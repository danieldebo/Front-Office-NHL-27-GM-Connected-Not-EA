/**
 * Integration test — commissioner invite links now issue hockey/gamer-word
 * tokens (e.g. "slapshot-clutch-7f3a") instead of a crypto.randomUUID().
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

let schemaReady = false;
let ownerReplitId: string;
let ownerAppUserId: string;
let leagueId: string;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'commissioner_invite'
     ) AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
  if (!schemaReady) return;

  ownerReplitId = `link-owner-${RUN_ID}`;
  const [owner] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [ownerReplitId, `Link Owner ${RUN_ID}`, `${ownerReplitId}@test.invalid`],
  );
  ownerAppUserId = owner!.id;

  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug) VALUES ($1,$2,$3) RETURNING id`,
    [ownerAppUserId, `Link League ${RUN_ID}`, `link-league-${RUN_ID}`],
  );
  leagueId = league!.id;

  mockGetCurrentUser.mockReturnValue({ id: ownerReplitId, appUserId: ownerAppUserId, name: ownerReplitId } as any);
});

const TOKEN_PATTERN = /^[a-z]+-[a-z]+-[0-9a-f]{4}$/;

describe("commissioner invite tokens", () => {
  it("issues a hockey/gamer-word token, not a UUID, on create", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const res = await request(app).post(`/api/leagues/${leagueId}/commissioner-invite`).send({});
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(TOKEN_PATTERN);
  });

  it("issues a different, still word-shaped token on rotate, and revokes the old one", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const before = await request(app).get(`/api/leagues/${leagueId}/commissioner-invite`);
    const oldToken = before.body.invite.token;

    const res = await request(app).post(`/api/leagues/${leagueId}/commissioner-invite/rotate`).send({});
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(TOKEN_PATTERN);
    expect(res.body.token).not.toBe(oldToken);

    const [oldRow] = await sql<{ is_active: boolean }>(
      `SELECT is_active FROM commissioner_invite WHERE token = $1`,
      [oldToken],
    );
    expect(oldRow?.is_active).toBe(false);
  });
});

// No cleanup: league_settings_version is not involved here, but this league
// has no settings version at all (created via raw SQL, not POST /leagues),
// so nothing blocks deletion — left in place anyway for consistency with the
// other integration tests in this file set, which rely on the RUN_ID suffix
// to keep fixtures isolated across runs rather than tearing down.
