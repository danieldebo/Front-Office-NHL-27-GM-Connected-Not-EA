/**
 * Integration tests — join-request review routes
 *
 * Covers:
 *   POST /api/leagues/:leagueId/join-requests/:requestId/approve
 *   POST /api/leagues/:leagueId/join-requests/:requestId/reject
 *
 * Auth is injected via vi.mock so tests don't need real sessions.
 *
 * Note: the seats.ts `can()` check passes `league.owner_user_id` (app_user UUID)
 * as the ownerId, so the mocked user.id must equal the commissioner's app_user.id.
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

// ── Unique prefix ─────────────────────────────────────────────────────────────
const RUN_ID = crypto.randomBytes(4).toString("hex");

// ── Fixtures ──────────────────────────────────────────────────────────────────
let commAppUserId: string;   // app_user.id (UUID) — used as the mocked user.id
let leagueId: string;
let applicantAppUserId: string;

// ── SQL helper ────────────────────────────────────────────────────────────────
async function sql<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/** Insert a pending join_request and return its id. */
async function makePendingJoinRequest(): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO join_request (league_id, user_id) VALUES ($1, $2) RETURNING id`,
    [leagueId, applicantAppUserId],
  );
  return row!.id;
}

/** Delete a join_request by id (and its dependent membership, if any). */
async function cleanupJoinRequest(jrId: string): Promise<void> {
  await sql(`DELETE FROM league_membership WHERE league_id = $1 AND user_id = $2`, [leagueId, applicantAppUserId]);
  await sql(`DELETE FROM join_request WHERE id = $1`, [jrId]);
}

// ── Schema guard ──────────────────────────────────────────────────────────────
let schemaReady = false;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'join_request'
     ) AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
});

// ── Create fixtures ───────────────────────────────────────────────────────────
beforeAll(async () => {
  if (!schemaReady) return;

  // 1. Commissioner app_user — capture the auto-generated UUID for auth mock
  const [commRow] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (replit_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [`seats-comm-${RUN_ID}`, `Seats Commissioner ${RUN_ID}`, `seats-comm-${RUN_ID}@test.invalid`],
  );
  commAppUserId = commRow!.id;

  // 2. League owned by the commissioner
  const [leagueRow] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [commAppUserId, `Seats League ${RUN_ID}`, `seats-league-${RUN_ID}`],
  );
  leagueId = leagueRow!.id;

  // 3. Applicant app_user
  const [applRow] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (replit_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [`seats-appl-${RUN_ID}`, `Seats Applicant ${RUN_ID}`, `seats-appl-${RUN_ID}@test.invalid`],
  );
  applicantAppUserId = applRow!.id;
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
afterAll(async () => {
  if (!leagueId) return;
  await sql(`DELETE FROM league_membership WHERE league_id = $1`, [leagueId]);
  await sql(`DELETE FROM join_request WHERE league_id = $1`, [leagueId]);
  await sql(`DELETE FROM league WHERE id = $1`, [leagueId]);
  await sql(`DELETE FROM app_user WHERE replit_id LIKE $1`, [`seats-%-${RUN_ID}`]);
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/leagues/:leagueId/join-requests/:requestId/approve
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /api/leagues/:leagueId/join-requests/:requestId/approve", () => {
  it("returns 401 when unauthenticated", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(null);

    const jrId = await makePendingJoinRequest();
    try {
      const res = await request(app)
        .post(`/api/leagues/${leagueId}/join-requests/${jrId}/approve`)
        .send();
      expect(res.status).toBe(401);
    } finally {
      await cleanupJoinRequest(jrId);
    }
  });

  it("returns 403 when authenticated as a non-owner", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: `outsider-${RUN_ID}`, name: "Outsider" });

    const jrId = await makePendingJoinRequest();
    try {
      const res = await request(app)
        .post(`/api/leagues/${leagueId}/join-requests/${jrId}/approve`)
        .send();
      expect(res.status).toBe(403);
    } finally {
      await cleanupJoinRequest(jrId);
    }
  });

  it("returns 404 when join request does not exist", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: commAppUserId, name: "Commissioner" });

    const res = await request(app)
      .post(`/api/leagues/${leagueId}/join-requests/${crypto.randomUUID()}/approve`)
      .send();

    expect(res.status).toBe(404);
  });

  it("returns 200, sets status to approved, and adds a league_membership", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: commAppUserId, name: "Commissioner" });

    const jrId = await makePendingJoinRequest();
    try {
      const res = await request(app)
        .post(`/api/leagues/${leagueId}/join-requests/${jrId}/approve`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: jrId, status: "approved" });

      // DB: join_request status updated
      const [jrRow] = await sql<{ status: string }>(
        `SELECT status FROM join_request WHERE id = $1`,
        [jrId],
      );
      expect(jrRow!.status).toBe("approved");

      // DB: league_membership created
      const [memberRow] = await sql<{ role: string }>(
        `SELECT role FROM league_membership WHERE league_id = $1 AND user_id = $2`,
        [leagueId, applicantAppUserId],
      );
      expect(memberRow).toBeTruthy();
      expect(memberRow!.role).toBe("gm");
    } finally {
      await cleanupJoinRequest(jrId);
    }
  });

  it("returns 409 when the request is already approved", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: commAppUserId, name: "Commissioner" });

    // Insert a pre-approved join request
    const [jrRow] = await sql<{ id: string }>(
      `INSERT INTO join_request (league_id, user_id, status, reviewed_at)
       VALUES ($1, $2, 'approved', NOW())
       RETURNING id`,
      [leagueId, applicantAppUserId],
    );
    const jrId = jrRow!.id;
    try {
      const res = await request(app)
        .post(`/api/leagues/${leagueId}/join-requests/${jrId}/approve`)
        .send();

      expect(res.status).toBe(409);
    } finally {
      await cleanupJoinRequest(jrId);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/leagues/:leagueId/join-requests/:requestId/reject
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /api/leagues/:leagueId/join-requests/:requestId/reject", () => {
  it("returns 401 when unauthenticated", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue(null);

    const jrId = await makePendingJoinRequest();
    try {
      const res = await request(app)
        .post(`/api/leagues/${leagueId}/join-requests/${jrId}/reject`)
        .send();
      expect(res.status).toBe(401);
    } finally {
      await cleanupJoinRequest(jrId);
    }
  });

  it("returns 403 when authenticated as a non-owner", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: `outsider-${RUN_ID}`, name: "Outsider" });

    const jrId = await makePendingJoinRequest();
    try {
      const res = await request(app)
        .post(`/api/leagues/${leagueId}/join-requests/${jrId}/reject`)
        .send();
      expect(res.status).toBe(403);
    } finally {
      await cleanupJoinRequest(jrId);
    }
  });

  it("returns 404 when join request does not exist", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: commAppUserId, name: "Commissioner" });

    const res = await request(app)
      .post(`/api/leagues/${leagueId}/join-requests/${crypto.randomUUID()}/reject`)
      .send();

    expect(res.status).toBe(404);
  });

  it("returns 200 and sets status to rejected", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: commAppUserId, name: "Commissioner" });

    const jrId = await makePendingJoinRequest();
    try {
      const res = await request(app)
        .post(`/api/leagues/${leagueId}/join-requests/${jrId}/reject`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: jrId, status: "rejected" });

      // DB: status updated
      const [jrRow] = await sql<{ status: string }>(
        `SELECT status FROM join_request WHERE id = $1`,
        [jrId],
      );
      expect(jrRow!.status).toBe("rejected");
    } finally {
      await cleanupJoinRequest(jrId);
    }
  });

  it("returns 409 when the request is already rejected", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: commAppUserId, name: "Commissioner" });

    const [jrRow] = await sql<{ id: string }>(
      `INSERT INTO join_request (league_id, user_id, status, reviewed_at)
       VALUES ($1, $2, 'rejected', NOW())
       RETURNING id`,
      [leagueId, applicantAppUserId],
    );
    const jrId = jrRow!.id;
    try {
      const res = await request(app)
        .post(`/api/leagues/${leagueId}/join-requests/${jrId}/reject`)
        .send();

      expect(res.status).toBe(409);
    } finally {
      await cleanupJoinRequest(jrId);
    }
  });
});
