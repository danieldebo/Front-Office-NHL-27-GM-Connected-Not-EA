import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("../../server/auth/index.js", () => ({ getCurrentUser: vi.fn().mockReturnValue(null) }));
import crypto from "node:crypto";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../../app.js";
import { getCurrentUser } from "../../server/auth/index.js";

const auth = vi.mocked(getCurrentUser);
const run = crypto.randomBytes(4).toString("hex");
let ready = false, leagueId = "", foreignLeagueId = "", seasonId = "", ownerId = "", otherId = "", firstTeam = "", secondTeam = "", thirdTeam = "", playerIds: string[] = [];
const sql = <T extends object>(text: string, values: unknown[] = []) => pool.query<T>(text, values).then((r) => r.rows);
const asOwner = () => auth.mockReturnValue({ id: `txn-owner-${run}`, appUserId: ownerId, email: null, firstName: null, lastName: null, profileImageUrl: null });
const asOther = () => auth.mockReturnValue({ id: `txn-other-${run}`, appUserId: otherId, email: null, firstName: null, lastName: null, profileImageUrl: null });

beforeAll(async () => {
  ready = (await sql<{ exists: boolean }>(`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='transaction_event') exists`))[0]?.exists ?? false;
  if (!ready) return;
  ownerId = (await sql<{ id: string }>(`INSERT INTO app_user(replit_id,display_name,email) VALUES($1,'Owner',$2) RETURNING id`, [`txn-owner-${run}`, `owner-${run}@invalid`]))[0]!.id;
  otherId = (await sql<{ id: string }>(`INSERT INTO app_user(replit_id,display_name,email) VALUES($1,'Other',$2) RETURNING id`, [`txn-other-${run}`, `other-${run}@invalid`]))[0]!.id;
  leagueId = (await sql<{ id: string }>(`INSERT INTO league(slug,name,owner_user_id) VALUES($1,'Transactions',$2) RETURNING id`, [`txn-${run}`,ownerId]))[0]!.id;
  foreignLeagueId = (await sql<{ id: string }>(`INSERT INTO league(slug,name,owner_user_id) VALUES($1,'Foreign',$2) RETURNING id`, [`txn-foreign-${run}`,ownerId]))[0]!.id;
  seasonId = (await sql<{ id: string }>(`INSERT INTO season(league_id,ordinal,label,game_title,starts_on) VALUES($1,1,'S','NHL',CURRENT_DATE) RETURNING id`,[leagueId]))[0]!.id;
  const franchises = await Promise.all(["One","Two","Empty"].map((name) => sql<{id:string}>(`INSERT INTO franchise(league_id,name) VALUES($1,$2) RETURNING id`,[leagueId,name])));
  const teams = await Promise.all(franchises.map((f) => sql<{id:string}>(`INSERT INTO team_season(season_id,franchise_id) VALUES($1,$2) RETURNING id`,[seasonId,f[0]!.id])));
  [firstTeam,secondTeam,thirdTeam] = [teams[0]![0]!.id,teams[1]![0]!.id,teams[2]![0]!.id];
  await sql(`INSERT INTO gm_assignment(team_season_id,user_id) VALUES($1,$2),($3,$4)`,[firstTeam,ownerId,secondTeam,otherId]);
  playerIds = (await Promise.all(Array.from({length: 6}, (_, i) => sql<{id:string}>(`INSERT INTO player(league_id,full_name,position) VALUES($1,$2,'C') RETURNING id`,[leagueId,`P${i}`])))).map((p) => p[0]!.id);
});

afterAll(async () => {
  if (!ready) return;
  await sql(`DELETE FROM transaction_approval WHERE transaction_id IN (SELECT id FROM transaction_event WHERE season_id=$1)`,[seasonId]);
  await sql(`DELETE FROM transaction_asset WHERE transaction_id IN (SELECT id FROM transaction_event WHERE season_id=$1)`,[seasonId]);
  await sql(`DELETE FROM contract WHERE season_id=$1`,[seasonId]);
  await sql(`DELETE FROM transaction_event WHERE season_id=$1`,[seasonId]);
  await sql(`DELETE FROM gm_assignment WHERE team_season_id IN (SELECT id FROM team_season WHERE season_id=$1)`,[seasonId]);
  await sql(`DELETE FROM team_season WHERE season_id=$1`,[seasonId]); await sql(`DELETE FROM player WHERE league_id=$1`,[leagueId]);
  await sql(`DELETE FROM franchise WHERE league_id=$1`,[leagueId]); await sql(`DELETE FROM season WHERE id=$1`,[seasonId]);
  await sql(`DELETE FROM league WHERE id=$1`,[leagueId]); await sql(`DELETE FROM idempotency_key WHERE user_id IN ($1,$2)`,[ownerId,otherId]);
  await sql(`DELETE FROM player WHERE league_id=$1`,[foreignLeagueId]);
  await sql(`DELETE FROM league WHERE id=$1`,[foreignLeagueId]);
  await sql(`DELETE FROM app_user WHERE id IN ($1,$2)`,[ownerId,otherId]);
});

