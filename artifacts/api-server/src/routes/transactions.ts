/**
 * Transactions engine — trades, signings, releases, and waiver claims.
 *
 * Everything here writes to the append-only transaction_event /
 * transaction_asset / transaction_approval tables from schema.sql — nothing
 * is ever edited or deleted; a correction is a new transaction_event that
 * references the one it undoes (reverses_txn_id), same convention as
 * league_settings_version and contract.superseded_by.
 *
 * GET    /leagues/:leagueId/players                        — free agents + rostered players
 * POST   /leagues/:leagueId/players                        — add a player to the pool (manual roster source)
 * GET    /leagues/:leagueId/wire                            — recent transactions, newest first
 * GET    /team-seasons/:teamSeasonId/cap                    — real cap position (Sidebar "Your cap")
 * POST   /leagues/:leagueId/trades                          — propose a trade
 * POST   /leagues/:leagueId/trades/:id/accept               — counterparty GM accepts
 * POST   /leagues/:leagueId/trades/:id/approve              — commissioner approves and executes
 * POST   /leagues/:leagueId/trades/:id/reject               — either side or commissioner rejects
 * POST   /leagues/:leagueId/signings                        — sign a free agent
 * POST   /leagues/:leagueId/releases                        — release/waive a rostered player
 * GET    /leagues/:leagueId/waivers                         — open waivers (auto-resolves expired ones)
 * POST   /leagues/:leagueId/waivers/:waiverId/claims        — submit a claim
 * POST   /leagues/:leagueId/waivers/:waiverId/resolve       — resolve now (commissioner)
 * POST   /contracts/:contractId/roster-status               — active / ir / minors
 *
 * NOT built here (documented, not silently dropped):
 *  - Draft picks as trade assets. asset_kind has 'draft_pick' but there is no
 *    owned-picks ledger anywhere in the schema, and building one is really a
 *    draft feature — replit.md lists "Draft rooms" as explicitly out of
 *    scope for this build. Trades below move players only.
 *  - A dedicated 'seat_change' transaction type. gm_assignment already
 *    append-only-records every seat change; a parallel transaction_event row
 *    would just be a second copy of the same fact, one migration away from
 *    disagreeing with it.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import { idempotencyMiddleware } from "../middlewares/idempotency";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../server/errors";
import { postToDiscord } from "../server/discordWebhook";
import {
  CreatePlayerBody,
  ProposeTradeBody,
  RejectTradeBody,
  CreateSigningBody,
  CreateReleaseBody,
  CreateWaiverClaimBody,
  SetRosterStatusBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ────────────────────────────────────────────── helpers

interface LeaguePolicy {
  id: string;
  ownerId: string;
  discordWebhookUrl: string | null;
  autoApproveTrades: boolean;
  capEnforcement: "block" | "warn" | "off";
  waiverWindowHours: number;
  activeSeasonId: string | null;
}

async function leaguePolicy(leagueId: string): Promise<LeaguePolicy | null> {
  const { rows } = await pool.query<{
    id: string;
    owner_user_id: string;
    discord_webhook_url: string | null;
    auto_approve_trades: boolean;
    cap_enforcement: "block" | "warn" | "off";
    waiver_window_hours: number;
    active_season_id: string | null;
  }>(
    `SELECT l.id, l.owner_user_id, l.discord_webhook_url,
            v.auto_approve_trades, v.cap_enforcement, v.waiver_window_hours,
            (SELECT id FROM season WHERE league_id = l.id AND is_active = TRUE LIMIT 1) AS active_season_id
       FROM league l
       JOIN league_settings_active a ON a.league_id = l.id
       JOIN league_settings_version v ON v.id = a.settings_version_id
      WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [leagueId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_user_id,
    discordWebhookUrl: row.discord_webhook_url,
    autoApproveTrades: row.auto_approve_trades,
    capEnforcement: row.cap_enforcement,
    waiverWindowHours: row.waiver_window_hours,
    activeSeasonId: row.active_season_id,
  };
}

async function callerRole(leagueId: string, appUserId: string): Promise<string | null> {
  const { rows } = await pool.query<{ role: string | null }>(
    `SELECT role::text AS role FROM league_membership
      WHERE league_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [leagueId, appUserId],
  );
  return rows[0]?.role ?? null;
}

function isCommissionerRole(league: LeaguePolicy, appUserId: string, role: string | null): boolean {
  return league.ownerId === appUserId || ["commissioner", "assistant_commissioner"].includes(role ?? "");
}

async function teamGm(teamSeasonId: string): Promise<{ userId: string | null; seasonId: string; leagueId: string } | null> {
  const { rows } = await pool.query<{ user_id: string | null; season_id: string; league_id: string }>(
    `SELECT ga.user_id, ts.season_id, s.league_id
       FROM team_season ts
       JOIN season s ON s.id = ts.season_id
       LEFT JOIN gm_assignment ga ON ga.team_season_id = ts.id AND ga.ended_at IS NULL
      WHERE ts.id = $1`,
    [teamSeasonId],
  );
  const row = rows[0];
  if (!row) return null;
  return { userId: row.user_id, seasonId: row.season_id, leagueId: row.league_id };
}

async function appUserIdFor(replitId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM app_user WHERE replit_id = $1`, [replitId]);
  return rows[0]?.id ?? null;
}

interface CapPosition {
  team_season_id: string;
  salary_cap_cents: number | null;
  cap_used_cents: number;
  cap_space_cents: number | null;
  roster_count: number;
  is_illegal: boolean;
}

async function capPositionFor(client: PoolClient | typeof pool, teamSeasonId: string): Promise<CapPosition | null> {
  const { rows } = await client.query<{
    team_season_id: string;
    salary_cap_cents: string | null;
    cap_used_cents: string;
    cap_space_cents: string | null;
    roster_count: string;
    is_illegal: boolean;
  }>(`SELECT * FROM v_cap_position WHERE team_season_id = $1`, [teamSeasonId]);
  const row = rows[0];
  if (!row) return null;
  return {
    team_season_id: row.team_season_id,
    salary_cap_cents: row.salary_cap_cents == null ? null : Number(row.salary_cap_cents),
    cap_used_cents: Number(row.cap_used_cents),
    cap_space_cents: row.cap_space_cents == null ? null : Number(row.cap_space_cents),
    roster_count: Number(row.roster_count),
    is_illegal: row.is_illegal,
  };
}

/** Would adding `deltaCapHitCents` to this team push them over their cap? */
function projectsOverCap(position: CapPosition, deltaCapHitCents: number): boolean {
  if (position.salary_cap_cents == null) return false;
  return position.cap_used_cents + deltaCapHitCents > position.salary_cap_cents;
}

