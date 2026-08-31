import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../server/auth/index.js", () => ({
  getCurrentUser: vi.fn().mockReturnValue(null),
}));

import crypto from "node:crypto";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../../app.js";
import { getCurrentUser } from "../../server/auth/index.js";
import { LEAGUE_SETTINGS_TEMPLATES } from "../league-settings.js";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const runId = crypto.randomBytes(4).toString("hex");
const replitId = `settings-template-${runId}`;
let schemaReady = false;
let ownerId = "";
let leagueId = "";
let emptyLeagueId = "";
let createdLeagueId = "";

async function sql<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, params)).rows;
}

beforeAll(async () => {
  const [ready] = await sql<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'league_settings_version'
          AND column_name = 'applied_template_id'
     ) AS ready`,
  );
  schemaReady = ready?.ready ?? false;
  if (!schemaReady) return;

  const [owner] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email)
     VALUES ($1, 'Template Commissioner', $2)
     RETURNING id`,
    [replitId, `${replitId}@test.invalid`],
  );
  ownerId = owner!.id;
  const [emptyLeague] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug)
     VALUES ($1, 'Empty Settings League', $2)
     RETURNING id`,
    [ownerId, `empty-settings-${runId}`],
  );
  emptyLeagueId = emptyLeague!.id;
  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug)
     VALUES ($1, 'Template Integration League', $2)
     RETURNING id`,
    [ownerId, `settings-template-${runId}`],
  );
  leagueId = league!.id;
  const [initial] = await sql<{ id: string }>(
    `INSERT INTO league_settings_version
       (league_id, version, changed_by, change_summary)
     VALUES ($1, 1, $2, 'Initial settings')
     RETURNING id`,
    [leagueId, ownerId],
  );
  await sql(
    `INSERT INTO league_settings_active (league_id, settings_version_id)
     VALUES ($1, $2)`,
    [leagueId, initial!.id],
  );
  mockGetCurrentUser.mockReturnValue({ id: replitId, appUserId: ownerId, name: "Template Commissioner" });
});

afterAll(async () => {
  if (!schemaReady) return;
  const client = await pool.connect();
  try {
    await client.query("SET session_replication_role = replica");
    await client.query(`DELETE FROM idempotency_key WHERE user_id = $1`, [ownerId]);
    await client.query(`DELETE FROM audit_log WHERE league_id = $1`, [leagueId]);
    if (createdLeagueId) {
      await client.query(`DELETE FROM league_membership WHERE league_id = $1`, [createdLeagueId]);
      await client.query(`DELETE FROM league_settings_active WHERE league_id = $1`, [createdLeagueId]);
      await client.query(`DELETE FROM league_settings_version WHERE league_id = $1`, [createdLeagueId]);
      await client.query(`DELETE FROM league WHERE id = $1`, [createdLeagueId]);
    }
    await client.query(`DELETE FROM league_settings_active WHERE league_id = $1`, [leagueId]);
    await client.query(`DELETE FROM league_settings_version WHERE league_id = $1`, [leagueId]);
    await client.query(`DELETE FROM league WHERE id = $1`, [leagueId]);
    await client.query(`DELETE FROM league WHERE id = $1`, [emptyLeagueId]);
    await client.query(`DELETE FROM app_user WHERE id = $1`, [ownerId]);
  } finally {
    await client.query("SET session_replication_role = DEFAULT").catch(() => undefined);
    client.release();
  }
});

describe.sequential("curated league settings template routes", () => {
  it("returns a successful null result when an existing league has no settings", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const response = await request(app).get(`/api/leagues/${emptyLeagueId}/settings`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: null });
  });

  it("creates and activates a complete template-backed version 1 with the league", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const template = LEAGUE_SETTINGS_TEMPLATES[0];
    const response = await request(app)
      .post("/api/leagues")
      .send({
        name: "Complete Settings League",
        slug: `complete-settings-${runId}`,
        visibility: "unlisted",
        settings: {
          ...template.values,
          applied_template_id: template.id,
          change_summary: "Initial league settings",
        },
      });
    expect(response.status).toBe(201);
    createdLeagueId = response.body.id;

    const [active] = await sql<{
      version: number;
      platform: string;
      team_count: number;
      roster_min: number;
      salary_cap_cents: string;
      applied_template_id: string;
    }>(
      `SELECT v.version, v.platform, v.team_count, v.roster_min,
              v.salary_cap_cents, v.applied_template_id
         FROM league_settings_active a
         JOIN league_settings_version v ON v.id = a.settings_version_id
        WHERE a.league_id = $1`,
      [createdLeagueId],
    );
    expect(active).toMatchObject({
      version: 1,
      platform: "both",
      team_count: 32,
      roster_min: 20,
      salary_cap_cents: "10400000000",
      applied_template_id: "balanced_standard",
    });
  });

  it("persists template provenance on a normal immutable version and history response", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const template = LEAGUE_SETTINGS_TEMPLATES[1];
    const created = await request(app)
      .post(`/api/leagues/${leagueId}/settings/versions`)
      .send({
        ...template.values,
        ea_league_id: null,
        applied_template_id: template.id,
        team_count: 12,
        change_summary: "Adjusted team count after applying the template",
      });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      version: 2,
      is_active: true,
      applied_template_id: "international_style",
      team_count: 12,
      change_summary: "Applied International-style template — Adjusted team count after applying the template",
    });

    const history = await request(app).get(`/api/leagues/${leagueId}/settings/history`);
    expect(history.status).toBe(200);
    expect(history.body.data[0]).toMatchObject({
      version: 2,
      applied_template_id: "international_style",
      team_count: 12,
    });
    expect(history.body.data[1]).toMatchObject({
      version: 1,
      applied_template_id: null,
    });
  });

  it("rejects a stale template without creating a version or audit entry", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const before = await sql<{ versions: string; audits: string }>(
      `SELECT
         (SELECT COUNT(*) FROM league_settings_version WHERE league_id = $1)::text AS versions,
         (SELECT COUNT(*) FROM audit_log WHERE league_id = $1)::text AS audits`,
      [leagueId],
    );
    const rejected = await request(app)
      .post(`/api/leagues/${leagueId}/settings/versions`)
      .send({
        ...LEAGUE_SETTINGS_TEMPLATES[0].values,
        applied_template_id: "retired_template",
        change_summary: "Should not save",
      });
    expect(rejected.status).toBe(400);
    expect(rejected.body.detail).toMatch(/no longer available/i);

    const after = await sql<{ versions: string; audits: string }>(
      `SELECT
         (SELECT COUNT(*) FROM league_settings_version WHERE league_id = $1)::text AS versions,
         (SELECT COUNT(*) FROM audit_log WHERE league_id = $1)::text AS audits`,
      [leagueId],
    );
    expect(after).toEqual(before);
  });
});