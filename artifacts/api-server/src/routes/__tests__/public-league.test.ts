import { vi, describe, it, expect, beforeAll } from "vitest";

vi.mock("../../server/auth/index.js", () => ({
  getCurrentUser: vi.fn().mockReturnValue(null),
}));

import request from "supertest";
import crypto from "crypto";
import { pool } from "@workspace/db";
import app from "../../app.js";

const RUN_ID = crypto.randomBytes(4).toString("hex");

async function sql<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

let schemaReady = false;
let ownerId: string;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'league_partner') AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
  if (!schemaReady) return;

  const [owner] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [`pub-owner-${RUN_ID}`, `Pub Owner ${RUN_ID}`, `pub-owner-${RUN_ID}@test.invalid`],
  );
  ownerId = owner!.id;
});

describe("GET /api/l/:slug — visibility + schedule + rulebook + partners", () => {
  it("renders a public league with schedule, rulebook, and partners", async () => {
    if (!schemaReady) return;
    const slug = `pub-public-${RUN_ID}`;
    const [league] = await sql<{ id: string }>(
      `INSERT INTO league (owner_user_id, name, slug, visibility) VALUES ($1,$2,$3,'public') RETURNING id`,
      [ownerId, `Public Test League ${RUN_ID}`, slug],
    );
    const leagueId = league!.id;

    await sql(
      `INSERT INTO rulebook_revision (league_id, version, body_md, authored_by) VALUES ($1,'1.0','# Rules',$2)`,
      [leagueId, ownerId],
    );
    await sql(
      `INSERT INTO league_partner (league_id, kind, name, link, display_order) VALUES ($1,'sponsor','Rink Co','https://x.example',0)`,
      [leagueId],
    );

    const [season] = await sql<{ id: string }>(
      `INSERT INTO season (league_id, ordinal, label, game_title, is_active) VALUES ($1,1,'Season 1','NHL',TRUE) RETURNING id`,
      [leagueId],
    );
    const [frA] = await sql<{ id: string }>(`INSERT INTO franchise (league_id, name) VALUES ($1,$2) RETURNING id`, [leagueId, `Pub Home ${RUN_ID}`]);
    const [frB] = await sql<{ id: string }>(`INSERT INTO franchise (league_id, name) VALUES ($1,$2) RETURNING id`, [leagueId, `Pub Away ${RUN_ID}`]);
    const [tsA] = await sql<{ id: string }>(`INSERT INTO team_season (season_id, franchise_id) VALUES ($1,$2) RETURNING id`, [season!.id, frA!.id]);
    const [tsB] = await sql<{ id: string }>(`INSERT INTO team_season (season_id, franchise_id) VALUES ($1,$2) RETURNING id`, [season!.id, frB!.id]);

    // A past, confirmed game (should appear under "recent")
    const [pastGame] = await sql<{ id: string }>(
      `INSERT INTO game (season_id, home_team_season_id, away_team_season_id, window_opens_at, window_closes_at, status)
       VALUES ($1,$2,$3, NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days', 'confirmed') RETURNING id`,
      [season!.id, tsA!.id, tsB!.id],
    );
    await sql(
      `INSERT INTO game_result (game_id, home_goals, away_goals, reported_by) VALUES ($1,4,2,$2)`,
      [pastGame!.id, ownerId],
    );
    // A future, scheduled game (should appear under "upcoming")
    await sql(
      `INSERT INTO game (season_id, home_team_season_id, away_team_season_id, window_opens_at, window_closes_at, status)
       VALUES ($1,$2,$3, NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days', 'scheduled')`,
      [season!.id, tsA!.id, tsB!.id],
    );

    const res = await request(app).get(`/api/l/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.rulebook.version).toBe("1.0");
    expect(res.body.partners.sponsors).toHaveLength(1);
    expect(res.body.schedule.recent).toHaveLength(1);
    expect(res.body.schedule.recent[0].home_goals).toBe(4);
    expect(res.body.schedule.upcoming).toHaveLength(1);
  });

  it("404s a private league regardless of any code", async () => {
    if (!schemaReady) return;
    const slug = `pub-private-${RUN_ID}`;
    await sql(
      `INSERT INTO league (owner_user_id, name, slug, visibility) VALUES ($1,$2,$3,'private')`,
      [ownerId, `Private Test League ${RUN_ID}`, slug],
    );

    const res = await request(app).get(`/api/l/${slug}`);
    expect(res.status).toBe(404);

    const withCode = await request(app).get(`/api/l/${slug}?code=ANYCODE123`);
    expect(withCode.status).toBe(404);
  });

  it("404s an unlisted league without the matching code, 200s with it", async () => {
    if (!schemaReady) return;
    const slug = `pub-unlisted-${RUN_ID}`;
    await sql(
      `INSERT INTO league (owner_user_id, name, slug, visibility, public_code) VALUES ($1,$2,$3,'unlisted','UN${RUN_ID.toUpperCase()}')`,
      [ownerId, `Unlisted Test League ${RUN_ID}`, slug],
    );

    const noCode = await request(app).get(`/api/l/${slug}`);
    expect(noCode.status).toBe(404);

    const wrongCode = await request(app).get(`/api/l/${slug}?code=NOPE`);
    expect(wrongCode.status).toBe(404);

    const rightCode = await request(app).get(`/api/l/${slug}?code=UN${RUN_ID.toUpperCase()}`);
    expect(rightCode.status).toBe(200);
    expect(rightCode.body.league.slug).toBe(slug);
  });
});
