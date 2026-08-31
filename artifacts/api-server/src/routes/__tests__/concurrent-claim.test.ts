/**
 * Integration test — concurrent seat-claim race condition
 *
 * Fires two simultaneous POST /api/join/:token/claim requests against an invite
 * with max_uses = 1 and verifies that the FOR UPDATE row lock in the endpoint
 * ensures exactly one claim succeeds and one is rejected (HTTP 410).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// getCurrentUser(req) reads req.authUser, set by the real Clerk-backed
// middleware. This test fires two genuinely concurrent requests as two
// different users, so — unlike every other test file's single
// mockReturnValue(...) — the mock here reads which user a given request is
// "logged in as" from a header the test sets per-request.
vi.mock("../../server/auth/index.js", () => ({
  getCurrentUser: vi.fn((req: { headers: Record<string, string | string[] | undefined> }) => {
    const replitId = req.headers["x-test-replit-id"];
    return typeof replitId === "string" ? { id: replitId, name: replitId } : null;
  }),
}));

import request from "supertest";
import crypto from "crypto";
import { pool } from "@workspace/db";
import app from "../../app.js";

// ── Unique prefix so parallel test runs don't collide ────────────────────────

const RUN_ID = crypto.randomBytes(4).toString("hex");

// IDs minted during setup
let leagueId: string;
let inviteToken: string;
let inviteId: string;
let sidA: string; // session for claimant A
let sidB: string; // session for claimant B

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Execute a raw SQL query and return the rows. */
async function sql<T extends object>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/** Create an app_user row keyed by replit_id; return the app_user id. */
async function makeUser(
  replitId: string,
  displayName: string,
): Promise<string> {
  // Upsert into app_user (raw domain table — no Drizzle schema for it).
  // Required NOT NULL columns: display_name, email.
  const email = `${replitId}@test.invalid`;
  const [row] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (replit_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [replitId, displayName, email],
  );
  return row!.id;
}

// ── Schema guard ──────────────────────────────────────────────────────────────
// Skip all tests in this file when the commissioner_invite table doesn't exist
// (e.g. a freshly-provisioned DB that hasn't had the full schema applied yet).

let schemaReady = false;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'commissioner_invite'
     ) AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
});

// ── Test fixtures ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!schemaReady) return;
  // 1. Commissioner (league owner)
  const commissionerReplitId = `test-commissioner-${RUN_ID}`;
  const commissionerAppId = await makeUser(
    commissionerReplitId,
    `commissioner-${RUN_ID}`,
  );

  // 2. Two claimants
  const replitIdA = `test-claimant-a-${RUN_ID}`;
  const replitIdB = `test-claimant-b-${RUN_ID}`;
  const appUserIdA = await makeUser(replitIdA, `claimant-a-${RUN_ID}`);
  const appUserIdB = await makeUser(replitIdB, `claimant-b-${RUN_ID}`);

  // 3. League owned by the commissioner
  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [commissionerAppId, `Test League ${RUN_ID}`, `test-league-${RUN_ID}`],
  );
  leagueId = league!.id;

  // 4. Invite with max_uses = 1
  inviteToken = crypto.randomUUID();
  const [invite] = await sql<{ id: string }>(
    `INSERT INTO commissioner_invite (league_id, token, created_by, max_uses)
     VALUES ($1, $2, $3, 1)
     RETURNING id`,
    [leagueId, inviteToken, commissionerAppId],
  );
  inviteId = invite!.id;

  // 5. Each claimant is identified per-request by the x-test-replit-id
  // header the mocked getCurrentUser reads (see the vi.mock above) — no
  // session store involved.
  sidA = replitIdA;
  sidB = replitIdB;
});

afterAll(async () => {
  // Clean up in reverse-dependency order
  if (inviteId) {
    await sql(
      `DELETE FROM commissioner_invite_claim WHERE invite_id = $1`,
      [inviteId],
    );
    await sql(
      `DELETE FROM commissioner_invite WHERE id = $1`,
      [inviteId],
    );
  }
  if (leagueId) {
    await sql(`DELETE FROM league_membership WHERE league_id = $1`, [leagueId]);
    await sql(`DELETE FROM league WHERE id = $1`, [leagueId]);
  }
  // Clean up test app_users
  await sql(
    `DELETE FROM app_user WHERE replit_id LIKE $1`,
    [`test-%-${RUN_ID}`],
  );
});

// ── The actual test ───────────────────────────────────────────────────────────

describe("POST /api/join/:token/claim — concurrent race condition", () => {
  it(
    "allows exactly one claim when two requests arrive simultaneously for a max_uses=1 invite",
    async (ctx) => {
      if (!schemaReady) return ctx.skip();
      // Fire both requests at the same time
      const [resA, resB] = await Promise.all([
        request(app)
          .post(`/api/join/${inviteToken}/claim`)
          .set("x-test-replit-id", sidA)
          .send(),
        request(app)
          .post(`/api/join/${inviteToken}/claim`)
          .set("x-test-replit-id", sidB)
          .send(),
      ]);

      const statuses = [resA.status, resB.status].sort();
      const bodies = [resA.body, resB.body];

      // Exactly one 200 and one 410
      expect(statuses).toEqual([200, 410]);

      // The 200 response must have outcome "member"
      const successBody = bodies.find((_, i) =>
        [resA, resB][i]!.status === 200,
      );
      expect(successBody).toMatchObject({ outcome: "member" });

      // The 410 response must be an RFC-7807 problem
      const failBody = bodies.find((_, i) =>
        [resA, resB][i]!.status === 410,
      );
      expect(failBody).toMatchObject({ status: 410 });

      // DB invariants: uses counter and claim row count
      const [inviteRow] = await sql<{ uses: number }>(
        `SELECT uses FROM commissioner_invite WHERE id = $1`,
        [inviteId],
      );
      expect(inviteRow!.uses).toBe(1);

      const [{ count }] = await sql<{ count: string }>(
        `SELECT COUNT(*) AS count FROM commissioner_invite_claim WHERE invite_id = $1`,
        [inviteId],
      );
      expect(Number(count)).toBe(1);
    },
  );
});
