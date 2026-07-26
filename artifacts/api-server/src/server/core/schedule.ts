/**
 * server/core/schedule.ts — pure schedule generation (no DB, no Express)
 *
 * Algorithm: circle method (round-robin tournament scheduling).
 * For N teams: N−1 rounds, N/2 games per round.
 * Fix one team; rotate the rest one position each round.
 *
 * Home/away: the fixed team alternates home/away each round.
 * For other pairs, parity is derived from round + pair index so every team
 * ends up with equal home and away games (±1 for odd game counts).
 *
 * For games_per_matchup > 1: repeat the full schedule with home/away swapped
 * so each team hosts each opponent the same number of times.
 */

export interface TeamRef {
  teamSeasonId: string;
}

export interface ScheduledGame {
  homeTeamSeasonId: string;
  awayTeamSeasonId: string;
  weekNumber: number;
  windowOpensAt: Date;
  windowClosesAt: Date;
}

export interface ScheduleConfig {
  teams: TeamRef[];
  gamesPerMatchup: number;
  /** First week's window_opens_at. */
  seasonStartDate: Date;
  /** How many days each window spans. Default 7. */
  weekDurationDays?: number;
}

export interface ScheduleResult {
  games: ScheduledGame[];
  totalRounds: number;
  totalWeeks: number;
}

/**
 * Generate a balanced round-robin schedule using the circle method.
 *
 * Invariants guaranteed:
 *  - Every team plays every other team exactly `gamesPerMatchup` times.
 *  - Total games per team = (N-1) × gamesPerMatchup.
 *  - Home and away counts differ by at most 1 per team.
 *  - No team plays itself.
 *
 * @throws {Error} if teams.length < 2 or is odd.
 */
export function generateSchedule(config: ScheduleConfig): ScheduleResult {
  const { teams, gamesPerMatchup, seasonStartDate, weekDurationDays = 7 } = config;
  const n = teams.length;

  if (n < 2) throw new Error("Need at least 2 teams to generate a schedule");
  if (n % 2 !== 0) throw new Error("Team count must be even");

  const weekMs = weekDurationDays * 24 * 3600 * 1000;
  const games: ScheduledGame[] = [];

  // Fix the last team; rotate indices 0..n-2.
  const fixed = n - 1;
  const numRoundsPerPass = n - 1;

  for (let pass = 0; pass < gamesPerMatchup; pass++) {
    const swapHomeAway = pass % 2 === 1;

    for (let r = 0; r < numRoundsPerPass; r++) {
      const weekNumber = pass * numRoundsPerPass + r + 1;
      const windowOpensAt = new Date(seasonStartDate.getTime() + (weekNumber - 1) * weekMs);
      const windowClosesAt = new Date(windowOpensAt.getTime() + weekMs);

      // Rotate the non-fixed indices left by r positions each round.
      const rot: number[] = [];
      for (let i = 0; i < n - 1; i++) {
        rot.push((r + i) % (n - 1));
      }

      // Game 0: fixed vs rot[0]
      const fixedIsHome = (r % 2 === 0) !== swapHomeAway;
      const fixedId = teams[fixed]!.teamSeasonId;
      const rot0Id = teams[rot[0]!]!.teamSeasonId;
      games.push({
        homeTeamSeasonId: fixedIsHome ? fixedId : rot0Id,
        awayTeamSeasonId: fixedIsHome ? rot0Id : fixedId,
        weekNumber,
        windowOpensAt,
        windowClosesAt,
      });

      // Games 1..n/2-1: pair rot[i] vs rot[n-2-i]
      for (let i = 1; i < n / 2; i++) {
        const aId = teams[rot[i]!]!.teamSeasonId;
        const bId = teams[rot[n - 1 - i]!]!.teamSeasonId;
        // aId (rot[i]) is always home in pass 0 and always away in pass 1.
        // This guarantees every pair gets one home and one away game per matchup
        // and each team's home/away count differs by at most 1 over the schedule.
        const aIsHome = !swapHomeAway;
        games.push({
          homeTeamSeasonId: aIsHome ? aId : bId,
          awayTeamSeasonId: aIsHome ? bId : aId,
          weekNumber,
          windowOpensAt,
          windowClosesAt,
        });
      }
    }
  }

  const totalWeeks = numRoundsPerPass * gamesPerMatchup;
  return { games, totalRounds: totalWeeks, totalWeeks };
}

/**
 * Verify schedule balance. Returns null if all invariants hold,
 * or a description of the first violation found.
 *
 * Called by the generate endpoint after generation to catch bugs before insert.
 */
export function checkScheduleBalance(
  games: ScheduledGame[],
  expectedTeamCount: number,
  gamesPerMatchup: number
): string | null {
  const homeCount = new Map<string, number>();
  const awayCount = new Map<string, number>();
  const matchups = new Map<string, number>();

  for (const g of games) {
    if (g.homeTeamSeasonId === g.awayTeamSeasonId) {
      return `Team plays itself: ${g.homeTeamSeasonId}`;
    }
    homeCount.set(g.homeTeamSeasonId, (homeCount.get(g.homeTeamSeasonId) ?? 0) + 1);
    awayCount.set(g.awayTeamSeasonId, (awayCount.get(g.awayTeamSeasonId) ?? 0) + 1);
    const key = [g.homeTeamSeasonId, g.awayTeamSeasonId].sort().join("|");
    matchups.set(key, (matchups.get(key) ?? 0) + 1);
  }

  const allTeams = new Set<string>([
    ...homeCount.keys(),
    ...awayCount.keys(),
  ]);

  if (allTeams.size !== expectedTeamCount) {
    return `Expected ${expectedTeamCount} teams, found ${allTeams.size}`;
  }

  for (const t of allTeams) {
    const h = homeCount.get(t) ?? 0;
    const a = awayCount.get(t) ?? 0;
    const total = h + a;
    const expected = (expectedTeamCount - 1) * gamesPerMatchup;
    if (total !== expected) {
      return `Team ${t}: played ${total} games, expected ${expected}`;
    }
    if (Math.abs(h - a) > 1) {
      return `Team ${t}: home=${h} away=${a}, home/away imbalanced (diff > 1)`;
    }
  }

  for (const [pair, count] of matchups) {
    if (count !== gamesPerMatchup) {
      return `Matchup ${pair}: ${count} games, expected ${gamesPerMatchup}`;
    }
  }

  return null;
}
