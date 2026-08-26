/**
 * Integration tests — commissioner sign-up review routes
 *
 * Covers:
 *   GET  /api/leagues/:id/signups
 *   GET  /api/leagues/:id/waitlist
 *   POST /api/leagues/:id/signups/:signupId/accept
 *   POST /api/leagues/:id/signups/:signupId/decline
 *
 * Auth is injected via vi.mock so these tests exercise the route guards
 * without requiring a real browser session. The discovery routes resolve the
 * mocked user's replit_id to app_user.id before checking league ownership.
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
const RUN_ID = crypto.randomBytes(4).toString("hex");

let schemaReady = false;
let signupReadColumnsReady = false;
let waitlistViewReady = false;
let declineNoteReady = false;
let leagueId: string;
let commissionerReplitId: string;
let commissionerAppUserId: string;
let outsiderReplitId: string;
let applicantAppUserIds: string[] = [];

async function sql<T extends object>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

async function makeUser(
  replitId: string,
  displayName: string,
): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (replit_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [replitId, displayName, `${replitId}@test.invalid`],
  );
  return row!.id;
}

async function makeSignupWithWaitlist(
  userId: string,
  position: number,
): Promise<{ signupId: string; waitlistId: string }> {
  const [signup] = await sql<{ id: string }>(
    `INSERT INTO league_signup (league_id, user_id, stated_division, platform, message)
     VALUES ($1, $2, 'gold', 'psn', 'Test applicant')
     RETURNING id`,
    [leagueId, userId],
  );

  const [waitlist] = await sql<{ id: string }>(
    `INSERT INTO waitlist_entry (league_id, user_id, signup_id, status, position)
     VALUES ($1, $2, $3, 'waiting', $4)
     RETURNING id`,
    [leagueId, userId, signup!.id, position],
  );

  return { signupId: signup!.id, waitlistId: waitlist!.id };
}

async function makeWaitlistOnly(
  userId: string,
  position: number,
): Promise<string> {
  const [waitlist] = await sql<{ id: string }>(
    `INSERT INTO waitlist_entry (league_id, user_id, signup_id, status, position)
     VALUES ($1, $2, NULL, 'waiting', $3)
     RETURNING id`,
    [leagueId, userId, position],
  );
  return waitlist!.id;
}

beforeAll(async () => {
  const { rows } = await pool.query<{ ready: boolean }>(
    `SELECT
       to_regclass('public.league_signup') IS NOT NULL
       AND to_regclass('public.waitlist_entry') IS NOT NULL
       AND to_regclass('public.league_membership') IS NOT NULL AS ready`,
  );
  schemaReady = rows[0]?.ready ?? false;
  if (!schemaReady) return;

  const { rows: columnRows } = await pool.query<{ ready: boolean }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'league_signup'
           AND column_name = 'country_code'
       )
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'league_signup'
           AND column_name = 'location'
       ) AS ready`,
  );
  signupReadColumnsReady = columnRows[0]?.ready ?? false;

  const { rows: declineNoteRows } = await pool.query<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'waitlist_entry'
         AND column_name = 'decline_note'
     ) AS ready`,
  );
  declineNoteReady = declineNoteRows[0]?.ready ?? false;

  const { rows: viewRows } = await pool.query<{ ready: boolean }>(
    `SELECT to_regclass('public.v_waitlist') IS NOT NULL AS ready`,
  );
  waitlistViewReady = viewRows[0]?.ready ?? false;

  commissionerReplitId = `signup-review-comm-${RUN_ID}`;
  outsiderReplitId = `signup-review-outsider-${RUN_ID}`;

  commissionerAppUserId = await makeUser(
    commissionerReplitId,
    `Signup Review Commissioner ${RUN_ID}`,
  );
  await makeUser(outsiderReplitId, `Signup Review Outsider ${RUN_ID}`);

  const applicantReplitIds = [
    `signup-review-guard-${RUN_ID}`,
    `signup-review-accept-${RUN_ID}`,
    `signup-review-decline-${RUN_ID}`,
    `signup-review-existing-${RUN_ID}`,
    `signup-review-waitlist-accept-${RUN_ID}`,
    `signup-review-waitlist-decline-${RUN_ID}`,
  ];
  for (const replitId of applicantReplitIds) {
    applicantAppUserIds.push(
      await makeUser(replitId, `Signup Review Applicant ${replitId}`),
    );
  }

  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [
      commissionerAppUserId,
      `Signup Review League ${RUN_ID}`,
      `signup-review-${RUN_ID}`,
    ],
  );
  leagueId = league!.id;
});

afterAll(async () => {
  if (!leagueId) return;

  await sql(`DELETE FROM waitlist_entry WHERE league_id = $1`, [leagueId]);
  await sql(`DELETE FROM league_signup WHERE league_id = $1`, [leagueId]);
  await sql(`DELETE FROM league_membership WHERE league_id = $1`, [leagueId]);
  await sql(`DELETE FROM league WHERE id = $1`, [leagueId]);
  await sql(`DELETE FROM app_user WHERE replit_id LIKE $1`, [
    `signup-review-%-${RUN_ID}`,
  ]);
});

describe("sign-up review authorization", () => {
  it("returns 403 for a non-commissioner on sign-up and waitlist reads", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({
      id: outsiderReplitId,
      name: "Outsider",
    });

    const signupsResponse = await request(app).get(
      `/api/leagues/${leagueId}/signups`,
    );
    const waitlistResponse = await request(app).get(
      `/api/leagues/${leagueId}/waitlist`,
    );

    expect(signupsResponse.status).toBe(403);
    expect(waitlistResponse.status).toBe(403);
  });

  it("returns 403 for a non-commissioner accepting or declining an applicant", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const { signupId } = await makeSignupWithWaitlist(
      applicantAppUserIds[0]!,
      1,
    );

    try {
      mockGetCurrentUser.mockReturnValue({
        id: outsiderReplitId,
        name: "Outsider",
      });

      const acceptResponse = await request(app).post(
        `/api/leagues/${leagueId}/signups/${signupId}/accept`,
      );
      const declineResponse = await request(app).post(
        `/api/leagues/${leagueId}/signups/${signupId}/decline`,
      );

      expect(acceptResponse.status).toBe(403);
      expect(declineResponse.status).toBe(403);
    } finally {
      await sql(`DELETE FROM waitlist_entry WHERE signup_id = $1`, [signupId]);
      await sql(`DELETE FROM league_signup WHERE id = $1`, [signupId]);
    }
  });

  it("returns sign-ups to the commissioner", async (ctx) => {
    if (!schemaReady || !signupReadColumnsReady) return ctx.skip();
    const { signupId, waitlistId } = await makeSignupWithWaitlist(
      applicantAppUserIds[0]!,
      1,
    );

    try {
      mockGetCurrentUser.mockReturnValue({
        id: commissionerReplitId,
        name: "Commissioner",
      });

      const signupsResponse = await request(app).get(
        `/api/leagues/${leagueId}/signups`,
      );

      expect(signupsResponse.status).toBe(200);
      expect(signupsResponse.body).toMatchObject({ total: 1 });
      expect(signupsResponse.body.data).toEqual([
        expect.objectContaining({
          signup_id: signupId,
          league_id: leagueId,
          user_id: applicantAppUserIds[0],
          skill_division: "gold",
          platform: "psn",
          waitlist_status: "waiting",
          waitlist_position: 1,
        }),
      ]);
    } finally {
      await sql(`DELETE FROM waitlist_entry WHERE id = $1`, [waitlistId]);
      await sql(`DELETE FROM league_signup WHERE id = $1`, [signupId]);
    }
  });

  it("returns waitlist entries to the commissioner", async (ctx) => {
    if (!schemaReady || !waitlistViewReady) return ctx.skip();
    const { signupId, waitlistId } = await makeSignupWithWaitlist(
      applicantAppUserIds[0]!,
      1,
    );

    try {
      mockGetCurrentUser.mockReturnValue({
        id: commissionerReplitId,
        name: "Commissioner",
      });

      const waitlistResponse = await request(app).get(
        `/api/leagues/${leagueId}/waitlist`,
      );

      expect(waitlistResponse.status).toBe(200);
      expect(waitlistResponse.body).toMatchObject({ total: 1 });
      expect(waitlistResponse.body.data).toEqual([
        expect.objectContaining({
          waitlist_entry_id: waitlistId,
          signup_id: signupId,
          league_id: leagueId,
          position: 1,
          status: "waiting",
          user_id: applicantAppUserIds[0],
          platform: "psn",
        }),
      ]);
    } finally {
      await sql(`DELETE FROM waitlist_entry WHERE id = $1`, [waitlistId]);
      await sql(`DELETE FROM league_signup WHERE id = $1`, [signupId]);
    }
  });
});

describe("POST /api/leagues/:id/signups/:signupId/accept", () => {
  it("creates membership, marks the applicant placed, and removes the signup", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({
      id: commissionerReplitId,
      name: "Commissioner",
    });
    const { signupId, waitlistId } = await makeSignupWithWaitlist(
      applicantAppUserIds[1]!,
      2,
    );

    try {
      const response = await request(app).post(
        `/api/leagues/${leagueId}/signups/${signupId}/accept`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        signup_id: signupId,
        league_id: leagueId,
        user_id: applicantAppUserIds[1],
        outcome: "accepted",
      });

      const [waitlistRow] = await sql<{
        status: string;
        signup_id: string | null;
      }>(`SELECT status, signup_id FROM waitlist_entry WHERE id = $1`, [
        waitlistId,
      ]);
      expect(waitlistRow).toMatchObject({ status: "placed", signup_id: null });

      const membershipRows = await sql<{ role: string }>(
        `SELECT role FROM league_membership
         WHERE league_id = $1 AND user_id = $2`,
        [leagueId, applicantAppUserIds[1]],
      );
      expect(membershipRows).toHaveLength(1);
      expect(membershipRows[0]!.role).toBe("gm");

      const signupRows = await sql<{ id: string }>(
        `SELECT id FROM league_signup WHERE id = $1`,
        [signupId],
      );
      expect(signupRows).toHaveLength(0);
    } finally {
      await sql(`DELETE FROM waitlist_entry WHERE id = $1`, [waitlistId]);
      await sql(`DELETE FROM league_signup WHERE id = $1`, [signupId]);
      await sql(
        `DELETE FROM league_membership WHERE league_id = $1 AND user_id = $2`,
        [leagueId, applicantAppUserIds[1]],
      );
    }
  });

  it("does not duplicate membership when the applicant is already a member", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({
      id: commissionerReplitId,
      name: "Commissioner",
    });
    const applicantId = applicantAppUserIds[3]!;
    const { signupId, waitlistId } = await makeSignupWithWaitlist(
      applicantId,
      3,
    );
    await sql(
      `INSERT INTO league_membership (league_id, user_id, role)
       VALUES ($1, $2, 'gm')`,
      [leagueId, applicantId],
    );

    try {
      const response = await request(app).post(
        `/api/leagues/${leagueId}/signups/${signupId}/accept`,
      );

      expect(response.status).toBe(200);
      const [{ count }] = await sql<{ count: string }>(
        `SELECT COUNT(*) AS count FROM league_membership
         WHERE league_id = $1 AND user_id = $2`,
        [leagueId, applicantId],
      );
      expect(Number(count)).toBe(1);
    } finally {
      await sql(`DELETE FROM waitlist_entry WHERE id = $1`, [waitlistId]);
      await sql(`DELETE FROM league_signup WHERE id = $1`, [signupId]);
      await sql(
        `DELETE FROM league_membership WHERE league_id = $1 AND user_id = $2`,
        [leagueId, applicantId],
      );
    }
  });

  it("accepts a waitlist-only applicant without creating or requiring a signup", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({
      id: commissionerReplitId,
      name: "Commissioner",
    });
    const applicantId = applicantAppUserIds[4]!;
    const waitlistId = await makeWaitlistOnly(applicantId, 6);

    try {
      const response = await request(app).post(
        `/api/leagues/${leagueId}/signups/${waitlistId}/accept`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        signup_id: null,
        league_id: leagueId,
        user_id: applicantId,
        outcome: "accepted",
      });

      const [waitlistRow] = await sql<{ status: string; signup_id: string | null }>(
        `SELECT status, signup_id FROM waitlist_entry WHERE id = $1`,
        [waitlistId],
      );
      expect(waitlistRow).toMatchObject({ status: "placed", signup_id: null });

      const membershipRows = await sql<{ role: string }>(
        `SELECT role FROM league_membership WHERE league_id = $1 AND user_id = $2`,
        [leagueId, applicantId],
      );
      expect(membershipRows).toHaveLength(1);
      expect(membershipRows[0]!.role).toBe("gm");
    } finally {
      await sql(`DELETE FROM waitlist_entry WHERE id = $1`, [waitlistId]);
      await sql(
        `DELETE FROM league_membership WHERE league_id = $1 AND user_id = $2`,
        [leagueId, applicantId],
      );
    }
  });
});

describe("POST /api/leagues/:id/signups/:signupId/decline", () => {
  it("marks the applicant declined and removes the signup", async (ctx) => {
    if (!schemaReady || !declineNoteReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({
      id: commissionerReplitId,
      name: "Commissioner",
    });
    const { signupId, waitlistId } = await makeSignupWithWaitlist(
      applicantAppUserIds[2]!,
      4,
    );

    try {
      const response = await request(app).post(
        `/api/leagues/${leagueId}/signups/${signupId}/decline`,
      ).send({ note: "Not the right fit for this season" });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        signup_id: signupId,
        league_id: leagueId,
        user_id: applicantAppUserIds[2],
        outcome: "declined",
      });

      const [waitlistRow] = await sql<{
        status: string;
        signup_id: string | null;
        decline_note: string | null;
      }>(`SELECT status, signup_id, decline_note FROM waitlist_entry WHERE id = $1`, [
        waitlistId,
      ]);
      expect(waitlistRow).toMatchObject({
        status: "declined",
        signup_id: null,
        decline_note: "Not the right fit for this season",
      });

      const signupRows = await sql<{ id: string }>(
        `SELECT id FROM league_signup WHERE id = $1`,
        [signupId],
      );
      expect(signupRows).toHaveLength(0);
    } finally {
      await sql(`DELETE FROM waitlist_entry WHERE id = $1`, [waitlistId]);
      await sql(`DELETE FROM league_signup WHERE id = $1`, [signupId]);
    }
  });

  it("rejects a decline note longer than 500 characters", async (ctx) => {
    if (!schemaReady || !declineNoteReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({
      id: commissionerReplitId,
      name: "Commissioner",
    });
    const { signupId, waitlistId } = await makeSignupWithWaitlist(
      applicantAppUserIds[3]!,
      5,
    );

    try {
      const response = await request(app)
        .post(`/api/leagues/${leagueId}/signups/${signupId}/decline`)
        .send({ note: "a".repeat(501) });

      expect(response.status).toBe(400);

      const [waitlistRow] = await sql<{
        status: string;
        decline_note: string | null;
      }>(`SELECT status, decline_note FROM waitlist_entry WHERE id = $1`, [
        waitlistId,
      ]);
      expect(waitlistRow).toMatchObject({
        status: "waiting",
        decline_note: null,
      });

      const signupRows = await sql<{ id: string }>(
        `SELECT id FROM league_signup WHERE id = $1`,
        [signupId],
      );
      expect(signupRows).toHaveLength(1);
    } finally {
      await sql(`DELETE FROM waitlist_entry WHERE id = $1`, [waitlistId]);
      await sql(`DELETE FROM league_signup WHERE id = $1`, [signupId]);
    }
  });

  it("declines a waitlist-only applicant without creating or requiring a signup", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({
      id: commissionerReplitId,
      name: "Commissioner",
    });
    const applicantId = applicantAppUserIds[5]!;
    const waitlistId = await makeWaitlistOnly(applicantId, 7);

    try {
      const response = await request(app).post(
        `/api/leagues/${leagueId}/signups/${waitlistId}/decline`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        signup_id: null,
        league_id: leagueId,
        user_id: applicantId,
        outcome: "declined",
      });

      const [waitlistRow] = await sql<{
        status: string;
        signup_id: string | null;
      }>(
        `SELECT status, signup_id FROM waitlist_entry WHERE id = $1`,
        [waitlistId],
      );
      expect(waitlistRow).toMatchObject({
        status: "declined",
        signup_id: null,
      });
    } finally {
      await sql(`DELETE FROM waitlist_entry WHERE id = $1`, [waitlistId]);
    }
  });
});
