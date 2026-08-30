/**
 * Stat-card refresh job — real Postgres, mocked NHL API. Covers the
 * aggregation math (registry-sync-spec.md §3) and that a manual/unmatched
 * player is a clean no-op rather than an error.
 */
import { vi, describe, it, expect, beforeAll } from "vitest";

vi.mock("../../nhlApi", () => ({
  fetchSkaterSummaries: vi.fn(),
  fetchGoalieSummaries: vi.fn(),
  nhlSeasonId: (endYear: number) => `${endYear - 1}${endYear}`,
}));

import { pool } from "@workspace/db";
import crypto from "crypto";
import { fetchSkaterSummaries, fetchGoalieSummaries } from "../../nhlApi";
import { refreshStatCards } from "../statCardRefresh";

const mockSkaters = vi.mocked(fetchSkaterSummaries);
const mockGoalies = vi.mocked(fetchGoalieSummaries);
const RUN_ID = crypto.randomBytes(4).toString("hex");
const NHL_ID = 800_000 + Number.parseInt(RUN_ID.slice(0, 4), 16);

let schemaReady = false;
let playerId: string;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'player_stat_card') AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
  if (!schemaReady) return;

  const [row] = (await pool.query<{ id: string }>(
    `INSERT INTO player (full_name, position, external_ids) VALUES ($1,'C', jsonb_build_object('nhl_api', $2::text)) RETURNING id`,
    [`Stat Card Test ${RUN_ID}`, String(NHL_ID)],
  )).rows;
  playerId = row!.id;
});

describe("refreshStatCards", () => {
  it("aggregates a two-season skater career into honest 1/3/5-year windows", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    // Two real seasons of data, none for the other three (sophomore career).
    const thisYear = new Date().getFullYear();
    const latestSeasonId = `${thisYear - 1}${thisYear}`;
    const priorSeasonId = `${thisYear - 2}${thisYear - 1}`;
    mockSkaters.mockImplementation(async (seasonId: string) => {
      if (seasonId === latestSeasonId) {
        return { rows: [{ playerId: NHL_ID, skaterFullName: "x", positionCode: "C", gamesPlayed: 82, goals: 30, assists: 40, points: 70, shots: 200 }], quarantined: 0 };
      }
      if (seasonId === priorSeasonId) {
        return { rows: [{ playerId: NHL_ID, skaterFullName: "x", positionCode: "C", gamesPlayed: 80, goals: 20, assists: 30, points: 50, shots: 150 }], quarantined: 0 };
      }
      return { rows: [], quarantined: 0 };
    });
    mockGoalies.mockResolvedValue({ rows: [], quarantined: 0 });

    const result = await refreshStatCards(pool, playerId);
    expect(result.refreshed).toBe(true);

    const { rows } = await pool.query<{ window_years: number; stat_line: Record<string, number>; season_span: string }>(
      `SELECT window_years, stat_line, season_span FROM player_stat_card WHERE player_id = $1 ORDER BY window_years`,
      [playerId],
    );
    expect(rows.length).toBe(3);

    const oneYear = rows.find((r) => r.window_years === 1)!;
    expect(oneYear.stat_line.GP).toBe(82);
    expect(oneYear.stat_line.PTS).toBe(70);

    // A sophomore's 5-year window is honestly short — only the 2 real seasons.
    const fiveYear = rows.find((r) => r.window_years === 5)!;
    expect(fiveYear.stat_line.GP).toBe(162);
    expect(fiveYear.stat_line.PTS).toBe(120);
    expect(fiveYear.season_span).toContain("–");
  });

  it("is a clean no-op for a player with no nhl_api id", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const [manual] = (await pool.query<{ id: string }>(
      `INSERT INTO player (full_name, position, is_manual) VALUES ($1,'C',true) RETURNING id`,
      [`Manual No Card ${RUN_ID}`],
    )).rows;
    const result = await refreshStatCards(pool, manual!.id);
    expect(result.refreshed).toBe(false);
    expect(result.reason).toContain("not registry-matched");
  });
});
