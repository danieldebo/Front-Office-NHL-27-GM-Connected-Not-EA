/**
 * Integration tests — keepers, the player registry search, and stat cards
 * (build-queue prompt F), exercised through the real Express app against a
 * real Postgres database.
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
let franchiseA: string;
let franchiseB: string;
let commissionerReplitId: string;
let commissionerAppUserId: string;
let gmAReplitId: string;
let gmAAppUserId: string;
let gmBReplitId: string;
let gmBAppUserId: string;
let playerManual: string;
let playerRegistry: string;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'keeper') AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
  if (!schemaReady) return;

  commissionerReplitId = `keep-comm-${RUN_ID}`;
  gmAReplitId = `keep-gma-${RUN_ID}`;
  gmBReplitId = `keep-gmb-${RUN_ID}`;

  const [comm] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [commissionerReplitId, `Keeper Commissioner ${RUN_ID}`, `${commissionerReplitId}@test.invalid`],
  );
  const [gmA] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [gmAReplitId, `Keeper GM A ${RUN_ID}`, `${gmAReplitId}@test.invalid`],
  );
  const [gmB] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [gmBReplitId, `Keeper GM B ${RUN_ID}`, `${gmBReplitId}@test.invalid`],
  );
  commissionerAppUserId = comm!.id;
  gmAAppUserId = gmA!.id;
  gmBAppUserId = gmB!.id;

  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug) VALUES ($1,$2,$3) RETURNING id`,
    [commissionerAppUserId, `Keeper League ${RUN_ID}`, `keeper-league-${RUN_ID}`],
  );
  leagueId = league!.id;

  const [season] = await sql<{ id: string }>(
    `INSERT INTO season (league_id, ordinal, label, game_title, keepers_per_team)
     VALUES ($1,1,'Season 1','NHL',2) RETURNING id`,
    [leagueId],
  );
  seasonId = season!.id;

  const [frA] = await sql<{ id: string }>(`INSERT INTO franchise (league_id, name) VALUES ($1,$2) RETURNING id`, [leagueId, `Alpha ${RUN_ID}`]);
  const [frB] = await sql<{ id: string }>(`INSERT INTO franchise (league_id, name) VALUES ($1,$2) RETURNING id`, [leagueId, `Beta ${RUN_ID}`]);
  franchiseA = frA!.id;
  franchiseB = frB!.id;

  const [tsA] = await sql<{ id: string }>(`INSERT INTO team_season (season_id, franchise_id) VALUES ($1,$2) RETURNING id`, [seasonId, franchiseA]);
  const [tsB] = await sql<{ id: string }>(`INSERT INTO team_season (season_id, franchise_id) VALUES ($1,$2) RETURNING id`, [seasonId, franchiseB]);
  await sql(`INSERT INTO gm_assignment (team_season_id, user_id) VALUES ($1,$2)`, [tsA!.id, gmAAppUserId]);
  await sql(`INSERT INTO gm_assignment (team_season_id, user_id) VALUES ($1,$2)`, [tsB!.id, gmBAppUserId]);

  const [manual] = await sql<{ id: string }>(
    `INSERT INTO player (league_id, full_name, position, is_manual) VALUES ($1,$2,'C',true) RETURNING id`,
    [leagueId, `Manual Prospect ${RUN_ID}`],
  );
  playerManual = manual!.id;

  const [registry] = await sql<{ id: string }>(
    `INSERT INTO player (full_name, position, external_ids) VALUES ($1,'C', jsonb_build_object('nhl_api', $2::text)) RETURNING id`,
    [`Connor McSlapshot ${RUN_ID}`, `${RUN_ID}1`],
  );
  playerRegistry = registry!.id;
});

describe("keeper designation and limit", () => {
  it("lets a GM designate a keeper on their own team", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(gmAReplitId, gmAAppUserId);
    const res = await request(app)
      .post(`/api/franchises/${franchiseA}/seasons/${seasonId}/keepers`)
      .send({ player_id: playerManual });
    expect(res.status).toBe(201);
    expect(res.body.is_commissioner_override).toBe(false);
    expect(res.body.first_marked_at).toBeTruthy();
  });

  it("refuses the (limit+1)th keeper with a clean 409", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(gmAReplitId, gmAAppUserId);
    const [p2] = await sql<{ id: string }>(`INSERT INTO player (league_id, full_name, position, is_manual) VALUES ($1,$2,'D',true) RETURNING id`, [leagueId, `Second Keeper ${RUN_ID}`]);
    const ok = await request(app).post(`/api/franchises/${franchiseA}/seasons/${seasonId}/keepers`).send({ player_id: p2!.id });
    expect(ok.status).toBe(201);

    const [p3] = await sql<{ id: string }>(`INSERT INTO player (league_id, full_name, position, is_manual) VALUES ($1,$2,'RW',true) RETURNING id`, [leagueId, `Third Keeper ${RUN_ID}`]);
    const blocked = await request(app).post(`/api/franchises/${franchiseA}/seasons/${seasonId}/keepers`).send({ player_id: p3!.id });
    expect(blocked.status).toBe(409);
  });

  it("blocks a GM from designating a keeper on someone else's team", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(gmAReplitId, gmAAppUserId);
    const res = await request(app).post(`/api/franchises/${franchiseB}/seasons/${seasonId}/keepers`).send({ player_id: playerRegistry });
    expect(res.status).toBe(403);
  });

  it("requires a note for a commissioner override, then records it in audit_log", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(commissionerReplitId, commissionerAppUserId);
    const noNote = await request(app).post(`/api/franchises/${franchiseB}/seasons/${seasonId}/keepers`).send({ player_id: playerRegistry });
    expect(noNote.status).toBe(400);

    const withNote = await request(app)
      .post(`/api/franchises/${franchiseB}/seasons/${seasonId}/keepers`)
      .send({ player_id: playerRegistry, note: "GM is on vacation, entering on their behalf" });
    expect(withNote.status).toBe(201);
    expect(withNote.body.is_commissioner_override).toBe(true);

    const [logRow] = await sql<{ reason: string }>(
      `SELECT reason FROM audit_log WHERE entity_type = 'keeper' AND entity_id = $1`,
      [withNote.body.id],
    );
    expect(logRow?.reason).toContain("vacation");
  });

  it("lists active keepers and slot usage for a franchise", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const res = await request(app).get(`/api/franchises/${franchiseA}/seasons/${seasonId}/keepers`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.slots).toEqual({ allowed: 2, used: 2, open_slots: 0 });
  });

  it("preserves the original first_marked_at across release and re-designation", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const [before] = await sql<{ id: string; first_marked_at: string }>(
      `SELECT id, first_marked_at FROM keeper WHERE player_id = $1 AND released_at IS NULL`,
      [playerManual],
    );
    authAs(gmAReplitId, gmAAppUserId);
    const release = await request(app).delete(`/api/keepers/${before!.id}`);
    expect(release.status).toBe(204);

    const redesignate = await request(app)
      .post(`/api/franchises/${franchiseA}/seasons/${seasonId}/keepers`)
      .send({ player_id: playerManual });
    expect(redesignate.status).toBe(201);
    expect(new Date(redesignate.body.first_marked_at).getTime()).toBe(new Date(before!.first_marked_at).getTime());
  });
});

describe("keeper deadline", () => {
  it("locks GM edits after the deadline but still allows a commissioner override", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(commissionerReplitId, commissionerAppUserId);
    const setDeadline = await request(app)
      .patch(`/api/leagues/${leagueId}/seasons/${seasonId}/keeper-settings`)
      .send({ keeper_deadline_at: new Date(Date.now() - 60_000).toISOString() });
    expect(setDeadline.status).toBe(200);

    const [p4] = await sql<{ id: string }>(`INSERT INTO player (league_id, full_name, position, is_manual) VALUES ($1,$2,'LW',true) RETURNING id`, [leagueId, `Post Deadline ${RUN_ID}`]);

    authAs(gmBReplitId, gmBAppUserId);
    const gmBlocked = await request(app).post(`/api/franchises/${franchiseB}/seasons/${seasonId}/keepers`).send({ player_id: p4!.id });
    expect(gmBlocked.status).toBe(403);

    authAs(commissionerReplitId, commissionerAppUserId);
    const commissionerStillWorks = await request(app)
      .post(`/api/franchises/${franchiseB}/seasons/${seasonId}/keepers`)
      .send({ player_id: p4!.id, note: "Post-deadline correction, league voted to allow" });
    expect(commissionerStillWorks.status).toBe(201);

    // Reset for any later tests in this file.
    await request(app).patch(`/api/leagues/${leagueId}/seasons/${seasonId}/keeper-settings`).send({ keeper_deadline_at: null });
  });
});

describe("player registry search", () => {
  it("finds a registry-backed player via typo-tolerant search", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    authAs(gmAReplitId, gmAAppUserId);
    const res = await request(app).get(`/api/players/search`).query({ q: `Mcslapshot ${RUN_ID}` });
    expect(res.status).toBe(200);
    expect(res.body.data.some((p: { id: string }) => p.id === playerRegistry)).toBe(true);
    const match = res.body.data.find((p: { id: string }) => p.id === playerRegistry);
    expect(match.registry_matched).toBe(true);
  });

  it("returns manual players too, flagged as not registry-matched", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const res = await request(app).get(`/api/players/search`).query({ q: `Manual Prospect ${RUN_ID}` });
    expect(res.status).toBe(200);
    const match = res.body.data.find((p: { id: string }) => p.id === playerManual);
    expect(match?.registry_matched).toBe(false);
  });
});

describe("stat cards", () => {
  it("returns empty and unmatched for a manual player", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const res = await request(app).get(`/api/players/${playerManual}/stat-cards`);
    expect(res.status).toBe(200);
    expect(res.body.registry_matched).toBe(false);
    expect(res.body.data).toEqual([]);
  });

  it("queues a refresh and returns empty for a never-fetched registry player", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    const res = await request(app).get(`/api/players/${playerRegistry}/stat-cards`);
    expect(res.status).toBe(200);
    expect(res.body.registry_matched).toBe(true);
    expect(res.body.refreshing).toBe(true);

    const [queued] = await sql<{ payload: { player_id: string } }>(
      `SELECT payload FROM outbox WHERE topic = 'statcard.refresh.requested' AND processed_at IS NULL AND payload->>'player_id' = $1`,
      [playerRegistry],
    );
    expect(queued).toBeTruthy();
  });

  it("does not double-queue a refresh while one is already pending", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    await request(app).get(`/api/players/${playerRegistry}/stat-cards`);
    const [{ count }] = await sql<{ count: string }>(
      `SELECT COUNT(*) FROM outbox WHERE topic = 'statcard.refresh.requested' AND payload->>'player_id' = $1`,
      [playerRegistry],
    );
    expect(Number(count)).toBe(1);
  });

  it("stops queuing once all three windows are fresh", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    await sql(`UPDATE outbox SET processed_at = now() WHERE topic = 'statcard.refresh.requested'`);
    for (const windowYears of [1, 3, 5]) {
      await sql(
        `INSERT INTO player_stat_card (player_id, window_years, stat_line, fetched_at, stale_after)
         VALUES ($1,$2,'{}'::jsonb, now(), now() + interval '7 days')`,
        [playerRegistry, windowYears],
      );
    }
    const res = await request(app).get(`/api/players/${playerRegistry}/stat-cards`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    expect(res.body.refreshing).toBe(false);
  });
});

describe("registry sync trigger", () => {
  it("queues a sync and refuses a second one while pending", async (ctx) => {
    if (!schemaReady) return ctx.skip();
    await sql(`DELETE FROM outbox WHERE topic = 'registry.sync.requested'`);
    authAs(gmAReplitId, gmAAppUserId);
    const first = await request(app).post(`/api/registry-sync/run`);
    expect(first.status).toBe(202);
    const second = await request(app).post(`/api/registry-sync/run`);
    expect(second.status).toBe(409);
  });
});

// No cleanup: league_settings_version is not touched by this file at all
// (these fixtures are raw SQL, not POST /leagues), but keeper rows reference
// app_user/player/season rows that would need a teardown order matching the
// FK graph; the RUN_ID suffix keeps fixtures isolated across runs instead,
// same convention as the other integration tests in this file set.
