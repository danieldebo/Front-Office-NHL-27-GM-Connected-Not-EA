/**
 * Registry sync job — docs/registry-sync-spec.md §2.
 *
 * Pulls skater + goalie season summaries for the last N seasons, collapses to
 * a distinct player set, and upserts into `player` keyed on
 * external_ids->>'nhl_api'. Idempotent by construction (player_nhl_id_unique):
 * re-running the whole job changes nothing but registry_synced_at.
 *
 * Never touches `is_manual` players — the upsert only ever writes rows it
 * owns (registry-backed), matched by conflict target on the nhl_api id.
 */
import type { Pool } from "pg";
import { fetchGoalieSummaries, fetchSkaterSummaries, nhlSeasonId } from "../nhlApi";

const REGISTRY_SYNC_SEASONS = Number(process.env["REGISTRY_SYNC_SEASONS"] ?? 5);

interface CollapsedPlayer {
  nhlPlayerId: number;
  fullName: string;
  position: string;
  shoots: string | null;
  birthdate: string | null;
  countryCode: string | null;
  currentTeamAbbrev: string | null;
  sweaterNum: number | null;
}

function lastNSeasonIds(n: number): string[] {
  const thisYear = new Date().getFullYear();
  return Array.from({ length: n }, (_, i) => nhlSeasonId(thisYear - i));
}

export interface RegistrySyncResult {
  playersUpserted: number;
  quarantined: number;
  error: string | null;
}

export async function runRegistrySync(pool: Pool): Promise<RegistrySyncResult> {
  const { rows: syncRow } = await pool.query<{ id: string }>(
    `INSERT INTO registry_sync (source) VALUES ('nhl_stats_api') RETURNING id`,
  );
  const syncId = syncRow[0]!.id;

  const byId = new Map<number, CollapsedPlayer>();
  let quarantined = 0;

  try {
    for (const seasonId of lastNSeasonIds(REGISTRY_SYNC_SEASONS)) {
      const skaters = await fetchSkaterSummaries(seasonId);
      quarantined += skaters.quarantined;
      for (const row of skaters.rows) {
        byId.set(row.playerId, {
          nhlPlayerId: row.playerId,
          fullName: row.skaterFullName,
          position: row.positionCode,
          shoots: row.shootsCatches ?? null,
          birthdate: row.birthDate ?? null,
          countryCode: row.birthCountryCode ?? null,
          currentTeamAbbrev: (row.teamAbbrevs ?? "").split(",")[0]?.trim() || null,
          sweaterNum: row.sweaterNumber ?? null,
        });
      }

      const goalies = await fetchGoalieSummaries(seasonId);
      quarantined += goalies.quarantined;
      for (const row of goalies.rows) {
        byId.set(row.playerId, {
          nhlPlayerId: row.playerId,
          fullName: row.goalieFullName,
          position: "G",
          shoots: row.shootsCatches ?? null,
          birthdate: row.birthDate ?? null,
          countryCode: row.birthCountryCode ?? null,
          currentTeamAbbrev: (row.teamAbbrevs ?? "").split(",")[0]?.trim() || null,
          sweaterNum: null,
        });
      }
    }

    let upserted = 0;
    for (const p of byId.values()) {
      await pool.query(
        `INSERT INTO player (full_name, position, shoots, birthdate, country_code,
                              current_team_abbrev, sweater_num, external_ids,
                              registry_synced_at, is_manual)
         VALUES ($1,$2,$3,$4,$5,$6,$7, jsonb_build_object('nhl_api', $8::text), now(), false)
         ON CONFLICT ((external_ids->>'nhl_api')) WHERE external_ids ? 'nhl_api'
         DO UPDATE SET
             full_name           = EXCLUDED.full_name,
             position            = EXCLUDED.position,
             current_team_abbrev = EXCLUDED.current_team_abbrev,
             sweater_num         = EXCLUDED.sweater_num,
             registry_synced_at  = now()`,
        [
          p.fullName, p.position, p.shoots, p.birthdate, p.countryCode,
          p.currentTeamAbbrev, p.sweaterNum, String(p.nhlPlayerId),
        ],
      );
      upserted++;
    }

    await pool.query(
      `UPDATE registry_sync SET completed_at = now(), players_upserted = $2 WHERE id = $1`,
      [syncId, upserted],
    );
    return { playersUpserted: upserted, quarantined, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE registry_sync SET completed_at = now(), players_upserted = $2, error = $3 WHERE id = $1`,
      [syncId, byId.size, message],
    );
    return { playersUpserted: 0, quarantined, error: message };
  }
}
