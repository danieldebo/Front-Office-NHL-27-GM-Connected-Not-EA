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
import { ReportResultBody, ConfirmResultBody, ListGamesParams, ListGamesQueryParams } from "@workspace/api-zod";
import { canonicalGmIdentity } from "../server/core/playerIdentity";
import { publishDomainEvent } from "../server/notifications/domainEvents";
import { requireGameRead, requireSeasonRead } from "../server/leagueAccess";

const router: IRouter = Router();

// ────────────────────────────────────────────── Standings

router.get(
  "/seasons/:seasonId/standings",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const seasonId = String(req.params.seasonId);
    if (!await requireSeasonRead(req, res, seasonId)) return;

    // Use the v_standings view which is already correct
    const { rows } = await pool.query(
      `SELECT
         ts.id              AS team_season_id,
         f.id               AS franchise_id,
         f.name             AS franchise_name,
         nc.abbrev          AS club_abbrev,
         u.display_name     AS gm_display_name,
         to_jsonb(u)->>'primary_identity' AS gm_primary_identity,
         to_jsonb(u)->>'xbox_gamertag'    AS gm_xbox_gamertag,
         to_jsonb(u)->>'psn_online_id'    AS gm_psn_online_id,
         to_jsonb(u)->>'xbox_identity_verified_at' AS gm_xbox_identity_verified_at,
         to_jsonb(u)->>'playstation_identity_verified_at' AS gm_playstation_identity_verified_at,
         u.platform::text   AS gm_legacy_platform,
         u.platform_gamertag AS gm_legacy_gamertag,
         COALESCE(vs.gp, 0)   AS "GP",
         COALESCE(vs.w, 0)    AS "W",
         COALESCE(vs.l, 0)    AS "L",
         COALESCE(vs.otl, 0)  AS "OTL",
         COALESCE(vs.row_wins, 0) AS "ROW",
         COALESCE(vs.gf, 0)   AS "GF",
         COALESCE(vs.ga, 0)   AS "GA",
         COALESCE(vs.gf, 0) - COALESCE(vs.ga, 0) AS "DIFF",
         COALESCE(vs.points, 0) AS "PTS"
       FROM team_season ts
       JOIN franchise f ON f.id = ts.franchise_id
       LEFT JOIN nhl_club nc ON nc.id = ts.nhl_club_id
       LEFT JOIN v_standings vs ON vs.team_season_id = ts.id
        LEFT JOIN gm_assignment ga ON ga.team_season_id = ts.id AND ga.ended_at IS NULL
        LEFT JOIN app_user u ON u.id = ga.user_id
      WHERE ts.season_id = $1
      ORDER BY "PTS" DESC, "ROW" DESC, "GF" DESC`,
      [seasonId]
    );

    // Per-team provenance: unconfirmed count + worst data_source chip
    const provenanceRows = await pool.query<{
      team_season_id: string;
      unconfirmed: string;
      provenance: string;
    }>(
      `SELECT
         team_season_id,
         COUNT(*) FILTER (WHERE status IN ('reported','disputed')) AS unconfirmed,
         CASE
           WHEN BOOL_OR(status = 'disputed')                        THEN 'dispute'
           WHEN COUNT(*) FILTER (WHERE status = 'reported') > 0     THEN 'manual'
           WHEN MAX(src_rank) >= 4                                   THEN 'reconciled'
           WHEN MAX(src_rank) = 3                                    THEN 'ocr'
           ELSE 'confirmed'
         END AS provenance
       FROM (
         SELECT g.home_team_season_id AS team_season_id, g.status,
           CASE gr.data_source
             WHEN 'partner_api' THEN 4 WHEN 'csv_import' THEN 4 WHEN 'system' THEN 4
             WHEN 'ocr' THEN 3 ELSE 1
           END AS src_rank
         FROM game g
         LEFT JOIN game_result gr ON gr.game_id = g.id AND gr.superseded_by IS NULL
         WHERE g.season_id = $1 AND g.status NOT IN ('voided','simulated')
         UNION ALL
         SELECT g.away_team_season_id, g.status,
           CASE gr.data_source
             WHEN 'partner_api' THEN 4 WHEN 'csv_import' THEN 4 WHEN 'system' THEN 4
             WHEN 'ocr' THEN 3 ELSE 1
           END
         FROM game g
         LEFT JOIN game_result gr ON gr.game_id = g.id AND gr.superseded_by IS NULL
         WHERE g.season_id = $1 AND g.status NOT IN ('voided','simulated')
       ) sub
       GROUP BY team_season_id`,
      [seasonId]
    );

    const provenanceMap = new Map<string, { unconfirmed: number; provenance: string }>();
    for (const r of provenanceRows.rows) {
      provenanceMap.set(r.team_season_id, {
        unconfirmed: parseInt(r.unconfirmed, 10),
        provenance: r.provenance,
      });
    }

    const data = rows.map((r, i) => {
      const prov = provenanceMap.get(r.team_season_id as string) ??
        { unconfirmed: 0, provenance: "confirmed" };
      return {
        rank: i + 1,
        team_season_id: r.team_season_id as string,
        franchise_id: r.franchise_id as string,
        franchise_name: r.franchise_name as string | null,
        club_abbrev: r.club_abbrev as string | null,
        ...canonicalGmIdentity(r),
        GP: r.GP as number,
        W: r.W as number,
        L: r.L as number,
        OTL: r.OTL as number,
        PTS: r.PTS as number,
        ROW: r.ROW as number,
        GF: r.GF as number,
        GA: r.GA as number,
        DIFF: r.DIFF as number,
        unconfirmed_games: prov.unconfirmed,
        provenance: prov.provenance,
      };
    });

    res.json({ computed_at: new Date().toISOString(), data });
  }
);

