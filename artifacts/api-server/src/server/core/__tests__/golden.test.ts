/**
 * Golden fixture test — standings.ts
 *
 * Loads the 4-team golden season from tests/seed/golden-season.ts,
 * calls computeStandings(), and deep-equals the committed expected output.
 *
 * This test catches regressions in the core algorithm that property-based
 * tests (which check invariants) would miss — e.g. a sorting swap that
 * preserves all invariants but changes positions.
 */
import { describe, it, expect } from "vitest";
import { goldenGames, goldenStandings, TEAMS } from "../../../../tests/seed/golden-season.js";
import { computeStandings } from "../standings.js";

// Expected standings — mirrors tests/fixtures/season-golden.json
const EXPECTED = [
  { team: "T3", GP: 3, W: 3, L: 0, OTL: 0, PTS: 6, ROW: 2, GF: 6, GA: 3,  DIFF: 3  },
  { team: "T1", GP: 3, W: 2, L: 1, OTL: 0, PTS: 4, ROW: 2, GF: 8, GA: 5,  DIFF: 3  },
  { team: "T2", GP: 3, W: 1, L: 1, OTL: 1, PTS: 3, ROW: 1, GF: 5, GA: 5,  DIFF: 0  },
  { team: "T4", GP: 3, W: 0, L: 2, OTL: 1, PTS: 1, ROW: 0, GF: 3, GA: 9,  DIFF: -6 },
];

describe("golden fixture — computeStandings matches committed expected output", () => {
  it("produces standings in the correct order", () => {
    const result = computeStandings(goldenGames);
    expect(result).toHaveLength(4);
    // T3 is first (6 pts), T1 second (4 pts), T2 third (3 pts), T4 last (1 pt)
    expect(result[0]!.team_season_id).toBe(TEAMS.T3);
    expect(result[1]!.team_season_id).toBe(TEAMS.T1);
    expect(result[2]!.team_season_id).toBe(TEAMS.T2);
    expect(result[3]!.team_season_id).toBe(TEAMS.T4);
  });

  it("matches fixture expected standings row-by-row", () => {
    const result = computeStandings(goldenGames);
    const teamKey = (uuid: string) =>
      Object.entries(TEAMS).find(([, v]) => v === uuid)?.[0] ?? uuid;

    for (let i = 0; i < EXPECTED.length; i++) {
      const expected = EXPECTED[i]!;
      const actual = result[i]!;
      const key = teamKey(actual.team_season_id);
      expect(key).toBe(expected.team);
      expect(actual.GP).toBe(expected.GP);
      expect(actual.W).toBe(expected.W);
      expect(actual.L).toBe(expected.L);
      expect(actual.OTL).toBe(expected.OTL);
      expect(actual.PTS).toBe(expected.PTS);
      expect(actual.ROW).toBe(expected.ROW);
      expect(actual.GF).toBe(expected.GF);
      expect(actual.GA).toBe(expected.GA);
      expect(actual.DIFF).toBe(expected.DIFF);
    }
  });

  it("goldenStandings export matches direct computation", () => {
    const direct = computeStandings(goldenGames);
    expect(goldenStandings).toEqual(direct);
  });

  it("T3 wins by PTS tiebreak (6 pts vs T1's 4 pts)", () => {
    const result = computeStandings(goldenGames);
    const t3 = result[0]!;
    const t1 = result[1]!;
    expect(t3.PTS).toBeGreaterThan(t1.PTS);
  });

  it("T3 has ROW=2 (regulation × 2, shootout × 1 — SO win excluded from ROW)", () => {
    const result = computeStandings(goldenGames);
    const t3 = result.find((e) => e.team_season_id === TEAMS.T3)!;
    expect(t3.W).toBe(3);
    expect(t3.ROW).toBe(2); // one win was a shootout
  });

  it("ΣGF = ΣGA across all four teams", () => {
    const result = computeStandings(goldenGames);
    const totalGF = result.reduce((s, e) => s + e.GF, 0);
    const totalGA = result.reduce((s, e) => s + e.GA, 0);
    expect(totalGF).toBe(totalGA);
  });

  it("GP = W + L + OTL for every team", () => {
    const result = computeStandings(goldenGames);
    for (const e of result) {
      expect(e.GP).toBe(e.W + e.L + e.OTL);
    }
  });
});
