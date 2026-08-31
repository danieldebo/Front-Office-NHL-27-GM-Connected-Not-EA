/**
 * Integration tests — the GM seat card's identity + career-record fields.
 *
 * Covers:
 *   GET /api/leagues/:leagueId/seats
 *   PUT /api/team-seasons/:teamSeasonId/gm
 *   PATCH /api/users/me (first_nhl_game, profile_image_url)
 *
 * Exercises getGmCareerRecords()'s league-scoped vs site-wide aggregation —
 * the one genuinely tricky piece of logic here — by giving one GM seats in
 * two different leagues and confirming a game in league B never leaks into
 * league A's league_record, while both count toward site_record.
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
let cardColumnsReady = false;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'team_season'
     ) AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;

  const { rows: colRows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'app_user' AND column_name = 'first_nhl_game'
     ) AS exists`,
  );
  cardColumnsReady = colRows[0]?.exists ?? false;
});

async function makeLeagueWithTwoTeams(
  commissionerReplitId: string,
  commissionerAppUserId: string,
  slug: string,
): Promise<{ leagueId: string; teamA: string; teamB: string }> {
  authAs(commissionerReplitId, commissionerAppUserId);
  const leagueRes = await request(app).post("/api/leagues").send({
    name: `GM Card League ${slug}`,
    slug: `gm-card-${slug}`,
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

  const seatsRes = await request(app).get(`/api/leagues/${leagueId}/seats`);
  expect(seatsRes.status).toBe(200);
  const teamSeasonIds: string[] = seatsRes.body.data.map((s: { team_season_id: string }) => s.team_season_id);
  return { leagueId, teamA: teamSeasonIds[0]!, teamB: teamSeasonIds[1]! };
}

/** Insert a confirmed, standings-counting result for a completed game. */
async function playGame(
  seasonId: string,
  homeTeamSeasonId: string,
  awayTeamSeasonId: string,
  homeGoals: number,
  awayGoals: number,
  reportedBy: string,
): Promise<void> {
  const [game] = await sql<{ id: string }>(
    `INSERT INTO game (season_id, home_team_season_id, away_team_season_id, window_opens_at, window_closes_at, status)
     VALUES ($1,$2,$3, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day', 'confirmed') RETURNING id`,
    [seasonId, homeTeamSeasonId, awayTeamSeasonId],
  );
  await sql(
    `INSERT INTO game_result (game_id, home_goals, away_goals, reported_by, counts_toward_standings)
     VALUES ($1,$2,$3,$4,TRUE)`,
    [game!.id, homeGoals, awayGoals, reportedBy],
  );
}

