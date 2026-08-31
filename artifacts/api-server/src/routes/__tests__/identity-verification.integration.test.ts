import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../server/auth/index.js", () => ({
  getCurrentUser: vi.fn().mockReturnValue(null),
}));

import crypto from "node:crypto";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../../app.js";
import { getCurrentUser } from "../../server/auth/index.js";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const RUN_ID = crypto.randomBytes(4).toString("hex");
const replitIds: string[] = [];
const userIds: string[] = [];
let schemaReady = false;
let eligibilitySchemaReady = false;
let ownerId: string;
let verifiedUserId: string;
let failedUserId: string;
let eligibilityUserId: string;
let leagueId: string;

async function sql<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, params)).rows;
}

async function makeXboxUser(label: string): Promise<string> {
  const replitId = `identity-${label}-${RUN_ID}`;
  replitIds.push(replitId);
  const [row] = await sql<{ id: string }>(
    `INSERT INTO app_user (
       replit_id, display_name, email, timezone, xbox_gamertag,
       systems_played, primary_identity
     ) VALUES ($1,$2,$3,'UTC',$4,ARRAY['xbox']::text[],'xbox')
     RETURNING id`,
    [replitId, `Identity ${label}`, `${replitId}@test.invalid`, `Xbox-${label}-${RUN_ID}`],
  );
  userIds.push(row!.id);
  return row!.id;
}

beforeAll(async () => {
  const [ready] = await sql<{ ready: boolean }>(
    `SELECT
       to_regclass('public.identity_verification_challenge') IS NOT NULL
       AND to_regclass('public.identity_verification_evidence') IS NOT NULL
       AND to_regclass('public.league_settings_version') IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'app_user'
            AND column_name = 'xbox_identity_verified_at'
       ) AS ready`,
  );
  schemaReady = ready?.ready ?? false;
  if (!schemaReady) return;

  verifiedUserId = await makeXboxUser("verified");
  failedUserId = await makeXboxUser("failed");
  ownerId = await makeXboxUser("owner");
  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug)
     VALUES ($1,$2,$3) RETURNING id`,
    [ownerId, `Verified Identity League ${RUN_ID}`, `verified-identity-${RUN_ID}`],
  );
  leagueId = league!.id;
  const [eligibilityReady] = await sql<{ ready: boolean }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'league'
            AND column_name = 'platform'
       )
       AND to_regclass('public.league_listing') IS NOT NULL
       AND to_regclass('public.league_signup') IS NOT NULL
       AND to_regclass('public.waitlist_entry') IS NOT NULL AS ready`,
  );
  eligibilitySchemaReady = eligibilityReady?.ready ?? false;
  if (!eligibilitySchemaReady) return;

  eligibilityUserId = await makeXboxUser("eligibility");
  await sql(
    `INSERT INTO league_listing
       (league_id,is_listed,accepting_signups,accepting_waitlist,platform)
     VALUES ($1,TRUE,TRUE,TRUE,'xbox')`,
    [leagueId],
  );
  const [settings] = await sql<{ id: string }>(
    `INSERT INTO league_settings_version
       (league_id,version,platform,changed_by,change_summary,require_verified_identities)
     VALUES ($1,1,'xbox',$2,'Require verified test identities',TRUE)
     RETURNING id`,
    [leagueId, ownerId],
  );
  await sql(
    `INSERT INTO league_settings_active (league_id,settings_version_id) VALUES ($1,$2)`,
    [leagueId, settings!.id],
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (!schemaReady) return;
  if (eligibilitySchemaReady) {
    await sql(`DELETE FROM waitlist_entry WHERE league_id = $1`, [leagueId]);
    await sql(`DELETE FROM league_signup WHERE league_id = $1`, [leagueId]);
    await sql(`DELETE FROM league_settings_active WHERE league_id = $1`, [leagueId]);
  }
  const client = await pool.connect();
  try {
    await client.query("SET session_replication_role = replica");
    if (eligibilitySchemaReady) {
      await client.query(`DELETE FROM league_settings_version WHERE league_id = $1`, [leagueId]);
    }
    await client.query(
      `DELETE FROM identity_verification_evidence WHERE user_id = ANY($1::uuid[])`,
      [userIds],
    );
    await client.query(
      `DELETE FROM app_user_profile_history WHERE user_id = ANY($1::uuid[])`,
      [userIds],
    );
  } finally {
    await client.query("SET session_replication_role = DEFAULT").catch(() => undefined);
    client.release();
  }
  if (eligibilitySchemaReady) {
    await sql(`DELETE FROM league_listing WHERE league_id = $1`, [leagueId]);
  }
  await sql(`DELETE FROM league WHERE id = $1`, [leagueId]);
  await sql(`DELETE FROM audit_log WHERE actor_user_id = ANY($1::uuid[])`, [userIds]);
  await sql(`DELETE FROM identity_verification_challenge WHERE user_id = ANY($1::uuid[])`, [userIds]);
  await sql(`DELETE FROM app_user WHERE id = ANY($1::uuid[])`, [userIds]);
});