function summarizeCapCheck(enforcement: LeaguePolicy["capEnforcement"], overCap: boolean): string {
  if (enforcement === "off") return "not cap-checked";
  if (!overCap) return "cap-checked, legal";
  return enforcement === "block" ? "cap-checked, blocked" : "cap-checked, over cap (warning only)";
}

// ────────────────────────────────────────────── Players (minimal — full registry is a separate build)

// GET /leagues/:leagueId/players?free_agents_only=true
router.get("/leagues/:leagueId/players", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user) { unauthorized(res); return; }
  const leagueId = req.params.leagueId as string;
  const league = await leaguePolicy(leagueId);
  if (!league) { notFound(res, "League not found"); return; }
  if (!league.activeSeasonId) { res.json({ data: [] }); return; }

  const freeAgentsOnly = req.query.free_agents_only === "true";
  const { rows } = await pool.query(
    `SELECT p.id, p.full_name, p.position, p.shoots, p.country_code,
            c.id AS contract_id, c.team_season_id, c.cap_hit_cents, c.term_years, c.roster_status
       FROM player p
       LEFT JOIN contract c ON c.player_id = p.id AND c.season_id = $2 AND c.superseded_by IS NULL
      WHERE (p.league_id = $1 OR p.league_id IS NULL) AND p.deleted_at IS NULL
        AND ($3::boolean IS FALSE OR c.team_season_id IS NULL)
      ORDER BY p.full_name ASC`,
    [leagueId, league.activeSeasonId, freeAgentsOnly],
  );
  res.json({
    data: rows.map(r => ({
      id: r.id,
      full_name: r.full_name,
      position: r.position,
      shoots: r.shoots,
      country_code: r.country_code,
      contract: r.contract_id ? {
        id: r.contract_id,
        team_season_id: r.team_season_id,
        cap_hit_cents: Number(r.cap_hit_cents),
        term_years: r.term_years,
        roster_status: r.roster_status,
      } : null,
    })),
  });
});

// POST /leagues/:leagueId/players — add a free agent to the pool by hand.
// Only a real endpoint for roster_source='manual' leagues; the nightly NHL
// registry sync (build-queue prompt F) is a separate, not-yet-built feature.
router.post("/leagues/:leagueId/players", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user) { unauthorized(res); return; }
  const leagueId = req.params.leagueId as string;
  const league = await leaguePolicy(leagueId);
  if (!league) { notFound(res, "League not found"); return; }

  const appUserId = await appUserIdFor(user.id);
  if (!appUserId) { badRequest(res, "User profile not found"); return; }
  const role = await callerRole(leagueId, appUserId);
  if (!isCommissionerRole(league, appUserId, role)) {
    forbidden(res, "Only the commissioner can add players to the pool");
    return;
  }

  const parsed = CreatePlayerBody.safeParse(req.body);
  if (!parsed.success) { badRequest(res, parsed.error.message); return; }
  const d = parsed.data;

  const { rows } = await pool.query(
    `INSERT INTO player (league_id, full_name, position, shoots, birthdate, country_code)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, full_name, position, shoots, birthdate, country_code`,
    [leagueId, d.full_name, d.position, d.shoots ?? null, d.birthdate ?? null, d.country_code ?? null],
  );
  res.status(201).json({ ...rows[0], contract: null });
});

// ────────────────────────────────────────────── Cap position

// GET /team-seasons/:teamSeasonId/cap
router.get("/team-seasons/:teamSeasonId/cap", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user) { unauthorized(res); return; }
  const teamSeasonId = req.params.teamSeasonId as string;
  const position = await capPositionFor(pool, teamSeasonId);
  if (!position) { notFound(res, "Team season not found"); return; }
  res.json(position);
});

// ────────────────────────────────────────────── Wire

function transactionSummary(row: {
  txn_type: string;
  players: Array<{ full_name: string; from_franchise: string | null; to_franchise: string | null }>;
}): string {
  const names = row.players.map(p => p.full_name);
  switch (row.txn_type) {
    case "trade": {
      const byDest = new Map<string, string[]>();
      for (const p of row.players) {
        const key = p.to_franchise ?? "free agency";
        byDest.set(key, [...(byDest.get(key) ?? []), p.full_name]);
      }
      return [...byDest.entries()].map(([dest, ps]) => `${ps.join(", ")} to ${dest}`).join(" · ");
    }
    case "signing":
      return `${names.join(", ")} signed${row.players[0]?.to_franchise ? ` by ${row.players[0].to_franchise}` : ""}`;
    case "release":
      return `${names.join(", ")} released${row.players[0]?.from_franchise ? ` by ${row.players[0].from_franchise}` : ""} — waivers`;
    case "waiver_claim":
      return `${names.join(", ")} claimed off waivers${row.players[0]?.to_franchise ? ` by ${row.players[0].to_franchise}` : ""}`;
    case "ir_place":
      return `${names.join(", ")} placed on IR`;
    case "ir_activate":
      return `${names.join(", ")} activated off IR`;
    case "call_up":
      return `${names.join(", ")} called up`;
    case "send_down":
      return `${names.join(", ")} sent down`;
    default:
      return names.join(", ") || row.txn_type;
  }
}