describe("GM seat card — identity fields and career record", () => {
  it("returns first_nhl_game/profile_image_url and a zero record for a freshly-assigned GM with no games", async (ctx) => {
    if (!schemaReady || !cardColumnsReady) return ctx.skip();

    const commissionerReplitId = `gmcard-comm-${RUN_ID}`;
    const [comm] = await sql<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [commissionerReplitId, `GM Card Commissioner ${RUN_ID}`, `${commissionerReplitId}@test.invalid`],
    );
    const gmReplitId = `gmcard-gm-fresh-${RUN_ID}`;
    const [gm] = await sql<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email, first_nhl_game, profile_image_url)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [gmReplitId, `GM Card Fresh GM ${RUN_ID}`, `${gmReplitId}@test.invalid`, "NHL 94", "https://example.test/avatar.png"],
    );

    const { leagueId, teamA } = await makeLeagueWithTwoTeams(commissionerReplitId, comm!.id, `fresh-${RUN_ID}`);

    authAs(commissionerReplitId, comm!.id);
    const assignRes = await request(app).put(`/api/team-seasons/${teamA}/gm`).send({ user_id: gm!.id });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.gm).toMatchObject({
      first_nhl_game: "NHL 94",
      profile_image_url: "https://example.test/avatar.png",
      league_record: { w: 0, l: 0, otl: 0 },
      site_record: { w: 0, l: 0, otl: 0 },
    });

    const seatsRes = await request(app).get(`/api/leagues/${leagueId}/seats`);
    const seat = seatsRes.body.data.find((s: { team_season_id: string }) => s.team_season_id === teamA);
    expect(seat.gm).toMatchObject({
      first_nhl_game: "NHL 94",
      profile_image_url: "https://example.test/avatar.png",
      league_record: { w: 0, l: 0, otl: 0 },
      site_record: { w: 0, l: 0, otl: 0 },
    });
  });

  it("keeps a league's combined record scoped to that league, while site_record spans every league the GM has ever managed in", async (ctx) => {
    if (!schemaReady || !cardColumnsReady) return ctx.skip();

    const commissionerReplitId = `gmcard-comm2-${RUN_ID}`;
    const [comm] = await sql<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [commissionerReplitId, `GM Card Commissioner 2 ${RUN_ID}`, `${commissionerReplitId}@test.invalid`],
    );
    const gmReplitId = `gmcard-gm-multi-${RUN_ID}`;
    const [gm] = await sql<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [gmReplitId, `GM Card Multi GM ${RUN_ID}`, `${gmReplitId}@test.invalid`],
    );

    const leagueA = await makeLeagueWithTwoTeams(commissionerReplitId, comm!.id, `a-${RUN_ID}`);
    const leagueB = await makeLeagueWithTwoTeams(commissionerReplitId, comm!.id, `b-${RUN_ID}`);

    authAs(commissionerReplitId, comm!.id);
    await request(app).put(`/api/team-seasons/${leagueA.teamA}/gm`).send({ user_id: gm!.id }).expect(200);
    await request(app).put(`/api/team-seasons/${leagueB.teamA}/gm`).send({ user_id: gm!.id }).expect(200);

    const [seasonA] = await sql<{ id: string }>(`SELECT season_id AS id FROM team_season WHERE id = $1`, [leagueA.teamA]);
    const [seasonB] = await sql<{ id: string }>(`SELECT season_id AS id FROM team_season WHERE id = $1`, [leagueB.teamA]);

    // League A: GM's team wins one, loses one (as home and away respectively).
    await playGame(seasonA!.id, leagueA.teamA, leagueA.teamB, 4, 2, comm!.id);
    await playGame(seasonA!.id, leagueA.teamB, leagueA.teamA, 3, 1, comm!.id);
    // League B: GM's team wins one more.
    await playGame(seasonB!.id, leagueB.teamA, leagueB.teamB, 5, 0, comm!.id);

    const seatsA = await request(app).get(`/api/leagues/${leagueA.leagueId}/seats`);
    const seatA = seatsA.body.data.find((s: { team_season_id: string }) => s.team_season_id === leagueA.teamA);
    expect(seatA.gm.league_record).toEqual({ w: 1, l: 1, otl: 0 });
    expect(seatA.gm.site_record).toEqual({ w: 2, l: 1, otl: 0 });

    const seatsB = await request(app).get(`/api/leagues/${leagueB.leagueId}/seats`);
    const seatB = seatsB.body.data.find((s: { team_season_id: string }) => s.team_season_id === leagueB.teamA);
    expect(seatB.gm.league_record).toEqual({ w: 1, l: 0, otl: 0 });
    expect(seatB.gm.site_record).toEqual({ w: 2, l: 1, otl: 0 });
  });

  it("lets a GM set first_nhl_game and profile_image_url via PATCH /users/me and surfaces them on the seat card", async (ctx) => {
    if (!schemaReady || !cardColumnsReady) return ctx.skip();

    const commissionerReplitId = `gmcard-comm3-${RUN_ID}`;
    const [comm] = await sql<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [commissionerReplitId, `GM Card Commissioner 3 ${RUN_ID}`, `${commissionerReplitId}@test.invalid`],
    );
    const gmReplitId = `gmcard-gm-self-${RUN_ID}`;
    const [gm] = await sql<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [gmReplitId, `GM Card Self GM ${RUN_ID}`, `${gmReplitId}@test.invalid`],
    );

    const { leagueId, teamA } = await makeLeagueWithTwoTeams(commissionerReplitId, comm!.id, `self-${RUN_ID}`);
    authAs(commissionerReplitId, comm!.id);
    await request(app).put(`/api/team-seasons/${teamA}/gm`).send({ user_id: gm!.id }).expect(200);

    authAs(gmReplitId, gm!.id);
    const patchRes = await request(app)
      .patch("/api/users/me")
      .send({ first_nhl_game: "NHL 06", profile_image_url: "https://example.test/gm-self.png" });
    expect(patchRes.status).toBe(200);

    authAs(commissionerReplitId, comm!.id);
    const seatsRes = await request(app).get(`/api/leagues/${leagueId}/seats`);
    const seat = seatsRes.body.data.find((s: { team_season_id: string }) => s.team_season_id === teamA);
    expect(seat.gm.first_nhl_game).toBe("NHL 06");
    expect(seat.gm.profile_image_url).toBe("https://example.test/gm-self.png");
  });
});