describe.sequential("console identity verification routes", () => {
  it("submits for a commissioner, permits one approval, and preserves commissioner evidence after identity change", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({
      id: replitIds[1]!,
      appUserId: verifiedUserId,
      name: "Verified player",
    });

    const first = await request(app)
      .post("/api/users/me/identity-verifications/xbox/challenge");
    const second = await request(app)
      .post("/api/users/me/identity-verifications/xbox/challenge");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const challenges = await sql<{ code: string; superseded_at: Date | null }>(
      `SELECT code, superseded_at FROM identity_verification_challenge
        WHERE user_id = $1 ORDER BY created_at`,
      [verifiedUserId],
    );
    expect(challenges).toHaveLength(2);
    expect(challenges[0]!.superseded_at).not.toBeNull();
    expect(challenges[1]!.superseded_at).toBeNull();

    const submitted = await request(app)
      .post("/api/users/me/identity-verifications/xbox/complete");
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("pending_commissioner_review");
    expect(submitted.body.review_path).toBe(`/identity-verifications/review/${second.body.challenge_id}`);

    mockGetCurrentUser.mockReturnValue({ id: replitIds[3]!, appUserId: ownerId, name: "Commissioner" });
    const review = await request(app).get(`/api${submitted.body.review_path}`);
    expect(review.status).toBe(200);
    expect(review.body).toMatchObject({ code: second.body.code, gamertag: second.body.gamertag });
    const approval = await request(app).post(`/api${submitted.body.review_path}/approve`);
    expect(approval.status).toBe(200);
    expect(approval.body.profile.xbox_identity_verified_at).toBeTruthy();
    expect((await request(app).post(`/api${submitted.body.review_path}/approve`)).status).toBe(400);

    const patch = await request(app)
      .patch("/api/users/me")
      .send({
        display_name: "Verified player",
        timezone: "UTC",
        xbox_gamertag: `Xbox-changed-${RUN_ID}`,
        psn_online_id: null,
        systems_played: ["xbox"],
        primary_identity: "xbox",
      });
    expect(patch.status).toBe(200);
    expect(patch.body.xbox_identity_verified_at).toBeNull();

    const [history] = await sql<{ evidence_count: string; audit_count: string }>(
      `SELECT
         (SELECT count(*) FROM identity_verification_evidence
           WHERE user_id = $1 AND outcome = 'verified' AND method = 'commissioner_attestation')
             AS evidence_count,
         (SELECT count(*) FROM audit_log
           WHERE entity_id = $1 AND action = 'verify_identity') AS audit_count`,
      [verifiedUserId],
    );
    expect(Number(history!.evidence_count)).toBe(1);
    expect(Number(history!.audit_count)).toBe(1);
  });

  it("rejects expired submissions and a profile change racing commissioner approval", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({
      id: replitIds[2]!,
      appUserId: failedUserId,
      name: "Failed player",
    });

    const expired = await request(app)
      .post("/api/users/me/identity-verifications/xbox/challenge");
    expect(expired.status).toBe(201);
    await sql(
      `UPDATE identity_verification_challenge
          SET created_at = now() - interval '2 minutes',
              expires_at = now() - interval '1 minute'
        WHERE user_id = $1 AND code = $2`,
      [failedUserId, expired.body.code],
    );
    expect((await request(app).post("/api/users/me/identity-verifications/xbox/complete")).status).toBe(400);

    const active = await request(app)
      .post("/api/users/me/identity-verifications/xbox/challenge");
    const submitted = await request(app).post("/api/users/me/identity-verifications/xbox/complete");
    expect(active.status).toBe(201);
    expect(submitted.status).toBe(200);

    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(`SELECT id FROM app_user WHERE id = $1 FOR UPDATE`, [failedUserId]);
    const replacementGamertag = `Changed-${RUN_ID}`;
    const patchPromise = request(app)
      .patch("/api/users/me")
      .send({
        display_name: "Failed player",
        timezone: "UTC",
        xbox_gamertag: replacementGamertag,
        psn_online_id: null,
        systems_played: ["xbox"],
        primary_identity: "xbox",
      })
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockGetCurrentUser.mockReturnValue({ id: replitIds[3]!, appUserId: ownerId, name: "Commissioner" });
    const approvalPromise = request(app)
      .post(`/api${submitted.body.review_path}/approve`)
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await blocker.query("COMMIT");
    blocker.release();

    const [patch, approval] = await Promise.all([patchPromise, approvalPromise]);
    expect(patch.status).toBe(200);
    expect(approval.status).toBe(400);
    const [profile] = await sql<{ xbox_gamertag: string; xbox_identity_verified_at: Date | null }>(
      `SELECT xbox_gamertag, xbox_identity_verified_at FROM app_user WHERE id = $1`,
      [failedUserId],
    );
    expect(profile).toMatchObject({
      xbox_gamertag: replacementGamertag,
      xbox_identity_verified_at: null,
    });
  });
});

describe.sequential("verified identity league eligibility", () => {
  it("blocks both signup paths until the saved identity is verified", async (ctx) => {
    if (!eligibilitySchemaReady) return ctx.skip();
    mockGetCurrentUser.mockReturnValue({
      id: replitIds[3]!,
      appUserId: eligibilityUserId,
      name: "Eligibility player",
    });

    const signupBlocked = await request(app).post(`/api/leagues/${leagueId}/signup`).send({});
    const waitlistBlocked = await request(app).post(`/api/leagues/${leagueId}/waitlist`).send({});
    expect(signupBlocked.status).toBe(400);
    expect(signupBlocked.body.detail).toMatch(/requires a verified console identity/i);
    expect(waitlistBlocked.status).toBe(400);
    expect(waitlistBlocked.body.detail).toMatch(/requires a verified console identity/i);

    await sql(
      `UPDATE app_user SET xbox_identity_verified_at = now() WHERE id = $1`,
      [eligibilityUserId],
    );
    const signupAllowed = await request(app).post(`/api/leagues/${leagueId}/signup`).send({});
    const waitlistAllowed = await request(app).post(`/api/leagues/${leagueId}/waitlist`).send({});
    expect(signupAllowed.status).toBe(201);
    expect(signupAllowed.body).toMatchObject({
      platform: "xbox",
      identity_verified: true,
    });
    expect(waitlistAllowed.status).toBe(201);
  });
});