// GET /leagues/:leagueId/wire
router.get("/leagues/:leagueId/wire", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user) { unauthorized(res); return; }
  const leagueId = req.params.leagueId as string;
  const league = await leaguePolicy(leagueId);
  if (!league) { notFound(res, "League not found"); return; }

  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const { rows: txns } = await pool.query<{
    id: string; txn_type: string; status: string; proposed_at: string; resolved_at: string | null;
    note: string | null;
  }>(
    `SELECT te.id, te.txn_type::text, te.status::text, te.proposed_at, te.resolved_at, te.note
       FROM transaction_event te
       JOIN season s ON s.id = te.season_id
      WHERE s.league_id = $1 AND te.status IN ('executed', 'rejected', 'reversed')
      ORDER BY COALESCE(te.resolved_at, te.proposed_at) DESC
      LIMIT $2`,
    [leagueId, limit],
  );
  if (txns.length === 0) { res.json({ data: [] }); return; }

  const ids = txns.map(t => t.id);
  const { rows: assets } = await pool.query<{
    transaction_id: string; player_id: string | null; full_name: string | null;
    from_franchise: string | null; to_franchise: string | null;
  }>(
    `SELECT ta.transaction_id, ta.player_id, p.full_name,
            ftf.name AS from_franchise, ttf.name AS to_franchise
       FROM transaction_asset ta
       LEFT JOIN player p ON p.id = ta.player_id
       LEFT JOIN team_season fts ON fts.id = ta.from_team_season_id
       LEFT JOIN franchise ftf ON ftf.id = fts.franchise_id
       LEFT JOIN team_season tts ON tts.id = ta.to_team_season_id
       LEFT JOIN franchise ttf ON ttf.id = tts.franchise_id
      WHERE ta.transaction_id = ANY($1::uuid[])`,
    [ids],
  );
  const { rows: approvals } = await pool.query<{ transaction_id: string; user_id: string; vote: boolean; voted_at: string; display_name: string }>(
    `SELECT tap.transaction_id, tap.user_id, tap.vote, tap.voted_at, au.display_name
       FROM transaction_approval tap
       JOIN app_user au ON au.id = tap.user_id
      WHERE tap.transaction_id = ANY($1::uuid[])
      ORDER BY tap.voted_at DESC`,
    [ids],
  );

  const assetsByTxn = new Map<string, typeof assets>();
  for (const a of assets) assetsByTxn.set(a.transaction_id, [...(assetsByTxn.get(a.transaction_id) ?? []), a]);
  const approvalByTxn = new Map<string, (typeof approvals)[number]>();
  for (const a of approvals) if (!approvalByTxn.has(a.transaction_id)) approvalByTxn.set(a.transaction_id, a);

  res.json({
    data: txns.map(t => {
      const players = (assetsByTxn.get(t.id) ?? [])
        .filter(a => a.player_id)
        .map(a => ({ full_name: a.full_name!, from_franchise: a.from_franchise, to_franchise: a.to_franchise }));
      const approval = approvalByTxn.get(t.id);
      return {
        id: t.id,
        type: t.txn_type,
        status: t.status,
        summary: transactionSummary({ txn_type: t.txn_type, players }),
        note: t.note,
        proposed_at: t.proposed_at,
        resolved_at: t.resolved_at,
        decided_by: approval?.display_name ?? null,
        decided_at: approval?.voted_at ?? null,
      };
    }),
  });
});

// ────────────────────────────────────────────── Trades

