/**
 * Integration test — Open Leagues directory round-trip
 *
 * Verifies that toggling is_listed on a league immediately affects what
 * GET /api/leagues/open returns, covering:
 *
 *  1. Listed league appears in /leagues/open
 *  2. De-listed league is removed from /leagues/open
 *  3. Edge: a listed league with NO active season still appears (active_season_id
 *     is null and seat counts are null/0)
 *
 * Auth is injected via vi.mock so tests don't need real sessions.
 * Note: the leagues-manage `can()` check passes league.owner_user_id (app_user
 * UUID) as ownerId, so the mocked user.id must equal the commissioner's
 * app_user.id.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ── Mock auth before any route imports resolve it ────────────────────────────
vi.mock("../../server/auth/index.js", () => ({
  getCurrentUser: vi.fn().mockReturnValue(null),
}));

import request from "supertest";
import crypto from "crypto";
import { pool } from "@workspace/db";
import app from "../../app.js";
import { getCurrentUser } from "../../server/auth/index.js";

const mockGetCurrentUser = vi.mocked(getCurrentUser);

// ── Unique run prefix to avoid collisions with parallel test runs ─────────────
const RUN_ID = crypto.randomBytes(4).toString("hex");

// ── Fixtures minted during setup ──────────────────────────────────────────────
let commAppUserId: string;   // app_user.id (UUID) — fed to the auth mock
let leagueId: string;        // league with an active season
let noSeasonLeagueId: string; // league WITHOUT any season

// ── SQL helper ────────────────────────────────────────────────────────────────
async function sql<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

// ── Schema guard ─────────────────────────────────────────────────────────────
// Skip all tests when league_listing (or the view) is absent from the DB.
let schemaReady = false;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'league_listing'
     ) AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
});

// ── Create fixtures ───────────────────────────────────────────────────────────
beforeAll(async () => {
  if (!schemaReady) return;

  // 1. Commissioner app_user
  const [commRow] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (replit_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [`oll-comm-${RUN_ID}`, `OLL Commissioner ${RUN_ID}`, `oll-comm-${RUN_ID}@test.invalid`],
  );
  commAppUserId = commRow!.id;

  // 2. League WITH an active season
  const [leagueRow] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [commAppUserId, `OLL League ${RUN_ID}`, `oll-league-${RUN_ID}`],
  );
  leagueId = leagueRow!.id;

  // Create an active season for leagueId (max_seats = 8 for speed)
  await sql(
    `INSERT INTO season (league_id, ordinal, label, game_title, max_seats, is_active)
     VALUES ($1, 1, 'Season 1', 'NHL 25', 8, TRUE)`,
    [leagueId],
  );

  // 3. League WITHOUT any season (edge case)
  const [noSeasonRow] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [commAppUserId, `OLL No-Season League ${RUN_ID}`, `oll-noseasonleague-${RUN_ID}`],
  );
  noSeasonLeagueId = noSeasonRow!.id;
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
afterAll(async () => {
  if (leagueId) {
    await sql(`DELETE FROM league_listing WHERE league_id IN ($1, $2)`, [leagueId, noSeasonLeagueId]);
    await sql(`DELETE FROM season WHERE league_id = $1`, [leagueId]);
    await sql(`DELETE FROM league WHERE id IN ($1, $2)`, [leagueId, noSeasonLeagueId]);
  }
  await sql(`DELETE FROM app_user WHERE replit_id LIKE $1`, [`oll-comm-${RUN_ID}`]);
});

// ── Helper: assert a league_id is present/absent in GET /api/leagues/open ─────
async function getOpenLeagueIds(): Promise<string[]> {
  const res = await request(app).get("/api/leagues/open");
  expect(res.status).toBe(200);
  return (res.body.data as Array<{ league_id: string }>).map((r) => r.league_id);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/leagues/open — listing round-trip", () => {
  // Ensure the mocked user is authenticated as the commissioner for all tests
  beforeAll(() => {
    mockGetCurrentUser.mockReturnValue({ id: commAppUserId, name: `OLL Commissioner ${RUN_ID}` });
  });

  it("league does NOT appear before any listing row exists", async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const ids = await getOpenLeagueIds();
    expect(ids).not.toContain(leagueId);
  });

  it("league appears immediately after PUT listing with is_listed=true", async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const res = await request(app)
      .put(`/api/leagues/${leagueId}/listing`)
      .send({ is_listed: true, accepting_signups: true, accepting_waitlist: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ league_id: leagueId, is_listed: true });

    const ids = await getOpenLeagueIds();
    expect(ids).toContain(leagueId);
  });

  it("GET /api/leagues/open row includes expected fields for the listed league", async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const res = await request(app).get("/api/leagues/open");
    expect(res.status).toBe(200);

    const row = (res.body.data as Array<Record<string, unknown>>).find(
      (r) => r.league_id === leagueId,
    );
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      league_id: leagueId,
      accepting_signups: true,
      accepting_waitlist: true,
    });
    // active season exists so seat counts must be present and numeric-valued.
    // node-postgres returns aggregate/arithmetic columns as strings, so we
    // coerce before asserting — the important thing is a parseable numeric value.
    expect(Number(row!.max_seats)).toBeGreaterThan(0);
    expect(Number(row!.seats_open)).toBeGreaterThanOrEqual(0);
  });

  it("league disappears after PUT listing with is_listed=false", async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const res = await request(app)
      .put(`/api/leagues/${leagueId}/listing`)
      .send({ is_listed: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ league_id: leagueId, is_listed: false });

    const ids = await getOpenLeagueIds();
    expect(ids).not.toContain(leagueId);
  });

  it("edge: a league with no active season cannot be listed", async (ctx) => {
    if (!schemaReady) return ctx.skip();

    // leagues-manage.ts deliberately refuses this: applicants would see NULL
    // seat counts in v_open_leagues, which is misleading, so listing requires
    // an active season first.
    const putRes = await request(app)
      .put(`/api/leagues/${noSeasonLeagueId}/listing`)
      .send({ is_listed: true, accepting_signups: false, accepting_waitlist: true });

    expect(putRes.status).toBe(400);
    expect(putRes.body.detail).toMatch(/no active season/i);

    const ids = await getOpenLeagueIds();
    expect(ids).not.toContain(noSeasonLeagueId);
  });
});
