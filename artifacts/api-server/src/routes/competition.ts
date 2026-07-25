/**
 * Competition routes — schedule, results, standings.
 *
 * GET  /seasons/:seasonId/standings    — derived standings table
 * GET  /seasons/:seasonId/games        — paginated game list
 * POST /games/:gameId/results          — report a result
 * POST /results/:resultId/confirm      — confirm / dispute
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import {
  notFound,
  unauthorized,
  forbidden,
  conflict,
  badRequest,
} from "../server/errors";
import { idempotencyMiddleware } from "../middlewares/idempotency";
import { rateLimiter } from "../middlewares/rateLimiter";
import {
  ReportResultBody,
  ConfirmResultBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ────────────────────────────────────────────── Standings

router.get(
  "/seasons/:seasonId/standings",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const { seasonId } = req.params;

    const seasonCheck = await pool.query(
      `SELECT id FROM season WHERE id = $1`,
      [seasonId]
    );
    if (!seasonCheck.rows[0]) {
      notFound(res, "Season not found");
      return;
    }

    // Compute standings from confirmed game results
    const { rows } = await pool.query(
      `WITH confirmed_games AS (
         SELECT
           gr.game_id,
           g.home_team_season_id,
           g.away_team_season_id,
           gr.home_goals,
           gr.away_goals,
           gr.decision,
           -- who won?
           CASE
             WHEN gr.home_goals > gr.away_goals THEN 'home'
             ELSE 'away'
           END AS winner
         FROM game_result gr
         JOIN game g ON g.id = gr.game_id
        WHERE g.season_id = $1
          AND gr.counts_toward_standings = TRUE
          AND gr.superseded_by IS NULL
       )
       SELECT
         ts.id              AS team_season_id,
         f.id               AS franchise_id,
         f.name             AS franchise_name,
         f.club_abbrev      AS club_abbrev,
         COUNT(*)           AS "GP",
         COUNT(*) FILTER (WHERE
           (cg.home_team_season_id = ts.id AND cg.winner = 'home') OR
           (cg.away_team_season_id = ts.id AND cg.winner = 'away')
         )                  AS "W",
         COUNT(*) FILTER (WHERE
           (cg.home_team_season_id = ts.id AND cg.winner = 'away' AND cg.decision = 'regulation') OR
           (cg.away_team_season_id = ts.id AND cg.winner = 'home' AND cg.decision = 'regulation')
         )                  AS "L",
         COUNT(*) FILTER (WHERE
           ((cg.home_team_season_id = ts.id AND cg.winner = 'away') OR
            (cg.away_team_season_id = ts.id AND cg.winner = 'home'))
           AND cg.decision IN ('overtime','shootout')
         )                  AS "OTL",
         SUM(
           CASE
             WHEN (cg.home_team_season_id = ts.id AND cg.winner = 'home') OR
                  (cg.away_team_season_id = ts.id AND cg.winner = 'away')
             THEN (SELECT s.points_win FROM season s WHERE s.id = $1)
             WHEN ((cg.home_team_season_id = ts.id AND cg.winner = 'away') OR
                   (cg.away_team_season_id = ts.id AND cg.winner = 'home'))
               AND cg.decision IN ('overtime','shootout')
             THEN (SELECT s.points_ot_loss FROM season s WHERE s.id = $1)
             ELSE (SELECT s.points_reg_loss FROM season s WHERE s.id = $1)
           END
         )                  AS "PTS",
         COUNT(*) FILTER (WHERE
           (cg.home_team_season_id = ts.id AND cg.winner = 'home' AND cg.decision = 'regulation') OR
           (cg.away_team_season_id = ts.id AND cg.winner = 'away' AND cg.decision = 'regulation')
         )                  AS "ROW",
         COALESCE(SUM(
           CASE
             WHEN cg.home_team_season_id = ts.id THEN cg.home_goals
             ELSE cg.away_goals
           END
         ), 0)              AS "GF",
         COALESCE(SUM(
           CASE
             WHEN cg.home_team_season_id = ts.id THEN cg.away_goals
             ELSE cg.home_goals
           END
         ), 0)              AS "GA"
       FROM team_season ts
       JOIN franchise f ON f.id = ts.franchise_id
       LEFT JOIN confirmed_games cg ON
         cg.home_team_season_id = ts.id OR cg.away_team_season_id = ts.id
      WHERE ts.season_id = $1
      GROUP BY ts.id, f.id, f.name, f.club_abbrev
      ORDER BY "PTS" DESC, "ROW" DESC, "GF" DESC`,
      [seasonId]
    );

    // Count unconfirmed games per team
    const unconfirmedRows = await pool.query<{
      team_season_id: string;
      unconfirmed: string;
    }>(
      `SELECT
         hts.id AS team_season_id,
         COUNT(*) AS unconfirmed
         FROM game g
         JOIN team_season hts ON hts.id = g.home_team_season_id
        WHERE g.season_id = $1
          AND g.status IN ('reported','disputed')
      GROUP BY hts.id
      UNION ALL
      SELECT
         ats.id AS team_season_id,
         COUNT(*) AS unconfirmed
         FROM game g
         JOIN team_season ats ON ats.id = g.away_team_season_id
        WHERE g.season_id = $1
          AND g.status IN ('reported','disputed')
      GROUP BY ats.id`,
      [seasonId]
    );

    const unconfirmedMap = new Map<string, number>();
    for (const r of unconfirmedRows.rows) {
      const current = unconfirmedMap.get(r.team_season_id) ?? 0;
      unconfirmedMap.set(r.team_season_id, current + parseInt(r.unconfirmed, 10));
    }

    const data = rows.map((r, i) => ({
      rank: i + 1,
      team_season_id: r.team_season_id as string,
      franchise_id: r.franchise_id as string,
      franchise_name: r.franchise_name as string | null,
      club_abbrev: r.club_abbrev as string | null,
      gm_display_name: null,
      GP: parseInt(r.GP as string, 10),
      W: parseInt(r.W as string, 10),
      L: parseInt(r.L as string, 10),
      OTL: parseInt(r.OTL as string, 10),
      PTS: parseInt(r.PTS as string, 10),
      ROW: parseInt(r.ROW as string, 10),
      GF: parseInt(r.GF as string, 10),
      GA: parseInt(r.GA as string, 10),
      DIFF: parseInt(r.GF as string, 10) - parseInt(r.GA as string, 10),
      unconfirmed_games: unconfirmedMap.get(r.team_season_id as string) ?? 0,
    }));

    res.json({ computed_at: new Date().toISOString(), data });
  }
);

// ────────────────────────────────────────────── Games list

router.get(
  "/seasons/:seasonId/games",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const { seasonId } = req.params;
    const { status, week, franchise_id, limit = "50", cursor } = req.query as Record<string, string>;

    const seasonCheck = await pool.query(`SELECT id FROM season WHERE id = $1`, [seasonId]);
    if (!seasonCheck.rows[0]) {
      notFound(res, "Season not found");
      return;
    }

    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const params: unknown[] = [seasonId];
    const conditions: string[] = [];

    if (status) {
      params.push(status);
      conditions.push(`g.status = $${params.length}`);
    }
    if (week) {
      params.push(parseInt(week, 10));
      conditions.push(`g.week_number = $${params.length}`);
    }
    if (franchise_id) {
      params.push(franchise_id);
      conditions.push(
        `(hf.id = $${params.length} OR af.id = $${params.length})`
      );
    }
    if (cursor) {
      params.push(cursor);
      conditions.push(`g.id > $${params.length}`);
    }

    const whereClause =
      conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

    params.push(parsedLimit + 1);

    const { rows } = await pool.query(
      `SELECT
         g.id, g.season_id, g.week_number, g.status,
         g.window_opens_at, g.window_closes_at, g.played_at,
         hts.id  AS home_team_season_id, hf.id  AS home_franchise_id,
         hf.name AS home_franchise_name,  hf.club_abbrev AS home_club_abbrev,
         ats.id  AS away_team_season_id, af.id  AS away_franchise_id,
         af.name AS away_franchise_name,  af.club_abbrev AS away_club_abbrev,
         gr.id   AS result_id,
         gr.home_goals, gr.away_goals, gr.decision,
         gr.version, gr.data_source, gr.counts_toward_standings,
         gr.reported_by, gr.verified_by, gr.verified_at,
         gr.superseded_by, gr.supersede_reason, gr.created_at AS result_created_at
       FROM game g
       JOIN team_season hts ON hts.id = g.home_team_season_id
       JOIN franchise hf ON hf.id = hts.franchise_id
       JOIN team_season ats ON ats.id = g.away_team_season_id
       JOIN franchise af ON af.id = ats.franchise_id
       LEFT JOIN game_result gr ON gr.game_id = g.id AND gr.superseded_by IS NULL
      WHERE g.season_id = $1 ${whereClause}
      ORDER BY g.id ASC
      LIMIT $${params.length}`,
      params
    );

    const hasMore = rows.length > parsedLimit;
    const data = (hasMore ? rows.slice(0, -1) : rows).map((r) => ({
      id: r.id,
      season_id: r.season_id,
      week_number: r.week_number,
      status: r.status,
      window_opens_at: r.window_opens_at,
      window_closes_at: r.window_closes_at,
      played_at: r.played_at ?? null,
      home: {
        team_season_id: r.home_team_season_id,
        franchise_id: r.home_franchise_id,
        franchise_name: r.home_franchise_name,
        club_abbrev: r.home_club_abbrev,
        goals: r.home_goals ?? null,
        gm_display_name: null,
      },
      away: {
        team_season_id: r.away_team_season_id,
        franchise_id: r.away_franchise_id,
        franchise_name: r.away_franchise_name,
        club_abbrev: r.away_club_abbrev,
        goals: r.away_goals ?? null,
        gm_display_name: null,
      },
      result: r.result_id
        ? {
            id: r.result_id,
            game_id: r.id,
            home_goals: r.home_goals,
            away_goals: r.away_goals,
            decision: r.decision,
            version: r.version,
            data_source: r.data_source,
            counts_toward_standings: r.counts_toward_standings,
            reported_by: r.reported_by ?? null,
            verified_by: r.verified_by ?? null,
            verified_at: r.verified_at ?? null,
            superseded_by: r.superseded_by ?? null,
            supersede_reason: r.supersede_reason ?? null,
            created_at: r.result_created_at,
          }
        : null,
    }));

    res.json({
      data,
      has_more: hasMore,
      next_cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    });
  }
);

// ────────────────────────────────────────────── Report result

router.post(
  "/games/:gameId/results",
  idempotencyMiddleware,
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) {
      unauthorized(res, "Authentication required");
      return;
    }

    const { gameId } = req.params;

    // Load game with GM user IDs
    const gameRow = await pool.query<{
      id: string;
      status: string;
      home_gm_user_id: string | null;
      away_gm_user_id: string | null;
    }>(
      `SELECT g.id, g.status,
              hu.replit_id AS home_gm_user_id,
              au.replit_id AS away_gm_user_id
         FROM game g
         JOIN team_season hts ON hts.id = g.home_team_season_id
         JOIN franchise hf ON hf.id = hts.franchise_id
         LEFT JOIN gm_assignment hga ON hga.franchise_id = hf.id AND hga.is_active = TRUE
         LEFT JOIN app_user hu ON hu.id = hga.user_id
         JOIN team_season ats ON ats.id = g.away_team_season_id
         JOIN franchise af ON af.id = ats.franchise_id
         LEFT JOIN gm_assignment aga ON aga.franchise_id = af.id AND aga.is_active = TRUE
         LEFT JOIN app_user au ON au.id = aga.user_id
        WHERE g.id = $1`,
      [gameId]
    );

    if (!gameRow.rows[0]) {
      notFound(res, "Game not found");
      return;
    }

    const game = gameRow.rows[0];

    if (
      !can(user, "result:report", {
        kind: "game",
        homeGmUserId: game.home_gm_user_id,
        awayGmUserId: game.away_gm_user_id,
      })
    ) {
      forbidden(res, "Only the home or away GM can report a result for this game");
      return;
    }

    if (["voided", "simulated"].includes(game.status)) {
      conflict(res, "This game cannot accept results");
      return;
    }

    const parsed = ReportResultBody.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, "Invalid request body");
      return;
    }

    const { home_goals, away_goals, decision, supersede_result_id, supersede_reason } =
      parsed.data;

    // Find the reporter's app_user.id
    const reporterRow = await pool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE replit_id = $1`,
      [user.id]
    );
    const reporterAppUserId = reporterRow.rows[0]?.id ?? null;

    // If superseding, verify the previous result exists
    if (supersede_result_id) {
      const prevRow = await pool.query(
        `SELECT id FROM game_result WHERE id = $1 AND game_id = $2`,
        [supersede_result_id, gameId]
      );
      if (!prevRow.rows[0]) {
        badRequest(res, "supersede_result_id does not match a result for this game");
        return;
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Supersede existing active result
      if (supersede_result_id) {
        await client.query(
          `UPDATE game_result
              SET superseded_by = gen_random_uuid(),
                  supersede_reason = $1
            WHERE id = $2`,
          [supersede_reason ?? "Corrected by GM", supersede_result_id]
        );
      }

      const insertRow = await client.query<{ id: string; version: number; created_at: Date }>(
        `INSERT INTO game_result
           (game_id, home_goals, away_goals, decision, data_source, reported_by, counts_toward_standings)
         VALUES ($1, $2, $3, $4, 'manual', $5, FALSE)
         RETURNING id, version, created_at`,
        [gameId, home_goals, away_goals, decision, reporterAppUserId]
      );

      // Update game status
      await client.query(
        `UPDATE game SET status = 'reported', played_at = NOW() WHERE id = $1`,
        [gameId]
      );

      await client.query("COMMIT");

      const result = insertRow.rows[0]!;
      res.status(201).json({
        id: result.id,
        game_id: gameId,
        home_goals,
        away_goals,
        decision,
        version: result.version,
        data_source: "manual",
        counts_toward_standings: false,
        reported_by: reporterAppUserId,
        verified_by: null,
        verified_at: null,
        superseded_by: null,
        supersede_reason: null,
        created_at: result.created_at,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

// ────────────────────────────────────────────── Confirm result

router.post(
  "/results/:resultId/confirm",
  idempotencyMiddleware,
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) {
      unauthorized(res, "Authentication required");
      return;
    }

    const { resultId } = req.params;
    const ifMatch = req.headers["if-match"];

    const resultRow = await pool.query<{
      id: string;
      game_id: string;
      home_goals: number;
      away_goals: number;
      decision: string;
      version: number;
      data_source: string;
      reported_by: string | null;
      created_at: Date;
      home_gm_user_id: string | null;
      away_gm_user_id: string | null;
    }>(
      `SELECT gr.id, gr.game_id, gr.home_goals, gr.away_goals, gr.decision,
              gr.version, gr.data_source, gr.reported_by, gr.created_at,
              hu.replit_id AS home_gm_user_id,
              au.replit_id AS away_gm_user_id
         FROM game_result gr
         JOIN game g ON g.id = gr.game_id
         JOIN team_season hts ON hts.id = g.home_team_season_id
         JOIN franchise hf ON hf.id = hts.franchise_id
         LEFT JOIN gm_assignment hga ON hga.franchise_id = hf.id AND hga.is_active = TRUE
         LEFT JOIN app_user hu ON hu.id = hga.user_id
         JOIN team_season ats ON ats.id = g.away_team_season_id
         JOIN franchise af ON af.id = ats.franchise_id
         LEFT JOIN gm_assignment aga ON aga.franchise_id = af.id AND aga.is_active = TRUE
         LEFT JOIN app_user au ON au.id = aga.user_id
        WHERE gr.id = $1 AND gr.superseded_by IS NULL`,
      [resultId]
    );

    if (!resultRow.rows[0]) {
      notFound(res, "Result not found");
      return;
    }

    const result = resultRow.rows[0];

    // Optimistic concurrency check
    if (ifMatch && ifMatch !== String(result.version)) {
      conflict(res, "Version mismatch — re-read the result and retry");
      return;
    }

    // Get reporter's replit_id for self-confirmation check
    const reporterRow = await pool.query<{ replit_id: string }>(
      `SELECT replit_id FROM app_user WHERE id = $1`,
      [result.reported_by]
    );
    const reporterReplitId = reporterRow.rows[0]?.replit_id ?? null;

    if (
      !can(user, "result:confirm", {
        kind: "result",
        reportedByUserId: reporterReplitId,
        gameHomeGmUserId: result.home_gm_user_id,
        gameAwayGmUserId: result.away_gm_user_id,
      })
    ) {
      forbidden(
        res,
        user.id === reporterReplitId
          ? "You cannot confirm your own reported result"
          : "Only a GM from this game can confirm the result"
      );
      return;
    }

    const parsed = ConfirmResultBody.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, "Invalid request body");
      return;
    }

    const { agree, dispute_reason } = parsed.data;

    const verifierRow = await pool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE replit_id = $1`,
      [user.id]
    );
    const verifierAppUserId = verifierRow.rows[0]?.id ?? null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE game_result
            SET verified_by = $1,
                verified_at = NOW(),
                counts_toward_standings = $2,
                version = version + 1
          WHERE id = $3 AND version = $4`,
        [verifierAppUserId, agree, resultId, result.version]
      );

      // Update game status
      const newStatus = agree ? "confirmed" : "disputed";
      await client.query(
        `UPDATE game SET status = $1 WHERE id = $2`,
        [newStatus, result.game_id]
      );

      await client.query("COMMIT");

      res.json({
        id: resultId,
        game_id: result.game_id,
        home_goals: result.home_goals,
        away_goals: result.away_goals,
        decision: result.decision,
        version: result.version + 1,
        data_source: result.data_source,
        counts_toward_standings: agree,
        reported_by: result.reported_by ?? null,
        verified_by: verifierAppUserId,
        verified_at: new Date().toISOString(),
        superseded_by: null,
        supersede_reason: dispute_reason ?? null,
        created_at: result.created_at,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

export default router;