// POST /leagues/:leagueId/trades
router.post(
  "/leagues/:leagueId/trades",
  idempotencyMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const leagueId = req.params.leagueId as string;
    const league = await leaguePolicy(leagueId);
    if (!league) { notFound(res, "League not found"); return; }
    if (!league.activeSeasonId) { badRequest(res, "League has no active season"); return; }

    const parsed = ProposeTradeBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const { side_a, side_b, note } = parsed.data;

    if (side_a.team_season_id === side_b.team_season_id) { badRequest(res, "Cannot trade with yourself"); return; }
    if (side_a.player_ids.length === 0 && side_b.player_ids.length === 0) { badRequest(res, "A trade must move at least one player"); return; }
    if (side_a.player_ids.length > 5 || side_b.player_ids.length > 5) { badRequest(res, "A trade may move at most 5 players per side"); return; }

    const [gmA, gmB] = await Promise.all([teamGm(side_a.team_season_id), teamGm(side_b.team_season_id)]);
    if (!gmA || !gmB) { notFound(res, "Team not found"); return; }
    if (gmA.leagueId !== leagueId || gmB.leagueId !== leagueId || gmA.seasonId !== league.activeSeasonId || gmB.seasonId !== league.activeSeasonId) {
      badRequest(res, "Both teams must be in this league's active season");
      return;
    }

    const appUserId = await appUserIdFor(user.id);
    if (!appUserId) { badRequest(res, "User profile not found"); return; }
    const role = await callerRole(leagueId, appUserId);
    if (!can(user, "transaction:act", {
      kind: "transaction", ownerId: league.ownerId,
      commissionerIds: isCommissionerRole(league, appUserId, role) ? [appUserId] : [],
      gmUserIds: [gmA.userId, gmB.userId],
    })) {
      forbidden(res, "Only a GM on one side of this trade, or the commissioner, can propose it");
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [leagueId]);

      // Every player must currently belong to the team proposed for their side.
      const allPlayers = [
        ...side_a.player_ids.map(id => ({ id, teamSeasonId: side_a.team_season_id })),
        ...side_b.player_ids.map(id => ({ id, teamSeasonId: side_b.team_season_id })),
      ];
      for (const p of allPlayers) {
        const owns = await client.query(
          `SELECT 1 FROM contract WHERE player_id = $1 AND team_season_id = $2 AND season_id = $3 AND superseded_by IS NULL`,
          [p.id, p.teamSeasonId, league.activeSeasonId],
        );
        if (!owns.rows[0]) {
          await client.query("ROLLBACK");
          badRequest(res, `Player ${p.id} is not currently on the roster of the team proposed for their side`);
          return;
        }
      }

      const txn = await client.query<{ id: string; proposed_at: string }>(
        `INSERT INTO transaction_event (season_id, txn_type, status, proposed_by, note)
         VALUES ($1, 'trade', 'proposed', $2, $3)
         RETURNING id, proposed_at`,
        [league.activeSeasonId, appUserId, note ?? null],
      );
      const transactionId = txn.rows[0]!.id;

      for (const playerId of side_a.player_ids) {
        await client.query(
          `INSERT INTO transaction_asset (transaction_id, kind, player_id, from_team_season_id, to_team_season_id)
           VALUES ($1, 'player', $2, $3, $4)`,
          [transactionId, playerId, side_a.team_season_id, side_b.team_season_id],
        );
      }
      for (const playerId of side_b.player_ids) {
        await client.query(
          `INSERT INTO transaction_asset (transaction_id, kind, player_id, from_team_season_id, to_team_season_id)
           VALUES ($1, 'player', $2, $3, $4)`,
          [transactionId, playerId, side_b.team_season_id, side_a.team_season_id],
        );
      }

      const capPreview = await capImpactPreview(client, side_a, side_b);

      await client.query("COMMIT");
      postToDiscord(league.discordWebhookUrl, `🔁 Trade proposed: ${transactionSummaryFor(capPreview)}`);
      res.status(201).json({
        id: transactionId,
        type: "trade",
        status: "proposed",
        proposed_at: txn.rows[0]!.proposed_at,
        cap_preview: capPreview,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);

interface CapPreviewSide {
  team_season_id: string;
  before: CapPosition;
  projected_cap_used_cents: number;
  would_be_over_cap: boolean;
}

async function capImpactPreview(
  client: PoolClient,
  side_a: { team_season_id: string; player_ids: string[] },
  side_b: { team_season_id: string; player_ids: string[] },
): Promise<{ side_a: CapPreviewSide; side_b: CapPreviewSide }> {
  const capHit = async (playerIds: string[]): Promise<number> => {
    if (playerIds.length === 0) return 0;
    const { rows } = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(cap_hit_cents), 0) AS total FROM contract
        WHERE player_id = ANY($1::uuid[]) AND superseded_by IS NULL`,
      [playerIds],
    );
    return Number(rows[0]?.total ?? 0);
  };
  const [capA, capB, outA, outB] = await Promise.all([
    capPositionFor(client, side_a.team_season_id),
    capPositionFor(client, side_b.team_season_id),
    capHit(side_a.player_ids),
    capHit(side_b.player_ids),
  ]);
  if (!capA || !capB) throw new Error("Team season disappeared mid-transaction");
  const projectedA = capA.cap_used_cents - outA + outB;
  const projectedB = capB.cap_used_cents - outB + outA;
  return {
    side_a: {
      team_season_id: side_a.team_season_id, before: capA,
      projected_cap_used_cents: projectedA,
      would_be_over_cap: capA.salary_cap_cents != null && projectedA > capA.salary_cap_cents,
    },
    side_b: {
      team_season_id: side_b.team_season_id, before: capB,
      projected_cap_used_cents: projectedB,
      would_be_over_cap: capB.salary_cap_cents != null && projectedB > capB.salary_cap_cents,
    },
  };
}

function transactionSummaryFor(preview: { side_a: CapPreviewSide; side_b: CapPreviewSide }): string {
  return `${preview.side_a.team_season_id} <-> ${preview.side_b.team_season_id}`;
}

async function loadTrade(client: PoolClient, transactionId: string) {
  const { rows } = await client.query<{
    id: string; season_id: string; status: string; league_id: string;
  }>(
    `SELECT te.id, te.season_id, te.status::text, s.league_id
       FROM transaction_event te JOIN season s ON s.id = te.season_id
      WHERE te.id = $1 AND te.txn_type = 'trade'`,
    [transactionId],
  );
  if (!rows[0]) return null;
  const { rows: assets } = await client.query<{ player_id: string; from_team_season_id: string; to_team_season_id: string }>(
    `SELECT player_id, from_team_season_id, to_team_season_id FROM transaction_asset WHERE transaction_id = $1`,
    [transactionId],
  );
  return { ...rows[0], assets };
}

// POST /leagues/:leagueId/trades/:id/accept — the counterparty GM's co-signature.
router.post(
  "/leagues/:leagueId/trades/:id/accept",
  async (req: Request, res: Response): Promise<void> => {
    await respondToTrade(req, res, { requireCounterparty: true, resultStatusIfAutoApprove: true });
  },
);

// POST /leagues/:leagueId/trades/:id/approve — commissioner-only, executes.
router.post(
  "/leagues/:leagueId/trades/:id/approve",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const leagueId = req.params.leagueId as string;
    const transactionId = req.params.id as string;
    const league = await leaguePolicy(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    const appUserId = await appUserIdFor(user.id);
    if (!appUserId) { badRequest(res, "User profile not found"); return; }
    const role = await callerRole(leagueId, appUserId);
    if (!can(user, "transaction:approve", { kind: "transaction", ownerId: league.ownerId, commissionerIds: isCommissionerRole(league, appUserId, role) ? [appUserId] : [] })) {
      forbidden(res, "Only the commissioner can approve a trade");
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const trade = await loadTrade(client, transactionId);
      if (!trade || trade.league_id !== leagueId) { await client.query("ROLLBACK"); notFound(res, "Trade not found"); return; }
      if (trade.status !== "accepted") { await client.query("ROLLBACK"); conflict(res, `Trade is '${trade.status}', not 'accepted'`); return; }

      const executed = await executeTrade(client, league, trade, appUserId);
      await client.query("COMMIT");
      postToDiscord(league.discordWebhookUrl, `✅ Trade executed: ${executed.summary}`);
      res.json(executed.response);
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof CapBlockedError) { conflict(res, error.message); return; }
      if (error instanceof TradeStaleError) { conflict(res, error.message); return; }
      throw error;
    } finally {
      client.release();
    }
  },
);

// POST /leagues/:leagueId/trades/:id/reject
router.post(
  "/leagues/:leagueId/trades/:id/reject",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const leagueId = req.params.leagueId as string;
    const transactionId = req.params.id as string;
    const league = await leaguePolicy(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    const parsed = RejectTradeBody.safeParse(req.body ?? {});
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const trade = await loadTrade(client, transactionId);
      if (!trade || trade.league_id !== leagueId) { await client.query("ROLLBACK"); notFound(res, "Trade not found"); return; }
      if (!["proposed", "accepted"].includes(trade.status)) { await client.query("ROLLBACK"); conflict(res, `Trade is already '${trade.status}'`); return; }

      const teamSeasonIds = [...new Set(trade.assets.flatMap(a => [a.from_team_season_id, a.to_team_season_id]))];
      const gms = await Promise.all(teamSeasonIds.map(teamGm));
      const appUserId = await appUserIdFor(user.id);
      if (!appUserId) { await client.query("ROLLBACK"); badRequest(res, "User profile not found"); return; }
      const role = await callerRole(leagueId, appUserId);
      if (!can(user, "transaction:act", {
        kind: "transaction", ownerId: league.ownerId,
        commissionerIds: isCommissionerRole(league, appUserId, role) ? [appUserId] : [],
        gmUserIds: gms.map(g => g?.userId ?? null),
      })) {
        await client.query("ROLLBACK");
        forbidden(res, "Only a GM on either side of this trade, or the commissioner, can reject it");
        return;
      }

      await client.query(`UPDATE transaction_event SET status = 'rejected', resolved_at = now() WHERE id = $1`, [transactionId]);
      await client.query(
        `INSERT INTO transaction_approval (transaction_id, user_id, vote, rationale) VALUES ($1,$2,false,$3)`,
        [transactionId, appUserId, parsed.data.reason ?? null],
      );
      await client.query("COMMIT");
      res.json({ id: transactionId, status: "rejected" });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);

async function respondToTrade(
  req: Request,
  res: Response,
  _opts: { requireCounterparty: boolean; resultStatusIfAutoApprove: boolean },
): Promise<void> {
  const user = getCurrentUser(req);
  if (!user) { unauthorized(res); return; }
  const leagueId = req.params.leagueId as string;
  const transactionId = req.params.id as string;
  const league = await leaguePolicy(leagueId);
  if (!league) { notFound(res, "League not found"); return; }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const trade = await loadTrade(client, transactionId);
    if (!trade || trade.league_id !== leagueId) { await client.query("ROLLBACK"); notFound(res, "Trade not found"); return; }
    if (trade.status !== "proposed") { await client.query("ROLLBACK"); conflict(res, `Trade is '${trade.status}', not 'proposed'`); return; }

    // The counterparty is whichever side the proposer did NOT act for — since
    // a GM can only own one side, "accept" must come from a GM on the OTHER
    // side than the proposer, or the commissioner acting on their behalf.
    const teamSeasonIds = [...new Set(trade.assets.flatMap(a => [a.from_team_season_id, a.to_team_season_id]))];
    const gms = await Promise.all(teamSeasonIds.map(teamGm));
    const appUserId = await appUserIdFor(user.id);
    if (!appUserId) { await client.query("ROLLBACK"); badRequest(res, "User profile not found"); return; }
    const role = await callerRole(leagueId, appUserId);
    if (!can(user, "transaction:act", {
      kind: "transaction", ownerId: league.ownerId,
      commissionerIds: isCommissionerRole(league, appUserId, role) ? [appUserId] : [],
      gmUserIds: gms.map(g => g?.userId ?? null),
    })) {
      await client.query("ROLLBACK");
      forbidden(res, "Only a GM on either side of this trade, or the commissioner, can accept it");
      return;
    }

    await client.query(
      `INSERT INTO transaction_approval (transaction_id, user_id, vote) VALUES ($1,$2,true)`,
      [transactionId, appUserId],
    );

    if (league.autoApproveTrades) {
      const executed = await executeTrade(client, league, trade, appUserId);
      await client.query("COMMIT");
      postToDiscord(league.discordWebhookUrl, `✅ Trade executed: ${executed.summary}`);
      res.json(executed.response);
      return;
    }

    await client.query(`UPDATE transaction_event SET status = 'accepted' WHERE id = $1`, [transactionId]);
    await client.query("COMMIT");
    res.json({ id: transactionId, status: "accepted" });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof CapBlockedError) { conflict(res, error.message); return; }
    if (error instanceof TradeStaleError) { conflict(res, error.message); return; }
    throw error;
  } finally {
    client.release();
  }
}

async function executeTrade(
  client: PoolClient,
  league: LeaguePolicy,
  trade: { id: string; season_id: string; assets: Array<{ player_id: string; from_team_season_id: string; to_team_season_id: string }> },
  approverAppUserId: string,
): Promise<{ response: Record<string, unknown>; summary: string }> {
  // Cap enforcement, evaluated against the CURRENT position right before
  // executing — a proposal's cap preview can go stale while it sits pending.
  const sides = [...new Set(trade.assets.map(a => a.to_team_season_id))];
  let anyOverCap = false;
  for (const teamSeasonId of sides) {
    const incoming = trade.assets.filter(a => a.to_team_season_id === teamSeasonId).map(a => a.player_id);
    const outgoing = trade.assets.filter(a => a.from_team_season_id === teamSeasonId).map(a => a.player_id);
    const capOf = async (ids: string[]) => {
      if (ids.length === 0) return 0;
      const { rows } = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(cap_hit_cents),0) AS total FROM contract WHERE player_id = ANY($1::uuid[]) AND superseded_by IS NULL`,
        [ids],
      );
      return Number(rows[0]?.total ?? 0);
    };
    const position = await capPositionFor(client, teamSeasonId);
    if (!position) throw new Error(`Team season ${teamSeasonId} disappeared mid-transaction`);
    const delta = (await capOf(incoming)) - (await capOf(outgoing));
    const overCap = projectsOverCap(position, delta);
    if (league.capEnforcement === "block" && overCap) {
      throw new CapBlockedError(teamSeasonId);
    }
    if (overCap) anyOverCap = true;
  }

  for (const asset of trade.assets) {
    const current = await client.query<{ id: string; cap_hit_cents: string; term_years: number | null; expires_after_season_ordinal: number | null; no_trade_clause: boolean }>(
      `SELECT id, cap_hit_cents, term_years, expires_after_season_ordinal, no_trade_clause
         FROM contract WHERE player_id = $1 AND team_season_id = $2 AND season_id = $3 AND superseded_by IS NULL`,
      [asset.player_id, asset.from_team_season_id, trade.season_id],
    );
    const contract = current.rows[0];
    if (!contract) throw new TradeStaleError(asset.player_id);

    const next = await client.query<{ id: string }>(
      `INSERT INTO contract (season_id, player_id, team_season_id, cap_hit_cents, term_years, expires_after_season_ordinal, no_trade_clause, data_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'manual')
       RETURNING id`,
      [trade.season_id, asset.player_id, asset.to_team_season_id, contract.cap_hit_cents, contract.term_years, contract.expires_after_season_ordinal, contract.no_trade_clause],
    );
    await client.query(`UPDATE contract SET superseded_by = $1 WHERE id = $2`, [next.rows[0]!.id, contract.id]);
  }

  await client.query(
    `UPDATE transaction_event SET status = 'executed', resolved_at = now(),
            note = COALESCE(note || ' — ', '') || $2
      WHERE id = $1`,
    [trade.id, summarizeCapCheck(league.capEnforcement, anyOverCap)],
  );
  await client.query(
    `INSERT INTO transaction_approval (transaction_id, user_id, vote) VALUES ($1,$2,true) ON CONFLICT DO NOTHING`,
    [trade.id, approverAppUserId],
  );

  const names = await client.query<{ full_name: string }>(
    `SELECT full_name FROM player WHERE id = ANY($1::uuid[])`,
    [trade.assets.map(a => a.player_id)],
  );
  return {
    response: { id: trade.id, status: "executed" },
    summary: names.rows.map(r => r.full_name).join(", "),
  };
}

