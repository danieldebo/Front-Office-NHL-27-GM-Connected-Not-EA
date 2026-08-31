/**
 * Outbox worker — real Postgres, mocked delivery/job functions. Covers
 * successful delivery, retry-with-backoff on a transient failure, and
 * giving up (not retrying forever) on a permanent one.
 */
import { vi, describe, it, expect, beforeAll } from "vitest";

vi.mock("../discordWebhook", async () => {
  const actual = await vi.importActual<typeof import("../discordWebhook")>("../discordWebhook");
  return { ...actual, sendDiscordMessage: vi.fn() };
});
vi.mock("../jobs/registrySync", () => ({ runRegistrySync: vi.fn() }));
vi.mock("../jobs/statCardRefresh", () => ({ refreshStatCards: vi.fn() }));

import { pool } from "@workspace/db";
import { sendDiscordMessage, PermanentDeliveryError } from "../discordWebhook";
import { runRegistrySync } from "../jobs/registrySync";
import { refreshStatCards } from "../jobs/statCardRefresh";
import { drainOnce } from "../outboxWorker";

const mockSend = vi.mocked(sendDiscordMessage);
const mockSync = vi.mocked(runRegistrySync);
const mockRefresh = vi.mocked(refreshStatCards);

let schemaReady = false;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'outbox') AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
});

async function enqueue(topic: string, payload: Record<string, unknown>): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO outbox (topic, payload) VALUES ($1, $2) RETURNING id`,
    [topic, JSON.stringify(payload)],
  );
  return rows[0]!.id;
}

describe("drainOnce", () => {
  it("delivers a discord.post row and marks it processed", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockSend.mockResolvedValue(undefined);
    const id = await enqueue("discord.post", { webhook_url: "https://discord.example/hook", content: "hi" });

    await drainOnce(pool);

    expect(mockSend).toHaveBeenCalledWith("https://discord.example/hook", "hi");
    const [row] = (await pool.query<{ processed_at: string | null }>(`SELECT processed_at FROM outbox WHERE id = $1`, [id])).rows;
    expect(row?.processed_at).toBeTruthy();
  });

  it("dispatches registry.sync.requested and statcard.refresh.requested to their jobs", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockSync.mockResolvedValue({ playersUpserted: 5, quarantined: 0, error: null });
    mockRefresh.mockResolvedValue({ refreshed: true });
    const syncId = await enqueue("registry.sync.requested", {});
    const cardId = await enqueue("statcard.refresh.requested", { player_id: "11111111-1111-1111-1111-111111111111" });

    await drainOnce(pool);

    expect(mockSync).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledWith(pool, "11111111-1111-1111-1111-111111111111");
    const rows = (await pool.query<{ id: string; processed_at: string | null }>(
      `SELECT id, processed_at FROM outbox WHERE id = ANY($1::bigint[])`,
      [[syncId, cardId]],
    )).rows;
    expect(rows.every((r) => r.processed_at)).toBe(true);
  });

  it("retries a transient failure with backoff instead of giving up immediately", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockSend.mockRejectedValueOnce(new Error("network blip"));
    const id = await enqueue("discord.post", { webhook_url: "https://discord.example/hook", content: "retry me" });

    await drainOnce(pool);

    const [row] = (await pool.query<{ processed_at: string | null; attempts: number; next_attempt_at: string; last_error: string }>(
      `SELECT processed_at, attempts, next_attempt_at, last_error FROM outbox WHERE id = $1`,
      [id],
    )).rows;
    expect(row?.processed_at).toBeNull();
    expect(row?.attempts).toBe(1);
    expect(row?.last_error).toContain("network blip");
    expect(new Date(row!.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    // Not picked up again immediately, since next_attempt_at is in the future.
    mockSend.mockClear();
    await drainOnce(pool);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("gives up on a permanent delivery error without retrying", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockSend.mockRejectedValueOnce(new PermanentDeliveryError("Discord webhook returned 404"));
    const id = await enqueue("discord.post", { webhook_url: "https://discord.example/dead-hook", content: "never lands" });

    await drainOnce(pool);

    const [row] = (await pool.query<{ processed_at: string | null; last_error: string }>(
      `SELECT processed_at, last_error FROM outbox WHERE id = $1`,
      [id],
    )).rows;
    expect(row?.processed_at).toBeTruthy();
    expect(row?.last_error).toContain("404");
  });

  it("holds the row lock for the duration of the job, so a concurrent drain can't pick up the same row", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    let releaseJob!: () => void;
    const jobGate = new Promise<void>((resolve) => { releaseJob = resolve; });
    let sendCallCount = 0;
    mockSend.mockImplementation(async () => {
      sendCallCount++;
      await jobGate;
    });
    const id = await enqueue("discord.post", { webhook_url: "https://discord.example/hook", content: "slow job" });

    const firstDrain = drainOnce(pool);
    // Give the first drain time to acquire the row lock and enter handle().
    await new Promise((resolve) => setTimeout(resolve, 50));

    // A second poll tick running while the first is still mid-job must not
    // see this row (FOR UPDATE SKIP LOCKED) — proving the lock is still held,
    // not released the instant the SELECT's own statement finished.
    await drainOnce(pool);
    expect(sendCallCount).toBe(1);

    releaseJob();
    await firstDrain;

    const [row] = (await pool.query<{ processed_at: string | null }>(`SELECT processed_at FROM outbox WHERE id = $1`, [id])).rows;
    expect(row?.processed_at).toBeTruthy();
    expect(sendCallCount).toBe(1);
  });

  it("drops an unknown topic (marks it processed) instead of retrying forever", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const id = await enqueue("something.nobody.handles", {});
    await drainOnce(pool);
    const [row] = (await pool.query<{ processed_at: string | null }>(`SELECT processed_at FROM outbox WHERE id = $1`, [id])).rows;
    expect(row?.processed_at).toBeTruthy();
  });
});
