/**
 * Property-based tests — server/core/standings.ts
 *
 * Uses fast-check to verify standing invariants hold for any valid set of games.
 * 1000 runs per property.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computeStandings, type GameRecord, type StandingsConfig } from "../standings.js";

// ── Arbitraries ───────────────────────────────────────────────────────────────

// Team IDs: single uppercase letters A–H so pairs are easy to reason about.
const teamId = fc.constantFrom("A", "B", "C", "D", "E", "F", "G", "H");

const decision = fc.constantFrom<GameRecord["decision"]>("regulation", "overtime", "shootout");

/**
 * A valid game record: home ≠ away, winner always has more goals,
 * OT/SO differ by exactly 1 (mandatory by game rules).
 */
const gameRecord: fc.Arbitrary<GameRecord> = fc
  .tuple(teamId, teamId, fc.boolean())
  .filter(([h, a]) => h !== a)
  .chain(([home, away, homeWins]) =>
    fc.tuple(
      fc.constant(home),
      fc.constant(away),
      fc.constant(homeWins),
      decision,
    ),
  )
  .chain(([home, away, homeWins, dec]) => {
    const goalsArb: fc.Arbitrary<[number, number]> =
      dec === "regulation"
        ? // Regulation: any non-tie score (winner has ≥1 more than loser)
          fc
            .tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 0, max: 8 }))
            .map(([margin, loserGoals]) =>
              homeWins
                ? ([margin + loserGoals, loserGoals] as [number, number])
                : ([loserGoals, margin + loserGoals] as [number, number]),
            )
        : // OT/SO: exactly 1-goal difference
          fc.integer({ min: 0, max: 8 }).map((base) =>
            homeWins
              ? ([base + 1, base] as [number, number])
              : ([base, base + 1] as [number, number]),
          );

    return fc.tuple(
      fc.constant(home),
      fc.constant(away),
      goalsArb,
      fc.constant(dec),
      fc.boolean(), // counts_toward_standings
    );
  })
  .map(([home, away, [homeGoals, awayGoals], dec, counts]) => ({
    home_team_season_id: home,
    away_team_season_id: away,
    home_goals: homeGoals,
    away_goals: awayGoals,
    decision: dec,
    counts_toward_standings: counts,
  }));

const gameList = fc.array(gameRecord, { minLength: 0, maxLength: 50 });

const standingsConfig: fc.Arbitrary<StandingsConfig> = fc.record({
  pointsWin: fc.integer({ min: 1, max: 4 }),
  pointsOTLoss: fc.integer({ min: 0, max: 2 }),
});

// ── Properties ────────────────────────────────────────────────────────────────

describe("property: GP = W + L + OTL for every team", () => {
  it("holds for 1000 random game sets", () => {
    fc.assert(
      fc.property(gameList, (games) => {
        const entries = computeStandings(games);
        for (const e of entries) {
          if (e.GP !== e.W + e.L + e.OTL) return false;
        }
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});

describe("property: PTS matches configured formula", () => {
  it("holds for 1000 random game sets with random configs", () => {
    fc.assert(
      fc.property(gameList, standingsConfig, (games, cfg) => {
        const entries = computeStandings(games, cfg);
        for (const e of entries) {
          const expected =
            e.W * (cfg.pointsWin ?? 2) + e.OTL * (cfg.pointsOTLoss ?? 1);
          if (e.PTS !== expected) return false;
        }
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});

describe("property: ΣGF = ΣGA across all teams", () => {
  it("holds for 1000 random game sets", () => {
    fc.assert(
      fc.property(gameList, (games) => {
        const entries = computeStandings(games);
        const totalGF = entries.reduce((s, e) => s + e.GF, 0);
        const totalGA = entries.reduce((s, e) => s + e.GA, 0);
        return totalGF === totalGA;
      }),
      { numRuns: 1000 },
    );
  });
});

describe("property: DIFF = GF - GA for every team", () => {
  it("holds for 1000 random game sets", () => {
    fc.assert(
      fc.property(gameList, (games) => {
        const entries = computeStandings(games);
        for (const e of entries) {
          if (e.DIFF !== e.GF - e.GA) return false;
        }
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});

describe("property: ROW ≤ W for every team", () => {
  it("holds for 1000 random game sets", () => {
    fc.assert(
      fc.property(gameList, (games) => {
        const entries = computeStandings(games);
        for (const e of entries) {
          if (e.ROW > e.W) return false;
        }
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});

describe("property: sort order is stable (PTS DESC → ROW DESC → GF DESC)", () => {
  it("holds for 1000 random game sets", () => {
    fc.assert(
      fc.property(gameList, (games) => {
        const entries = computeStandings(games);
        for (let i = 1; i < entries.length; i++) {
          const prev = entries[i - 1]!;
          const curr = entries[i]!;
          if (prev.PTS < curr.PTS) return false;
          if (prev.PTS === curr.PTS && prev.ROW < curr.ROW) return false;
          if (
            prev.PTS === curr.PTS &&
            prev.ROW === curr.ROW &&
            prev.GF < curr.GF
          )
            return false;
        }
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});

describe("property: excluded games never affect any team's record", () => {
  it("adding an excluded game does not change existing teams' stats", () => {
    const excludedGame: fc.Arbitrary<GameRecord> = gameRecord.map((g) => ({
      ...g,
      counts_toward_standings: false,
    }));

    fc.assert(
      fc.property(gameList, excludedGame, (games, excluded) => {
        const without = computeStandings(games);
        const withExcluded = computeStandings([...games, excluded]);
        for (const e of without) {
          const match = withExcluded.find(
            (x) => x.team_season_id === e.team_season_id,
          );
          if (!match) return false;
          if (match.GP !== e.GP || match.PTS !== e.PTS) return false;
        }
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});