class CapBlockedError extends Error {
  constructor(public teamSeasonId: string) { super(`Team ${teamSeasonId} would exceed the salary cap`); }
}
class TradeStaleError extends Error {
  constructor(public playerId: string) { super(`Player ${playerId} is no longer on the roster this trade expects`); }
}

// ────────────────────────────────────────────── Signings

// POST /leagues/:leagueId/signings
router.post(
  "/leagues/:leagueId/signings",
  idempotencyMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const leagueId = req.params.leagueId as string;
    const league = await leaguePolicy(leagueId);
    if (!league) { notFound(res, "League not found"); return; }
    if (!league.activeSeasonId) { badRequest(res, "League has no active season"); return; }

    const parsed = CreateSigningBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const { team_season_id, player_id, cap_hit_cents, term_years } = parsed.data;

    const gm = await teamGm(team_season_id);
    if (!gm || gm.leagueId !== leagueId || gm.seasonId !== league.activeSeasonId) { notFound(res, "Team not found in this league's active season"); return; }

    const appUserId = await appUserIdFor(user.id);
    if (!appUserId) { badRequest(res, "User profile not found"); return; }
    const role = await callerRole(leagueId, appUserId);
    if (!can(user, "transaction:act", { kind: "transaction", ownerId: league.ownerId, commissionerIds: isCommissionerRole(league, appUserId, role) ? [appUserId] : [], gmUserIds: [gm.userId] })) {
      forbidden(res, "Only the team's GM or the commissioner can sign a player");
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [leagueId]);

      const existing = await client.query(
        `SELECT team_season_id FROM contract WHERE player_id = $1 AND season_id = $2 AND superseded_by IS NULL`,
        [player_id, league.activeSeasonId],
      );
      if (existing.rows[0]?.team_season_id) {
        await client.query("ROLLBACK");
        conflict(res, "Player is already under contract this season");
        return;
      }

      const position = await capPositionFor(client, team_season_id);
      if (!position) { await client.query("ROLLBACK"); notFound(res, "Team season not found"); return; }
      const overCap = projectsOverCap(position, cap_hit_cents);
      if (league.capEnforcement === "block" && overCap) {
        await client.query("ROLLBACK");
        conflict(res, `Signing would exceed the salary cap (space: ${position.cap_space_cents ?? "uncapped"})`);
        return;
      }

      // Supersede any prior (e.g. previously-released) contract row for this
      // player/season so exactly one current row exists per player.
      if (existing.rows[0]) {
        await client.query(
          `UPDATE contract SET superseded_by = gen_random_uuid() WHERE player_id = $1 AND season_id = $2 AND superseded_by IS NULL`,
          [player_id, league.activeSeasonId],
        );
      }

      const contract = await client.query<{ id: string }>(
        `INSERT INTO contract (season_id, player_id, team_season_id, cap_hit_cents, term_years, data_source)
         VALUES ($1,$2,$3,$4,$5,'manual') RETURNING id`,
        [league.activeSeasonId, player_id, team_season_id, cap_hit_cents, term_years ?? null],
      );

      const txn = await client.query<{ id: string; proposed_at: string }>(
        `INSERT INTO transaction_event (season_id, txn_type, status, proposed_by, resolved_at, note)
         VALUES ($1, 'signing', 'executed', $2, now(), $3)
         RETURNING id, proposed_at`,
        [league.activeSeasonId, appUserId, summarizeCapCheck(league.capEnforcement, overCap)],
      );
      await client.query(
        `INSERT INTO transaction_asset (transaction_id, kind, player_id, to_team_season_id)
         VALUES ($1, 'player', $2, $3)`,
        [txn.rows[0]!.id, player_id, team_season_id],
      );

      await client.query("COMMIT");
      const playerRow = await pool.query<{ full_name: string }>(`SELECT full_name FROM player WHERE id = $1`, [player_id]);
      postToDiscord(league.discordWebhookUrl, `✍️ Signing: ${playerRow.rows[0]?.full_name ?? "A player"} signed (${(cap_hit_cents / 100).toLocaleString()}/yr)${overCap ? " — over cap" : ""}`);
      res.status(201).json({ id: txn.rows[0]!.id, contract_id: contract.rows[0]!.id, status: "executed", over_cap_warning: league.capEnforcement === "warn" && overCap });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);

