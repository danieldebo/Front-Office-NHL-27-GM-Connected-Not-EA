/**
 * Stat-card refresh job — docs/registry-sync-spec.md §3.
 *
 * Fills the 1/3/5-year card for one registry-matched player, lazily, on
 * demand (never pre-computed for every player — most are never kept). Reads
 * this player's per-season lines and aggregates into three windows; a
 * partial career produces an honestly short window, never a padded one.
 *
 * Writes ONLY to player_stat_card — no reach into any league fact table, so
 * these real-world NHL numbers can never leak into `v_standings` (replit.md
 * rule 17, keeper-addendum.md §5).
 */
import type { Pool } from "pg";
import { fetchGoalieSummaries, fetchSkaterSummaries, nhlSeasonId } from "../nhlApi";

const STATCARD_STALE_DAYS = Number(process.env["STATCARD_STALE_DAYS"] ?? 7);
const WINDOWS = [1, 3, 5] as const;

interface SeasonLine {
  seasonId: string;
  gp: number;
  // skater
  g?: number; a?: number; pts?: number; plusMinus?: number; pim?: number; sog?: number; toiPerGame?: number;
  // goalie
  gs?: number; w?: number; l?: number; otl?: number; so?: number; saves?: number; goalsAgainst?: number; toiSeconds?: number;
}

async function seasonLinesFor(nhlPlayerId: number, position: string, seasons: string[]): Promise<SeasonLine[]> {
  const isGoalie = position === "G";
  const lines: SeasonLine[] = [];
  for (const seasonId of seasons) {
    if (isGoalie) {
      const { rows } = await fetchGoalieSummaries(seasonId);
      const row = rows.find((r) => r.playerId === nhlPlayerId);
      if (row && (row.gamesPlayed ?? 0) > 0) {
        lines.push({
          seasonId, gp: row.gamesPlayed ?? 0, gs: row.gamesStarted ?? 0,
          w: row.wins ?? 0, l: row.losses ?? 0, otl: row.otLosses ?? 0, so: row.shutouts ?? 0,
          saves: row.saves ?? 0, goalsAgainst: row.goalsAgainst ?? 0, toiSeconds: row.timeOnIce ?? 0,
        });
      }
    } else {
      const { rows } = await fetchSkaterSummaries(seasonId);
      const row = rows.find((r) => r.playerId === nhlPlayerId);
      if (row && (row.gamesPlayed ?? 0) > 0) {
        lines.push({
          seasonId, gp: row.gamesPlayed ?? 0, g: row.goals ?? 0, a: row.assists ?? 0,
          pts: row.points ?? 0, plusMinus: row.plusMinus ?? 0, pim: row.penaltyMinutes ?? 0,
          sog: row.shots ?? 0, toiPerGame: row.timeOnIcePerGame ?? 0,
        });
      }
    }
  }
  return lines;
}

function aggregate(lines: SeasonLine[], isGoalie: boolean): Record<string, number> {
  if (isGoalie) {
    const gp = sum(lines, "gp"), gs = sum(lines, "gs"), w = sum(lines, "w"), l = sum(lines, "l"),
      otl = sum(lines, "otl"), so = sum(lines, "so"), saves = sum(lines, "saves"),
      ga = sum(lines, "goalsAgainst"), toiSec = sum(lines, "toiSeconds");
    return {
      GP: gp, GS: gs, W: w, L: l, OTL: otl, SO: so,
      "SV%": saves + ga > 0 ? round(saves / (saves + ga), 3) : 0,
      GAA: toiSec > 0 ? round((ga * 3600) / toiSec, 2) : 0,
    };
  }
  const gp = sum(lines, "gp"), g = sum(lines, "g"), a = sum(lines, "a"), pts = sum(lines, "pts"),
    plusMinus = sum(lines, "plusMinus"), pim = sum(lines, "pim"), sog = sum(lines, "sog"),
    toiTotal = lines.reduce((t, l) => t + (l.toiPerGame ?? 0) * l.gp, 0);
  return {
    GP: gp, G: g, A: a, PTS: pts, "+/-": plusMinus, PIM: pim, SOG: sog,
    "S%": sog > 0 ? round(g / sog, 3) : 0,
    "TOI/GP": gp > 0 ? round(toiTotal / gp, 1) : 0,
  };
}

function sum(lines: SeasonLine[], key: keyof SeasonLine): number {
  return lines.reduce((t, l) => t + (Number(l[key]) || 0), 0);
}

function round(n: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function seasonSpan(seasonIds: string[]): string | null {
  if (seasonIds.length === 0) return null;
  const label = (id: string) => `${id.slice(0, 4)}-${id.slice(6, 8)}`;
  const sorted = [...seasonIds].sort();
  return sorted.length === 1 ? label(sorted[0]!) : `${label(sorted[0]!)} – ${label(sorted[sorted.length - 1]!)}`;
}

export async function refreshStatCards(pool: Pool, playerId: string): Promise<{ refreshed: boolean; reason?: string }> {
  const { rows } = await pool.query<{ id: string; position: string; nhl_id: string | null }>(
    `SELECT id, position, external_ids->>'nhl_api' AS nhl_id FROM player WHERE id = $1`,
    [playerId],
  );
  const player = rows[0];
  if (!player || !player.nhl_id) return { refreshed: false, reason: "not registry-matched" };

  const nhlPlayerId = Number(player.nhl_id);
  const isGoalie = player.position === "G";
  const maxWindow = Math.max(...WINDOWS);
  const seasons = Array.from({ length: maxWindow }, (_, i) => nhlSeasonId(new Date().getFullYear() - i));
  const lines = await seasonLinesFor(nhlPlayerId, player.position, seasons);
  if (lines.length === 0) return { refreshed: false, reason: "no season lines found" };

  const staleAfter = new Date(Date.now() + STATCARD_STALE_DAYS * 86_400_000).toISOString();
  for (const windowYears of WINDOWS) {
    const windowLines = lines.slice(0, windowYears);
    const statLine = aggregate(windowLines, isGoalie);
    await pool.query(
      `INSERT INTO player_stat_card (player_id, window_years, stat_line, season_span, source, fetched_at, stale_after)
       VALUES ($1,$2,$3,$4,'nhl_stats_api', now(), $5)
       ON CONFLICT (player_id, window_years) DO UPDATE SET
         stat_line = EXCLUDED.stat_line, season_span = EXCLUDED.season_span,
         fetched_at = now(), stale_after = EXCLUDED.stale_after`,
      [playerId, windowYears, JSON.stringify(statLine), seasonSpan(windowLines.map((l) => l.seasonId)), staleAfter],
    );
  }
  return { refreshed: true };
}
