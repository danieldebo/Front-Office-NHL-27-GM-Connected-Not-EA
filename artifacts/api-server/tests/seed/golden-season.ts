/**
 * tests/seed/golden-season.ts
 *
 * Deterministic 4-team golden season fixture.
 *
 * Teams T1–T4 play a single round-robin (6 games total, 1 per matchup).
 * All game results are hardcoded with known outcomes so the expected
 * standings are computed in advance and committed as a fixture.
 *
 * Usage:
 *   import { goldenGames, goldenStandings } from './golden-season.js';
 */
import { computeStandings, type GameRecord, type StandingsEntry } from "../../src/server/core/standings.js";

// ── Fixed team UUIDs ──────────────────────────────────────────────────────────
// Using zero-padded UUID v4 nulls with sequential suffixes for readability.
export const TEAMS = {
  T1: "00000000-0000-0000-0000-000000000001",
  T2: "00000000-0000-0000-0000-000000000002",
  T3: "00000000-0000-0000-0000-000000000003",
  T4: "00000000-0000-0000-0000-000000000004",
} as const;

// ── Known game results ────────────────────────────────────────────────────────
//
// Round-robin schedule (all counts_toward_standings = true):
//
//   Game 1: T1(home) 3–1 T2(away)  — regulation  → T1: W+ROW, T2: L
//   Game 2: T3(home) 2–1 T4(away)  — overtime    → T3: W+ROW, T4: OTL
//   Game 3: T3(home) 2–1 T1(away)  — regulation  → T3: W+ROW, T1: L
//   Game 4: T2(home) 3–0 T4(away)  — regulation  → T2: W+ROW, T4: L
//   Game 5: T1(home) 4–2 T4(away)  — regulation  → T1: W+ROW, T4: L
//   Game 6: T3(home) 2–1 T2(away)  — shootout    → T3: W (NO ROW), T2: OTL
//
// Expected standings (default 2-1-0 config):
//   1. T3: GP=3, W=3, L=0, OTL=0, PTS=6, ROW=2, GF=6, GA=3,  DIFF=3
//   2. T1: GP=3, W=2, L=1, OTL=0, PTS=4, ROW=2, GF=8, GA=5,  DIFF=3
//   3. T2: GP=3, W=1, L=1, OTL=1, PTS=3, ROW=1, GF=5, GA=5,  DIFF=0
//   4. T4: GP=3, W=0, L=2, OTL=1, PTS=1, ROW=0, GF=3, GA=9,  DIFF=-6

export const goldenGames: GameRecord[] = [
  {
    home_team_season_id: TEAMS.T1,
    away_team_season_id: TEAMS.T2,
    home_goals: 3,
    away_goals: 1,
    decision: "regulation",
    counts_toward_standings: true,
  },
  {
    home_team_season_id: TEAMS.T3,
    away_team_season_id: TEAMS.T4,
    home_goals: 2,
    away_goals: 1,
    decision: "overtime",
    counts_toward_standings: true,
  },
  {
    home_team_season_id: TEAMS.T3,
    away_team_season_id: TEAMS.T1,
    home_goals: 2,
    away_goals: 1,
    decision: "regulation",
    counts_toward_standings: true,
  },
  {
    home_team_season_id: TEAMS.T2,
    away_team_season_id: TEAMS.T4,
    home_goals: 3,
    away_goals: 0,
    decision: "regulation",
    counts_toward_standings: true,
  },
  {
    home_team_season_id: TEAMS.T1,
    away_team_season_id: TEAMS.T4,
    home_goals: 4,
    away_goals: 2,
    decision: "regulation",
    counts_toward_standings: true,
  },
  {
    home_team_season_id: TEAMS.T3,
    away_team_season_id: TEAMS.T2,
    home_goals: 2,
    away_goals: 1,
    decision: "shootout",
    counts_toward_standings: true,
  },
];

export const goldenStandings: StandingsEntry[] = computeStandings(goldenGames);