// ────────────────────────────────────────────── Releases / waivers

// POST /leagues/:leagueId/releases
router.post(
  "/leagues/:leagueId/releases",
  idempotencyMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const leagueId = req.params.leagueId as string;
    const league = await leaguePolicy(leagueId);
    if (!league) { notFound(res, "League not found"); return; }
    if (!league.activeSeasonId) { badRequest(res, "League has no active season"); return; }

    const parsed = CreateReleaseBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const { player_id } = parsed.data;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ id: string; team_season_id: string | null }>(
        `SELECT id, team_season_id FROM contract WHERE player_id = $1 AND season_id = $2 AND superseded_by IS NULL`,
        [player_id, league.activeSeasonId],
      );
      const contract = current.rows[0];
      if (!contract || !contract.team_season_id) { await client.query("ROLLBACK"); badRequest(res, "Player is not currently rostered"); return; }

      const gm = await teamGm(contract.team_season_id);
      const appUserId = await appUserIdFor(user.id);
      if (!appUserId) { await client.query("ROLLBACK"); badRequest(res, "User profile not found"); return; }
      const role = await callerRole(leagueId, appUserId);
      if (!can(user, "transaction:act", { kind: "transaction", ownerId: league.ownerId, commissionerIds: isCommissionerRole(league, appUserId, role) ? [appUserId] : [], gmUserIds: [gm?.userId ?? null] })) {
        await client.query("ROLLBACK");
        forbidden(res, "Only the team's GM or the commissioner can release this player");
        return;
      }

      const txn = await client.query<{ id: string }>(
        `INSERT INTO transaction_event (season_id, txn_type, status, proposed_by, resolved_at)
         VALUES ($1, 'release', 'executed', $2, now()) RETURNING id`,
        [league.activeSeasonId, appUserId],
      );
      await client.query(
        `INSERT INTO transaction_asset (transaction_id, kind, player_id, from_team_season_id)
         VALUES ($1, 'player', $2, $3)`,
        [txn.rows[0]!.id, player_id, contract.team_season_id],
      );

      const freed = await client.query<{ id: string }>(
        `INSERT INTO contract (season_id, player_id, team_season_id, cap_hit_cents, data_source)
         VALUES ($1,$2,NULL,0,'manual') RETURNING id`,
        [league.activeSeasonId, player_id],
      );
      await client.query(`UPDATE contract SET superseded_by = $1 WHERE id = $2`, [freed.rows[0]!.id, contract.id]);

      const expiresAt = new Date(Date.now() + league.waiverWindowHours * 3_600_000).toISOString();
      const waiver = await client.query<{ id: string; expires_at: string }>(
        `INSERT INTO waiver (league_id, season_id, player_id, waived_by_team_season_id, release_txn_id, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, expires_at`,
        [leagueId, league.activeSeasonId, player_id, contract.team_season_id, txn.rows[0]!.id, expiresAt],
      );
      await client.query(`UPDATE transaction_event SET waiver_id = $1 WHERE id = $2`, [waiver.rows[0]!.id, txn.rows[0]!.id]);

      await client.query("COMMIT");
      const playerRow = await pool.query<{ full_name: string }>(`SELECT full_name FROM player WHERE id = $1`, [player_id]);
      postToDiscord(league.discordWebhookUrl, `📤 ${playerRow.rows[0]?.full_name ?? "A player"} placed on waivers`);
      res.status(201).json({ transaction_id: txn.rows[0]!.id, waiver_id: waiver.rows[0]!.id, expires_at: waiver.rows[0]!.expires_at });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);

