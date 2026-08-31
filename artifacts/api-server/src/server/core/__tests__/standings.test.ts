/**
 * Unit tests — server/core/standings.ts
 *
 * Covers every tiebreaker path, superseded-game exclusion, and config variants.
 */
import { describe, it, expect } from "vitest";
import { computeStandings, type GameRecord, type StandingsConfig } from "../standings.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function game(
  home: string,
  away: string,
  homeGoals: number,
  awayGoals: number,
  decision: GameRecord["decision"] = "regulation",
  counts = true,
): GameRecord {
  return {
    home_team_season_id: home,
    away_team_season_id: away,
    home_goals: homeGoals,
    away_goals: awayGoals,
    decision,
    counts_toward_standings: counts,
  };
}

function byTeam(entries: ReturnType<typeof computeStandings>) {
  return Object.fromEntries(entries.map((e) => [e.team_season_id, e]));
}

// ── Basic points ──────────────────────────────────────────────────────────────

describe("computeStandings — basic points", () => {
  it("regulation win: winner gets 2 pts, loser gets 0", () => {
    const result = computeStandings([game("A", "B", 3, 1)]);
    const t = byTeam(result);
    expect(t["A"]!.PTS).toBe(2);
    expect(t["B"]!.PTS).toBe(0);
  });

  it("overtime win: winner 2 pts, loser 1 pt (OTL)", () => {
    const result = computeStandings([game("A", "B", 2, 1, "overtime")]);
    const t = byTeam(result);
    expect(t["A"]!.PTS).toBe(2);
    expect(t["B"]!.PTS).toBe(1);
    expect(t["B"]!.OTL).toBe(1);
    expect(t["B"]!.L).toBe(0);
  });

  it("shootout win: winner 2 pts, loser 1 pt (OTL)", () => {
    const result = computeStandings([game("A", "B", 2, 1, "shootout")]);
    const t = byTeam(result);
    expect(t["A"]!.PTS).toBe(2);
    expect(t["B"]!.PTS).toBe(1);
  });

  it("respects custom point configuration", () => {
    const cfg: StandingsConfig = { pointsWin: 3, pointsOTLoss: 0 };
    const result = computeStandings([game("A", "B", 2, 1, "overtime")], cfg);
    const t = byTeam(result);
    expect(t["A"]!.PTS).toBe(3);
    expect(t["B"]!.PTS).toBe(0);
  });
});

// ── ROW (Regulation+OT Wins) ──────────────────────────────────────────────────

describe("computeStandings — ROW tiebreaker", () => {
  it("regulation win counts toward ROW", () => {
    const result = computeStandings([game("A", "B", 3, 1, "regulation")]);
    expect(byTeam(result)["A"]!.ROW).toBe(1);
  });

  it("overtime win counts toward ROW", () => {
    const result = computeStandings([game("A", "B", 2, 1, "overtime")]);
    expect(byTeam(result)["A"]!.ROW).toBe(1);
  });

  it("shootout win does NOT count toward ROW", () => {
    const result = computeStandings([game("A", "B", 2, 1, "shootout")]);
    expect(byTeam(result)["A"]!.ROW).toBe(0);
  });
});

// ── GP / W / L / OTL ─────────────────────────────────────────────────────────

describe("computeStandings — GP/W/L/OTL invariant", () => {
  it("GP = W + L + OTL for every team", () => {
    const games = [
      game("A", "B", 3, 1, "regulation"),
      game("A", "C", 2, 1, "overtime"),
      game("B", "C", 1, 2, "shootout"),
    ];
    for (const e of computeStandings(games)) {
      expect(e.GP).toBe(e.W + e.L + e.OTL);
    }
  });
});

// ── GF / GA / DIFF ────────────────────────────────────────────────────────────

