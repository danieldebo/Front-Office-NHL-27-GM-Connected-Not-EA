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
  getCurrentUser: vi.fn((req: { get(name: string): string | undefined }) => {
    const id = req.get("x-test-user-id");
    return id ? { id } : null;
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
let exhaustedLeagueId: string;
let revokedInviteToken: string;
let revokedInviteId: string;
let expiredInviteToken: string;
let expiredInviteId: string;
let exhaustedInviteToken: string;
let exhaustedInviteId: string;
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
  const [exhaustedLeague] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [
      commissionerAppId,
      `Test Exhausted League ${RUN_ID}`,
      `test-exhausted-league-${RUN_ID}`,
    ],
  );
  exhaustedLeagueId = exhaustedLeague!.id;

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

  // 4c. Exhausted invite: use count has reached its cap
  exhaustedInviteToken = crypto.randomUUID();
  const [exhaustedInvite] = await sql<{ id: string }>(
    `INSERT INTO commissioner_invite (league_id, token, created_by, max_uses, uses)
     VALUES ($1, $2, $3, 1, 1)
     RETURNING id`,
    [exhaustedLeagueId, exhaustedInviteToken, commissionerAppId],
  );
  exhaustedInviteId = exhaustedInvite!.id;

});

afterAll(async () => {
  // Clean up in reverse-dependency order
  for (const inviteId of [revokedInviteId, expiredInviteId, exhaustedInviteId].filter(Boolean)) {
    await sql(`DELETE FROM commissioner_invite_claim WHERE invite_id = $1`, [inviteId]);
    await sql(`DELETE FROM commissioner_invite WHERE id = $1`, [inviteId]);
  }
  for (const id of [leagueId, exhaustedLeagueId].filter(Boolean)) {
    await sql(`DELETE FROM league_membership WHERE league_id = $1`, [id]);
    await sql(`DELETE FROM league WHERE id = $1`, [id]);
  }
  await sql(`DELETE FROM app_user WHERE replit_id LIKE $1`, [`test-%-rev-${RUN_ID}`]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/join/:token — inactive invite reasons", () => {
  it.each([
    ["revoked", () => revokedInviteToken, "This invite has been revoked."],
    ["expired", () => expiredInviteToken, "This invite has expired."],
    ["exhausted", () => exhaustedInviteToken, "This invite has reached its use limit."],
  ])("returns the precise %s reason", async (_label, token, reason, ctx) => {
    if (!schemaReady) return ctx.skip();

    const res = await request(app).get(`/api/join/${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ usable: false, reason });
  });

  it("keeps a genuinely missing token distinct", async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const res = await request(app).get(`/api/join/${crypto.randomUUID()}`);

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({
      status: 410,
      detail: "This invite link is no longer active or does not exist.",
    });
  });
});

describe("POST /api/join/:token/claim — revoked invite", () => {
  it("returns 410 and leaves the claim table empty", async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const res = await request(app)
      .post(`/api/join/${revokedInviteToken}/claim`)
      .set("x-test-user-id", claimantReplitId)
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

    const res = await request(app)
      .post(`/api/join/${expiredInviteToken}/claim`)
      .set("x-test-user-id", claimantReplitId)
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