async function autoResolveExpiredWaivers(leagueId: string, seasonId: string): Promise<void> {
  const { rows: expired } = await pool.query<{ id: string }>(
    `SELECT id FROM waiver WHERE league_id = $1 AND season_id = $2 AND status = 'open' AND expires_at <= now()`,
    [leagueId, seasonId],
  );
  for (const w of expired) {
    await resolveWaiver(w.id).catch(() => { /* best-effort; a commissioner can resolve manually */ });
  }
}

async function resolveWaiver(waiverId: string): Promise<{ winning_team_season_id: string | null }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [waiverId]);
    const w = await client.query<{ id: string; season_id: string; league_id: string; player_id: string; status: string }>(
      `SELECT id, season_id, league_id, player_id, status FROM waiver WHERE id = $1 FOR UPDATE`,
      [waiverId],
    );
    const waiver = w.rows[0];
    if (!waiver || waiver.status !== "open") { await client.query("ROLLBACK"); return { winning_team_season_id: null }; }

    const claims = await client.query<{ id: string; to_team_season_id: string }>(
      `SELECT te.id, ta.to_team_season_id
         FROM transaction_event te JOIN transaction_asset ta ON ta.transaction_id = te.id
        WHERE te.waiver_id = $1 AND te.status = 'proposed'`,
      [waiverId],
    );

    if (claims.rows.length === 0) {
      await client.query(`UPDATE waiver SET status = 'resolved', resolved_at = now() WHERE id = $1`, [waiverId]);
      await client.query("COMMIT");
      return { winning_team_season_id: null };
    }

    // Reverse standings: worst record (fewest points) gets priority.
    const priority = await client.query<{ team_season_id: string }>(
      `SELECT v.team_season_id
         FROM v_standings v
        WHERE v.season_id = $1 AND v.team_season_id = ANY($2::uuid[])
        ORDER BY v.points ASC, v.diff ASC`,
      [waiver.season_id, claims.rows.map(c => c.to_team_season_id)],
    );
    const winnerTeamSeasonId = priority.rows[0]?.team_season_id ?? claims.rows[0]!.to_team_season_id;
    const winningClaim = claims.rows.find(c => c.to_team_season_id === winnerTeamSeasonId)!;

    const freeAgent = await client.query<{ id: string }>(
      `SELECT id FROM contract WHERE player_id = $1 AND season_id = $2 AND superseded_by IS NULL`,
      [waiver.player_id, waiver.season_id],
    );
    const lostCurrent = await client.query<{ cap_hit_cents: string }>(`SELECT cap_hit_cents FROM contract WHERE id = $1`, [freeAgent.rows[0]!.id]);
    const claimed = await client.query<{ id: string }>(
      `INSERT INTO contract (season_id, player_id, team_season_id, cap_hit_cents, data_source)
       VALUES ($1,$2,$3,$4,'manual') RETURNING id`,
      [waiver.season_id, waiver.player_id, winnerTeamSeasonId, lostCurrent.rows[0]?.cap_hit_cents ?? 0],
    );
    await client.query(`UPDATE contract SET superseded_by = $1 WHERE id = $2`, [claimed.rows[0]!.id, freeAgent.rows[0]!.id]);

    await client.query(`UPDATE transaction_event SET status = 'executed', resolved_at = now() WHERE id = $1`, [winningClaim.id]);
    await client.query(
      `UPDATE transaction_event SET status = 'rejected', resolved_at = now() WHERE waiver_id = $1 AND status = 'proposed' AND id <> $2`,
      [waiverId, winningClaim.id],
    );
    await client.query(`UPDATE waiver SET status = 'resolved', resolved_at = now(), winning_txn_id = $1 WHERE id = $2`, [winningClaim.id, waiverId]);

    await client.query("COMMIT");
    return { winning_team_season_id: winnerTeamSeasonId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// GET /leagues/:leagueId/waivers — open waivers, auto-resolving any past expiry.
router.get("/leagues/:leagueId/waivers", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user) { unauthorized(res); return; }
  const leagueId = req.params.leagueId as string;
  const league = await leaguePolicy(leagueId);
  if (!league) { notFound(res, "League not found"); return; }
  if (!league.activeSeasonId) { res.json({ data: [] }); return; }

  await autoResolveExpiredWaivers(leagueId, league.activeSeasonId);

  const { rows } = await pool.query(
    `SELECT w.id, w.player_id, p.full_name, w.waived_by_team_season_id, w.opened_at, w.expires_at, w.status,
            (SELECT COUNT(*) FROM transaction_event te WHERE te.waiver_id = w.id AND te.status = 'proposed') AS claim_count
       FROM waiver w JOIN player p ON p.id = w.player_id
      WHERE w.league_id = $1 AND w.status = 'open'
      ORDER BY w.expires_at ASC`,
    [leagueId],
  );
  res.json({ data: rows.map(r => ({ ...r, claim_count: Number(r.claim_count) })) });
});

