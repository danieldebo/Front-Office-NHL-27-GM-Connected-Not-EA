/**
 * Integration tests — the transactions engine (build-queue prompt C).
 *
 * Covers signings, trades (propose/accept/approve/execute, cap block),
 * releases + waiver claim + resolution, and roster status, exercised through
 * the real Express app against a real Postgres database.
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
  // Matches what clerkIdentityMiddleware.ts really sets: both the replit-side
  // id and the resolved app_user UUID. authz.ts's can() reads appUserId (not
  // id) as the domain identity, so a mock that omits it would silently
  // compare replit ids against DB-resolved UUIDs and always fail closed.
  mockGetCurrentUser.mockReturnValue({ id: replitId, appUserId, name: replitId } as any);
}

let schemaReady = false;
let commissionerReplitId: string;
let gmAReplitId: string;
let gmBReplitId: string;
let gmCReplitId: string;
let commissionerAppUserId: string;
let gmAAppUserId: string;
let gmBAppUserId: string;
let gmCAppUserId: string;
let leagueId: string;
let teamA: string;
let teamB: string;
let teamC: string;
let freeAgentPlayerId: string;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'waiver'
     ) AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
  if (!schemaReady) return;

  commissionerReplitId = `txn-comm-${RUN_ID}`;
  gmAReplitId = `txn-gma-${RUN_ID}`;
  gmBReplitId = `txn-gmb-${RUN_ID}`;
  gmCReplitId = `txn-gmc-${RUN_ID}`;

  const [comm] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [commissionerReplitId, `Txn Commissioner ${RUN_ID}`, `${commissionerReplitId}@test.invalid`],
  );
  const [gmA] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [gmAReplitId, `Txn GM A ${RUN_ID}`, `${gmAReplitId}@test.invalid`],
  );
  const [gmB] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [gmBReplitId, `Txn GM B ${RUN_ID}`, `${gmBReplitId}@test.invalid`],
  );
  const [gmC] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [gmCReplitId, `Txn GM C ${RUN_ID}`, `${gmCReplitId}@test.invalid`],
  );
  commissionerAppUserId = comm!.id;
  gmAAppUserId = gmA!.id;
  gmBAppUserId = gmB!.id;
  gmCAppUserId = gmC!.id;

  authAs(commissionerReplitId, commissionerAppUserId);
  const leagueRes = await request(app).post("/api/leagues").send({
    name: `Txn League ${RUN_ID}`,
    slug: `txn-league-${RUN_ID}`,
    platform: "xbox",
    team_count: 4,
    settings_template_id: "balanced_standard",
  });
  expect(leagueRes.status).toBe(201);
  leagueId = leagueRes.body.id;

  const seasonRes = await request(app)
    .post(`/api/leagues/${leagueId}/seasons`)
    .send({ label: "Season 1", game_title: "Hockey 27" });
  expect(seasonRes.status).toBe(201);

  const seatsRes = await request(app).get(`/api/leagues/${leagueId}/seats`);
  expect(seatsRes.status).toBe(200);
  const teamSeasonIds: string[] = seatsRes.body.data.map((s: { team_season_id: string }) => s.team_season_id);
  [teamA, teamB, teamC] = teamSeasonIds;

  for (const [teamSeasonId, gmId] of [[teamA, gmA!.id], [teamB, gmB!.id], [teamC, gmC!.id]] as const) {
    const assignRes = await request(app).put(`/api/team-seasons/${teamSeasonId}/gm`).send({ user_id: gmId });
    expect(assignRes.status).toBe(200);
  }

  const playerRes = await request(app)
    .post(`/api/leagues/${leagueId}/players`)
    .send({ full_name: `Free Agent ${RUN_ID}`, position: "C" });
  expect(playerRes.status).toBe(201);
  freeAgentPlayerId = playerRes.body.id;
});

describe("signings", () => {
  it("signs a free agent and updates cap position", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(gmAReplitId, gmAAppUserId);
    const res = await request(app)
      .post(`/api/leagues/${leagueId}/signings`)
      .send({ team_season_id: teamA, player_id: freeAgentPlayerId, cap_hit_cents: 500_000_00, term_years: 2 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("executed");
    expect(res.body.over_cap_warning).toBe(false);

    const capRes = await request(app).get(`/api/team-seasons/${teamA}/cap`);
    expect(capRes.status).toBe(200);
    expect(capRes.body.cap_used_cents).toBe(500_000_00);
    expect(capRes.body.roster_count).toBe(1);
  });

  it("blocks a signing that would exceed the cap when cap_enforcement is 'block'", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(commissionerReplitId, commissionerAppUserId);
    const current = await request(app).get(`/api/leagues/${leagueId}/settings`);
    expect(current.status).toBe(200);
    const setCapEnforcement = async (value: "block" | "warn") => {
      const res = await request(app)
        .post(`/api/leagues/${leagueId}/settings/versions`)
        .send({
          ...current.body,
          // The template's playoff_format.teams (16) exceeds this test
          // league's small team_count (4); shrink it to stay valid.
          playoff_format: { ...current.body.playoff_format, teams: 4 },
          cap_enforcement: value,
          change_summary: `Set cap_enforcement=${value} for test`,
        });
      expect(res.status).toBe(201);
    };
    await setCapEnforcement("block");

    const bigPlayer = await request(app)
      .post(`/api/leagues/${leagueId}/players`)
      .send({ full_name: `Expensive Player ${RUN_ID}`, position: "D" });
    authAs(gmAReplitId, gmAAppUserId);
    // The league cap is $104M (CURRENT_SALARY_CAP_CENTS); this alone exceeds it.
    const res = await request(app)
      .post(`/api/leagues/${leagueId}/signings`)
      .send({ team_season_id: teamA, player_id: bigPlayer.body.id, cap_hit_cents: 110_000_000_00 });
    expect(res.status).toBe(409);

    authAs(commissionerReplitId, commissionerAppUserId);
    await setCapEnforcement("warn");
  });
});

describe("trades", () => {
  let tradeId: string;
  let tradedPlayerId: string;

  it("proposes a trade with a cap-impact preview", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    tradedPlayerId = freeAgentPlayerId;
    authAs(gmAReplitId, gmAAppUserId);
    const res = await request(app)
      .post(`/api/leagues/${leagueId}/trades`)
      .send({ side_a: { team_season_id: teamA, player_ids: [tradedPlayerId] }, side_b: { team_season_id: teamB, player_ids: [] } });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("proposed");
    expect(res.body.cap_preview.side_a.would_be_over_cap).toBe(false);
    expect(res.body.cap_preview.side_b.projected_cap_used_cents).toBe(500_000_00);
    tradeId = res.body.id;
  });

  it("rejects acceptance from someone not on either side", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(gmCReplitId, gmCAppUserId);
    const res = await request(app).post(`/api/leagues/${leagueId}/trades/${tradeId}/accept`);
    expect(res.status).toBe(403);
  });

  it("accepts, then commissioner approval executes the move", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(gmBReplitId, gmBAppUserId);
    const acceptRes = await request(app).post(`/api/leagues/${leagueId}/trades/${tradeId}/accept`);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.status).toBe("accepted");

    authAs(commissionerReplitId, commissionerAppUserId);
    const approveRes = await request(app).post(`/api/leagues/${leagueId}/trades/${tradeId}/approve`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("executed");

    const [contract] = await sql<{ team_season_id: string }>(
      `SELECT team_season_id FROM contract WHERE player_id = $1 AND superseded_by IS NULL`,
      [tradedPlayerId],
    );
    expect(contract?.team_season_id).toBe(teamB);

    const capA = await request(app).get(`/api/team-seasons/${teamA}/cap`);
    expect(capA.body.cap_used_cents).toBe(0);
    const capB = await request(app).get(`/api/team-seasons/${teamB}/cap`);
    expect(capB.body.cap_used_cents).toBe(500_000_00);
  });

  it("shows the executed trade on the wire", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const res = await request(app).get(`/api/leagues/${leagueId}/wire`);
    expect(res.status).toBe(200);
    const entry = res.body.data.find((e: { id: string }) => e.id === tradeId);
    expect(entry).toBeTruthy();
    expect(entry.type).toBe("trade");
    expect(entry.status).toBe("executed");
    expect(entry.decided_by).toBeTruthy();
  });
});

describe("releases and waivers", () => {
  let waiverId: string;

  it("releases a rostered player to waivers", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(gmBReplitId, gmBAppUserId);
    const res = await request(app)
      .post(`/api/leagues/${leagueId}/releases`)
      .send({ player_id: freeAgentPlayerId });
    expect(res.status).toBe(201);
    waiverId = res.body.waiver_id;

    const listRes = await request(app).get(`/api/leagues/${leagueId}/waivers`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((w: { id: string }) => w.id === waiverId)).toBe(true);
  });

  it("accepts a claim and resolves it to the claiming team", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(gmCReplitId, gmCAppUserId);
    const claimRes = await request(app)
      .post(`/api/leagues/${leagueId}/waivers/${waiverId}/claims`)
      .send({ team_season_id: teamC });
    expect(claimRes.status).toBe(201);

    authAs(commissionerReplitId, commissionerAppUserId);
    const resolveRes = await request(app).post(`/api/leagues/${leagueId}/waivers/${waiverId}/resolve`);
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.winning_team_season_id).toBe(teamC);

    const [contract] = await sql<{ team_season_id: string }>(
      `SELECT team_season_id FROM contract WHERE player_id = $1 AND superseded_by IS NULL`,
      [freeAgentPlayerId],
    );
    expect(contract?.team_season_id).toBe(teamC);
  });

  it("moves the claimed player to IR and back to active", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const [contract] = await sql<{ id: string }>(
      `SELECT id FROM contract WHERE player_id = $1 AND superseded_by IS NULL`,
      [freeAgentPlayerId],
    );
    authAs(gmCReplitId, gmCAppUserId);
    const irRes = await request(app).post(`/api/contracts/${contract!.id}/roster-status`).send({ roster_status: "ir" });
    expect(irRes.status).toBe(200);
    expect(irRes.body.roster_status).toBe("ir");

    const activeRes = await request(app).post(`/api/contracts/${contract!.id}/roster-status`).send({ roster_status: "active" });
    expect(activeRes.status).toBe(200);
    expect(activeRes.body.roster_status).toBe("active");
  });

  it("rejects the waiving team claiming its own player", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(gmCReplitId, gmCAppUserId);
    const release = await request(app).post(`/api/leagues/${leagueId}/releases`).send({ player_id: freeAgentPlayerId });
    expect(release.status).toBe(201);
    const claimRes = await request(app)
      .post(`/api/leagues/${leagueId}/waivers/${release.body.waiver_id}/claims`)
      .send({ team_season_id: teamC });
    expect(claimRes.status).toBe(400);
  });
});

// No cleanup: league_settings_version is trigger-enforced append-only, so the
// league and its app_user rows can't be deleted afterward either (same
// convention as league-settings-migration.test.ts and
// league-settings-templates.test.ts). The RUN_ID suffix keeps fixtures
// isolated across runs.
