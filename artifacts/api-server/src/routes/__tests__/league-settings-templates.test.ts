/**
 * Integration test — league settings templates end to end.
 *
 * Covers build-queue prompt A: GET /league-settings/templates exists and is
 * usable, and POST /leagues actually applies the chosen template + platform +
 * team_count to the seeded version-1 settings and to league.platform.
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
const REPLIT_ID = `lst-comm-${RUN_ID}`;

async function sql<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

let schemaReady = false;
let createdLeagueId: string | undefined;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'league_settings_version' AND column_name = 'require_verified_identities'
     ) AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
  if (!schemaReady) return;

  await sql(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1, $2, $3)
     ON CONFLICT (replit_id) DO NOTHING`,
    [REPLIT_ID, `Templates Commissioner ${RUN_ID}`, `${REPLIT_ID}@test.invalid`],
  );
  mockGetCurrentUser.mockReturnValue({ id: REPLIT_ID, name: "Templates Commissioner" } as any);
});

// No cleanup: league_settings_version is append-only (a trigger refuses
// UPDATE/DELETE), so neither the league nor the app_user row it references
// can be deleted afterward. Same convention as league-settings-migration.test.ts —
// the RUN_ID suffix keeps fixtures from colliding across runs.

describe("GET /api/league-settings/templates", () => {
  it("lists templates without requiring auth", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const callsBefore = mockGetCurrentUser.mock.calls.length;
    const res = await request(app).get("/api/league-settings/templates");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.map((t: { id: string }) => t.id)).toContain("balanced_standard");
    // Prove the route never even checks auth, rather than merely tolerating it.
    expect(mockGetCurrentUser.mock.calls.length).toBe(callsBefore);
  });
});

describe("POST /api/leagues — template + platform + team_count", () => {
  it("seeds version 1 from the chosen template and syncs league.platform", async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const res = await request(app)
      .post("/api/leagues")
      .send({
        name: `Templates League ${RUN_ID}`,
        slug: `templates-league-${RUN_ID}`,
        platform: "xbox",
        team_count: 24,
        settings_template_id: "competitive_hardcore",
      });

    expect(res.status).toBe(201);
    expect(res.body.platform).toBe("xbox");
    createdLeagueId = res.body.id;

    const settingsRes = await request(app).get(`/api/leagues/${createdLeagueId}/settings`);
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.body).toMatchObject({
      version: 1,
      platform: "xbox",
      team_count: 24,
      require_verified_identities: true,
      schedule_format: "double_round_robin",
    });
    expect(settingsRes.body.playoff_format).toMatchObject({ teams: 8, series_length: 7 });

    const [leagueRow] = await sql<{ platform: string }>(
      `SELECT platform FROM league WHERE id = $1`,
      [createdLeagueId],
    );
    expect(leagueRow?.platform).toBe("xbox");
  });
});
