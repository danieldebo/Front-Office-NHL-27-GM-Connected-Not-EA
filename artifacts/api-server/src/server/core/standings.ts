/**
 * server/core/standings.ts
 * Pure standings computation — no I/O, fully unit-testable.
 *
 * This is the canonical algorithm. The DB view `v_standings` mirrors this
 * logic for query performance; this function is the source of truth for CP6
 * property-based tests.
 */

export type Decision = "regulation" | "overtime" | "shootout";

export interface GameRecord {
  home_team_season_id: string;
  away_team_season_id: string;
  home_goals: number;
  away_goals: number;
  decision: Decision;
  counts_toward_standings: boolean;
}

export interface StandingsEntry {
  team_season_id: string;
  GP: number;
  W: number;
  L: number;
  OTL: number;
  PTS: number;
  ROW: number;
  GF: number;
  GA: number;
  DIFF: number;
}

export interface StandingsConfig {
  /** Points for a regulation or OT/SO win. Default: 2 */
  pointsWin?: number;
  /** Points for an OT or SO loss. Default: 1 */
  pointsOTLoss?: number;
}

/**
 * Compute NHL-style (2-1-0) standings from a set of game records.
 *
 * - Only games where `counts_toward_standings = true` are counted.
 * - OT wins count toward ROW; SO wins do not.
 * - Sort order: PTS DESC → ROW DESC → GF DESC (stable, deterministic).
 */
export function computeStandings(
  games: GameRecord[],
  config: StandingsConfig = {},
): StandingsEntry[] {
  const ptsWin = config.pointsWin ?? 2;
  const ptsOTL = config.pointsOTLoss ?? 1;

  const map = new Map<string, StandingsEntry>();

  const get = (id: string): StandingsEntry => {
    if (!map.has(id)) {
      map.set(id, {
        team_season_id: id,
        GP: 0, W: 0, L: 0, OTL: 0,
        PTS: 0, ROW: 0, GF: 0, GA: 0, DIFF: 0,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return map.get(id)!;
  };

  for (const g of games) {
    if (!g.counts_toward_standings) continue;

    const home = get(g.home_team_season_id);
    const away = get(g.away_team_season_id);
    const homeWin = g.home_goals > g.away_goals;

    home.GP++;
    away.GP++;
    home.GF += g.home_goals;
    home.GA += g.away_goals;
    away.GF += g.away_goals;
    away.GA += g.home_goals;

    if (g.decision === "regulation") {
      if (homeWin) {
        home.W++;
        home.ROW++;
        home.PTS += ptsWin;
        away.L++;
      } else {
        away.W++;
        away.ROW++;
        away.PTS += ptsWin;
        home.L++;
      }
    } else {
      // overtime or shootout: winner gets ptsWin, loser gets ptsOTL (OTL)
      if (homeWin) {
        home.W++;
        home.PTS += ptsWin;
        if (g.decision === "overtime") home.ROW++;
        away.OTL++;
        away.PTS += ptsOTL;
      } else {
        away.W++;
        away.PTS += ptsWin;
        if (g.decision === "overtime") away.ROW++;
        home.OTL++;
        home.PTS += ptsOTL;
      }
    }
  }

  const entries = [...map.values()];
  for (const e of entries) {
    e.DIFF = e.GF - e.GA;
  }

  return entries.sort(
    (a, b) => b.PTS - a.PTS || b.ROW - a.ROW || b.GF - a.GF,
  );
}