describe("transaction workflow and Hub wire", () => {
  it("requires auth and rejects a sixth player on a trade side", async (ctx) => {
    if (!ready) return ctx.skip();
    auth.mockReturnValue(null);
    await request(app).post(`/api/leagues/${leagueId}/transactions`).send({}).expect(401);
    asOwner();
    const empty = await request(app).get(`/api/leagues/${leagueId}/transactions`).expect(200);
    expect(empty.body.data).toEqual([]);
    const assets = playerIds.map((player_id) => ({ kind:"player",player_id,from_team_season_id:firstTeam,to_team_season_id:secondTeam }));
    await request(app).post(`/api/leagues/${leagueId}/transactions`).send({ season_id:seasonId,type:"trade",assets }).expect(400);
  });

  it("appends transitions, preserves the proposal on reversal, and replays idempotent creation", async (ctx) => {
    if (!ready) return ctx.skip();
    asOwner();
    // A trade may only execute from its actual source roster.
    await sql(`INSERT INTO contract(season_id,player_id,team_season_id) VALUES($1,$2,$3)`, [seasonId,playerIds[0],firstTeam]);
    const body = { season_id:seasonId,type:"trade",assets:[{kind:"player",player_id:playerIds[0],from_team_season_id:firstTeam,to_team_season_id:secondTeam}] };
    const created = await request(app).post(`/api/leagues/${leagueId}/transactions`).set("Idempotency-Key",`key-${run}`).send(body).expect(201);
    expect(created.body.cap_checked).toBe(false);
    const replay = await request(app).post(`/api/leagues/${leagueId}/transactions`).set("Idempotency-Key",`key-${run}`).send(body).expect(201);
    expect(replay.body.id).toBe(created.body.id);
    await request(app).post(`/api/transactions/${created.body.id}/approve`).expect(400);
    await request(app).post(`/api/transactions/${created.body.id}/accept`).expect(403);
    asOther(); await request(app).post(`/api/transactions/${created.body.id}/accept`).expect(201);
    asOwner(); await request(app).post(`/api/transactions/${created.body.id}/approve`).expect(201);
    const executed = await request(app).post(`/api/transactions/${created.body.id}/execute`).expect(201);
    expect(executed.body.cap_checked).toBe(true);
    const executedHub = await request(app).get(`/api/leagues/${leagueId}/hub`).expect(200);
    expect(executedHub.body.wire_transactions.find((transaction: { id: string }) => transaction.id === created.body.id))
      .toMatchObject({ status:"executed", cap_checked:true });
    expect(executedHub.body.wire_transactions.find((transaction: { id: string }) => transaction.id === created.body.id).resolved_at).toBeTruthy();
    await request(app).post(`/api/transactions/${created.body.id}/reverse`).send({ rationale:"fixture" }).expect(201);
    const active = await sql<{team_season_id:string}>(`SELECT team_season_id FROM contract WHERE season_id=$1 AND player_id=$2 AND superseded_by IS NULL`, [seasonId,playerIds[0]]);
    expect(active).toEqual([{ team_season_id:firstTeam }]);
    const rows = await sql<{id:string;reverses_txn_id:string|null}>(`SELECT id,reverses_txn_id FROM transaction_event WHERE season_id=$1 ORDER BY proposed_at`,[seasonId]);
    expect(rows).toHaveLength(5); expect(rows[0]!.id).toBe(created.body.id); expect(rows[4]!.reverses_txn_id).toBe(created.body.id);
  });

  it("serializes live Wire entries and derives only actual open seats", async (ctx) => {
    if (!ready) return ctx.skip();
    asOwner();
    const wire = await request(app).get(`/api/leagues/${leagueId}/transactions`).expect(200);
    expect(wire.body.data[0]).toMatchObject({ status:"reversed", cap_checked:true, approved_by:ownerId });
    const hub = await request(app).get(`/api/leagues/${leagueId}/hub`).expect(200);
    expect(hub.body.wire_transactions.length).toBeGreaterThan(0);
    expect(hub.body.wire_transactions[0]).toMatchObject({ status:"reversed", cap_checked:true });
    expect(hub.body.wire_transactions[0].resolved_at).toBeTruthy();
    expect(hub.body.open_seat_details).toHaveLength(1);
    expect(hub.body.open_seat_details[0]).toMatchObject({ state:"never_filled", applicant_count:0 });
  });

  it("rejects a three-team trade instead of collecting incomplete consent", async (ctx) => {
    if (!ready) return ctx.skip();
    asOwner();
    await request(app).post(`/api/leagues/${leagueId}/transactions`).send({
      season_id:seasonId,
      type:"trade",
      assets:[
        { kind:"player", player_id:playerIds[3], from_team_season_id:firstTeam, to_team_season_id:secondTeam },
        { kind:"player", player_id:playerIds[4], from_team_season_id:thirdTeam, to_team_season_id:firstTeam },
      ],
    }).expect(400);
  });

  it("rejects foreign-league players at creation and again under execute locks", async (ctx) => {
    if (!ready) return ctx.skip();
    asOwner();
    const foreignPlayer = (await sql<{ id: string }>(
      `INSERT INTO player(league_id,full_name,position) VALUES($1,'Foreign Player','C') RETURNING id`, [foreignLeagueId],
    ))[0]!.id;
    await request(app).post(`/api/leagues/${leagueId}/transactions`).send({
      season_id:seasonId, type:"signing", assets:[{ kind:"player", player_id:foreignPlayer, from_team_season_id:null, to_team_season_id:firstTeam }],
    }).expect(404);
    const created = await request(app).post(`/api/leagues/${leagueId}/transactions`).send({
      season_id:seasonId, type:"signing", assets:[{ kind:"player", player_id:playerIds[2], from_team_season_id:null, to_team_season_id:firstTeam }],
    }).expect(201);
    await request(app).post(`/api/transactions/${created.body.id}/approve`).expect(201);
    await sql(`UPDATE player SET league_id=$1 WHERE id=$2`, [foreignLeagueId,playerIds[2]]);
    await request(app).post(`/api/transactions/${created.body.id}/execute`).expect(409);
    await sql(`UPDATE player SET league_id=$1 WHERE id=$2`, [leagueId,playerIds[2]]);
    await sql(`DELETE FROM player WHERE id=$1`, [foreignPlayer]);
  });

  it("executes and reverses a release as an immutable free-agent version", async (ctx) => {
    if (!ready) return ctx.skip();
    asOwner();
    await sql(`INSERT INTO contract(season_id,player_id,team_season_id,cap_hit_cents) VALUES($1,$2,$3,100)`, [seasonId,playerIds[1],firstTeam]);
    const created = await request(app).post(`/api/leagues/${leagueId}/transactions`).send({
      season_id:seasonId, type:"release", assets:[{ kind:"player", player_id:playerIds[1], from_team_season_id:firstTeam, to_team_season_id:null }],
    }).expect(201);
    await request(app).post(`/api/transactions/${created.body.id}/approve`).expect(201);
    await request(app).post(`/api/transactions/${created.body.id}/execute`).expect(201);
    expect(await sql(`SELECT id FROM contract WHERE season_id=$1 AND player_id=$2 AND team_season_id IS NULL AND superseded_by IS NULL`, [seasonId,playerIds[1]])).toHaveLength(1);
    await request(app).post(`/api/transactions/${created.body.id}/reverse`).expect(201);
    expect(await sql(`SELECT id FROM contract WHERE season_id=$1 AND player_id=$2 AND team_season_id=$3 AND superseded_by IS NULL`, [seasonId,playerIds[1],firstTeam])).toHaveLength(1);
  });

  it("serializes persisted canonical transaction types on the Wire", async (ctx) => {
    if (!ready) return ctx.skip();
    await sql(`INSERT INTO transaction_event(season_id,txn_type,status,proposed_by) VALUES($1,'send_down','executed',$2)`, [seasonId,ownerId]);
    asOwner();
    const wire = await request(app).get(`/api/leagues/${leagueId}/hub`).expect(200);
    expect(wire.body.wire_transactions.some((transaction: { type: string }) => transaction.type === "send_down")).toBe(true);
  });
});