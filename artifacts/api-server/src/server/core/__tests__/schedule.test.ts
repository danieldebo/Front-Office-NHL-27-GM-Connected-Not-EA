/**
 * Unit tests — server/core/schedule.ts
 *
 * Verifies schedule balance invariants and edge cases.
 */
import { describe, it, expect } from "vitest";
import { generateSchedule, checkScheduleBalance, type ScheduleConfig } from "../schedule.js";

function makeTeams(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    teamSeasonId: `team-${String(i + 1).padStart(2, "0")}`,
  }));
}

const START = new Date("2025-10-01T00:00:00Z");

// ── generateSchedule ──────────────────────────────────────────────────────────

describe("generateSchedule — 4 teams, 1 matchup", () => {
  const cfg: ScheduleConfig = {
    teams: makeTeams(4),
    gamesPerMatchup: 1,
    seasonStartDate: START,
  };

  it("generates (N-1) × gamesPerMatchup × N/2 total games", () => {
    const { games } = generateSchedule(cfg);
    // 3 rounds × 2 games/round = 6 games
    expect(games).toHaveLength(6);
  });

  it("every team plays every other team exactly once", () => {
    const { games } = generateSchedule(cfg);
    const err = checkScheduleBalance(games, 4, 1);
    expect(err).toBeNull();
  });

  it("no team plays itself", () => {
    const { games } = generateSchedule(cfg);
    for (const g of games) {
      expect(g.homeTeamSeasonId).not.toBe(g.awayTeamSeasonId);
    }
  });

  it("home/away counts differ by at most 1 per team", () => {
    const { games } = generateSchedule(cfg);
    const home = new Map<string, number>();
    const away = new Map<string, number>();
    for (const g of games) {
      home.set(g.homeTeamSeasonId, (home.get(g.homeTeamSeasonId) ?? 0) + 1);
      away.set(g.awayTeamSeasonId, (away.get(g.awayTeamSeasonId) ?? 0) + 1);
    }
    for (const [t] of home) {
      const h = home.get(t) ?? 0;
      const a = away.get(t) ?? 0;
      expect(Math.abs(h - a)).toBeLessThanOrEqual(1);
    }
  });

  it("week numbers start at 1 and increment correctly", () => {
    const { games } = generateSchedule(cfg);
    const weeks = [...new Set(games.map((g) => g.weekNumber))].sort((a, b) => a - b);
    expect(weeks[0]).toBe(1);
    expect(weeks[weeks.length - 1]).toBe(3); // N-1 rounds for 4 teams
  });

  it("window dates are sequential and non-overlapping", () => {
    const { games } = generateSchedule(cfg);
    const byWeek = new Map<number, typeof games[0]>();
    for (const g of games) byWeek.set(g.weekNumber, g);
    const sorted = [...byWeek.values()].sort((a, b) => a.weekNumber - b.weekNumber);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.windowOpensAt.getTime()).toBeGreaterThanOrEqual(
        sorted[i - 1]!.windowClosesAt.getTime(),
      );
    }
  });
});

describe("generateSchedule — 8 teams, 2 matchups", () => {
  const cfg: ScheduleConfig = {
    teams: makeTeams(8),
    gamesPerMatchup: 2,
    seasonStartDate: START,
  };

  it("passes checkScheduleBalance", () => {
    const { games } = generateSchedule(cfg);
    expect(checkScheduleBalance(games, 8, 2)).toBeNull();
  });

  it("every team plays exactly (N-1)*2 = 14 games", () => {
    const { games } = generateSchedule(cfg);
    const counts = new Map<string, number>();
    for (const g of games) {
      counts.set(g.homeTeamSeasonId, (counts.get(g.homeTeamSeasonId) ?? 0) + 1);
      counts.set(g.awayTeamSeasonId, (counts.get(g.awayTeamSeasonId) ?? 0) + 1);
    }
    for (const [, c] of counts) {
      expect(c).toBe(14);
    }
  });
});

describe("generateSchedule — 32 teams, 1 matchup (full NHL season shape)", () => {
  const cfg: ScheduleConfig = {
    teams: makeTeams(32),
    gamesPerMatchup: 1,
    seasonStartDate: START,
  };

  it("generates 496 games (32*31/2)", () => {
    const { games } = generateSchedule(cfg);
    expect(games).toHaveLength(496);
  });

  it("passes balance check", () => {
    const { games } = generateSchedule(cfg);
    expect(checkScheduleBalance(games, 32, 1)).toBeNull();
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("generateSchedule — error cases", () => {
  it("throws when fewer than 2 teams", () => {
    expect(() =>
      generateSchedule({ teams: makeTeams(1), gamesPerMatchup: 1, seasonStartDate: START }),
    ).toThrow("at least 2");
  });

  it("supports an odd configured team count with one rotating bye", () => {
    const { games, totalWeeks } = generateSchedule({
      teams: makeTeams(3), gamesPerMatchup: 1, seasonStartDate: START,
    });
    expect(games).toHaveLength(3);
    expect(totalWeeks).toBe(3);
    expect(checkScheduleBalance(games, 3, 1)).toBeNull();
  });
});

// ── checkScheduleBalance ──────────────────────────────────────────────────────

describe("checkScheduleBalance — detects violations", () => {
  it("returns error string when a team plays itself", () => {
    const bad = [
      {
        homeTeamSeasonId: "A",
        awayTeamSeasonId: "A",
        weekNumber: 1,
        windowOpensAt: START,
        windowClosesAt: new Date(START.getTime() + 7 * 86400000),
      },
    ];
    const err = checkScheduleBalance(bad, 1, 1);
    expect(err).toMatch(/plays itself/);
  });

  it("returns error string when team count mismatches", () => {
    const cfg: ScheduleConfig = {
      teams: makeTeams(4),
      gamesPerMatchup: 1,
      seasonStartDate: START,
    };
    const { games } = generateSchedule(cfg);
    // Pass expectedTeamCount=6 — should fail
    const err = checkScheduleBalance(games, 6, 1);
    expect(err).toMatch(/Expected 6 teams/);
  });
});
