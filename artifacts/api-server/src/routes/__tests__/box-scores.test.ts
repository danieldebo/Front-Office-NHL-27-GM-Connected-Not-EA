/**
 * Integration tests — box score uploads (build-queue prompt H1), exercised
 * through the real Express app against a real Postgres database.
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
let leagueId: string;
let seasonId: string;
let commissionerReplitId: string;
let commissionerAppUserId: string;
let gmAReplitId: string;
let gmAAppUserId: string;
let gmBReplitId: string;
let gmBAppUserId: string;
let strangerReplitId: string;
let strangerAppUserId: string;

async function makeGame(): Promise<string> {
  const [ts] = await sql<{ id: string }>(
    `SELECT id FROM team_season WHERE season_id = $1 ORDER BY id LIMIT 1`,
    [seasonId],
  );
  const [ts2] = await sql<{ id: string }>(
    `SELECT id FROM team_season WHERE season_id = $1 AND id <> $2 LIMIT 1`,
    [seasonId, ts!.id],
  );
  const [game] = await sql<{ id: string }>(
    `INSERT INTO game (season_id, home_team_season_id, away_team_season_id, window_opens_at, window_closes_at)
     VALUES ($1,$2,$3, NOW(), NOW() + INTERVAL '2 days')
     RETURNING id`,
    [seasonId, ts!.id, ts2!.id],
  );
  return game!.id;
}

const validCsv = [
  "player_name,team,goals,assists",
  "Home Star,home,2,1",
  "Away Star,away,1,0",
].join("\n");

const seasonShapedCsv = [
  "player_name,team,goals,assists,gp",
  "Home Star,home,40,60,82",
].join("\n");

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'box_score_upload') AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
  if (!schemaReady) return;

  commissionerReplitId = `box-comm-${RUN_ID}`;
  gmAReplitId = `box-gma-${RUN_ID}`;
  gmBReplitId = `box-gmb-${RUN_ID}`;
  strangerReplitId = `box-stranger-${RUN_ID}`;

  const [comm] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [commissionerReplitId, `Box Commissioner ${RUN_ID}`, `${commissionerReplitId}@test.invalid`],
  );
  const [gmA] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [gmAReplitId, `Box GM A ${RUN_ID}`, `${gmAReplitId}@test.invalid`],
  );
  const [gmB] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [gmBReplitId, `Box GM B ${RUN_ID}`, `${gmBReplitId}@test.invalid`],
  );
  const [stranger] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [strangerReplitId, `Box Stranger ${RUN_ID}`, `${strangerReplitId}@test.invalid`],
  );
  commissionerAppUserId = comm!.id;
  gmAAppUserId = gmA!.id;
  gmBAppUserId = gmB!.id;
  strangerAppUserId = stranger!.id;

  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug) VALUES ($1,$2,$3) RETURNING id`,
    [commissionerAppUserId, `Box League ${RUN_ID}`, `box-league-${RUN_ID}`],
  );
  leagueId = league!.id;

  const [season] = await sql<{ id: string }>(
    `INSERT INTO season (league_id, ordinal, label, game_title) VALUES ($1,1,'Season 1','NHL') RETURNING id`,
    [leagueId],
  );
  seasonId = season!.id;

  const [frA] = await sql<{ id: string }>(`INSERT INTO franchise (league_id, name) VALUES ($1,$2) RETURNING id`, [leagueId, `Home Club ${RUN_ID}`]);
  const [frB] = await sql<{ id: string }>(`INSERT INTO franchise (league_id, name) VALUES ($1,$2) RETURNING id`, [leagueId, `Away Club ${RUN_ID}`]);

  const [tsA] = await sql<{ id: string }>(`INSERT INTO team_season (season_id, franchise_id) VALUES ($1,$2) RETURNING id`, [seasonId, frA!.id]);
  const [tsB] = await sql<{ id: string }>(`INSERT INTO team_season (season_id, franchise_id) VALUES ($1,$2) RETURNING id`, [seasonId, frB!.id]);
  await sql(`INSERT INTO gm_assignment (team_season_id, user_id) VALUES ($1,$2)`, [tsA!.id, gmAAppUserId]);
  await sql(`INSERT INTO gm_assignment (team_season_id, user_id) VALUES ($1,$2)`, [tsB!.id, gmBAppUserId]);
});

describe("box score uploads", () => {
  it("rejects a season-total-shaped CSV outright", async () => {
    if (!schemaReady) return;
    authAs(gmAReplitId, gmAAppUserId);
    const gameId = await makeGame();
    const res = await request(app)
      .post(`/api/games/${gameId}/box-score`)
      .send({ kind: "csv", raw_payload: seasonShapedCsv });
    expect(res.status).toBe(400);
  });

  it("a stranger cannot upload a box score", async () => {
    if (!schemaReady) return;
    authAs(strangerReplitId, strangerAppUserId);
    const gameId = await makeGame();
    const res = await request(app)
      .post(`/api/games/${gameId}/box-score`)
      .send({ kind: "csv", raw_payload: validCsv });
    expect(res.status).toBe(403);
  });

  it("GM uploads a CSV, commissioner approves it, and the game is confirmed", async () => {
    if (!schemaReady) return;
    const gameId = await makeGame();

    authAs(gmAReplitId, gmAAppUserId);
    const uploadRes = await request(app)
      .post(`/api/games/${gameId}/box-score`)
      .send({ kind: "csv", raw_payload: validCsv });
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.status).toBe("pending");
    expect(uploadRes.body.parsed_home_goals).toBe(2);
    expect(uploadRes.body.parsed_away_goals).toBe(1);

    // Non-commissioner cannot approve
    authAs(gmAReplitId, gmAAppUserId);
    const forbiddenApprove = await request(app).post(`/api/box-scores/${uploadRes.body.id}/approve`).send({});
    expect(forbiddenApprove.status).toBe(403);

    authAs(commissionerReplitId, commissionerAppUserId);
    const pendingRes = await request(app).get(`/api/leagues/${leagueId}/box-scores/pending`);
    expect(pendingRes.status).toBe(200);
    expect(pendingRes.body.data.some((r: any) => r.id === uploadRes.body.id)).toBe(true);

    const approveRes = await request(app).post(`/api/box-scores/${uploadRes.body.id}/approve`).send({});
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("approved");
    expect(approveRes.body.resulting_game_result_id).toBeTruthy();

    const [gameRow] = await sql<{ status: string }>(`SELECT status FROM game WHERE id = $1`, [gameId]);
    expect(gameRow!.status).toBe("confirmed");

    const [resultRow] = await sql<{ home_goals: number; away_goals: number; counts_toward_standings: boolean }>(
      `SELECT home_goals, away_goals, counts_toward_standings FROM game_result WHERE id = $1`,
      [approveRes.body.resulting_game_result_id],
    );
    expect(resultRow!.home_goals).toBe(2);
    expect(resultRow!.away_goals).toBe(1);
    expect(resultRow!.counts_toward_standings).toBe(true);

    // Cannot approve twice
    const secondApprove = await request(app).post(`/api/box-scores/${uploadRes.body.id}/approve`).send({});
    expect(secondApprove.status).toBe(409);
  });

  it("commissioner can reject a pending upload with a reason", async () => {
    if (!schemaReady) return;
    const gameId = await makeGame();
    authAs(gmBReplitId, gmBAppUserId);
    const uploadRes = await request(app)
      .post(`/api/games/${gameId}/box-score`)
      .send({ kind: "csv", raw_payload: validCsv });
    expect(uploadRes.status).toBe(201);

    authAs(commissionerReplitId, commissionerAppUserId);
    const badReject = await request(app).post(`/api/box-scores/${uploadRes.body.id}/reject`).send({});
    expect(badReject.status).toBe(400);

    const rejectRes = await request(app)
      .post(`/api/box-scores/${uploadRes.body.id}/reject`)
      .send({ reason: "Score doesn't match the reported result" });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe("rejected");
    expect(rejectRes.body.rejection_reason).toBe("Score doesn't match the reported result");
  });

  it("a screenshot upload requires home_goals/away_goals on approve", async () => {
    if (!schemaReady) return;
    const gameId = await makeGame();
    authAs(gmAReplitId, gmAAppUserId);
    const uploadRes = await request(app)
      .post(`/api/games/${gameId}/box-score`)
      .send({ kind: "screenshot", raw_payload: "data:image/png;base64,fake" });
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.kind).toBe("screenshot");
    expect(uploadRes.body.parsed_home_goals).toBeNull();

    authAs(commissionerReplitId, commissionerAppUserId);
    const missingScore = await request(app).post(`/api/box-scores/${uploadRes.body.id}/approve`).send({});
    expect(missingScore.status).toBe(400);

    const approveRes = await request(app)
      .post(`/api/box-scores/${uploadRes.body.id}/approve`)
      .send({ home_goals: 4, away_goals: 3 });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("approved");
  });

  it("auto-approves a CSV upload when the league setting is on, without a screenshot exception", async () => {
    if (!schemaReady) return;
    authAs(commissionerReplitId, commissionerAppUserId);
    const settingsRes = await request(app)
      .patch(`/api/leagues/${leagueId}/box-score-settings`)
      .send({ box_score_auto_approve: true });
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.body.box_score_auto_approve).toBe(true);

    const gameId = await makeGame();
    authAs(gmAReplitId, gmAAppUserId);
    const uploadRes = await request(app)
      .post(`/api/games/${gameId}/box-score`)
      .send({ kind: "csv", raw_payload: validCsv });
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.status).toBe("approved");
    expect(uploadRes.body.auto_approved).toBe(true);
    expect(uploadRes.body.resulting_game_result_id).toBeTruthy();

    const [gameRow] = await sql<{ status: string }>(`SELECT status FROM game WHERE id = $1`, [gameId]);
    expect(gameRow!.status).toBe("confirmed");

    // A screenshot upload still lands pending even with auto-approve on
    const shotGameId = await makeGame();
    const shotRes = await request(app)
      .post(`/api/games/${shotGameId}/box-score`)
      .send({ kind: "screenshot", raw_payload: "data:image/png;base64,fake" });
    expect(shotRes.status).toBe(201);
    expect(shotRes.body.status).toBe("pending");

    // Reset for other tests
    await request(app)
      .patch(`/api/leagues/${leagueId}/box-score-settings`)
      .send({ box_score_auto_approve: false });
  });
});