describe("computeStandings — GF/GA/DIFF", () => {
  it("home team accumulates correct GF and GA", () => {
    const result = computeStandings([game("A", "B", 4, 2)]);
    const t = byTeam(result);
    expect(t["A"]!.GF).toBe(4);
    expect(t["A"]!.GA).toBe(2);
    expect(t["A"]!.DIFF).toBe(2);
  });

  it("away team accumulates correct GF and GA", () => {
    const result = computeStandings([game("A", "B", 4, 2)]);
    const t = byTeam(result);
    expect(t["B"]!.GF).toBe(2);
    expect(t["B"]!.GA).toBe(4);
    expect(t["B"]!.DIFF).toBe(-2);
  });

  it("league-wide ΣGF = ΣGA", () => {
    const games = [
      game("A", "B", 3, 1),
      game("C", "D", 2, 2, "overtime"), // OT can't be a tie, but for GF/GA purposes we allow it here
      game("A", "C", 5, 4),
    ];
    // replace with realistic scores
    const realistic = [
      game("A", "B", 3, 1),
      game("C", "D", 2, 1, "overtime"),
      game("A", "C", 5, 4),
    ];
    const entries = computeStandings(realistic);
    const totalGF = entries.reduce((s, e) => s + e.GF, 0);
    const totalGA = entries.reduce((s, e) => s + e.GA, 0);
    expect(totalGF).toBe(totalGA);
  });
});

// ── Sort order ────────────────────────────────────────────────────────────────

describe("computeStandings — sort order", () => {
  it("PTS DESC is primary sort key", () => {
    const games = [
      game("A", "B", 3, 1), // A: 2pts
      game("C", "D", 3, 1), // C: 2pts
      game("B", "C", 1, 3), // C now 4pts, A still 2pts; B 0pts, D 0pts
    ];
    const result = computeStandings(games);
    expect(result[0]!.team_season_id).toBe("C");
    expect(result[1]!.team_season_id).toBe("A");
  });

  it("ROW is tiebreaker when PTS are equal", () => {
    // A and B each have 2 pts; A got it via regulation, B via OT (so B: ROW=1, A: ROW=1... need to differentiate)
    // Give A a regulation win and B a shootout win (ROW=0)
    const games = [
      game("A", "X", 3, 1, "regulation"),  // A: 2pts ROW=1
      game("B", "Y", 2, 1, "shootout"),    // B: 2pts ROW=0
    ];
    const result = computeStandings(games);
    const positions = result.map((e) => e.team_season_id);
    expect(positions.indexOf("A")).toBeLessThan(positions.indexOf("B"));
  });

  it("GF is tiebreaker when PTS and ROW are equal", () => {
    // Both teams win by regulation (equal PTS and ROW). Higher GF wins tiebreak.
    const games = [
      game("A", "X", 5, 1, "regulation"),  // A: 2pts, ROW=1, GF=5
      game("B", "Y", 2, 1, "regulation"),  // B: 2pts, ROW=1, GF=2
    ];
    const result = computeStandings(games);
    const positions = result.map((e) => e.team_season_id);
    expect(positions.indexOf("A")).toBeLessThan(positions.indexOf("B"));
  });
});

// ── counts_toward_standings = false ───────────────────────────────────────────

describe("computeStandings — excluded games", () => {
  it("games with counts_toward_standings=false are ignored entirely", () => {
    const excluded = game("A", "B", 5, 0, "regulation", false);
    const result = computeStandings([excluded]);
    expect(result).toHaveLength(0);
  });

  it("mix: only counted games affect standings", () => {
    const counted = game("A", "B", 3, 1, "regulation", true);
    const excluded = game("A", "B", 0, 5, "regulation", false); // would flip standings if counted
    const result = computeStandings([counted, excluded]);
    const t = byTeam(result);
    expect(t["A"]!.W).toBe(1);
    expect(t["A"]!.L).toBe(0);
    expect(t["A"]!.GP).toBe(1); // only 1 counted game
  });
});

// ── Empty input ───────────────────────────────────────────────────────────────

describe("computeStandings — edge cases", () => {
  it("returns empty array for no games", () => {
    expect(computeStandings([])).toEqual([]);
  });

  it("returns empty array when all games are excluded", () => {
    const g = game("A", "B", 3, 1, "regulation", false);
    expect(computeStandings([g])).toEqual([]);
  });

  it("handles a single team appearing only on one side consistently", () => {
    const result = computeStandings([game("A", "B", 2, 1, "regulation")]);
    const t = byTeam(result);
    expect(t["A"]).toBeDefined();
    expect(t["B"]).toBeDefined();
  });
});
