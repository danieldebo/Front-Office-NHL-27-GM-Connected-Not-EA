/**
 * Integration tests — per-user league membership limits.
 *
 * Covers:
 *   POST /api/leagues                                        — create-quota, cooldown, total cap
 *   POST /api/leagues/:leagueId/join-requests/:id/approve     — join-side total cap
 *
 * A user may belong to (create + join, via league_membership) at most 10
 * leagues at once. Of those, the first 5 they create are free but throttled
 * by a 4-hour cooldown between creations; the 6th-10th require
 * app_user.extra_leagues_approved (there is no in-app admin role — this is
 * a manual DB flag).
 */
import { vi, describe, it, expect, beforeAll } from "vitest";

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

async function sql<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

function authAs(replitId: string, appUserId: string) {
  mockGetCurrentUser.mockReturnValue({ id: replitId, appUserId, name: replitId } as any);
}

let schemaReady = false;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'app_user' AND column_name = 'extra_leagues_approved'
     ) AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
});

async function makeUser(tag: string): Promise<{ replitId: string; appUserId: string }> {
  const replitId = `leaguecap-${tag}-${RUN_ID}`;
  const [row] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [replitId, `League Cap ${tag} ${RUN_ID}`, `${replitId}@test.invalid`],
  );
  return { replitId, appUserId: row!.id };
}

/** A minimal league row + an active membership row for `userId`, backdated so it never trips the cooldown. */
async function makeFillerLeagueMembership(
  ownerId: string,
  memberId: string,
  slugTag: string,
  role: "owner" | "gm" = "owner",
): Promise<string> {
  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (name, slug, owner_user_id, created_at)
     VALUES ($1,$2,$3, NOW() - INTERVAL '30 days') RETURNING id`,
    [`Filler League ${slugTag} ${RUN_ID}`, `filler-${slugTag}-${RUN_ID}`, ownerId],
  );
  await sql(
    `INSERT INTO league_membership (league_id, user_id, role) VALUES ($1,$2,$3)
     ON CONFLICT (league_id, user_id) DO NOTHING`,
    [league!.id, memberId, role],
  );
  return league!.id;
}

describe("league creation limits", () => {
  it("blocks a 2nd creation within the 4-hour cooldown, then allows it once the cooldown has passed", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const { replitId, appUserId } = await makeUser("cooldown");
    authAs(replitId, appUserId);

    const first = await request(app).post("/api/leagues").send({
      name: `Cooldown League 1 ${RUN_ID}`,
      slug: `cooldown-1-${RUN_ID}`,
      platform: "xbox",
      team_count: 4,
      settings_template_id: "balanced_standard",
    });
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/leagues").send({
      name: `Cooldown League 2 ${RUN_ID}`,
      slug: `cooldown-2-${RUN_ID}`,
      platform: "xbox",
      team_count: 4,
      settings_template_id: "balanced_standard",
    });
    expect(second.status).toBe(429);
    expect(second.headers["retry-after"]).toBeTruthy();

    // Backdate the first league so the cooldown has elapsed.
    await sql(`UPDATE league SET created_at = NOW() - INTERVAL '5 hours' WHERE id = $1`, [first.body.id]);

    const third = await request(app).post("/api/leagues").send({
      name: `Cooldown League 3 ${RUN_ID}`,
      slug: `cooldown-3-${RUN_ID}`,
      platform: "xbox",
      team_count: 4,
      settings_template_id: "balanced_standard",
    });
    expect(third.status).toBe(201);
  });

  it("blocks a 6th created league until extra_leagues_approved is set", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const { replitId, appUserId } = await makeUser("quota");
    authAs(replitId, appUserId);

    // Backdated so none of these trip the cooldown against each other.
    for (let i = 0; i < 5; i++) {
      await sql(
        `INSERT INTO league (name, slug, owner_user_id, created_at)
         VALUES ($1,$2,$3, NOW() - INTERVAL '30 days')`,
        [`Quota League ${i} ${RUN_ID}`, `quota-${i}-${RUN_ID}`, appUserId],
      );
    }

    const blocked = await request(app).post("/api/leagues").send({
      name: `Quota League 6 ${RUN_ID}`,
      slug: `quota-6-${RUN_ID}`,
      platform: "xbox",
      team_count: 4,
      settings_template_id: "balanced_standard",
    });
    expect(blocked.status).toBe(403);

    await sql(`UPDATE app_user SET extra_leagues_approved = TRUE WHERE id = $1`, [appUserId]);

    const allowed = await request(app).post("/api/leagues").send({
      name: `Quota League 6b ${RUN_ID}`,
      slug: `quota-6b-${RUN_ID}`,
      platform: "xbox",
      team_count: 4,
      settings_template_id: "balanced_standard",
    });
    expect(allowed.status).toBe(201);
  });

  it("blocks creation once a user is already in 10 leagues total, even with extra_leagues_approved", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const { appUserId: ownerId } = await makeUser("cap-owner");
    const { replitId, appUserId } = await makeUser("cap-self");
    authAs(replitId, appUserId);
    await sql(`UPDATE app_user SET extra_leagues_approved = TRUE WHERE id = $1`, [appUserId]);

    for (let i = 0; i < 10; i++) {
      await makeFillerLeagueMembership(ownerId, appUserId, `cap-${i}`, "gm");
    }

    const res = await request(app).post("/api/leagues").send({
      name: `Cap League 11 ${RUN_ID}`,
      slug: `cap-11-${RUN_ID}`,
      platform: "xbox",
      team_count: 4,
      settings_template_id: "balanced_standard",
    });
    expect(res.status).toBe(409);
  });
});

describe("league join limits", () => {
  it("refuses to approve a join request for an applicant already in 10 leagues", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const { appUserId: ownerId } = await makeUser("join-owner");
    const { replitId: applicantReplitId, appUserId: applicantId } = await makeUser("join-applicant");

    for (let i = 0; i < 10; i++) {
      await makeFillerLeagueMembership(ownerId, applicantId, `join-${i}`, "gm");
    }

    const commissioner = await makeUser("join-commissioner");
    authAs(commissioner.replitId, commissioner.appUserId);
    const leagueRes = await request(app).post("/api/leagues").send({
      name: `Join Cap League ${RUN_ID}`,
      slug: `join-cap-${RUN_ID}`,
      platform: "xbox",
      team_count: 4,
      settings_template_id: "balanced_standard",
    });
    expect(leagueRes.status).toBe(201);
    const leagueId = leagueRes.body.id as string;

    const [invite] = await sql<{ id: string; token: string }>(
      `INSERT INTO invite_link (league_id, created_by) VALUES ($1,$2) RETURNING id, token`,
      [leagueId, commissioner.appUserId],
    );

    authAs(applicantReplitId, applicantId);
    const joinRes = await request(app).post(`/api/invites/${invite!.token}/join`);
    expect(joinRes.status).toBe(201);
    const requestId = joinRes.body.id as string;

    authAs(commissioner.replitId, commissioner.appUserId);
    const approveRes = await request(app).post(`/api/leagues/${leagueId}/join-requests/${requestId}/approve`);
    expect(approveRes.status).toBe(409);

    const [jr] = await sql<{ status: string }>(`SELECT status FROM join_request WHERE id = $1`, [requestId]);
    expect(jr!.status).toBe("pending");
  });
});