// ────────────────────────────────────────────── Games list

router.get(
  "/seasons/:seasonId/games",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const paramsInput = ListGamesParams.safeParse(req.params);
    const query = ListGamesQueryParams.safeParse(req.query);
    if (!paramsInput.success || !query.success) {
      badRequest(res, "Invalid path or query parameters");
      return;
    }
    const seasonId = paramsInput.data.seasonId;
    const { status, week, franchise_id, limit, cursor } = query.data;

    if (!await requireSeasonRead(req, res, seasonId)) return;

    const parsedLimit = limit;
    const params: unknown[] = [seasonId];
    const conditions: string[] = [];

    if (status) { params.push(status); conditions.push(`g.status = $${params.length}`); }
    if (week !== undefined) { params.push(week); conditions.push(`g.week_number = $${params.length}`); }
    if (franchise_id) {
      params.push(franchise_id);
      conditions.push(`(hf.id = $${params.length} OR af.id = $${params.length})`);
    }
    if (cursor) { params.push(cursor); conditions.push(`g.id > $${params.length}`); }

    const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
    params.push(parsedLimit + 1);

    const { rows } = await pool.query(
      `SELECT
         g.id, g.season_id, g.week_number, g.status,
         g.window_opens_at, g.window_closes_at, g.played_at,
         g.home_team_season_id,
         hf.id  AS home_franchise_id, hf.name AS home_franchise_name,
         hn.abbrev AS home_club_abbrev,
         hu.display_name AS home_gm_display_name, to_jsonb(hu)->>'primary_identity' AS home_gm_primary_identity,
         to_jsonb(hu)->>'xbox_gamertag' AS home_gm_xbox_gamertag, to_jsonb(hu)->>'psn_online_id' AS home_gm_psn_online_id,
         to_jsonb(hu)->>'xbox_identity_verified_at' AS home_gm_xbox_identity_verified_at,
         to_jsonb(hu)->>'playstation_identity_verified_at' AS home_gm_playstation_identity_verified_at,
         hu.platform::text AS home_gm_legacy_platform, hu.platform_gamertag AS home_gm_legacy_gamertag,
         g.away_team_season_id,
         af.id  AS away_franchise_id, af.name AS away_franchise_name,
         an.abbrev AS away_club_abbrev,
         au.display_name AS away_gm_display_name, to_jsonb(au)->>'primary_identity' AS away_gm_primary_identity,
         to_jsonb(au)->>'xbox_gamertag' AS away_gm_xbox_gamertag, to_jsonb(au)->>'psn_online_id' AS away_gm_psn_online_id,
         to_jsonb(au)->>'xbox_identity_verified_at' AS away_gm_xbox_identity_verified_at,
         to_jsonb(au)->>'playstation_identity_verified_at' AS away_gm_playstation_identity_verified_at,
         au.platform::text AS away_gm_legacy_platform, au.platform_gamertag AS away_gm_legacy_gamertag,
         gr.id   AS result_id,
         gr.home_goals, gr.away_goals, gr.decision,
         gr.version, gr.data_source, gr.counts_toward_standings,
         gr.reported_by, gr.verified_by, gr.verified_at,
         gr.superseded_by, gr.supersede_reason, gr.created_at AS result_created_at
       FROM game g
       JOIN team_season hts ON hts.id = g.home_team_season_id
       JOIN franchise hf ON hf.id = hts.franchise_id
       LEFT JOIN nhl_club hn ON hn.id = hts.nhl_club_id
        LEFT JOIN gm_assignment hga ON hga.team_season_id = hts.id AND hga.ended_at IS NULL
        LEFT JOIN app_user hu ON hu.id = hga.user_id
       JOIN team_season ats ON ats.id = g.away_team_season_id
       JOIN franchise af ON af.id = ats.franchise_id
       LEFT JOIN nhl_club an ON an.id = ats.nhl_club_id
        LEFT JOIN gm_assignment aga ON aga.team_season_id = ats.id AND aga.ended_at IS NULL
        LEFT JOIN app_user au ON au.id = aga.user_id
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
        club_abbrev: r.home_club_abbrev ?? null,
        goals: r.home_goals ?? null,
        ...canonicalGmIdentity({
          gm_display_name: r.home_gm_display_name, gm_primary_identity: r.home_gm_primary_identity,
          gm_xbox_gamertag: r.home_gm_xbox_gamertag, gm_psn_online_id: r.home_gm_psn_online_id,
          gm_xbox_identity_verified_at: r.home_gm_xbox_identity_verified_at,
          gm_playstation_identity_verified_at: r.home_gm_playstation_identity_verified_at,
          gm_legacy_platform: r.home_gm_legacy_platform, gm_legacy_gamertag: r.home_gm_legacy_gamertag,
        }),
      },
      away: {
        team_season_id: r.away_team_season_id,
        franchise_id: r.away_franchise_id,
        franchise_name: r.away_franchise_name,
        club_abbrev: r.away_club_abbrev ?? null,
        goals: r.away_goals ?? null,
        ...canonicalGmIdentity({
          gm_display_name: r.away_gm_display_name, gm_primary_identity: r.away_gm_primary_identity,
          gm_xbox_gamertag: r.away_gm_xbox_gamertag, gm_psn_online_id: r.away_gm_psn_online_id,
          gm_xbox_identity_verified_at: r.away_gm_xbox_identity_verified_at,
          gm_playstation_identity_verified_at: r.away_gm_playstation_identity_verified_at,
          gm_legacy_platform: r.away_gm_legacy_platform, gm_legacy_gamertag: r.away_gm_legacy_gamertag,
        }),
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
      next_cursor: hasMore ? (data[data.length - 1]?.id ?? null) : null,
    });
  }
);

// ────────────────────────────────────────────── Single game

router.get(
  "/games/:gameId",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const gameId = String(req.params.gameId);
    if (!await requireGameRead(req, res, gameId)) return;

    const { rows } = await pool.query(
      `SELECT
         g.id, g.season_id, g.week_number, g.status,
         g.window_opens_at, g.window_closes_at, g.played_at,
         g.home_team_season_id,
         hf.id  AS home_franchise_id, hf.name AS home_franchise_name,
         hn.abbrev AS home_club_abbrev,
         hu.display_name AS home_gm_display_name, to_jsonb(hu)->>'primary_identity' AS home_gm_primary_identity,
         to_jsonb(hu)->>'xbox_gamertag' AS home_gm_xbox_gamertag, to_jsonb(hu)->>'psn_online_id' AS home_gm_psn_online_id,
         to_jsonb(hu)->>'xbox_identity_verified_at' AS home_gm_xbox_identity_verified_at,
         to_jsonb(hu)->>'playstation_identity_verified_at' AS home_gm_playstation_identity_verified_at,
         hu.platform::text AS home_gm_legacy_platform, hu.platform_gamertag AS home_gm_legacy_gamertag,
         g.away_team_season_id,
         af.id  AS away_franchise_id, af.name AS away_franchise_name,
         an.abbrev AS away_club_abbrev,
         au.display_name AS away_gm_display_name, to_jsonb(au)->>'primary_identity' AS away_gm_primary_identity,
         to_jsonb(au)->>'xbox_gamertag' AS away_gm_xbox_gamertag, to_jsonb(au)->>'psn_online_id' AS away_gm_psn_online_id,
         to_jsonb(au)->>'xbox_identity_verified_at' AS away_gm_xbox_identity_verified_at,
         to_jsonb(au)->>'playstation_identity_verified_at' AS away_gm_playstation_identity_verified_at,
         au.platform::text AS away_gm_legacy_platform, au.platform_gamertag AS away_gm_legacy_gamertag,
         gr.id   AS result_id,
         gr.home_goals, gr.away_goals, gr.decision,
         gr.version, gr.data_source, gr.counts_toward_standings,
         gr.reported_by, gr.verified_by, gr.verified_at,
         gr.superseded_by, gr.supersede_reason, gr.created_at AS result_created_at
       FROM game g
       JOIN team_season hts ON hts.id = g.home_team_season_id
       JOIN franchise hf ON hf.id = hts.franchise_id
       LEFT JOIN nhl_club hn ON hn.id = hts.nhl_club_id
        LEFT JOIN gm_assignment hga ON hga.team_season_id = hts.id AND hga.ended_at IS NULL
        LEFT JOIN app_user hu ON hu.id = hga.user_id
       JOIN team_season ats ON ats.id = g.away_team_season_id
       JOIN franchise af ON af.id = ats.franchise_id
       LEFT JOIN nhl_club an ON an.id = ats.nhl_club_id
        LEFT JOIN gm_assignment aga ON aga.team_season_id = ats.id AND aga.ended_at IS NULL
        LEFT JOIN app_user au ON au.id = aga.user_id
       LEFT JOIN game_result gr ON gr.game_id = g.id AND gr.superseded_by IS NULL
      WHERE g.id = $1`,
      [gameId]
    );

    if (!rows[0]) { notFound(res, "Game not found"); return; }

    const r = rows[0];
    res.json({
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
        club_abbrev: r.home_club_abbrev ?? null,
        goals: r.home_goals ?? null,
        ...canonicalGmIdentity({
          gm_display_name: r.home_gm_display_name, gm_primary_identity: r.home_gm_primary_identity,
          gm_xbox_gamertag: r.home_gm_xbox_gamertag, gm_psn_online_id: r.home_gm_psn_online_id,
          gm_xbox_identity_verified_at: r.home_gm_xbox_identity_verified_at,
          gm_playstation_identity_verified_at: r.home_gm_playstation_identity_verified_at,
          gm_legacy_platform: r.home_gm_legacy_platform, gm_legacy_gamertag: r.home_gm_legacy_gamertag,
        }),
      },
      away: {
        team_season_id: r.away_team_season_id,
        franchise_id: r.away_franchise_id,
        franchise_name: r.away_franchise_name,
        club_abbrev: r.away_club_abbrev ?? null,
        goals: r.away_goals ?? null,
        ...canonicalGmIdentity({
          gm_display_name: r.away_gm_display_name, gm_primary_identity: r.away_gm_primary_identity,
          gm_xbox_gamertag: r.away_gm_xbox_gamertag, gm_psn_online_id: r.away_gm_psn_online_id,
          gm_xbox_identity_verified_at: r.away_gm_xbox_identity_verified_at,
          gm_playstation_identity_verified_at: r.away_gm_playstation_identity_verified_at,
          gm_legacy_platform: r.away_gm_legacy_platform, gm_legacy_gamertag: r.away_gm_legacy_gamertag,
        }),
      },
      result: r.result_id ? {
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
      } : null,
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
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const { gameId } = req.params;

    // Load game — get home/away GM replit_ids via team_season → gm_assignment → app_user
    const gameRow = await pool.query<{
      id: string;
      status: string;
      home_gm_user_id: string | null;
      away_gm_user_id: string | null;
      home_gm_app_user_id: string | null;
      away_gm_app_user_id: string | null;
      league_id: string;
    }>(
      `SELECT g.id, g.status,
              hu.replit_id AS home_gm_user_id,
              au.replit_id AS away_gm_user_id,
              hu.id AS home_gm_app_user_id,
              au.id AS away_gm_app_user_id,
              s.league_id
         FROM game g
         JOIN season s ON s.id = g.season_id
         LEFT JOIN gm_assignment hga ON hga.team_season_id = g.home_team_season_id AND hga.ended_at IS NULL
         LEFT JOIN app_user hu ON hu.id = hga.user_id
         LEFT JOIN gm_assignment aga ON aga.team_season_id = g.away_team_season_id AND aga.ended_at IS NULL
         LEFT JOIN app_user au ON au.id = aga.user_id
        WHERE g.id = $1`,
      [gameId]
    );

    if (!gameRow.rows[0]) { notFound(res, "Game not found"); return; }

    const game = gameRow.rows[0];

    if (!can(user, "result:report", {
      kind: "game",
      homeGmUserId: game.home_gm_user_id,
      awayGmUserId: game.away_gm_user_id,
    })) {
      forbidden(res, "Only the home or away GM can report a result for this game");
      return;
    }

    if (["voided", "simulated"].includes(game.status)) {
      conflict(res, "This game cannot accept results");
      return;
    }

    const parsed = ReportResultBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, "Invalid request body"); return; }

    const { home_goals, away_goals, decision, supersede_result_id, supersede_reason } = parsed.data;

    const reporterRow = await pool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE replit_id = $1`,
      [user.id]
    );
    const reporterAppUserId = reporterRow.rows[0]?.id ?? null;

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

      // Pre-generate the new result ID so we can point superseded_by at it
      // (FK must reference an existing row; we INSERT first, then UPDATE the old row)
      const uuidRow = await client.query<{ new_id: string }>(`SELECT gen_random_uuid() AS new_id`);
      const newResultId = uuidRow.rows[0]!.new_id;

      const insertRow = await client.query<{ id: string; version: number; created_at: Date }>(
        `INSERT INTO game_result
           (id, game_id, home_goals, away_goals, decision, data_source, reported_by, counts_toward_standings)
         VALUES ($1, $2, $3, $4, $5, 'manual', $6, FALSE)
         RETURNING id, version, created_at`,
        [newResultId, gameId, home_goals, away_goals, decision, reporterAppUserId]
      );

      if (supersede_result_id) {
        await client.query(
          `UPDATE game_result SET superseded_by = $1, supersede_reason = $2 WHERE id = $3`,
          [newResultId, supersede_reason ?? "Corrected by GM", supersede_result_id]
        );
      }

      await client.query(
        `UPDATE game SET status = 'reported', played_at = NOW() WHERE id = $1`,
        [gameId]
      );

      await publishDomainEvent(client, {
        eventType: "result.reported",
        leagueId: game.league_id,
        actorUserId: reporterAppUserId,
        audienceUserIds: [game.home_gm_app_user_id, game.away_gm_app_user_id]
          .filter((id): id is string => !!id),
        title: "Game result reported",
        body: `Reported score: ${home_goals}-${away_goals}. Confirmation is still required.`,
        data: { game_id: gameId, result_id: newResultId },
      });

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
    if (!user) { unauthorized(res, "Authentication required"); return; }

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
      home_gm_app_user_id: string | null;
      away_gm_app_user_id: string | null;
      league_id: string;
    }>(
      `SELECT gr.id, gr.game_id, gr.home_goals, gr.away_goals, gr.decision,
              gr.version, gr.data_source, gr.reported_by, gr.created_at,
              hu.replit_id AS home_gm_user_id,
               au.replit_id AS away_gm_user_id,
               hu.id AS home_gm_app_user_id, au.id AS away_gm_app_user_id,
               s.league_id
         FROM game_result gr
         JOIN game g ON g.id = gr.game_id
          JOIN season s ON s.id = g.season_id
         LEFT JOIN gm_assignment hga ON hga.team_season_id = g.home_team_season_id AND hga.ended_at IS NULL
         LEFT JOIN app_user hu ON hu.id = hga.user_id
         LEFT JOIN gm_assignment aga ON aga.team_season_id = g.away_team_season_id AND aga.ended_at IS NULL
         LEFT JOIN app_user au ON au.id = aga.user_id
        WHERE gr.id = $1 AND gr.superseded_by IS NULL`,
      [resultId]
    );

    if (!resultRow.rows[0]) { notFound(res, "Result not found"); return; }

    const result = resultRow.rows[0];

    if (ifMatch && ifMatch !== String(result.version)) {
      conflict(res, "Version mismatch — re-read the result and retry");
      return;
    }

    const reporterRow = await pool.query<{ replit_id: string }>(
      `SELECT replit_id FROM app_user WHERE id = $1`,
      [result.reported_by]
    );
    const reporterReplitId = reporterRow.rows[0]?.replit_id ?? null;

    if (!can(user, "result:confirm", {
      kind: "result",
      reportedByUserId: reporterReplitId,
      gameHomeGmUserId: result.home_gm_user_id,
      gameAwayGmUserId: result.away_gm_user_id,
    })) {
      forbidden(res,
        user.id === reporterReplitId
          ? "You cannot confirm your own reported result"
          : "Only a GM from this game can confirm the result"
      );
      return;
    }

    const parsed = ConfirmResultBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, "Invalid request body"); return; }

    const { agree, dispute_reason } = parsed.data;

    const verifierRow = await pool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE replit_id = $1`,
      [user.id]
    );
    const verifierAppUserId = verifierRow.rows[0]?.id ?? null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const confirmation = await client.query(
        `UPDATE game_result
            SET verified_by = $1, verified_at = NOW(),
                counts_toward_standings = $2, version = version + 1
          WHERE id = $3 AND version = $4
          RETURNING id`,
        [verifierAppUserId, agree, resultId, result.version]
      );
      if (confirmation.rowCount !== 1) {
        await client.query("ROLLBACK");
        conflict(res, "Version mismatch — re-read the result and retry");
        return;
      }

      await client.query(
        `UPDATE game SET status = $1 WHERE id = $2`,
        [agree ? "confirmed" : "disputed", result.game_id]
      );

      await publishDomainEvent(client, {
        eventType: agree ? "result.confirmed" : "result.disputed",
        leagueId: result.league_id,
        actorUserId: verifierAppUserId,
        audienceUserIds: [result.home_gm_app_user_id, result.away_gm_app_user_id]
          .filter((id): id is string => !!id),
        title: agree ? "Game result confirmed" : "Game result disputed",
        body: agree
          ? `Final score: ${result.home_goals}-${result.away_goals}`
          : (dispute_reason ?? "A game result was disputed."),
        data: { game_id: result.game_id, result_id: resultId },
      });

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
