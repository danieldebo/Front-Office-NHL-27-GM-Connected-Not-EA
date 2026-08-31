/**
 * Transaction ledger.  transaction_event is immutable: workflow actions are
 * represented by a new row whose external_ids.parent_transaction_id points to
 * the original proposal.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../server/errors";
import { idempotencyMiddleware } from "../middlewares/idempotency";
import { publishDomainEvent } from "../server/notifications/domainEvents";
import { requireLeagueRead } from "../server/leagueAccess";
import { CreateLeagueTransactionBody, CreateLeagueTransactionParams, ListLeagueTransactionsParams,
  AcceptTransactionParams, ApproveTransactionParams, RejectTransactionParams, ExecuteTransactionParams,
  ReverseTransactionParams } from "@workspace/api-zod";

const router: IRouter = Router();
type Asset = { kind: string; player_id?: string | null; draft_year?: number | null; draft_round?: number | null;
  amount_cents?: number | null; from_team_season_id?: string | null; to_team_season_id?: string | null };
type ContractState = { id: string; player_id: string; team_season_id: string | null; cap_hit_cents: string;
  term_years: number | null; signed_at: Date; expires_after_season_ordinal: number | null; no_trade_clause: boolean;
  superseded_by?: string | null };
class TransactionConflict extends Error {}

function actor(req: Request): string | null { return getCurrentUser(req)?.appUserId ?? null; }
function dbType(type: string): string { return type === "ir_move" ? "ir_place" : type === "seat_change" ? "call_up" : type; }
const publicTransactionTypes = new Set(["trade", "signing", "release", "waiver_claim", "call_up", "send_down",
  "ir_place", "ir_activate", "retire", "draft_pick", "reversal", "ir_move", "seat_change"]);
function publicType(requested: unknown, persisted: string): string {
  return typeof requested === "string" && publicTransactionTypes.has(requested) ? requested : persisted;
}

async function isCommissioner(req: Request, leagueId: string): Promise<boolean> {
  const row = (await pool.query<{ owner_user_id: string; commissioner_ids: string[] }>(
    `SELECT l.owner_user_id, COALESCE(array_agg(lm.user_id) FILTER
       (WHERE lm.left_at IS NULL AND lm.role IN ('commissioner','assistant_commissioner')), '{}') commissioner_ids
       FROM league l LEFT JOIN league_membership lm ON lm.league_id=l.id WHERE l.id=$1 GROUP BY l.id`, [leagueId],
  )).rows[0];
  return !!row && can(getCurrentUser(req),
    "league:write", { kind: "league", ownerId: row.owner_user_id, commissionerIds: row.commissioner_ids });
}

async function leagueForTransaction(transactionId: string) {
  return (await pool.query<{ id: string; season_id: string; txn_type: string; status: string; proposed_by: string | null; league_id: string }>(
    `SELECT te.id,te.season_id,te.txn_type::text,te.status::text,te.proposed_by,l.id league_id
       FROM transaction_event te JOIN season s ON s.id=te.season_id JOIN league l ON l.id=s.league_id
      WHERE te.id=$1`, [transactionId],
  )).rows[0] ?? null;
}

async function currentStatus(transactionId: string): Promise<string | null> {
  return (await pool.query<{ status: string }>(
    `SELECT status::text FROM transaction_event
      WHERE id=$1 OR external_ids->>'parent_transaction_id'=$1::text
      ORDER BY proposed_at DESC, id DESC LIMIT 1`, [transactionId],
  )).rows[0]?.status ?? null;
}

async function render(transactionId: string) {
  const event = (await pool.query<any>(
    `SELECT te.*, COALESCE((SELECT status::text FROM transaction_event x
       WHERE x.id=te.id OR x.external_ids->>'parent_transaction_id'=te.id::text
        ORDER BY x.proposed_at DESC,x.id DESC LIMIT 1),te.status::text) current_status,
       COALESCE((SELECT x.external_ids FROM transaction_event x
        WHERE x.id=te.id OR x.external_ids->>'parent_transaction_id'=te.id::text
        ORDER BY x.proposed_at DESC,x.id DESC LIMIT 1),te.external_ids) current_external_ids
       FROM transaction_event te WHERE te.id=$1`, [transactionId],
  )).rows[0];
  if (!event) return null;
  const assets = (await pool.query<Asset>(`SELECT kind::text,player_id,draft_year,draft_round,amount_cents,from_team_season_id,to_team_season_id
    FROM transaction_asset WHERE transaction_id=$1 ORDER BY id`, [transactionId])).rows;
  const approvedBy = (await pool.query<{ user_id: string }>(
    `SELECT a.user_id FROM transaction_approval a JOIN transaction_event workflow
       ON workflow.id=a.transaction_id
      WHERE workflow.external_ids->>'parent_transaction_id'=$1::text AND a.vote AND workflow.external_ids->>'action'='approve'
      ORDER BY a.voted_at DESC LIMIT 1`, [transactionId],
  )).rows[0]?.user_id ?? null;
  const requested = publicType(event.external_ids?.requested_type, event.txn_type);
  const names = (await pool.query<{ id: string; full_name: string }>(
    `SELECT id,full_name FROM player WHERE id=ANY($1::uuid[])`, [assets.map((a) => a.player_id).filter(Boolean)],
  )).rows;
  const playerNames = new Map(names.map((p) => [p.id, p.full_name]));
  const description = assets.map((a) => a.kind === "player" ? playerNames.get(a.player_id ?? "") ?? "player" :
    a.kind === "draft_pick" ? `${a.draft_year ?? ""} round ${a.draft_round ?? ""} pick` : a.kind).join(", ");
  return { id: event.id, season_id: event.season_id, type: requested, status: event.current_status,
    proposed_by: event.proposed_by, proposed_at: event.proposed_at, resolved_at: event.resolved_at,
    reverses_txn_id: event.reverses_txn_id, note: event.note, assets,
    summary: `${requested.replace("_", " ")}${description ? `: ${description}` : ""}`,
    provenance: event.external_ids?.entry_source === "commissioner" ? "commissioner" : "manual",
    cap_checked: event.current_external_ids?.cap_checked === true, approved_by: approvedBy };
}

router.get("/leagues/:leagueId/transactions", async (req, res) => {
  const params = ListLeagueTransactionsParams.safeParse(req.params);
  if (!params.success) { badRequest(res, params.error.message); return; }
  if (!await requireLeagueRead(req, res, params.data.leagueId)) return;
  const rows = await pool.query<{ id: string }>(
    `SELECT te.id FROM transaction_event te JOIN season s ON s.id=te.season_id
      WHERE s.league_id=$1 AND NOT (te.external_ids ? 'parent_transaction_id')
      ORDER BY te.proposed_at DESC,te.id DESC LIMIT 100`, [params.data.leagueId],
  );
  const data = (await Promise.all(rows.rows.map((r) => render(r.id)))).filter(Boolean);
  res.json({ data });
});

router.post("/leagues/:leagueId/transactions", idempotencyMiddleware, async (req, res) => {
  const params = CreateLeagueTransactionParams.safeParse(req.params);
  const body = CreateLeagueTransactionBody.safeParse(req.body);
  const userId = actor(req);
  if (!userId) { unauthorized(res, "Authentication required"); return; }
  if (!params.success) { badRequest(res, params.error.message); return; }
  if (!body.success) { badRequest(res, body.error.message); return; }
  const input = body.data;
  const season = (await pool.query<{ id: string }>(`SELECT id FROM season WHERE id=$1 AND league_id=$2`, [input.season_id, params.data.leagueId])).rows[0];
  if (!season) { notFound(res, "Season not found in league"); return; }
  const commissioner = await isCommissioner(req, params.data.leagueId);
  if (input.entry_source === "commissioner" && !commissioner) { forbidden(res, "Commissioner entry source requires commissioner access"); return; }
  if (!input.assets.length) { badRequest(res, "At least one asset is required"); return; }
  const teamIds = [...new Set(input.assets.flatMap((a) => [a.from_team_season_id, a.to_team_season_id]).filter((id): id is string => !!id))];
  const validTeams = await pool.query<{ id: string }>(`SELECT id FROM team_season WHERE season_id=$1 AND id=ANY($2::uuid[])`, [input.season_id, teamIds]);
  if (validTeams.rows.length !== teamIds.length) { notFound(res, "Transaction team not found in season"); return; }
  const playerIds = input.assets.filter((a) => a.kind === "player").map((a) => a.player_id).filter((id): id is string => !!id);
  if (playerIds.length !== new Set(playerIds).size) { badRequest(res, "A player may only appear once"); return; }
  if (playerIds.length && (await pool.query(`SELECT id FROM player WHERE id=ANY($1::uuid[]) AND league_id=$2`, [playerIds, params.data.leagueId])).rowCount !== playerIds.length) {
    notFound(res, "Transaction player not found in league"); return;
  }
  if (!["trade", "signing", "waiver_claim", "release"].includes(input.type)) {
    badRequest(res, "This transaction type is read-only until its roster semantics are supported"); return;
  }
  const invalidPlayerAsset = input.assets.some((asset) => {
    if (asset.kind !== "player" || !asset.player_id) return false;
    if (input.type === "trade") return !asset.from_team_season_id || !asset.to_team_season_id;
    if (input.type === "signing") return !!asset.from_team_season_id || !asset.to_team_season_id;
    if (input.type === "release") return !asset.from_team_season_id || !!asset.to_team_season_id;
    return !asset.to_team_season_id; // waiver claims may name a source, but need not.
  });
  if (invalidPlayerAsset || input.assets.some((a) => a.kind === "draft_pick" && (!a.draft_year || !a.draft_round))) {
    badRequest(res, "Assets do not match the selected transaction type"); return;
  }
  if (input.type === "trade") {
    const perSide = new Map<string, number>();
    for (const a of input.assets.filter((x) => x.kind === "player")) perSide.set(a.from_team_season_id!, (perSide.get(a.from_team_season_id!) ?? 0) + 1);
    if ([...perSide.values()].some((count) => count > 5)) { badRequest(res, "A trade may include at most five player assets per side"); return; }
    if (teamIds.length !== 2) { badRequest(res, "Trades currently support exactly two participating teams"); return; }
    const proposerTeams = await pool.query(
      `SELECT team_season_id FROM gm_assignment
        WHERE user_id=$1 AND ended_at IS NULL AND team_season_id=ANY($2::uuid[])`, [userId, teamIds],
    );
    if (proposerTeams.rowCount !== 1) {
      forbidden(res, "A trade proposer must be the active GM for exactly one participating team"); return;
    }
  }
  if (!commissioner && !teamIds.length) { forbidden(res, "A GM must propose a transaction for an assigned team"); return; }
  if (!commissioner && teamIds.length) {
    const owns = await pool.query(`SELECT 1 FROM gm_assignment WHERE user_id=$1 AND ended_at IS NULL AND team_season_id=ANY($2::uuid[]) LIMIT 1`, [userId, teamIds]);
    if (!owns.rowCount) { forbidden(res, "Only an active GM for a transaction team may propose it"); return; }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const status = input.type === "trade" ? "proposed" : "pending_approval";
    const txn = (await client.query<{ id: string }>(
      `INSERT INTO transaction_event(season_id,txn_type,status,proposed_by,note,data_source,external_ids)
       VALUES($1,$2::txn_type,$3::txn_status,$4,$5,'manual',$6::jsonb) RETURNING id`,
      [input.season_id, dbType(input.type), status, userId, input.note ?? null,
        JSON.stringify({ requested_type: input.type, entry_source: input.entry_source ?? "manual", cap_checked: false })],
    )).rows[0]!;
    for (const a of input.assets) await client.query(
      `INSERT INTO transaction_asset(transaction_id,kind,player_id,draft_year,draft_round,amount_cents,from_team_season_id,to_team_season_id)
       VALUES($1,$2::asset_kind,$3,$4,$5,$6,$7,$8)`,
      [txn.id,a.kind,a.player_id ?? null,a.draft_year ?? null,a.draft_round ?? null,a.amount_cents ?? null,a.from_team_season_id ?? null,a.to_team_season_id ?? null]);
    const eventType = input.type === "trade" ? "trade.proposed" : input.type === "signing" ? "signing" : input.type === "waiver_claim" ? "waiver.claim" : null;
    if (eventType) await publishDomainEvent(client, { eventType, leagueId: params.data.leagueId, actorUserId: userId,
      title: "Transaction proposed", body: `${input.type.replace("_", " ")} proposed`, data: { transaction_id: txn.id } });
    await client.query("COMMIT");
    res.status(201).json(await render(txn.id));
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
});

async function insertContractVersion(client: any, previous: ContractState | null, seasonId: string,
  playerId: string, teamId: string | null): Promise<ContractState> {
  const row = ((await client.query(
    `INSERT INTO contract(season_id,player_id,team_season_id,cap_hit_cents,term_years,signed_at,
       expires_after_season_ordinal,no_trade_clause,data_source)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manual')
     RETURNING id,player_id,team_season_id,cap_hit_cents,term_years,signed_at,expires_after_season_ordinal,no_trade_clause`,
    [seasonId, playerId, teamId, previous?.cap_hit_cents ?? 0, previous?.term_years ?? null,
      previous?.signed_at ?? new Date(), previous?.expires_after_season_ordinal ?? null,
      previous?.no_trade_clause ?? false],
  )).rows[0] as ContractState);
  if (previous) await client.query(`UPDATE contract SET superseded_by=$1 WHERE id=$2 AND superseded_by IS NULL`, [row.id, previous.id]);
  return row;
}

async function assertCap(client: any, seasonId: string, teamIds: string[]) {
  const cap = ((await client.query(
    `SELECT salary_cap_cents FROM season WHERE id=$1 FOR UPDATE`, [seasonId],
  )).rows[0] as { salary_cap_cents: string | null } | undefined)?.salary_cap_cents;
  // A NULL cap is the existing "no cap configured" behavior, but the totals are
  // still calculated so the ledger can accurately record that it was checked.
  const totals = await client.query(
    `SELECT ts.id team_season_id,COALESCE(SUM(c.cap_hit_cents),0)::text cap_used_cents
       FROM team_season ts LEFT JOIN contract c ON c.team_season_id=ts.id AND c.superseded_by IS NULL
      WHERE ts.id=ANY($1::uuid[]) GROUP BY ts.id`, [teamIds],
  );
  if (cap != null && (totals.rows as Array<{ cap_used_cents: string }>).some((row) => BigInt(row.cap_used_cents) > BigInt(cap))) {
    throw new TransactionConflict("Transaction would exceed the salary cap");
  }
}

async function transition(req: Request, res: Response, action: "accept" | "approve" | "reject" | "execute" | "reverse") {
  const parsers = { accept: AcceptTransactionParams, approve: ApproveTransactionParams, reject: RejectTransactionParams, execute: ExecuteTransactionParams, reverse: ReverseTransactionParams };
  const parsed = parsers[action].safeParse(req.params); const userId = actor(req);
  if (!userId) { unauthorized(res, "Authentication required"); return; }
  if (!parsed.success) { badRequest(res, parsed.error.message); return; }
  const root = await leagueForTransaction(parsed.data.transactionId);
  if (!root) { notFound(res, "Transaction not found"); return; }
  const state = await currentStatus(root.id);
  const rationale = typeof req.body?.rationale === "string" && req.body.rationale.length <= 2000
    ? req.body.rationale : undefined;
  if (req.body?.rationale !== undefined && rationale === undefined) {
    badRequest(res, "rationale must be a string no longer than 2000 characters"); return;
  }
  const commissioner = await isCommissioner(req, root.league_id);
  if (action !== "accept" && !commissioner) { forbidden(res, "Commissioner access required"); return; }
  if (action === "accept") {
    if (state !== "proposed") { conflict(res, "Transaction has already progressed"); return; }
    const teams = [...new Set((await pool.query<{ from_team_season_id: string | null; to_team_season_id: string | null }>(
      `SELECT from_team_season_id,to_team_season_id FROM transaction_asset WHERE transaction_id=$1`, [root.id],
    )).rows.flatMap((a) => [a.from_team_season_id,a.to_team_season_id]).filter(Boolean))] as string[];
    const proposerTeams = root.proposed_by ? (await pool.query<{ team_season_id: string }>(
      `SELECT team_season_id FROM gm_assignment
        WHERE user_id=$1 AND ended_at IS NULL AND team_season_id=ANY($2::uuid[])`, [root.proposed_by, teams],
    )).rows.map((row) => row.team_season_id) : [];
    const counterparties = teams.filter((teamId) => !proposerTeams.includes(teamId));
    const active = await pool.query(
      `SELECT 1 FROM gm_assignment
        WHERE user_id=$1 AND ended_at IS NULL AND team_season_id=ANY($2::uuid[]) LIMIT 1`, [userId, counterparties],
    );
    if (proposerTeams.length !== 1 || counterparties.length !== 1 || !active.rowCount || root.proposed_by === userId) {
      forbidden(res, "Only the non-proposer counterparty GM may accept"); return;
    }
  }
  const expected: Record<typeof action, string[]> = { accept: ["proposed"], approve: ["accepted", "pending_approval"], reject: ["proposed","accepted","pending_approval","approved"], execute: ["approved"], reverse: ["executed"] };
  if (!expected[action].includes(state ?? "")) { action === "reverse" ? conflict(res, "Transaction is already reversed or not executed") : badRequest(res, "Transaction is not in a state for this action"); return; }
  const status = action === "accept" ? "accepted" : action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "execute" ? "executed" : "reversed";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Every workflow writer takes the root lock before inspecting state, so two
    // execute/reverse requests cannot both apply a roster version.
    await client.query(`SELECT id FROM transaction_event WHERE id=$1 FOR UPDATE`, [root.id]);
    const lockedState = (await client.query<{ status: string }>(
      `SELECT status::text FROM transaction_event
        WHERE id=$1 OR external_ids->>'parent_transaction_id'=$1::text
        ORDER BY proposed_at DESC,id DESC LIMIT 1`, [root.id],
    )).rows[0]?.status;
    if (!expected[action].includes(lockedState ?? "")) {
      throw new TransactionConflict("Transaction has already progressed");
    }
    let appliedContracts: Array<{ previous_contract_id: string | null; contract_id: string; expected_team_season_id: string | null }> = [];
    let capChecked = false;
    if (action === "execute") {
      const assets = (await client.query<Asset>(
        `SELECT kind::text,player_id,from_team_season_id,to_team_season_id FROM transaction_asset WHERE transaction_id=$1 ORDER BY id`,
        [root.id],
      )).rows.filter((asset) => asset.kind === "player" && asset.player_id);
      const teamIds = [...new Set(assets.flatMap((asset) => [asset.from_team_season_id, asset.to_team_season_id]).filter(Boolean))] as string[];
      const playerIds = assets.map((asset) => asset.player_id!) ;
      // Team and player locks serialize both roster changes and competing claims
      // for an otherwise-uncontracted player.
      await client.query(`SELECT id FROM team_season WHERE id=ANY($1::uuid[]) FOR UPDATE`, [teamIds]);
      const lockedPlayers = await client.query<{ id: string }>(
        `SELECT p.id FROM player p JOIN season s ON s.league_id=p.league_id
          WHERE p.id=ANY($1::uuid[]) AND s.id=$2 FOR UPDATE`, [playerIds, root.season_id],
      );
      if (lockedPlayers.rowCount !== playerIds.length) throw new TransactionConflict("Transaction contains a player from another league");
      const current = (await client.query<ContractState>(
        `SELECT id,player_id,team_season_id,cap_hit_cents,term_years,signed_at,expires_after_season_ordinal,no_trade_clause,superseded_by
           FROM contract WHERE season_id=$1 AND player_id=ANY($2::uuid[]) AND superseded_by IS NULL FOR UPDATE`,
        [root.season_id, playerIds],
      )).rows;
      for (const asset of assets) {
        const active = current.filter((contract) => contract.player_id === asset.player_id);
        const sourceRequired = root.txn_type === "trade" ||
          (root.txn_type === "waiver_claim" && !!asset.from_team_season_id) ||
          (root.txn_type !== "signing" && !!asset.from_team_season_id);
        if (sourceRequired) {
          if (active.length !== 1 || active[0]!.team_season_id !== asset.from_team_season_id) {
            throw new TransactionConflict("Player is not actively rostered by the declared source team");
          }
        } else if (active.length > 1 || active.some((contract) => contract.team_season_id !== null)) {
          throw new TransactionConflict("Player is not eligible as a free agent");
        }
        const previous = active[0] ?? null;
        const destination = root.txn_type === "release" ? null : asset.to_team_season_id!;
        const next = await insertContractVersion(client, previous, root.season_id, asset.player_id!, destination);
        appliedContracts.push({ previous_contract_id: previous?.id ?? null, contract_id: next.id, expected_team_season_id: destination });
      }
      await assertCap(client, root.season_id, teamIds);
      capChecked = true;
    }
    if (action === "reverse") {
      const executed = (await client.query<{ external_ids: any }>(
        `SELECT external_ids FROM transaction_event
          WHERE external_ids->>'parent_transaction_id'=$1::text AND external_ids->>'action'='execute'
          ORDER BY proposed_at DESC,id DESC LIMIT 1 FOR UPDATE`, [root.id],
      )).rows[0];
      const applied = executed?.external_ids?.applied_contracts;
      if (!Array.isArray(applied) || !applied.length) {
        throw new TransactionConflict("Transaction cannot be safely reversed because its roster effects are unavailable");
      }
      const ids = applied.flatMap((item: any) => [item.contract_id, item.previous_contract_id].filter(Boolean));
      let states = (await client.query<ContractState>(
        `SELECT id,player_id,team_season_id,cap_hit_cents,term_years,signed_at,expires_after_season_ordinal,no_trade_clause,superseded_by
           FROM contract WHERE id=ANY($1::uuid[])`, [ids],
      )).rows;
      const reversalTeamIds = [...new Set(states.map((contract) => contract.team_season_id).filter(Boolean))] as string[];
      await client.query(`SELECT id FROM team_season WHERE id=ANY($1::uuid[]) FOR UPDATE`, [reversalTeamIds]);
      states = (await client.query<ContractState>(
        `SELECT id,player_id,team_season_id,cap_hit_cents,term_years,signed_at,expires_after_season_ordinal,no_trade_clause,superseded_by
           FROM contract WHERE id=ANY($1::uuid[]) FOR UPDATE`, [ids],
      )).rows;
      const compensationTeams: string[] = [];
      for (const item of applied) {
        const executedContract = states.find((contract) => contract.id === item.contract_id);
        const previous = item.previous_contract_id ? states.find((contract) => contract.id === item.previous_contract_id) : null;
        if (!executedContract) {
          throw new TransactionConflict("Transaction cannot be safely reversed because its roster has changed");
        }
        // The executed contract must still be the active version, and the
        // predecessor (when any) must be the version it superseded.
        const active = (await client.query<ContractState>(
        `SELECT id,player_id,team_season_id,cap_hit_cents,term_years,signed_at,expires_after_season_ordinal,no_trade_clause,superseded_by
             FROM contract WHERE id=$1 AND superseded_by IS NULL FOR UPDATE`, [executedContract.id],
        )).rows[0];
        if (!active || active.team_season_id !== (item.expected_team_season_id ?? null) ||
            (previous && previous.superseded_by !== active.id)) {
          throw new TransactionConflict("Transaction cannot be safely reversed because its roster has changed");
        }
        const restored = await insertContractVersion(client, active, root.season_id, active.player_id, previous?.team_season_id ?? null);
        if (active.team_season_id) compensationTeams.push(active.team_season_id);
        if (restored.team_season_id) compensationTeams.push(restored.team_season_id);
      }
      await assertCap(client, root.season_id, [...new Set(compensationTeams)]);
      capChecked = true;
    }
    const row = (await client.query<{ id: string }>(
      `INSERT INTO transaction_event(season_id,txn_type,status,proposed_by,resolved_at,reverses_txn_id,note,data_source,external_ids)
       VALUES($1,$2::txn_type,$3::txn_status,$4,now(),$5,$6,'manual',$7::jsonb) RETURNING id`,
      [root.season_id, action === "reverse" ? "reversal" : root.txn_type, status, userId, action === "reverse" ? root.id : null,
        rationale ?? null, JSON.stringify({ parent_transaction_id: root.id, action, entry_source: commissioner ? "commissioner" : "manual",
          cap_checked: capChecked, ...(action === "execute" ? { applied_contracts: appliedContracts } : {}) })],
    )).rows[0]!;
    if (action === "accept" || action === "approve" || action === "reject") {
      await client.query(
        `INSERT INTO transaction_approval(transaction_id,user_id,vote,rationale)
         VALUES($1,$2,$3,$4) ON CONFLICT(transaction_id,user_id) DO NOTHING`,
        [row.id, userId, action !== "reject", rationale ?? null],
      );
    }
    if (action === "execute") {
      if (root.txn_type === "trade") await publishDomainEvent(client, { eventType: "trade.executed", leagueId: root.league_id, actorUserId: userId, title: "Trade executed", body: "A trade has been executed.", data: { transaction_id: root.id } });
    }
    await client.query("COMMIT");
    res.status(201).json(await render(root.id));
    void row;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof TransactionConflict) { conflict(res, error.message); return; }
    throw error;
  } finally { client.release(); }
}
router.post("/transactions/:transactionId/accept", idempotencyMiddleware, (req, res) => transition(req,res,"accept"));
router.post("/transactions/:transactionId/approve", idempotencyMiddleware, (req, res) => transition(req,res,"approve"));
router.post("/transactions/:transactionId/reject", idempotencyMiddleware, (req, res) => transition(req,res,"reject"));
router.post("/transactions/:transactionId/execute", idempotencyMiddleware, (req, res) => transition(req,res,"execute"));
router.post("/transactions/:transactionId/reverse", idempotencyMiddleware, (req, res) => transition(req,res,"reverse"));
export default router;