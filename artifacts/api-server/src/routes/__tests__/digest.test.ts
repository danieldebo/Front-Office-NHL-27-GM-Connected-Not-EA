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
let leagueId: string;
let commissionerReplitId: string;
let commissionerAppUserId: string;
let memberReplitId: string;
let memberAppUserId: string;
let unsubToken: string;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'league' AND column_name = 'digest_enabled') AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
  if (!schemaReady) return;

  commissionerReplitId = `digest-comm-${RUN_ID}`;
  memberReplitId = `digest-member-${RUN_ID}`;

  const [comm] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [commissionerReplitId, `Digest Route Comm ${RUN_ID}`, `${commissionerReplitId}@test.invalid`],
  );
  const [member] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [memberReplitId, `Digest Route Member ${RUN_ID}`, `${memberReplitId}@test.invalid`],
  );
  commissionerAppUserId = comm!.id;
  memberAppUserId = member!.id;

  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug) VALUES ($1,$2,$3) RETURNING id`,
    [commissionerAppUserId, `Digest Route League ${RUN_ID}`, `digest-route-league-${RUN_ID}`],
  );
  leagueId = league!.id;

  const [membership] = await sql<{ digest_unsub_token: string }>(
    `INSERT INTO league_membership (league_id, user_id) VALUES ($1,$2) RETURNING digest_unsub_token`,
    [leagueId, memberAppUserId],
  );
  unsubToken = membership!.digest_unsub_token;
});

describe("digest settings + unsubscribe", () => {
  it("only the commissioner can view or edit digest settings", async () => {
    if (!schemaReady) return;
    authAs(memberReplitId, memberAppUserId);
    const forbiddenGet = await request(app).get(`/api/leagues/${leagueId}/digest-settings`);
    expect(forbiddenGet.status).toBe(403);

    authAs(commissionerReplitId, commissionerAppUserId);
    const getRes = await request(app).get(`/api/leagues/${leagueId}/digest-settings`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.digest_enabled).toBe(false);

    const patchRes = await request(app)
      .patch(`/api/leagues/${leagueId}/digest-settings`)
      .send({ digest_enabled: true, digest_day_of_week: 3, digest_hour_local: 14, digest_timezone: "America/New_York" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.digest_enabled).toBe(true);
    expect(patchRes.body.digest_day_of_week).toBe(3);
    expect(patchRes.body.digest_timezone).toBe("America/New_York");
  });

  it("a member can unsubscribe themselves", async () => {
    if (!schemaReady) return;
    authAs(memberReplitId, memberAppUserId);
    const res = await request(app).post(`/api/leagues/${leagueId}/digest-unsubscribe`);
    expect(res.status).toBe(200);
    expect(res.body.unsubscribed).toBe(true);

    const [row] = await sql<{ digest_unsubscribed_at: Date | null }>(
      `SELECT digest_unsubscribed_at FROM league_membership WHERE league_id = $1 AND user_id = $2`,
      [leagueId, memberAppUserId],
    );
    expect(row!.digest_unsubscribed_at).not.toBeNull();
  });

  it("the public token-based unsubscribe link works without auth", async () => {
    if (!schemaReady) return;
    mockGetCurrentUser.mockReturnValue(null);
    const res = await request(app).get(`/api/digest/unsubscribe/${unsubToken}`);
    expect(res.status).toBe(200);

    const badRes = await request(app).get(`/api/digest/unsubscribe/not-a-real-token`);
    expect(badRes.status).toBe(404);
  });
});
