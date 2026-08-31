/**
 * Integration tests — PATCH /api/leagues/:leagueId/seasons/:seasonId
 *
 * A commissioner can set/change a season's starts_on freely until the
 * season has a real (confirmed/forfeited/simulated) game result, at which
 * point it locks — starts_on can no longer contradict what's already been
 * played.
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
       WHERE table_name = 'season' AND column_name = 'starts_on'
     ) AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
});

async function makeCommissionerWithLeague(tag: string): Promise<{
  replitId: string; appUserId: string; leagueId: string; seasonId: string; teamA: string; teamB: string;
}> {
  const replitId = `season-comm-${tag}-${RUN_ID}`;
  const [row] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [replitId, `Season Commissioner ${tag} ${RUN_ID}`, `${replitId}@test.invalid`],
  );
  const appUserId = row!.id;
  authAs(replitId, appUserId);

  const leagueRes = await request(app).post("/api/leagues").send({
    name: `Season Update League ${tag} ${RUN_ID}`,
    slug: `season-update-${tag}-${RUN_ID}`,
    platform: "xbox",
    team_count: 4,
    settings_template_id: "balanced_standard",
  });
  expect(leagueRes.status).toBe(201);
  const leagueId = leagueRes.body.id as string;

  const seasonRes = await request(app)
    .post(`/api/leagues/${leagueId}/seasons`)
    .send({ label: "Season 1", game_title: "Hockey 27" });
  expect(seasonRes.status).toBe(201);
  const seasonId = seasonRes.body.id as string;

  const seatsRes = await request(app).get(`/api/leagues/${leagueId}/seats`);
  const teamSeasonIds: string[] = seatsRes.body.data.map((s: { team_season_id: string }) => s.team_season_id);

  return { replitId, appUserId, leagueId, seasonId, teamA: teamSeasonIds[0]!, teamB: teamSeasonIds[1]! };
}

describe("PATCH /api/leagues/:leagueId/seasons/:seasonId", () => {
  it("lets the commissioner set and then change starts_on before any game is played", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const { replitId, appUserId, leagueId, seasonId } = await makeCommissionerWithLeague("free");
    authAs(replitId, appUserId);

    const first = await request(app)
      .patch(`/api/leagues/${leagueId}/seasons/${seasonId}`)
      .send({ starts_on: "2026-10-01" });
    expect(first.status).toBe(200);
    expect(first.body.starts_on).toContain("2026-10-01");
    expect(first.body.starts_on_locked).toBe(false);

    const second = await request(app)
      .patch(`/api/leagues/${leagueId}/seasons/${seasonId}`)
      .send({ starts_on: "2026-10-15" });
    expect(second.status).toBe(200);
    expect(second.body.starts_on).toContain("2026-10-15");
  });

  it("rejects a non-commissioner GM", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const { leagueId, seasonId } = await makeCommissionerWithLeague("gm-block");
    const outsiderReplitId = `season-outsider-${RUN_ID}`;
    const [outsider] = await sql<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [outsiderReplitId, `Season Outsider ${RUN_ID}`, `${outsiderReplitId}@test.invalid`],
    );
    authAs(outsiderReplitId, outsider!.id);

    const res = await request(app)
      .patch(`/api/leagues/${leagueId}/seasons/${seasonId}`)
      .send({ starts_on: "2026-10-01" });
    expect(res.status).toBe(403);
  });

  it("locks starts_on once the season has a confirmed game, and reports starts_on_locked on the seasons list", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const { replitId, appUserId, leagueId, seasonId, teamA, teamB } = await makeCommissionerWithLeague("locked");
    authAs(replitId, appUserId);

    const before = await request(app)
      .patch(`/api/leagues/${leagueId}/seasons/${seasonId}`)
      .send({ starts_on: "2026-10-01" });
    expect(before.status).toBe(200);

    const [game] = await sql<{ id: string }>(
      `INSERT INTO game (season_id, home_team_season_id, away_team_season_id, window_opens_at, window_closes_at, status)
       VALUES ($1,$2,$3, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day', 'confirmed') RETURNING id`,
      [seasonId, teamA, teamB],
    );
    await sql(
      `INSERT INTO game_result (game_id, home_goals, away_goals, reported_by) VALUES ($1,4,2,$2)`,
      [game!.id, appUserId],
    );

    const seasonsRes = await request(app).get(`/api/leagues/${leagueId}/seasons`);
    const season = seasonsRes.body.data.find((s: { id: string }) => s.id === seasonId);
    expect(season.starts_on_locked).toBe(true);

    const blocked = await request(app)
      .patch(`/api/leagues/${leagueId}/seasons/${seasonId}`)
      .send({ starts_on: "2026-11-01" });
    expect(blocked.status).toBe(409);

    const unchanged = await sql<{ starts_on: string }>(
      `SELECT to_char(starts_on, 'YYYY-MM-DD') AS starts_on FROM season WHERE id = $1`,
      [seasonId],
    );
    expect(unchanged[0]!.starts_on).toBe("2026-10-01");
  });

  it("shifts every already-generated game window by the same delta when starts_on changes", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const { replitId, appUserId, leagueId, seasonId, teamA, teamB } = await makeCommissionerWithLeague("reschedule");
    authAs(replitId, appUserId);

    // Seed an initial starts_on and a two-week schedule anchored to it.
    const seeded = await request(app)
      .patch(`/api/leagues/${leagueId}/seasons/${seasonId}`)
      .send({ starts_on: "2026-10-01" });
    expect(seeded.status).toBe(200);

    const [week1, week2] = await sql<{ id: string }>(
      `INSERT INTO game (season_id, week_number, home_team_season_id, away_team_season_id, window_opens_at, window_closes_at)
       VALUES
         ($1, 1, $2, $3, '2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z'),
         ($1, 2, $3, $2, '2026-10-08T00:00:00Z', '2026-10-15T00:00:00Z')
       RETURNING id`,
      [seasonId, teamA, teamB],
    );
    expect(week1).toBeDefined();
    expect(week2).toBeDefined();

    // Push the start date out by 7 days.
    const moved = await request(app)
      .patch(`/api/leagues/${leagueId}/seasons/${seasonId}`)
      .send({ starts_on: "2026-10-08" });
    expect(moved.status).toBe(200);

    const games = await sql<{ week_number: number; window_opens_at: string; window_closes_at: string }>(
      `SELECT week_number, window_opens_at, window_closes_at FROM game WHERE season_id = $1 ORDER BY week_number`,
      [seasonId],
    );
    expect(games).toHaveLength(2);
    expect(new Date(games[0]!.window_opens_at).toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(new Date(games[0]!.window_closes_at).toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(new Date(games[1]!.window_opens_at).toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(new Date(games[1]!.window_closes_at).toISOString()).toBe("2026-10-22T00:00:00.000Z");
  });

  it("does not touch game windows when starts_on is set for the first time (nothing to shift from)", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const { replitId, appUserId, leagueId, seasonId, teamA, teamB } = await makeCommissionerWithLeague("first-set");
    authAs(replitId, appUserId);

    // No starts_on yet — insert a game window before ever setting one.
    await sql(
      `INSERT INTO game (season_id, week_number, home_team_season_id, away_team_season_id, window_opens_at, window_closes_at)
       VALUES ($1, 1, $2, $3, '2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z')`,
      [seasonId, teamA, teamB],
    );

    const first = await request(app)
      .patch(`/api/leagues/${leagueId}/seasons/${seasonId}`)
      .send({ starts_on: "2026-11-01" });
    expect(first.status).toBe(200);

    const games = await sql<{ window_opens_at: string }>(
      `SELECT window_opens_at FROM game WHERE season_id = $1`,
      [seasonId],
    );
    expect(new Date(games[0]!.window_opens_at).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});
