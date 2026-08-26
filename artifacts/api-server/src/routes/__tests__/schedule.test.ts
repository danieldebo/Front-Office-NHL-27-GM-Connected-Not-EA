/**
 * Integration tests — schedule and game-management routes
 *
 * Covers:
 *   POST   /api/seasons/:seasonId/schedule  — generate schedule
 *   PATCH  /api/games/:gameId/window        — shift window (commissioner)
 *   POST   /api/games/:gameId/postpone      — postpone game (commissioner)
 *
 * Auth is injected via vi.mock so tests don't need real sessions.
 *
 * Fixture layout
 * ──────────────
 *   seasonId        — schedule-generation season (starts empty; tests create games)
 *   gameSeasonId    — separate season whose games are pre-seeded in beforeAll for
 *                     the window-shift and postpone describe blocks so those tests
 *                     are fully independent of the schedule-generation tests.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ── Mock auth before any route imports resolve it ─────────────────────────────
vi.mock("../../server/auth/index.js", () => ({
  getCurrentUser: vi.fn().mockReturnValue(null),
}));

import request from "supertest";
import crypto from "crypto";
import { pool } from "@workspace/db";
import app from "../../app.js";
import { getCurrentUser } from "../../server/auth/index.js";

const mockGetCurrentUser = vi.mocked(getCurrentUser);

// ── Unique prefix so parallel test runs don't collide ─────────────────────────
const RUN_ID = crypto.randomBytes(4).toString("hex");

// ── Fixtures (populated in beforeAll) ─────────────────────────────────────────
let commissionerReplitId: string;
let commissionerAppUserId: string;
let leagueId: string;

// Season used for POST /schedule tests — starts with no games
let seasonId: string;
let teamSeasonId1: string;
let teamSeasonId2: string;

// Season + teams used by window-shift and postpone tests — has a pre-seeded game
let gameSeasonId: string;
let gameTeamSeasonId1: string;
let gameTeamSeasonId2: string;

// ── SQL helper ────────────────────────────────────────────────────────────────
async function sql<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

function commissionerAuth() {
  return {
    id: commissionerReplitId,
    appUserId: commissionerAppUserId,
    name: "Commissioner",
  };
}

// ── Schema guard ──────────────────────────────────────────────────────────────
let schemaReady = false;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'game'
     ) AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
});

// ── Set up test fixtures ──────────────────────────────────────────────────────
beforeAll(async () => {
  if (!schemaReady) return;

  commissionerReplitId = `sched-comm-${RUN_ID}`;

  // 1. Commissioner app_user
  const [commRow] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (replit_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [commissionerReplitId, `Sched Commissioner ${RUN_ID}`, `${commissionerReplitId}@test.invalid`],
  );
  const commAppUserId = commRow!.id;
  commissionerAppUserId = commAppUserId;

  // 2. Single league for all schedule tests
  const [leagueRow] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [commAppUserId, `Sched League ${RUN_ID}`, `sched-league-${RUN_ID}`],
  );
  leagueId = leagueRow!.id;

  // ── Season for POST /schedule tests (no games pre-inserted) ───────────────
  const [seasonRow] = await sql<{ id: string }>(
    `INSERT INTO season (league_id, ordinal, label, game_title, games_per_matchup, starts_on)
     VALUES ($1, 1, 'Season 1', 'NHL', 1, '2025-09-01')
     RETURNING id`,
    [leagueId],
  );
  seasonId = seasonRow!.id;

  const [fr1] = await sql<{ id: string }>(
    `INSERT INTO franchise (league_id, name) VALUES ($1, $2) RETURNING id`,
    [leagueId, `Alpha ${RUN_ID}`],
  );
  const [fr2] = await sql<{ id: string }>(
    `INSERT INTO franchise (league_id, name) VALUES ($1, $2) RETURNING id`,
    [leagueId, `Beta ${RUN_ID}`],
  );
  const [ts1] = await sql<{ id: string }>(
    `INSERT INTO team_season (season_id, franchise_id) VALUES ($1, $2) RETURNING id`,
    [seasonId, fr1!.id],
  );
  const [ts2] = await sql<{ id: string }>(
    `INSERT INTO team_season (season_id, franchise_id) VALUES ($1, $2) RETURNING id`,
    [seasonId, fr2!.id],
  );
  teamSeasonId1 = ts1!.id;
  teamSeasonId2 = ts2!.id;

  // ── Separate season for window-shift and postpone tests ───────────────────
  const [gameSeason] = await sql<{ id: string }>(
    `INSERT INTO season (league_id, ordinal, label, game_title, games_per_matchup, starts_on)
     VALUES ($1, 2, 'Season 2', 'NHL', 1, '2026-01-01')
     RETURNING id`,
    [leagueId],
  );
  gameSeasonId = gameSeason!.id;

  const [fr3] = await sql<{ id: string }>(
    `INSERT INTO franchise (league_id, name) VALUES ($1, $2) RETURNING id`,
    [leagueId, `Gamma ${RUN_ID}`],
  );
  const [fr4] = await sql<{ id: string }>(
    `INSERT INTO franchise (league_id, name) VALUES ($1, $2) RETURNING id`,
    [leagueId, `Delta ${RUN_ID}`],
  );
  const [gts1] = await sql<{ id: string }>(
    `INSERT INTO team_season (season_id, franchise_id) VALUES ($1, $2) RETURNING id`,
    [gameSeasonId, fr3!.id],
  );
  const [gts2] = await sql<{ id: string }>(
    `INSERT INTO team_season (season_id, franchise_id) VALUES ($1, $2) RETURNING id`,
    [gameSeasonId, fr4!.id],
  );
  gameTeamSeasonId1 = gts1!.id;
  gameTeamSeasonId2 = gts2!.id;
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
afterAll(async () => {
  if (!leagueId) return;
  await sql(`DELETE FROM audit_log WHERE league_id = $1`, [leagueId]);
  await sql(`DELETE FROM game WHERE season_id IN ($1, $2)`, [seasonId, gameSeasonId]);
  await sql(`DELETE FROM team_season WHERE season_id IN ($1, $2)`, [seasonId, gameSeasonId]);
  await sql(`DELETE FROM franchise WHERE league_id = $1`, [leagueId]);
  await sql(`DELETE FROM season WHERE league_id = $1`, [leagueId]);
  await sql(`DELETE FROM league WHERE id = $1`, [leagueId]);
  await sql(`DELETE FROM idempotency_key WHERE user_id = $1`, [commissionerAppUserId]);
  await sql(`DELETE FROM app_user WHERE replit_id LIKE $1`, [`sched-%-${RUN_ID}`]);
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/seasons/:seasonId/schedule — generate schedule
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /api/seasons/:seasonId/schedule — generate schedule", () => {
  it("returns 401 when unauthenticated", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(null);

    const res = await request(app)
      .post(`/api/seasons/${seasonId}/schedule`)
      .send({ week_duration_days: 7 });

    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a non-owner", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: `outsider-${RUN_ID}`, name: "Outsider" });

    const res = await request(app)
      .post(`/api/seasons/${seasonId}/schedule`)
      .send({ week_duration_days: 7 });

    expect(res.status).toBe(403);
  });

  it("returns 404 when season does not exist", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(commissionerAuth());

    const res = await request(app)
      .post(`/api/seasons/${crypto.randomUUID()}/schedule`)
      .send({ week_duration_days: 7 });

    expect(res.status).toBe(404);
  });

  it("replays one result for simultaneous requests with the same idempotency key", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(commissionerAuth());
    const key = `schedule-same-${RUN_ID}`;

    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/seasons/${seasonId}/schedule`)
        .set("Idempotency-Key", key)
        .send({ week_duration_days: 7 }),
      request(app)
        .post(`/api/seasons/${seasonId}/schedule`)
        .set("Idempotency-Key", key)
        .send({ week_duration_days: 7 }),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body).toEqual(second.body);
    expect(first.text).toBe(second.text);
    const [{ games }] = await sql<{ games: string }>(
      `SELECT COUNT(*) AS games FROM game WHERE season_id = $1`,
      [seasonId],
    );
    const [{ audits }] = await sql<{ audits: string }>(
      `SELECT COUNT(*) AS audits FROM audit_log
        WHERE entity_id = $1 AND action = 'schedule_generated'`,
      [seasonId],
    );
    expect(Number(games)).toBe(1);
    expect(Number(audits)).toBe(1);

    await sql(`DELETE FROM audit_log WHERE entity_id = $1 AND action = 'schedule_generated'`, [seasonId]);
    await sql(`DELETE FROM game WHERE season_id = $1`, [seasonId]);
    await sql(`DELETE FROM idempotency_key WHERE user_id = $1 AND key = $2`, [commissionerAppUserId, key]);
  });

  it("serializes concurrent generation and creates exactly one schedule", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(commissionerAuth());

    // 2 teams × games_per_matchup=1 → 1 game total
    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/seasons/${seasonId}/schedule`)
        .set("Idempotency-Key", `schedule-first-${RUN_ID}`)
        .send({ week_duration_days: 7 }),
      request(app)
        .post(`/api/seasons/${seasonId}/schedule`)
        .set("Idempotency-Key", `schedule-second-${RUN_ID}`)
        .send({ week_duration_days: 7 }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const created = first.status === 201 ? first : second;
    expect(created.body).toMatchObject({
      games_created: 1,
      total_weeks: expect.any(Number),
      week_duration_days: 7,
    });

    // Verify games were actually written to the DB
    const [{ count }] = await sql<{ count: string }>(
      `SELECT COUNT(*) AS count FROM game WHERE season_id = $1`,
      [seasonId],
    );
    expect(Number(count)).toBe(1);
  });

  it("returns 409 when a schedule already exists for the season", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(commissionerAuth());

    // Games were created by the previous test
    const res = await request(app)
      .post(`/api/seasons/${seasonId}/schedule`)
      .send({ week_duration_days: 7 });

    expect(res.status).toBe(409);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/games/:gameId/window — shift window
// ══════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/games/:gameId/window — shift window", () => {
  let windowGameId: string;

  const newOpens  = new Date(Date.now() + 2 * 86400_000).toISOString();
  const newCloses = new Date(Date.now() + 9 * 86400_000).toISOString();

  beforeAll(async () => {
    if (!schemaReady) return;
    const [row] = await sql<{ id: string }>(
      `INSERT INTO game
         (season_id, week_number, home_team_season_id, away_team_season_id,
          window_opens_at, window_closes_at, status)
       VALUES ($1, 1, $2, $3,
               NOW() + INTERVAL '1 day', NOW() + INTERVAL '8 days',
               'scheduled')
       RETURNING id`,
      [gameSeasonId, gameTeamSeasonId1, gameTeamSeasonId2],
    );
    windowGameId = row!.id;
  });

  afterAll(async () => {
    if (windowGameId) {
      await sql(`DELETE FROM audit_log WHERE entity_id = $1`, [windowGameId]);
      await sql(`DELETE FROM game WHERE id = $1`, [windowGameId]);
    }
  });

  it("returns 401 when unauthenticated", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(null);

    const res = await request(app)
      .patch(`/api/games/${windowGameId}/window`)
      .send({ window_opens_at: newOpens, window_closes_at: newCloses, reason: "Test" });

    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a non-owner", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: `outsider-${RUN_ID}`, name: "Outsider" });

    const res = await request(app)
      .patch(`/api/games/${windowGameId}/window`)
      .send({ window_opens_at: newOpens, window_closes_at: newCloses, reason: "Test" });

    expect(res.status).toBe(403);
  });

  it("returns 404 when game does not exist", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(commissionerAuth());

    const res = await request(app)
      .patch(`/api/games/${crypto.randomUUID()}/window`)
      .send({ window_opens_at: newOpens, window_closes_at: newCloses, reason: "Test" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when window_closes_at is not after window_opens_at", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(commissionerAuth());

    const res = await request(app)
      .patch(`/api/games/${windowGameId}/window`)
      .send({
        window_opens_at:  newCloses, // intentionally swapped
        window_closes_at: newOpens,
        reason: "Test",
      });

    expect(res.status).toBe(400);
  });

  it("returns 409 when the game is in a terminal status (confirmed)", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(commissionerAuth());

    const [{ id: confirmedId }] = await sql<{ id: string }>(
      `INSERT INTO game
         (season_id, week_number, home_team_season_id, away_team_season_id,
          window_opens_at, window_closes_at, status)
       VALUES ($1, 99, $2, $3,
               NOW() - INTERVAL '14 days', NOW() - INTERVAL '7 days',
               'confirmed')
       RETURNING id`,
      [gameSeasonId, gameTeamSeasonId1, gameTeamSeasonId2],
    );

    const res = await request(app)
      .patch(`/api/games/${confirmedId}/window`)
      .send({ window_opens_at: newOpens, window_closes_at: newCloses, reason: "Test" });

    expect(res.status).toBe(409);

    await sql(`DELETE FROM game WHERE id = $1`, [confirmedId]);
  });

  it("returns 200, updates the window, and writes an audit log entry", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(commissionerAuth());

    const res = await request(app)
      .patch(`/api/games/${windowGameId}/window`)
      .send({ window_opens_at: newOpens, window_closes_at: newCloses, reason: "Rescheduled" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: windowGameId });

    // Audit log must have been written
    const [auditRow] = await sql<{ action: string; reason: string }>(
      `SELECT action, reason FROM audit_log
        WHERE entity_id = $1 AND action = 'window_shifted' LIMIT 1`,
      [windowGameId],
    );
    expect(auditRow).toBeTruthy();
    expect(auditRow!.reason).toBe("Rescheduled");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/games/:gameId/postpone — postpone game
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /api/games/:gameId/postpone — postpone game", () => {
  let postponeGameId: string;

  beforeAll(async () => {
    if (!schemaReady) return;
    const [row] = await sql<{ id: string }>(
      `INSERT INTO game
         (season_id, week_number, home_team_season_id, away_team_season_id,
          window_opens_at, window_closes_at, status)
       VALUES ($1, 2, $2, $3,
               NOW() + INTERVAL '3 days', NOW() + INTERVAL '10 days',
               'scheduled')
       RETURNING id`,
      [gameSeasonId, gameTeamSeasonId1, gameTeamSeasonId2],
    );
    postponeGameId = row!.id;
  });

  afterAll(async () => {
    if (postponeGameId) {
      await sql(`DELETE FROM audit_log WHERE entity_id = $1`, [postponeGameId]);
      await sql(`DELETE FROM game WHERE id = $1`, [postponeGameId]);
    }
  });

  it("returns 401 when unauthenticated", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(null);

    const res = await request(app)
      .post(`/api/games/${postponeGameId}/postpone`)
      .send({ reason: "Bad weather" });

    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a non-owner", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: `outsider-${RUN_ID}`, name: "Outsider" });

    const res = await request(app)
      .post(`/api/games/${postponeGameId}/postpone`)
      .send({ reason: "Bad weather" });

    expect(res.status).toBe(403);
  });

  it("returns 404 when game does not exist", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(commissionerAuth());

    const res = await request(app)
      .post(`/api/games/${crypto.randomUUID()}/postpone`)
      .send({ reason: "Bad weather" });

    expect(res.status).toBe(404);
  });

  it("returns 200, sets status to postponed, and writes an audit log entry", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(commissionerAuth());

    const res = await request(app)
      .post(`/api/games/${postponeGameId}/postpone`)
      .send({ reason: "Venue not available" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: postponeGameId, status: "postponed" });

    // DB: status must be updated
    const [gameRow] = await sql<{ status: string }>(
      `SELECT status FROM game WHERE id = $1`,
      [postponeGameId],
    );
    expect(gameRow!.status).toBe("postponed");

    // Audit log entry must have been written
    const [auditRow] = await sql<{ action: string; reason: string }>(
      `SELECT action, reason FROM audit_log
        WHERE entity_id = $1 AND action = 'postponed' LIMIT 1`,
      [postponeGameId],
    );
    expect(auditRow).toBeTruthy();
    expect(auditRow!.reason).toBe("Venue not available");
  });

  it("returns 409 when game is already postponed", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(commissionerAuth());

    // Game is now in 'postponed' status from the previous test
    const res = await request(app)
      .post(`/api/games/${postponeGameId}/postpone`)
      .send({ reason: "Still not available" });

    expect(res.status).toBe(409);
  });
});
