/**
 * Schedule routes — generation, week windows, and commissioner adjustments.
 *
 * POST /seasons/:seasonId/schedule          — generate a balanced schedule
 * GET  /seasons/:seasonId/weeks             — list week windows + status counts
 * PATCH /games/:gameId/window               — shift a window (commissioner)
 * POST  /games/:gameId/postpone             — postpone a game (commissioner)
 * POST  /games/:gameId/force-resolve        — force-resolve at window close (commissioner)
 *
 * Every commissioner action writes to audit_log with a mandatory reason.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import {
  notFound,
  unauthorized,
  forbidden,
  badRequest,
  conflict,
  unprocessable,
} from "../server/errors";
import { idempotencyMiddleware } from "../middlewares/idempotency";
import { rateLimiter } from "../middlewares/rateLimiter";
import { generateSchedule, checkScheduleBalance } from "../server/core/schedule";
import {
  GenerateScheduleBody,
  ShiftWindowBody,
  PostponeGameBody,
  ForceResolveGameBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ─────────────────────────────────────── helpers

async function getLeagueOwnerBySeasonId(
  seasonId: string
): Promise<{ leagueId: string; ownerId: string } | null> {
  const { rows } = await pool.query<{ league_id: string; owner_replit_id: string }>(
    `SELECT s.league_id, u.replit_id AS owner_replit_id
       FROM season s
       JOIN league l ON l.id = s.league_id
       JOIN app_user u ON u.id = l.owner_user_id
      WHERE s.id = $1`,
    [seasonId]
  );
  const row = rows[0];
  if (!row) return null;
  return { leagueId: row.league_id, ownerId: row.owner_replit_id };
}

async function getLeagueOwnerByGameId(
  gameId: string
): Promise<{ leagueId: string; ownerId: string; seasonId: string } | null> {
  const { rows } = await pool.query<{
    league_id: string; owner_replit_id: string; season_id: string;
  }>(
    `SELECT s.league_id, u.replit_id AS owner_replit_id, g.season_id
       FROM game g
       JOIN season s ON s.id = g.season_id
       JOIN league l ON l.id = s.league_id
       JOIN app_user u ON u.id = l.owner_user_id
      WHERE g.id = $1`,
    [gameId]
  );
  const row = rows[0];
  if (!row) return null;
  return { leagueId: row.league_id, ownerId: row.owner_replit_id, seasonId: row.season_id };
}

async function writeAuditLog(client: PoolClient, opts: {
  actorUserId: string | null;
  leagueId: string;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason: string;
}): Promise<void> {
  // Look up app_user.id from replit_id for the actor
  let appUserId: string | null = null;
  if (opts.actorUserId) {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM app_user WHERE replit_id = $1`,
      [opts.actorUserId]
    );
    appUserId = r.rows[0]?.id ?? null;
  }

  await client.query(
    `INSERT INTO audit_log
       (actor_user_id, league_id, entity_type, entity_id, action, before, after, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      appUserId,
      opts.leagueId,
      opts.entityType,
      opts.entityId,
      opts.action,
      opts.before ? JSON.stringify(opts.before) : null,
      opts.after  ? JSON.stringify(opts.after)  : null,
      opts.reason,
    ]
  );
}

// ─────────────────────────────────────── Generate schedule

router.post(
  "/seasons/:seasonId/schedule",
  idempotencyMiddleware,
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const seasonId = req.params.seasonId as string;

    const league = await getLeagueOwnerBySeasonId(seasonId);
    if (!league) { notFound(res, "Season not found"); return; }

    if (!can(user, "schedule:generate", { kind: "league", ownerId: league.ownerId })) {
      forbidden(res, "Only the league owner can generate a schedule"); return;
    }

    // Reject if games already exist for this season
    const existing = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM game WHERE season_id = $1`,
      [seasonId]
    );
    if (parseInt(existing.rows[0]?.count ?? "0", 10) > 0) {
      conflict(res, "A schedule already exists for this season. Delete games first or use postpone/void on individual games.");
      return;
    }

    const parsed = GenerateScheduleBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    const { week_duration_days = 7, start_date } = parsed.data;

    // Load season
    const seasonRow = await pool.query<{
      games_per_matchup: number;
      starts_on: string | null;
    }>(
      `SELECT games_per_matchup, starts_on FROM season WHERE id = $1`,
      [seasonId]
    );
    const season = seasonRow.rows[0];
    if (!season) { notFound(res, "Season not found"); return; }

    // Determine season start date.
    // `start_date` arrives as a Zod-coerced Date; `season.starts_on` may come
    // back from pg as a Date object (pg type parsers are global and can be
    // overridden by Drizzle's driver setup). Normalise both to YYYY-MM-DD
    // strings before building the full ISO timestamp.
    const toDateStr = (d: Date | string | null | undefined): string | null =>
      d instanceof Date ? d.toISOString().slice(0, 10) : (d ?? null);

    const rawStartDate =
      toDateStr(start_date) ??
      toDateStr(season.starts_on) ??
      new Date().toISOString().slice(0, 10);

    const seasonStartDate = new Date(rawStartDate + "T00:00:00Z");
    if (isNaN(seasonStartDate.getTime())) {
      badRequest(res, "Invalid start_date"); return;
    }

    // Load all 32 team_seasons for this season
    const teamsRow = await pool.query<{ id: string }>(
      `SELECT id FROM team_season WHERE season_id = $1 ORDER BY id`,
      [seasonId]
    );
    const teams = teamsRow.rows.map((r) => ({ teamSeasonId: r.id }));

    if (teams.length < 2) {
      unprocessable(res, "Need at least 2 team seats to generate a schedule"); return;
    }
    if (teams.length % 2 !== 0) {
      unprocessable(res, "Team count must be even"); return;
    }

    // Generate the balanced schedule (pure function)
    let result;
    try {
      result = generateSchedule({
        teams,
        gamesPerMatchup: season.games_per_matchup,
        seasonStartDate,
        weekDurationDays: week_duration_days,
      });
    } catch (e: unknown) {
      unprocessable(res, e instanceof Error ? e.message : "Schedule generation failed"); return;
    }

    // Verify balance invariants before touching the DB
    const balanceError = checkScheduleBalance(result.games, teams.length, season.games_per_matchup);
    if (balanceError) {
      // This is an internal bug; 500 is appropriate
      res.status(500).json({
        type: "https://frontoffice.example/probs/schedule-balance",
        title: "Schedule balance check failed",
        status: 500,
        detail: balanceError,
        trace_id: req.id,
      });
      return;
    }

    // Bulk insert games in a single transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Bulk insert using unnest for efficiency
      const homeIds = result.games.map((g) => g.homeTeamSeasonId);
      const awayIds = result.games.map((g) => g.awayTeamSeasonId);
      const weeks   = result.games.map((g) => g.weekNumber);
      const opens   = result.games.map((g) => g.windowOpensAt.toISOString());
      const closes  = result.games.map((g) => g.windowClosesAt.toISOString());
      const sIds    = result.games.map(() => seasonId);

      await client.query(
        `INSERT INTO game
           (season_id, week_number, home_team_season_id, away_team_season_id,
            window_opens_at, window_closes_at, status)
         SELECT
           UNNEST($1::uuid[]),
           UNNEST($2::int[]),
           UNNEST($3::uuid[]),
           UNNEST($4::uuid[]),
           UNNEST($5::timestamptz[]),
           UNNEST($6::timestamptz[]),
           'scheduled'`,
        [sIds, weeks, homeIds, awayIds, opens, closes]
      );

      // Write audit entry
      await writeAuditLog(client, {
        actorUserId: user.id,
        leagueId: league.leagueId,
        entityType: "season",
        entityId: seasonId,
        action: "schedule_generated",
        after: {
          games_created: result.games.length,
          total_weeks: result.totalWeeks,
          games_per_matchup: season.games_per_matchup,
          season_start: seasonStartDate.toISOString(),
        },
        reason: `Commissioner generated a ${result.games.length}-game schedule`,
      });

      await client.query("COMMIT");

      res.status(201).json({
        games_created: result.games.length,
        total_weeks: result.totalWeeks,
        total_rounds: result.totalRounds,
        season_start: seasonStartDate.toISOString(),
        week_duration_days,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

// ─────────────────────────────────────── List week windows

router.get(
  "/seasons/:seasonId/weeks",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const seasonId = req.params.seasonId as string;

    const seasonCheck = await pool.query(
      `SELECT id FROM season WHERE id = $1`,
      [seasonId]
    );
    if (!seasonCheck.rows[0]) { notFound(res, "Season not found"); return; }

    const { rows } = await pool.query<{
      week_number: number;
      window_opens_at: Date;
      window_closes_at: Date;
      total: string;
      scheduled: string;
      in_window: string;
      reported: string;
      confirmed: string;
      disputed: string;
      forfeited: string;
      postponed: string;
      voided: string;
    }>(
      `SELECT
         week_number,
         MIN(window_opens_at)  AS window_opens_at,
         MAX(window_closes_at) AS window_closes_at,
         COUNT(*)                                              AS total,
         COUNT(*) FILTER (WHERE status = 'scheduled')         AS scheduled,
         COUNT(*) FILTER (WHERE status = 'in_window')         AS in_window,
         COUNT(*) FILTER (WHERE status = 'reported')          AS reported,
         COUNT(*) FILTER (WHERE status = 'confirmed')         AS confirmed,
         COUNT(*) FILTER (WHERE status = 'disputed')          AS disputed,
         COUNT(*) FILTER (WHERE status = 'forfeited')         AS forfeited,
         COUNT(*) FILTER (WHERE status = 'postponed')         AS postponed,
         COUNT(*) FILTER (WHERE status = 'voided')            AS voided
       FROM game
      WHERE season_id = $1
      GROUP BY week_number
      ORDER BY week_number`,
      [seasonId]
    );

    res.json({
      data: rows.map((r) => ({
        week_number: r.week_number,
        window_opens_at:  r.window_opens_at,
        window_closes_at: r.window_closes_at,
        games: {
          total:      parseInt(r.total, 10),
          scheduled:  parseInt(r.scheduled, 10),
          in_window:  parseInt(r.in_window, 10),
          reported:   parseInt(r.reported, 10),
          confirmed:  parseInt(r.confirmed, 10),
          disputed:   parseInt(r.disputed, 10),
          forfeited:  parseInt(r.forfeited, 10),
          postponed:  parseInt(r.postponed, 10),
          voided:     parseInt(r.voided, 10),
        },
      })),
    });
  }
);

// ─────────────────────────────────────── Shift window

router.patch(
  "/games/:gameId/window",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const gameId = req.params.gameId as string;

    const league = await getLeagueOwnerByGameId(gameId);
    if (!league) { notFound(res, "Game not found"); return; }

    if (!can(user, "game:manage", { kind: "league", ownerId: league.ownerId })) {
      forbidden(res, "Only the league owner can adjust game windows"); return;
    }

    const parsed = ShiftWindowBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    const { window_opens_at, window_closes_at, reason } = parsed.data;
    const opens  = new Date(window_opens_at);
    const closes = new Date(window_closes_at);

    if (closes <= opens) {
      badRequest(res, "window_closes_at must be after window_opens_at"); return;
    }

    // Get current game state for before snapshot
    const gameRow = await pool.query<{
      id: string; status: string; week_number: number | null;
      window_opens_at: Date; window_closes_at: Date;
    }>(
      `SELECT id, status, week_number, window_opens_at, window_closes_at FROM game WHERE id = $1`,
      [gameId]
    );
    if (!gameRow.rows[0]) { notFound(res, "Game not found"); return; }
    const game = gameRow.rows[0];

    if (["forfeited", "voided", "confirmed"].includes(game.status)) {
      conflict(res, `Cannot shift window on a ${game.status} game`); return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE game SET window_opens_at = $1, window_closes_at = $2 WHERE id = $3`,
        [opens.toISOString(), closes.toISOString(), gameId]
      );

      await writeAuditLog(client, {
        actorUserId: user.id,
        leagueId: league.leagueId,
        entityType: "game",
        entityId: gameId,
        action: "window_shifted",
        before: {
          window_opens_at:  game.window_opens_at,
          window_closes_at: game.window_closes_at,
        },
        after: { window_opens_at: opens.toISOString(), window_closes_at: closes.toISOString() },
        reason,
      });

      await client.query("COMMIT");
      res.json({ id: gameId, window_opens_at: opens, window_closes_at: closes });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

// ─────────────────────────────────────── Postpone game

router.post(
  "/games/:gameId/postpone",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const gameId = req.params.gameId as string;

    const league = await getLeagueOwnerByGameId(gameId);
    if (!league) { notFound(res, "Game not found"); return; }

    if (!can(user, "game:manage", { kind: "league", ownerId: league.ownerId })) {
      forbidden(res, "Only the league owner can postpone games"); return;
    }

    const parsed = PostponeGameBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    const { reason } = parsed.data;

    const gameRow = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM game WHERE id = $1`,
      [gameId]
    );
    if (!gameRow.rows[0]) { notFound(res, "Game not found"); return; }
    const game = gameRow.rows[0];

    if (["confirmed", "forfeited", "voided", "postponed"].includes(game.status)) {
      conflict(res, `Cannot postpone a ${game.status} game`); return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE game SET status = 'postponed' WHERE id = $1`,
        [gameId]
      );

      await writeAuditLog(client, {
        actorUserId: user.id,
        leagueId: league.leagueId,
        entityType: "game",
        entityId: gameId,
        action: "postponed",
        before: { status: game.status },
        after:  { status: "postponed" },
        reason,
      });

      await client.query("COMMIT");
      res.json({ id: gameId, status: "postponed" });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

// ─────────────────────────────────────── Force-resolve

router.post(
  "/games/:gameId/force-resolve",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const gameId = req.params.gameId as string;

    const league = await getLeagueOwnerByGameId(gameId);
    if (!league) { notFound(res, "Game not found"); return; }

    if (!can(user, "game:manage", { kind: "league", ownerId: league.ownerId })) {
      forbidden(res, "Only the league owner can force-resolve games"); return;
    }

    const parsed = ForceResolveGameBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    const { resolution, reason } = parsed.data;

    const gameRow = await pool.query<{
      id: string; status: string;
      home_team_season_id: string; away_team_season_id: string;
    }>(
      `SELECT id, status, home_team_season_id, away_team_season_id FROM game WHERE id = $1`,
      [gameId]
    );
    if (!gameRow.rows[0]) { notFound(res, "Game not found"); return; }
    const game = gameRow.rows[0];

    if (["confirmed", "voided"].includes(game.status)) {
      conflict(res, `Cannot force-resolve a ${game.status} game`); return;
    }

    const newStatus = resolution === "void" ? "voided" : "forfeited";

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE game SET status = $1 WHERE id = $2`,
        [newStatus, gameId]
      );

      // For forfeits, insert a synthetic game_result so standings compute correctly
      if (resolution !== "void") {
        const homeWins = resolution === "forfeit_home";
        // 1-0 regulation forfeit score (synthetic)
        await client.query(
          `INSERT INTO game_result
             (game_id, home_goals, away_goals, decision, data_source,
              counts_toward_standings, reported_by, verified_by, verified_at)
           VALUES ($1, $2, $3, 'regulation', 'system', TRUE, NULL, NULL, NOW())`,
          [gameId, homeWins ? 1 : 0, homeWins ? 0 : 1]
        );
      }

      await writeAuditLog(client, {
        actorUserId: user.id,
        leagueId: league.leagueId,
        entityType: "game",
        entityId: gameId,
        action: "force_resolved",
        before: { status: game.status },
        after:  { status: newStatus, resolution },
        reason,
      });

      await client.query("COMMIT");
      res.json({ id: gameId, status: newStatus, resolution });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

export default router;
