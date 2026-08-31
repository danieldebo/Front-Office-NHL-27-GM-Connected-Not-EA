import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { pool } from "@workspace/db";
import { runDigestTick } from "../digestScheduler";

const RUN_ID = crypto.randomBytes(4).toString("hex");

async function sql<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

let schemaReady = false;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'league_digest_send_log') AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
});

describe("runDigestTick", () => {
  it("enqueues one email per subscribed member, skips the unsubscribed, and dedups same-day", async () => {
    if (!schemaReady) return;

    const now = new Date();
    const utcDay = now.getUTCDay();
    const utcHour = now.getUTCHours();

    const [owner] = await sql<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [`digest-owner-${RUN_ID}`, `Digest Owner ${RUN_ID}`, `digest-owner-${RUN_ID}@test.invalid`],
    );
    const [memberSubscribed] = await sql<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [`digest-sub-${RUN_ID}`, `Digest Sub ${RUN_ID}`, `digest-sub-${RUN_ID}@test.invalid`],
    );
    const [memberUnsubscribed] = await sql<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [`digest-unsub-${RUN_ID}`, `Digest Unsub ${RUN_ID}`, `digest-unsub-${RUN_ID}@test.invalid`],
    );

    const [league] = await sql<{ id: string }>(
      `INSERT INTO league (owner_user_id, name, slug, digest_enabled, digest_day_of_week, digest_hour_local, digest_timezone)
       VALUES ($1,$2,$3, TRUE, $4, $5, 'UTC') RETURNING id`,
      [owner!.id, `Digest League ${RUN_ID}`, `digest-league-${RUN_ID}`, utcDay, utcHour],
    );
    const leagueId = league!.id;

    await sql(
      `INSERT INTO league_membership (league_id, user_id, digest_unsubscribed_at) VALUES ($1,$2,NULL)`,
      [leagueId, memberSubscribed!.id],
    );
    await sql(
      `INSERT INTO league_membership (league_id, user_id, digest_unsubscribed_at) VALUES ($1,$2,NOW())`,
      [leagueId, memberUnsubscribed!.id],
    );

    const [season] = await sql<{ id: string }>(
      `INSERT INTO season (league_id, ordinal, label, game_title, is_active) VALUES ($1,1,'Season 1','NHL',TRUE) RETURNING id`,
      [leagueId],
    );
    const [frA] = await sql<{ id: string }>(`INSERT INTO franchise (league_id, name) VALUES ($1,$2) RETURNING id`, [leagueId, `Digest Home ${RUN_ID}`]);
    const [frB] = await sql<{ id: string }>(`INSERT INTO franchise (league_id, name) VALUES ($1,$2) RETURNING id`, [leagueId, `Digest Away ${RUN_ID}`]);
    const [tsA] = await sql<{ id: string }>(`INSERT INTO team_season (season_id, franchise_id) VALUES ($1,$2) RETURNING id`, [season!.id, frA!.id]);
    const [tsB] = await sql<{ id: string }>(`INSERT INTO team_season (season_id, franchise_id) VALUES ($1,$2) RETURNING id`, [season!.id, frB!.id]);

    // A game within the trailing/leading 30-day activity window (keeps the league "active")
    await sql(
      `INSERT INTO game (season_id, home_team_season_id, away_team_season_id, window_opens_at, window_closes_at)
       VALUES ($1,$2,$3, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day')`,
      [season!.id, tsA!.id, tsB!.id],
    );

    const outboxBefore = await sql<{ count: string }>(`SELECT COUNT(*) FROM outbox WHERE topic = 'email.digest'`);

    const result = await runDigestTick(pool, now);
    expect(result.sent).toBe(1); // only the subscribed member

    const outboxAfter = await sql<{ payload: { to: string } }>(
      `SELECT payload FROM outbox WHERE topic = 'email.digest' ORDER BY id DESC LIMIT 1`,
    );
    expect(outboxAfter[0]!.payload.to).toBe(`digest-sub-${RUN_ID}@test.invalid`);

    const outboxCountAfter = await sql<{ count: string }>(`SELECT COUNT(*) FROM outbox WHERE topic = 'email.digest'`);
    expect(Number(outboxCountAfter[0]!.count)).toBe(Number(outboxBefore[0]!.count) + 1);

    // Second tick same "day" must not double-send (send-log dedup)
    const second = await runDigestTick(pool, now);
    expect(second.sent).toBe(0);
  });

  it("skips a league with no game activity in the trailing/leading 30 days", async () => {
    if (!schemaReady) return;
    const now = new Date();
    const utcDay = now.getUTCDay();
    const utcHour = now.getUTCHours();

    const [owner] = await sql<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [`digest-quiet-owner-${RUN_ID}`, `Quiet Owner ${RUN_ID}`, `digest-quiet-owner-${RUN_ID}@test.invalid`],
    );
    const [league] = await sql<{ id: string }>(
      `INSERT INTO league (owner_user_id, name, slug, digest_enabled, digest_day_of_week, digest_hour_local, digest_timezone)
       VALUES ($1,$2,$3, TRUE, $4, $5, 'UTC') RETURNING id`,
      [owner!.id, `Quiet League ${RUN_ID}`, `quiet-league-${RUN_ID}`, utcDay, utcHour],
    );
    const before = await sql<{ count: string }>(`SELECT COUNT(*) FROM league_digest_send_log WHERE league_id = $1`, [league!.id]);
    expect(Number(before[0]!.count)).toBe(0);

    await runDigestTick(pool, now);

    const after = await sql<{ count: string }>(`SELECT COUNT(*) FROM league_digest_send_log WHERE league_id = $1`, [league!.id]);
    expect(Number(after[0]!.count)).toBe(0);
  });
});
