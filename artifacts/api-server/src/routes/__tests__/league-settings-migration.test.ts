import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationSql = readFileSync(
  resolve(process.cwd(), "../../db/migration-2.0.0-league-settings.sql"),
  "utf8",
).replace(/^BEGIN;\s*/u, "").replace(/\s*COMMIT;\s*$/u, "");

describe.sequential("league settings migration backfill", () => {
  it("preserves each legacy season and creates a separate active snapshot", async (ctx) => {
    const client = await pool.connect();
    try {
      const schema = await client.query<{ ready: boolean }>(
        `SELECT to_regclass('public.league_settings_version') IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'season'
                     AND column_name = 'max_seats'
                ) AS ready`,
      );
      if (!schema.rows[0]?.ready) {
        ctx.skip();
        return;
      }

      await client.query("BEGIN");
      const user = await client.query<{ id: string }>(
        `INSERT INTO app_user (replit_id, display_name, email)
         VALUES ($1, 'Migration Commissioner', $2) RETURNING id`,
        [`migration-${crypto.randomUUID()}`, `migration-${crypto.randomUUID()}@test.invalid`],
      );
      const league = await client.query<{ id: string }>(
        `INSERT INTO league (owner_user_id, name, slug)
         VALUES ($1, 'Migration League', $2) RETURNING id`,
        [user.rows[0]!.id, `migration-${crypto.randomUUID()}`],
      );
      const seasons = await client.query<{ id: string; ordinal: number }>(
        `INSERT INTO season (
           league_id, ordinal, label, game_title, salary_cap_cents,
           roster_min, roster_max, games_per_matchup, max_seats, is_active,
           created_at
         ) VALUES
           ($1, 1, 'Legacy One', 'NHL', 10000, 10, 20, 2, 5, FALSE, '2020-01-01'),
           ($1, 2, 'Legacy Two', 'NHL', 20000, 11, 21, 3, 7, TRUE,  '2021-01-01')
         RETURNING id, ordinal`,
        [league.rows[0]!.id],
      );
      const oldShared = await client.query<{ id: string }>(
        `INSERT INTO league_settings_version (
           league_id, version, team_count, salary_cap_cents, roster_min,
           roster_max, changed_by, change_summary
         ) VALUES ($1, 1, 32, 99999, 9, 19, $2,
                   'Initial settings migrated from existing league data')
         RETURNING id`,
        [league.rows[0]!.id, user.rows[0]!.id],
      );
      await client.query(
        `INSERT INTO league_settings_active (league_id, settings_version_id)
         VALUES ($1, $2)`,
        [league.rows[0]!.id, oldShared.rows[0]!.id],
      );
      await client.query(
        `UPDATE season SET settings_version_id = $1 WHERE league_id = $2`,
        [oldShared.rows[0]!.id, league.rows[0]!.id],
      );

      await client.query(migrationSql);

      const rows = await client.query<{
        ordinal: number;
        settings_version_id: string;
        migrated_from_season_id: string;
        team_count: number;
        schedule_format: string;
        games_per_matchup: number;
        salary_cap_cents: string;
        roster_min: number;
        roster_max: number;
      }>(
        `SELECT s.ordinal, s.settings_version_id, v.migrated_from_season_id,
                v.team_count, v.schedule_format,
                CASE v.schedule_format
                  WHEN 'round_robin' THEN 1
                  WHEN 'double_round_robin' THEN 2
                  ELSE (v.schedule_settings->>'games_per_matchup')::INT
                END AS games_per_matchup,
                v.salary_cap_cents, v.roster_min, v.roster_max
           FROM season s
           JOIN league_settings_version v ON v.id = s.settings_version_id
          WHERE s.league_id = $1
          ORDER BY s.ordinal`,
        [league.rows[0]!.id],
      );

      expect(rows.rows).toMatchObject([
        {
          ordinal: 1,
          migrated_from_season_id: seasons.rows[0]!.id,
          team_count: 5,
          schedule_format: "double_round_robin",
          games_per_matchup: 2,
          salary_cap_cents: "10000",
          roster_min: 10,
          roster_max: 20,
        },
        {
          ordinal: 2,
          migrated_from_season_id: seasons.rows[1]!.id,
          team_count: 7,
          schedule_format: "custom",
          games_per_matchup: 3,
          salary_cap_cents: "20000",
          roster_min: 11,
          roster_max: 21,
        },
      ]);

      const active = await client.query<{
        migrated_from_season_id: string | null;
        team_count: number;
        schedule_format: string;
        games_per_matchup: number;
        salary_cap_cents: string;
      }>(
        `SELECT v.migrated_from_season_id, v.team_count, v.schedule_format,
                (v.schedule_settings->>'games_per_matchup')::INT AS games_per_matchup,
                v.salary_cap_cents
           FROM league_settings_active a
           JOIN league_settings_version v ON v.id = a.settings_version_id
          WHERE a.league_id = $1`,
        [league.rows[0]!.id],
      );
      expect(active.rows[0]).toMatchObject({
        migrated_from_season_id: null,
        team_count: 7,
        schedule_format: "custom",
        games_per_matchup: 3,
        salary_cap_cents: "20000",
      });

      const count = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM league_settings_version WHERE league_id = $1`,
        [league.rows[0]!.id],
      );
      expect(Number(count.rows[0]!.count)).toBe(4);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("aborts instead of clamping an unrepresentable legacy schedule", async (ctx) => {
    const client = await pool.connect();
    try {
      const schema = await client.query<{ ready: boolean }>(
        `SELECT to_regclass('public.league_settings_version') IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'season'
                     AND column_name = 'max_seats'
                ) AS ready`,
      );
      if (!schema.rows[0]?.ready) {
        ctx.skip();
        return;
      }

      await client.query("BEGIN");
      const user = await client.query<{ id: string }>(
        `INSERT INTO app_user (replit_id, display_name, email)
         VALUES ($1, 'Invalid Migration Commissioner', $2) RETURNING id`,
        [`migration-invalid-${crypto.randomUUID()}`, `migration-invalid-${crypto.randomUUID()}@test.invalid`],
      );
      const league = await client.query<{ id: string }>(
        `INSERT INTO league (owner_user_id, name, slug)
         VALUES ($1, 'Invalid Migration League', $2) RETURNING id`,
        [user.rows[0]!.id, `migration-invalid-${crypto.randomUUID()}`],
      );
      await client.query(
        `INSERT INTO season (
           league_id, ordinal, label, game_title, games_per_matchup,
           max_seats, created_at
         ) VALUES ($1, 1, 'Invalid Legacy', 'NHL', 9, 8, '2020-01-01')`,
        [league.rows[0]!.id],
      );

      await expect(client.query(migrationSql)).rejects.toThrow(/cannot be represented/);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});