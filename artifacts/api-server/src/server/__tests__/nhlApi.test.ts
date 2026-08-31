/**
 * Unit tests for the NHL API client — mocked fetch (this sandbox's egress
 * policy blocks the real hosts outright; see nhlApi.ts's file header).
 * Covers pagination, Zod quarantine of a malformed row, and 5xx retry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchSkaterSummaries } from "../nhlApi";

const originalFetch = global.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function validSkaterRow(playerId: number) {
  return {
    playerId,
    skaterFullName: `Test Player ${playerId}`,
    positionCode: "C",
    gamesPlayed: 82,
    goals: 30,
    assists: 40,
    points: 70,
  };
}

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchSkaterSummaries", () => {
  it("pages until a short page is returned", async () => {
    const page1 = { data: Array.from({ length: 100 }, (_, i) => validSkaterRow(i)) };
    const page2 = { data: [validSkaterRow(100)] };
    let call = 0;
    global.fetch = vi.fn(async () => jsonResponse(call++ === 0 ? page1 : page2)) as unknown as typeof fetch;

    const result = await fetchSkaterSummaries("20242025");
    expect(result.rows.length).toBe(101);
    expect(result.quarantined).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("quarantines a malformed row instead of failing the batch", async () => {
    const good = validSkaterRow(1);
    const bad = { playerId: 2 }; // missing required fields
    global.fetch = vi.fn(async () => jsonResponse({ data: [good, bad] })) as unknown as typeof fetch;

    const result = await fetchSkaterSummaries("20242025");
    expect(result.rows.length).toBe(1);
    expect(result.quarantined).toBe(1);
  });

  it("retries on a 500 and succeeds on the next attempt", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call++;
      return call === 1 ? new Response("", { status: 500 }) : jsonResponse({ data: [validSkaterRow(1)] });
    }) as unknown as typeof fetch;

    const result = await fetchSkaterSummaries("20242025");
    expect(result.rows.length).toBe(1);
    expect(call).toBe(2);
  }, 10_000);

  it("throws when the response shape doesn't match at all", async () => {
    global.fetch = vi.fn(async () => jsonResponse({ notData: [] })) as unknown as typeof fetch;
    await expect(fetchSkaterSummaries("20242025")).rejects.toThrow();
  });
});
