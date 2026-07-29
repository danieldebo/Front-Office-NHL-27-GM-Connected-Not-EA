/**
 * Integration test — duplicate seat-claim guard
 *
 * Verifies that a second POST /api/join/:token/claim from the *same* user returns
 * HTTP 409 while the first call succeeds with HTTP 200 (outcome: "member"), and
 * that commissioner_invite.uses remains 1 after both attempts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { pool } from "@workspace/db";
import app from "../../app.js";
import { createSession } from "../../lib/auth.js";

// ── Unique prefix so parallel test runs don't collide ────────────────────────

const RUN_ID = crypto.randomBytes(4).toString("hex");

// IDs minted during setup
let leagueId: string;
let inviteToken: string;
let inviteId: string;
let claimantSession: string;

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
// Skip all tests in this file when the commissioner_invite table doesn't exist.

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
  const commissionerReplitId = `test-commissioner-dup-${RUN_ID}`;
  const commissionerAppId = await makeUser(
    commissionerReplitId,
    `commissioner-dup-${RUN_ID}`,
  );

  // 2. Single claimant who will attempt to claim twice
  const claimantReplitId = `test-claimant-dup-${RUN_ID}`;
  await makeUser(claimantReplitId, `claimant-dup-${RUN_ID}`);

  // 3. League owned by the commissioner
  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [
      commissionerAppId,
      `Test League Dup ${RUN_ID}`,
      `test-league-dup-${RUN_ID}`,
    ],
  );
  leagueId = league!.id;

  // 4. Invite with generous max_uses so the second attempt is blocked only by
  //    the duplicate-claim guard, not by the use-count limit.
  inviteToken = crypto.randomUUID();
  const [invite] = await sql<{ id: string }>(
    `INSERT INTO commissioner_invite (league_id, token, created_by, max_uses)
     VALUES ($1, $2, $3, 10)
     RETURNING id`,
    [leagueId, inviteToken, commissionerAppId],
  );
  inviteId = invite!.id;

  // 5. Session for the claimant
  claimantSession = await createSession({
    user: { id: claimantReplitId, name: `Claimant Dup ${RUN_ID}` },
    access_token: "test-token-dup",
  });
});

afterAll(async () => {
  if (inviteId) {
    await sql(`DELETE FROM commissioner_invite_claim WHERE invite_id = $1`, [inviteId]);
    await sql(`DELETE FROM commissioner_invite WHERE id = $1`, [inviteId]);
  }
  if (leagueId) {
    await sql(`DELETE FROM league_membership WHERE league_id = $1`, [leagueId]);
    await sql(`DELETE FROM league WHERE id = $1`, [leagueId]);
  }
  await sql(`DELETE FROM app_user WHERE replit_id LIKE $1`, [`test-%-dup-${RUN_ID}`]);
  if (claimantSession) {
    await sql(`DELETE FROM sessions WHERE sid = $1`, [claimantSession]);
  }
});

// ── The actual test ───────────────────────────────────────────────────────────

describe("POST /api/join/:token/claim — duplicate claim guard", () => {
  it(
    "first claim returns 200 with outcome member; second claim from the same user returns 409",
    async (ctx) => {
      if (!schemaReady) return ctx.skip();

      // First claim — must succeed
      const firstRes = await request(app)
        .post(`/api/join/${inviteToken}/claim`)
        .set("Authorization", `Bearer ${claimantSession}`)
        .send();

      expect(firstRes.status).toBe(200);
      expect(firstRes.body).toMatchObject({ outcome: "member" });

      // Second claim with the same session — must be rejected
      const secondRes = await request(app)
        .post(`/api/join/${inviteToken}/claim`)
        .set("Authorization", `Bearer ${claimantSession}`)
        .send();

      expect(secondRes.status).toBe(409);

      // uses counter must reflect exactly one successful claim
      const [inviteRow] = await sql<{ uses: number }>(
        `SELECT uses FROM commissioner_invite WHERE id = $1`,
        [inviteId],
      );
      expect(inviteRow!.uses).toBe(1);

      // Only one claim row must exist
      const [{ count }] = await sql<{ count: string }>(
        `SELECT COUNT(*) AS count FROM commissioner_invite_claim WHERE invite_id = $1`,
        [inviteId],
      );
      expect(Number(count)).toBe(1);
    },
  );
});