// POST /leagues/:leagueId/waivers/:waiverId/claims
router.post(
  "/leagues/:leagueId/waivers/:waiverId/claims",
  idempotencyMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const leagueId = req.params.leagueId as string;
    const waiverId = req.params.waiverId as string;
    const league = await leaguePolicy(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    const parsed = CreateWaiverClaimBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const { team_season_id } = parsed.data;

    const w = await pool.query<{ id: string; league_id: string; season_id: string; status: string; expires_at: string; player_id: string; waived_by_team_season_id: string }>(
      `SELECT id, league_id, season_id, status, expires_at, player_id, waived_by_team_season_id FROM waiver WHERE id = $1`,
      [waiverId],
    );
    const waiver = w.rows[0];
    if (!waiver || waiver.league_id !== leagueId) { notFound(res, "Waiver not found"); return; }
    if (waiver.status !== "open" || new Date(waiver.expires_at) <= new Date()) { conflict(res, "Waiver claim window has closed"); return; }
    if (team_season_id === waiver.waived_by_team_season_id) { badRequest(res, "The waiving team cannot claim its own player"); return; }

    const gm = await teamGm(team_season_id);
    if (!gm || gm.leagueId !== leagueId) { notFound(res, "Team not found"); return; }
    const appUserId = await appUserIdFor(user.id);
    if (!appUserId) { badRequest(res, "User profile not found"); return; }
    const role = await callerRole(leagueId, appUserId);
    if (!can(user, "transaction:act", { kind: "transaction", ownerId: league.ownerId, commissionerIds: isCommissionerRole(league, appUserId, role) ? [appUserId] : [], gmUserIds: [gm.userId] })) {
      forbidden(res, "Only the claiming team's GM or the commissioner can submit a waiver claim");
      return;
    }

    const existing = await pool.query(
      `SELECT te.id FROM transaction_event te JOIN transaction_asset ta ON ta.transaction_id = te.id
        WHERE te.waiver_id = $1 AND ta.to_team_season_id = $2 AND te.status = 'proposed'`,
      [waiverId, team_season_id],
    );
    if (existing.rows[0]) { conflict(res, "This team already has a pending claim on this waiver"); return; }

    const txn = await pool.query<{ id: string }>(
      `INSERT INTO transaction_event (season_id, txn_type, status, proposed_by, waiver_id)
       VALUES ($1, 'waiver_claim', 'proposed', $2, $3) RETURNING id`,
      [waiver.season_id, appUserId, waiverId],
    );
    await pool.query(
      `INSERT INTO transaction_asset (transaction_id, kind, player_id, to_team_season_id) VALUES ($1, 'player', $2, $3)`,
      [txn.rows[0]!.id, waiver.player_id, team_season_id],
    );
    postToDiscord(league.discordWebhookUrl, `🙋 Waiver claim submitted for a player`);
    res.status(201).json({ id: txn.rows[0]!.id, status: "proposed" });
  },
);

// POST /leagues/:leagueId/waivers/:waiverId/resolve — commissioner resolves now.
router.post(
  "/leagues/:leagueId/waivers/:waiverId/resolve",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const leagueId = req.params.leagueId as string;
    const waiverId = req.params.waiverId as string;
    const league = await leaguePolicy(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    const appUserId = await appUserIdFor(user.id);
    if (!appUserId) { badRequest(res, "User profile not found"); return; }
    const role = await callerRole(leagueId, appUserId);
    if (!can(user, "transaction:approve", { kind: "transaction", ownerId: league.ownerId, commissionerIds: isCommissionerRole(league, appUserId, role) ? [appUserId] : [] })) {
      forbidden(res, "Only the commissioner can resolve a waiver early");
      return;
    }

    const w = await pool.query<{ id: string; league_id: string }>(`SELECT id, league_id FROM waiver WHERE id = $1`, [waiverId]);
    if (!w.rows[0] || w.rows[0].league_id !== leagueId) { notFound(res, "Waiver not found"); return; }

    const result = await resolveWaiver(waiverId);
    res.json(result);
  },
);

// ────────────────────────────────────────────── Roster status (IR / minors)

// POST /contracts/:contractId/roster-status
router.post(
  "/contracts/:contractId/roster-status",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const contractId = req.params.contractId as string;

    const parsed = SetRosterStatusBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    const contract = await pool.query<{ id: string; team_season_id: string | null; season_id: string; roster_status: string; superseded_by: string | null; league_id: string }>(
      `SELECT c.id, c.team_season_id, c.season_id, c.roster_status, c.superseded_by, s.league_id
         FROM contract c JOIN season s ON s.id = c.season_id
        WHERE c.id = $1`,
      [contractId],
    );
    const row = contract.rows[0];
    if (!row || row.superseded_by) { notFound(res, "Contract not found"); return; }
    if (!row.team_season_id) { badRequest(res, "Player is a free agent"); return; }

    const league = await leaguePolicy(row.league_id);
    if (!league) { notFound(res, "League not found"); return; }
    const gm = await teamGm(row.team_season_id);
    const appUserId = await appUserIdFor(user.id);
    if (!appUserId) { badRequest(res, "User profile not found"); return; }
    const role = await callerRole(row.league_id, appUserId);
    if (!can(user, "transaction:act", { kind: "transaction", ownerId: league.ownerId, commissionerIds: isCommissionerRole(league, appUserId, role) ? [appUserId] : [], gmUserIds: [gm?.userId ?? null] })) {
      forbidden(res, "Only the team's GM or the commissioner can change this player's roster status");
      return;
    }

    const txnType =
      parsed.data.roster_status === "ir" ? "ir_place" :
      row.roster_status === "ir" && parsed.data.roster_status === "active" ? "ir_activate" :
      parsed.data.roster_status === "minors" ? "send_down" :
      row.roster_status === "minors" && parsed.data.roster_status === "active" ? "call_up" :
      null;

    await pool.query(`UPDATE contract SET roster_status = $1 WHERE id = $2`, [parsed.data.roster_status, contractId]);
    if (txnType) {
      const txn = await pool.query<{ id: string }>(
        `INSERT INTO transaction_event (season_id, txn_type, status, proposed_by, resolved_at)
         VALUES ($1, $2, 'executed', $3, now()) RETURNING id`,
        [row.season_id, txnType, appUserId],
      );
      await pool.query(
        `INSERT INTO transaction_asset (transaction_id, kind, player_id, from_team_season_id, to_team_season_id)
         VALUES ($1, 'player', (SELECT player_id FROM contract WHERE id = $2), $3, $3)`,
        [txn.rows[0]!.id, contractId, row.team_season_id],
      );
    }

    res.json({ id: contractId, roster_status: parsed.data.roster_status });
  },
);

export default router;
