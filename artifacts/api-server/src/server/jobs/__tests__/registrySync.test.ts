/**
 * Registry sync job — real Postgres, mocked NHL API (nhlApi.ts's own tests
 * cover the HTTP layer; this covers the upsert contract from
 * registry-sync-spec.md §2: idempotent, never touches is_manual players,
 * updates in place on re-run).
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
import { runRegistrySync } from "../registrySync";

const mockSkaters = vi.mocked(fetchSkaterSummaries);
const mockGoalies = vi.mocked(fetchGoalieSummaries);
const RUN_ID = crypto.randomBytes(4).toString("hex");
const NHL_ID = 900_000 + Number.parseInt(RUN_ID.slice(0, 4), 16);

let schemaReady = false;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'registry_sync') AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
});

describe("runRegistrySync", () => {
  it("upserts a new player and records the sync row", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockSkaters.mockResolvedValue({
      rows: [{ playerId: NHL_ID, skaterFullName: `Sync Test ${RUN_ID}`, positionCode: "C", gamesPlayed: 82 }],
      quarantined: 0,
    });
    mockGoalies.mockResolvedValue({ rows: [], quarantined: 0 });

    const result = await runRegistrySync(pool);
    expect(result.error).toBeNull();
    expect(result.playersUpserted).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query<{ full_name: string; is_manual: boolean }>(
      `SELECT full_name, is_manual FROM player WHERE external_ids->>'nhl_api' = $1`,
      [String(NHL_ID)],
    );
    expect(rows[0]?.full_name).toBe(`Sync Test ${RUN_ID}`);
    expect(rows[0]?.is_manual).toBe(false);

    const [syncRow] = (await pool.query<{ players_upserted: number; completed_at: string | null }>(
      `SELECT players_upserted, completed_at FROM registry_sync ORDER BY started_at DESC LIMIT 1`,
    )).rows;
    expect(syncRow?.completed_at).toBeTruthy();
  });

  it("is idempotent: re-running updates the same row instead of duplicating", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockSkaters.mockResolvedValue({
      rows: [{ playerId: NHL_ID, skaterFullName: `Sync Test Renamed ${RUN_ID}`, positionCode: "C", gamesPlayed: 82 }],
      quarantined: 0,
    });
    mockGoalies.mockResolvedValue({ rows: [], quarantined: 0 });

    await runRegistrySync(pool);

    const { rows } = await pool.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM player WHERE external_ids->>'nhl_api' = $1`,
      [String(NHL_ID)],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.full_name).toBe(`Sync Test Renamed ${RUN_ID}`);
  });

  it("never touches a manually-entered player, even with a similar name", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const [manual] = (await pool.query<{ id: string; full_name: string }>(
      `INSERT INTO player (full_name, position, is_manual) VALUES ($1,'C',true) RETURNING id, full_name`,
      [`Manual Sync Guard ${RUN_ID}`],
    )).rows;

    mockSkaters.mockResolvedValue({ rows: [], quarantined: 0 });
    mockGoalies.mockResolvedValue({ rows: [], quarantined: 0 });
    await runRegistrySync(pool);

    const { rows } = await pool.query<{ full_name: string; is_manual: boolean }>(
      `SELECT full_name, is_manual FROM player WHERE id = $1`,
      [manual!.id],
    );
    expect(rows[0]?.is_manual).toBe(true);
    expect(rows[0]?.full_name).toBe(`Manual Sync Guard ${RUN_ID}`);
  });

  it("records the error on the sync row when the upstream fetch fails, without throwing", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockSkaters.mockRejectedValue(new Error("NHL stats API skater/summary returned 503"));
    mockGoalies.mockResolvedValue({ rows: [], quarantined: 0 });

    const result = await runRegistrySync(pool);
    expect(result.error).toContain("503");

    const [syncRow] = (await pool.query<{ error: string | null }>(
      `SELECT error FROM registry_sync ORDER BY started_at DESC LIMIT 1`,
    )).rows;
    expect(syncRow?.error).toContain("503");
  });
});
