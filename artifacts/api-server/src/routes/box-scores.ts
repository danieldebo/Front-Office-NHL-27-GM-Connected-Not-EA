/**
 * Box score uploads — CSV or screenshot, landing in a commissioner review
 * queue unless the league has auto-approve on (CSV only; a screenshot always
 * needs a human to confirm the score since there's no OCR service wired up).
 *
 * POST   /games/:gameId/box-score              — GM (or commissioner) uploads
 * GET    /leagues/:leagueId/box-scores/pending  — commissioner review queue
 * POST   /box-scores/:boxScoreId/approve        — commissioner approves
 * POST   /box-scores/:boxScoreId/reject         — commissioner rejects
 * PATCH  /leagues/:leagueId/box-score-settings  — toggle auto-approve
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../server/errors";
import { parseBoxScoreCsv, BoxScoreParseError } from "../server/boxScoreParser";
import {
  UploadBoxScoreBody,
  ApproveBoxScoreBody,
  RejectBoxScoreBody,
  UpdateBoxScoreSettingsBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ────────────────────────────────────────────── helpers

interface GameContext {
  gameId: string;
  leagueId: string;
  status: string;
  leagueOwnerId: string;
  homeGmUserId: string | null;
  awayGmUserId: string | null;
  boxScoreAutoApprove: boolean;
}

async function loadGameContext(gameId: string): Promise<GameContext | null> {
  const { rows } = await pool.query<{
    game_id: string; league_id: string; status: string; league_owner_id: string;
    home_gm_user_id: string | null; away_gm_user_id: string | null;
    box_score_auto_approve: boolean;
  }>(
    `SELECT g.id AS game_id, s.league_id, g.status, l.owner_user_id AS league_owner_id,
            hu.id AS home_gm_user_id, au.id AS away_gm_user_id,
            l.box_score_auto_approve
       FROM game g
       JOIN season s ON s.id = g.season_id
       JOIN league l ON l.id = s.league_id
       LEFT JOIN gm_assignment hga ON hga.team_season_id = g.home_team_season_id AND hga.ended_at IS NULL
       LEFT JOIN app_user hu ON hu.id = hga.user_id
       LEFT JOIN gm_assignment aga ON aga.team_season_id = g.away_team_season_id AND aga.ended_at IS NULL
       LEFT JOIN app_user au ON au.id = aga.user_id
      WHERE g.id = $1`,
    [gameId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    gameId: r.game_id,
    leagueId: r.league_id,
    status: r.status,
    leagueOwnerId: r.league_owner_id,
    homeGmUserId: r.home_gm_user_id,
    awayGmUserId: r.away_gm_user_id,
    boxScoreAutoApprove: r.box_score_auto_approve,
  };
}

async function getLeagueOwnerForBoxScores(leagueId: string): Promise<{ id: string; ownerId: string } | null> {
  const { rows } = await pool.query<{ id: string; owner_user_id: string }>(
    `SELECT id, owner_user_id FROM league WHERE id = $1`,
    [leagueId]
  );
  const r = rows[0];
  return r ? { id: r.id, ownerId: r.owner_user_id } : null;
}

async function appUserIdFor(replitOrDomainId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM app_user WHERE id::text = $1 OR replit_id = $1`,
    [replitOrDomainId]
  );
  return rows[0]?.id ?? null;
}

// Applies an approved score to the game: supersedes any existing active
// result and marks the game confirmed. Shared by the manual-approve endpoint
// and the upload-time auto-approve path.
async function applyApprovedBoxScore(
  client: PoolClient,
  opts: {
    gameId: string;
    homeGoals: number;
    awayGoals: number;
    dataSource: "csv_import" | "manual";
    reviewerAppUserId: string | null;
  }
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM game_result WHERE game_id = $1 AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 1`,
    [opts.gameId]
  );

  const uuidRow = await client.query<{ new_id: string }>(`SELECT gen_random_uuid() AS new_id`);
  const newResultId = uuidRow.rows[0]!.new_id;

  await client.query(
    `INSERT INTO game_result
       (id, game_id, home_goals, away_goals, decision, data_source,
        reported_by, verified_by, verified_at, counts_toward_standings)
     VALUES ($1, $2, $3, $4, 'regulation', $5, $6, $6, NOW(), TRUE)`,
    [newResultId, opts.gameId, opts.homeGoals, opts.awayGoals, opts.dataSource, opts.reviewerAppUserId]
  );

  if (existing.rows[0]) {
    await client.query(
      `UPDATE game_result SET superseded_by = $1, supersede_reason = $2 WHERE id = $3`,
      [newResultId, "Superseded by an approved box score upload", existing.rows[0]!.id]
    );
  }

  await client.query(
    `UPDATE game SET status = 'confirmed', played_at = COALESCE(played_at, NOW()) WHERE id = $1`,
    [opts.gameId]
  );

  return newResultId;
}

function selectColumns(): string {
  return `id, game_id, league_id, kind, status, auto_approved,
          parsed_home_goals, parsed_away_goals, parsed_rows,
          rejection_reason, reviewed_by, reviewed_at,
          resulting_game_result_id, created_at`;
}

// ────────────────────────────────────────────── Upload

router.post(
  "/games/:gameId/box-score",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const gameId = req.params.gameId as string;
    const ctx = await loadGameContext(gameId);
    if (!ctx) { notFound(res, "Game not found"); return; }

    const isGm = can(user, "result:report", {
      kind: "game", homeGmUserId: ctx.homeGmUserId, awayGmUserId: ctx.awayGmUserId,
    });
    const isCommissioner = can(user, "league:write", { kind: "league", ownerId: ctx.leagueOwnerId });
    if (!isGm && !isCommissioner) {
      forbidden(res, "Only the home or away GM, or the commissioner, can upload a box score for this game");
      return;
    }

    if (["voided", "simulated"].includes(ctx.status)) {
      conflict(res, "This game cannot accept a box score"); return;
    }

    const parsed = UploadBoxScoreBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const { kind, raw_payload } = parsed.data;

    let parsedHomeGoals: number | null = null;
    let parsedAwayGoals: number | null = null;
    let parsedRows: unknown[] = [];

    if (kind === "csv") {
      try {
        const result = parseBoxScoreCsv(raw_payload);
        parsedHomeGoals = result.homeGoals;
        parsedAwayGoals = result.awayGoals;
        parsedRows = result.rows;
      } catch (e) {
        if (e instanceof BoxScoreParseError) { badRequest(res, e.message); return; }
        throw e;
      }
    }

    const uploaderAppUserId = await appUserIdFor(user.appUserId ?? user.id);
    const willAutoApprove = kind === "csv" && ctx.boxScoreAutoApprove;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const insertRow = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO box_score_upload
           (game_id, league_id, uploaded_by, kind, raw_payload,
            parsed_home_goals, parsed_away_goals, parsed_rows, status, auto_approved,
            reviewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, created_at`,
        [
          gameId, ctx.leagueId, uploaderAppUserId, kind, raw_payload,
          parsedHomeGoals, parsedAwayGoals, JSON.stringify(parsedRows),
          willAutoApprove ? "approved" : "pending",
          willAutoApprove,
          willAutoApprove ? new Date().toISOString() : null,
        ]
      );
      const uploadId = insertRow.rows[0]!.id;

      let resultingGameResultId: string | null = null;
      if (willAutoApprove) {
        resultingGameResultId = await applyApprovedBoxScore(client, {
          gameId: gameId!,
          homeGoals: parsedHomeGoals!,
          awayGoals: parsedAwayGoals!,
          dataSource: "csv_import",
          reviewerAppUserId: null,
        });
        await client.query(
          `UPDATE box_score_upload SET resulting_game_result_id = $1 WHERE id = $2`,
          [resultingGameResultId, uploadId]
        );
      }

      await client.query("COMMIT");

      const { rows } = await pool.query(`SELECT ${selectColumns()} FROM box_score_upload WHERE id = $1`, [uploadId]);
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

// ────────────────────────────────────────────── Pending queue

router.get(
  "/leagues/:leagueId/box-scores/pending",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwnerForBoxScores(leagueId!);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "boxscore:review", { kind: "league", ownerId: league.ownerId })) {
      forbidden(res, "Only the commissioner can review box score uploads"); return;
    }

    const { rows } = await pool.query(
      `SELECT ${selectColumns()} FROM box_score_upload
        WHERE league_id = $1 AND status = 'pending'
        ORDER BY created_at ASC`,
      [leagueId]
    );

    res.json({ data: rows });
  }
);

// ────────────────────────────────────────────── Approve

router.post(
  "/box-scores/:boxScoreId/approve",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const boxScoreId = req.params.boxScoreId as string;
    const { rows } = await pool.query<{
      id: string; game_id: string; league_id: string; kind: string; status: string;
      parsed_home_goals: number | null; parsed_away_goals: number | null;
      league_owner_id: string;
    }>(
      `SELECT b.id, b.game_id, b.league_id, b.kind, b.status,
              b.parsed_home_goals, b.parsed_away_goals, l.owner_user_id AS league_owner_id
         FROM box_score_upload b
         JOIN league l ON l.id = b.league_id
        WHERE b.id = $1`,
      [boxScoreId]
    );
    const upload = rows[0];
    if (!upload) { notFound(res, "Box score upload not found"); return; }

    if (!can(user, "boxscore:review", { kind: "league", ownerId: upload.league_owner_id })) {
      forbidden(res, "Only the commissioner can approve box score uploads"); return;
    }
    if (upload.status !== "pending") {
      conflict(res, `This upload was already ${upload.status}`); return;
    }

    const parsed = ApproveBoxScoreBody.safeParse(req.body ?? {});
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    const homeGoals = parsed.data.home_goals ?? upload.parsed_home_goals ?? undefined;
    const awayGoals = parsed.data.away_goals ?? upload.parsed_away_goals ?? undefined;
    if (homeGoals === undefined || awayGoals === undefined) {
      badRequest(res, "home_goals and away_goals are required to approve a screenshot upload");
      return;
    }
    if (homeGoals === awayGoals) {
      badRequest(res, "A game cannot end in a tie"); return;
    }

    const reviewerAppUserId = await appUserIdFor(user.appUserId ?? user.id);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const resultingGameResultId = await applyApprovedBoxScore(client, {
        gameId: upload.game_id,
        homeGoals,
        awayGoals,
        dataSource: upload.kind === "csv" ? "csv_import" : "manual",
        reviewerAppUserId,
      });

      await client.query(
        `UPDATE box_score_upload
            SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), resulting_game_result_id = $2
          WHERE id = $3`,
        [reviewerAppUserId, resultingGameResultId, boxScoreId]
      );

      await client.query("COMMIT");

      const { rows: finalRows } = await pool.query(`SELECT ${selectColumns()} FROM box_score_upload WHERE id = $1`, [boxScoreId]);
      res.json(finalRows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

// ────────────────────────────────────────────── Reject

router.post(
  "/box-scores/:boxScoreId/reject",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const boxScoreId = req.params.boxScoreId as string;
    const { rows } = await pool.query<{ id: string; status: string; league_owner_id: string }>(
      `SELECT b.id, b.status, l.owner_user_id AS league_owner_id
         FROM box_score_upload b
         JOIN league l ON l.id = b.league_id
        WHERE b.id = $1`,
      [boxScoreId]
    );
    const upload = rows[0];
    if (!upload) { notFound(res, "Box score upload not found"); return; }

    if (!can(user, "boxscore:review", { kind: "league", ownerId: upload.league_owner_id })) {
      forbidden(res, "Only the commissioner can reject box score uploads"); return;
    }
    if (upload.status !== "pending") {
      conflict(res, `This upload was already ${upload.status}`); return;
    }

    const parsed = RejectBoxScoreBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    const reviewerAppUserId = await appUserIdFor(user.appUserId ?? user.id);

    const { rows: updated } = await pool.query(
      `UPDATE box_score_upload
          SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = NOW()
        WHERE id = $3
        RETURNING ${selectColumns()}`,
      [parsed.data.reason, reviewerAppUserId, boxScoreId]
    );

    res.json(updated[0]);
  }
);

// ────────────────────────────────────────────── Settings

router.patch(
  "/leagues/:leagueId/box-score-settings",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwnerForBoxScores(leagueId!);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "boxscore:review", { kind: "league", ownerId: league.ownerId })) {
      forbidden(res, "Only the commissioner can change box score settings"); return;
    }

    const parsed = UpdateBoxScoreSettingsBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    await pool.query(`UPDATE league SET box_score_auto_approve = $1 WHERE id = $2`, [
      parsed.data.box_score_auto_approve, leagueId,
    ]);

    res.json({ box_score_auto_approve: parsed.data.box_score_auto_approve });
  }
);

export default router;
