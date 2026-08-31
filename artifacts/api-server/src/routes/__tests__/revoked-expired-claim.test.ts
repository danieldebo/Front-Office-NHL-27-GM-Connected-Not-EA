/**
 * Integration tests — revoked and expired invite-link rejection
 *
 * Verifies that POST /api/join/:token/claim returns HTTP 410 and leaves the
 * commissioner_invite_claim table empty when:
 *   (a) the invite has been explicitly revoked (is_active = false)
 *   (b) the invite's expires_at is in the past
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../server/auth/index.js", () => ({
  getCurrentUser: vi.fn().mockReturnValue(null),
}));

import request from "supertest";
import crypto from "crypto";
import { pool } from "@workspace/db";
import app from "../../app.js";
import { getCurrentUser } from "../../server/auth/index.js";

const mockGetCurrentUser = vi.mocked(getCurrentUser);

// ── Unique prefix so parallel test runs don't collide ────────────────────────

const RUN_ID = crypto.randomBytes(4).toString("hex");

// IDs minted during setup
let leagueId: string;
let revokedInviteToken: string;
let revokedInviteId: string;
let expiredInviteToken: string;
let expiredInviteId: string;
let claimantReplitId: string;

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
async function makeUser(replitId: string, displayName: string): Promise<string> {
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
// Skip all tests when the commissioner_invite table doesn't exist.

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
  const commissionerReplitId = `test-commissioner-rev-${RUN_ID}`;
  const commissionerAppId = await makeUser(
    commissionerReplitId,
    `commissioner-rev-${RUN_ID}`,
  );

  // 2. Single claimant used for both tests
  claimantReplitId = `test-claimant-rev-${RUN_ID}`;
  await makeUser(claimantReplitId, `claimant-rev-${RUN_ID}`);

  // 3. League owned by the commissioner
  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [
      commissionerAppId,
      `Test League Rev ${RUN_ID}`,
      `test-league-rev-${RUN_ID}`,
    ],
  );
  leagueId = league!.id;

  // 4a. Revoked invite: insert as active, then immediately revoke it
  revokedInviteToken = crypto.randomUUID();
  const [revokedInvite] = await sql<{ id: string }>(
    `INSERT INTO commissioner_invite (league_id, token, created_by, is_active, revoked_at)
     VALUES ($1, $2, $3, false, now())
     RETURNING id`,
    [leagueId, revokedInviteToken, commissionerAppId],
  );
  revokedInviteId = revokedInvite!.id;

  // 4b. Expired invite: expires_at set one hour in the past
  expiredInviteToken = crypto.randomUUID();
  const [expiredInvite] = await sql<{ id: string }>(
    `INSERT INTO commissioner_invite (league_id, token, created_by, expires_at)
     VALUES ($1, $2, $3, now() - interval '1 hour')
     RETURNING id`,
    [leagueId, expiredInviteToken, commissionerAppId],
  );
  expiredInviteId = expiredInvite!.id;
});

afterAll(async () => {
  // Clean up in reverse-dependency order
  for (const inviteId of [revokedInviteId, expiredInviteId].filter(Boolean)) {
    await sql(`DELETE FROM commissioner_invite_claim WHERE invite_id = $1`, [inviteId]);
    await sql(`DELETE FROM commissioner_invite WHERE id = $1`, [inviteId]);
  }
  if (leagueId) {
    await sql(`DELETE FROM league_membership WHERE league_id = $1`, [leagueId]);
    await sql(`DELETE FROM league WHERE id = $1`, [leagueId]);
  }
  await sql(`DELETE FROM app_user WHERE replit_id LIKE $1`, [`test-%-rev-${RUN_ID}`]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/join/:token/claim — revoked invite", () => {
  it("returns 410 and leaves the claim table empty", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: claimantReplitId, name: claimantReplitId } as any);

    const res = await request(app)
      .post(`/api/join/${revokedInviteToken}/claim`)
      .send();

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ status: 410 });

    // Claim table must remain empty for this invite
    const [{ count }] = await sql<{ count: string }>(
      `SELECT COUNT(*) AS count FROM commissioner_invite_claim WHERE invite_id = $1`,
      [revokedInviteId],
    );
    expect(Number(count)).toBe(0);
  });
});

describe("POST /api/join/:token/claim — expired invite", () => {
  it("returns 410 and leaves the claim table empty", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({ id: claimantReplitId, name: claimantReplitId } as any);

    const res = await request(app)
      .post(`/api/join/${expiredInviteToken}/claim`)
      .send();

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ status: 410 });

    // Claim table must remain empty for this invite
    const [{ count }] = await sql<{ count: string }>(
      `SELECT COUNT(*) AS count FROM commissioner_invite_claim WHERE invite_id = $1`,
      [expiredInviteId],
    );
    expect(Number(count)).toBe(0);
  });
});
