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
let gmAReplitId: string;
let gmAAppUserId: string;
let gmBReplitId: string;
let gmBAppUserId: string;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'calendar_feed_token') AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
  if (!schemaReady) return;

  commissionerReplitId = `cal-comm-${RUN_ID}`;
  gmAReplitId = `cal-gma-${RUN_ID}`;
  gmBReplitId = `cal-gmb-${RUN_ID}`;

  const [comm] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [commissionerReplitId, `Cal Comm ${RUN_ID}`, `${commissionerReplitId}@test.invalid`],
  );
  const [gmA] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [gmAReplitId, `Cal GM A ${RUN_ID}`, `${gmAReplitId}@test.invalid`],
  );
  const [gmB] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [gmBReplitId, `Cal GM B ${RUN_ID}`, `${gmBReplitId}@test.invalid`],
  );
  commissionerAppUserId = comm!.id;
  gmAAppUserId = gmA!.id;
  gmBAppUserId = gmB!.id;

  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug) VALUES ($1,$2,$3) RETURNING id`,
    [commissionerAppUserId, `Cal League ${RUN_ID}`, `cal-league-${RUN_ID}`],
  );
  leagueId = league!.id;

  const [season] = await sql<{ id: string }>(
    `INSERT INTO season (league_id, ordinal, label, game_title) VALUES ($1,1,'Season 1','NHL') RETURNING id`,
    [leagueId],
  );
  const [frA] = await sql<{ id: string }>(`INSERT INTO franchise (league_id, name) VALUES ($1,$2) RETURNING id`, [leagueId, `Cal Home ${RUN_ID}`]);
  const [frB] = await sql<{ id: string }>(`INSERT INTO franchise (league_id, name) VALUES ($1,$2) RETURNING id`, [leagueId, `Cal Away ${RUN_ID}`]);
  const [tsA] = await sql<{ id: string }>(`INSERT INTO team_season (season_id, franchise_id) VALUES ($1,$2) RETURNING id`, [season!.id, frA!.id]);
  const [tsB] = await sql<{ id: string }>(`INSERT INTO team_season (season_id, franchise_id) VALUES ($1,$2) RETURNING id`, [season!.id, frB!.id]);
  await sql(`INSERT INTO gm_assignment (team_season_id, user_id) VALUES ($1,$2)`, [tsA!.id, gmAAppUserId]);
  await sql(`INSERT INTO gm_assignment (team_season_id, user_id) VALUES ($1,$2)`, [tsB!.id, gmBAppUserId]);
  await sql(
    `INSERT INTO game (season_id, home_team_season_id, away_team_season_id, window_opens_at, window_closes_at)
     VALUES ($1,$2,$3, NOW() + INTERVAL '3 days', NOW() + INTERVAL '5 days')`,
    [season!.id, tsA!.id, tsB!.id],
  );
});

describe("calendar feed", () => {
  it("issues a personal feed and serves the .ics for it", async () => {
    if (!schemaReady) return;
    authAs(gmAReplitId, gmAAppUserId);
    const mineRes = await request(app).get(`/api/leagues/${leagueId}/calendar-feed/mine`);
    expect(mineRes.status).toBe(200);
    expect(mineRes.body.scope).toBe("gm");
    const token = mineRes.body.token;

    const icsRes = await request(app).get(`/api/calendar/${token}`);
    expect(icsRes.status).toBe(200);
    expect(icsRes.headers["content-type"]).toContain("text/calendar");
    expect(icsRes.text).toContain("BEGIN:VCALENDAR");
    expect(icsRes.text).toContain("Cal Away");
    expect(icsRes.text).toContain("Cal Home");
  });

  it("gm B does not see gm A's personal token reused, and requesting again is idempotent", async () => {
    if (!schemaReady) return;
    authAs(gmAReplitId, gmAAppUserId);
    const first = await request(app).get(`/api/leagues/${leagueId}/calendar-feed/mine`);
    const second = await request(app).get(`/api/leagues/${leagueId}/calendar-feed/mine`);
    expect(first.body.token).toBe(second.body.token);

    authAs(gmBReplitId, gmBAppUserId);
    const gmBToken = await request(app).get(`/api/leagues/${leagueId}/calendar-feed/mine`);
    expect(gmBToken.body.token).not.toBe(first.body.token);
  });

  it("revoking a personal feed invalidates the old token and issues a new one", async () => {
    if (!schemaReady) return;
    authAs(gmAReplitId, gmAAppUserId);
    const before = await request(app).get(`/api/leagues/${leagueId}/calendar-feed/mine`);
    const oldToken = before.body.token;

    const revokeRes = await request(app).post(`/api/leagues/${leagueId}/calendar-feed/mine/revoke`);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.token).not.toBe(oldToken);

    const oldIcsRes = await request(app).get(`/api/calendar/${oldToken}`);
    expect(oldIcsRes.status).toBe(404);

    const newIcsRes = await request(app).get(`/api/calendar/${revokeRes.body.token}`);
    expect(newIcsRes.status).toBe(200);
  });

  it("only the commissioner can mint or revoke the whole-league feed", async () => {
    if (!schemaReady) return;
    authAs(gmAReplitId, gmAAppUserId);
    const forbiddenGet = await request(app).get(`/api/leagues/${leagueId}/calendar-feed/league`);
    expect(forbiddenGet.status).toBe(403);

    authAs(commissionerReplitId, commissionerAppUserId);
    const leagueFeed = await request(app).get(`/api/leagues/${leagueId}/calendar-feed/league`);
    expect(leagueFeed.status).toBe(200);
    expect(leagueFeed.body.scope).toBe("league");

    const icsRes = await request(app).get(`/api/calendar/${leagueFeed.body.token}`);
    expect(icsRes.status).toBe(200);
    // League-wide feed includes both teams' games regardless of GM assignment
    expect(icsRes.text).toContain("Cal Away");
  });

  it("an unknown token 404s", async () => {
    if (!schemaReady) return;
    const res = await request(app).get(`/api/calendar/not-a-real-token`);
    expect(res.status).toBe(404);
  });
});
