/**
 * Read-only league and season routes.
 *
 * GET /leagues/me        — leagues the current user belongs to
 * GET /leagues/:leagueId — get a single league
 * GET /leagues/:leagueId/hub — hub summary
 * GET /leagues/:leagueId/seasons — list seasons
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { notFound, unauthorized } from "../server/errors";
import { rateLimiter } from "../middlewares/rateLimiter";
import { canonicalGmIdentity } from "../server/core/playerIdentity";
import { requireLeagueRead } from "../server/leagueAccess";

const router: IRouter = Router();

// GET /leagues/me
router.get("/leagues/me", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user) {
    unauthorized(res, "Authentication required");
    return;
  }

  // League membership, rather than a transient team assignment, defines access.
  const { rows } = await pool.query<{
    id: string;
    slug: string;
    name: string;
    visibility: string;
    logo_url: string | null;
    primary_color: string | null;
    secondary_color: string | null;
    owner_user_id: string;
    created_at: Date;
  }>(
    `SELECT DISTINCT l.id, l.slug, l.name, l.visibility, l.logo_url,
            l.primary_color, l.secondary_color, l.owner_user_id, l.created_at
       FROM league l
       JOIN app_user u ON u.replit_id = $1
       LEFT JOIN league_membership lm
         ON lm.league_id = l.id AND lm.user_id = u.id AND lm.left_at IS NULL
       WHERE l.owner_user_id = u.id OR lm.id IS NOT NULL
       ORDER BY l.name`,
    [user.id]
  );

  res.json({ data: rows });
});

// GET /leagues/:leagueId
router.get(
  "/leagues/:leagueId",
  async (req: Request, res: Response): Promise<void> => {
    const leagueId = String(req.params.leagueId);
    if (!await requireLeagueRead(req, res, leagueId)) return;
    const { rows } = await pool.query<{
      id: string;
      slug: string;
      name: string;
      visibility: string;
      logo_url: string | null;
      primary_color: string | null;
      secondary_color: string | null;
      created_at: Date;
    }>(
      `SELECT id, slug, name, visibility, logo_url, primary_color,
              secondary_color, created_at
         FROM league
        WHERE id = $1`,
      [leagueId]
    );

    if (!rows[0]) {
      notFound(res, "League not found");
      return;
    }

    res.json(rows[0]);
  }
);

// GET /leagues/:leagueId/hub — summary stats for the slab
router.get(
  "/leagues/:leagueId/hub",
  rateLimiter({ getLeagueId: (r) => r.params.leagueId as string }),
  async (req: Request, res: Response): Promise<void> => {
    const leagueId = String(req.params.leagueId);
    const user = getCurrentUser(req);
    if (!await requireLeagueRead(req, res, leagueId)) return;

    // Active season
    const seasonRow = await pool.query<{ id: string; label: string }>(
      `SELECT id, label FROM season WHERE league_id = $1 AND is_active = TRUE LIMIT 1`,
      [leagueId]
    );
    const activeSeason = seasonRow.rows[0] ?? null;

    let gamesScheduled = 0;
    let gamesConfirmed = 0;
    if (activeSeason) {
      const statsRow = await pool.query<{ total: string; confirmed: string }>(
        `SELECT
            COUNT(*) FILTER (WHERE status NOT IN ('voided','simulated')) AS total,
            COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed
           FROM game WHERE season_id = $1`,
        [activeSeason.id]
      );
      gamesScheduled = parseInt(statsRow.rows[0]?.total ?? "0", 10);
      gamesConfirmed = parseInt(statsRow.rows[0]?.confirmed ?? "0", 10);
    }

    // Open seats
    const seatsRow = await pool.query<{ open_seats: string }>(
      `SELECT COUNT(*) AS open_seats
         FROM team_season ts
         JOIN franchise f ON f.id = ts.franchise_id
         JOIN season s ON s.id = ts.season_id AND s.is_active = TRUE
        WHERE f.league_id = $1
          AND ts.seat_status = 'open'`,
      [leagueId]
    );
    const openSeats = parseInt(seatsRow.rows[0]?.open_seats ?? "0", 10);

    // Seat states are derived strictly from historical assignments; "inactive"
    // means the most recent ended assignment explicitly recorded that reason.
    const preferencesAvailable = (await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.applicant_team_season_preference') IS NOT NULL AS exists`,
    )).rows[0]?.exists ?? false;
    const applicantCountProjection = preferencesAvailable
      ? `COALESCE(applicants.count, 0)::int`
      : `0::int`;
    const applicantCountJoin = preferencesAvailable
      ? `LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT preference.applicant_user_id)::int AS count
             FROM applicant_team_season_preference preference
            WHERE preference.team_season_id = ts.id
              AND preference.league_id = $1
              AND (
                EXISTS (
                  SELECT 1 FROM league_signup signup
                   WHERE signup.league_id = $1
                     AND signup.user_id = preference.applicant_user_id
                )
                OR EXISTS (
                  SELECT 1 FROM waitlist_entry waitlist
                   WHERE waitlist.league_id = $1
                     AND waitlist.user_id = preference.applicant_user_id
                     AND waitlist.status IN ('waiting', 'invited')
                )
              )
         ) applicants ON true`
      : "";
    const openSeatDetailsRow = await pool.query(
      `SELECT ts.id team_season_id, f.id franchise_id, f.name franchise_name,
              CASE WHEN last_assignment.end_reason='inactive' THEN 'inactive'
                   WHEN ts.seat_status='vacated' OR last_assignment.id IS NOT NULL THEN 'vacated'
                   ELSE 'never_filled' END state,
              ${applicantCountProjection} applicant_count
         FROM team_season ts JOIN franchise f ON f.id=ts.franchise_id
         JOIN season s ON s.id=ts.season_id AND s.is_active
         LEFT JOIN LATERAL (
           SELECT id,end_reason FROM gm_assignment ga WHERE ga.team_season_id=ts.id AND ga.ended_at IS NOT NULL
           ORDER BY ga.ended_at DESC LIMIT 1
         ) last_assignment ON true
         ${applicantCountJoin}
        WHERE f.league_id=$1 AND ts.seat_status IN ('open','vacated')
          AND NOT EXISTS (SELECT 1 FROM gm_assignment active WHERE active.team_season_id=ts.id AND active.ended_at IS NULL)
        ORDER BY f.name`, [leagueId],
    );
    const wireTransactionsRow = await pool.query(
       `SELECT te.id,te.season_id,CASE WHEN te.external_ids->>'requested_type' IN
                ('trade','signing','release','waiver_claim','call_up','send_down','ir_place','ir_activate',
                 'retire','draft_pick','reversal','ir_move','seat_change')
              THEN te.external_ids->>'requested_type' ELSE te.txn_type::text END type,
               workflow.status::text status,
               te.proposed_by,te.proposed_at,workflow.resolved_at,workflow.reverses_txn_id,
               COALESCE(workflow.note,te.note) note,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',ta.kind::text,'player_id',ta.player_id,
                'draft_year',ta.draft_year,'draft_round',ta.draft_round,'amount_cents',ta.amount_cents,
                'from_team_season_id',ta.from_team_season_id,'to_team_season_id',ta.to_team_season_id))
                FROM transaction_asset ta WHERE ta.transaction_id=te.id),'[]'::jsonb) assets,
               ((CASE WHEN te.external_ids->>'requested_type' IN
                ('trade','signing','release','waiver_claim','call_up','send_down','ir_place','ir_activate',
                 'retire','draft_pick','reversal','ir_move','seat_change')
                THEN te.external_ids->>'requested_type' ELSE te.txn_type::text END) || COALESCE(': ' || COALESCE(workflow.note,te.note),'')) summary,
               CASE WHEN workflow.external_ids->>'entry_source'='commissioner' THEN 'commissioner' ELSE 'manual' END provenance,
               COALESCE((workflow.external_ids->>'cap_checked')::boolean,false) cap_checked,
              (SELECT a.user_id FROM transaction_approval a JOIN transaction_event workflow ON workflow.id=a.transaction_id
                WHERE workflow.external_ids->>'parent_transaction_id'=te.id::text AND a.vote AND workflow.external_ids->>'action'='approve'
                ORDER BY a.voted_at DESC LIMIT 1) approved_by
         FROM transaction_event te JOIN season s ON s.id=te.season_id
          JOIN LATERAL (
            SELECT x.status,x.resolved_at,x.reverses_txn_id,x.note,x.external_ids
              FROM transaction_event x
             WHERE x.id=te.id OR x.external_ids->>'parent_transaction_id'=te.id::text
             ORDER BY x.proposed_at DESC,x.id DESC LIMIT 1
          ) workflow ON true
        WHERE s.league_id=$1 AND NOT (te.external_ids ? 'parent_transaction_id')
        ORDER BY te.proposed_at DESC,te.id DESC LIMIT 10`, [leagueId],
    );

    // Active GMs (users with active assignments in any team_season of this league)
    const gmRow = await pool.query<{ active_gms: string }>(
      `SELECT COUNT(DISTINCT ga.user_id) AS active_gms
         FROM gm_assignment ga
         JOIN team_season ts ON ts.id = ga.team_season_id
         JOIN franchise f ON f.id = ts.franchise_id
        WHERE f.league_id = $1 AND ga.ended_at IS NULL`,
      [leagueId]
    );
    const activeGms = parseInt(gmRow.rows[0]?.active_gms ?? "0", 10);

    // My pending games
    let myGamesThisWeek: unknown[] = [];
    if (user && activeSeason) {
      const myGamesRow = await pool.query(
        `SELECT g.id, g.season_id, g.week_number, g.status,
                g.window_opens_at, g.window_closes_at, g.played_at,
                g.home_team_season_id, hf.id AS home_franchise_id,
                hf.name AS home_franchise_name,
                hn.abbrev AS home_club_abbrev,
                 hu.display_name AS home_gm_display_name,
                 hu.platform::text AS home_gm_legacy_platform,
                 hu.platform_gamertag AS home_gm_legacy_gamertag,
                  to_jsonb(hu)->>'primary_identity' AS home_gm_primary_identity,
                  to_jsonb(hu)->>'xbox_gamertag' AS home_gm_xbox_gamertag,
                  to_jsonb(hu)->>'psn_online_id' AS home_gm_psn_online_id,
                  to_jsonb(hu)->>'xbox_identity_verified_at' AS home_gm_xbox_identity_verified_at,
                  to_jsonb(hu)->>'playstation_identity_verified_at' AS home_gm_playstation_identity_verified_at,
                g.away_team_season_id, af.id AS away_franchise_id,
                af.name AS away_franchise_name,
                an.abbrev AS away_club_abbrev,
                 au.display_name AS away_gm_display_name,
                 au.platform::text AS away_gm_legacy_platform,
                 au.platform_gamertag AS away_gm_legacy_gamertag,
                  to_jsonb(au)->>'primary_identity' AS away_gm_primary_identity,
                  to_jsonb(au)->>'xbox_gamertag' AS away_gm_xbox_gamertag,
                  to_jsonb(au)->>'psn_online_id' AS away_gm_psn_online_id,
                  to_jsonb(au)->>'xbox_identity_verified_at' AS away_gm_xbox_identity_verified_at,
                  to_jsonb(au)->>'playstation_identity_verified_at' AS away_gm_playstation_identity_verified_at,
                gr.id AS result_id, gr.home_goals, gr.away_goals, gr.decision,
                gr.version, gr.data_source, gr.counts_toward_standings,
                gr.reported_by, gr.verified_by, gr.verified_at,
                gr.created_at AS result_created_at
           FROM game g
           JOIN team_season hts ON hts.id = g.home_team_season_id
           JOIN franchise hf ON hf.id = hts.franchise_id
           LEFT JOIN nhl_club hn ON hn.id = hts.nhl_club_id
           JOIN gm_assignment hga ON hga.team_season_id = g.home_team_season_id AND hga.ended_at IS NULL
           JOIN app_user hu ON hu.id = hga.user_id
           JOIN team_season ats ON ats.id = g.away_team_season_id
           JOIN franchise af ON af.id = ats.franchise_id
           LEFT JOIN nhl_club an ON an.id = ats.nhl_club_id
           JOIN gm_assignment aga ON aga.team_season_id = g.away_team_season_id AND aga.ended_at IS NULL
           JOIN app_user au ON au.id = aga.user_id
           LEFT JOIN game_result gr ON gr.game_id = g.id AND gr.superseded_by IS NULL
          WHERE g.season_id = $1
            AND g.status NOT IN ('confirmed','voided','simulated')
            AND (hu.replit_id = $2 OR au.replit_id = $2)
          ORDER BY g.window_closes_at ASC
          LIMIT 5`,
        [activeSeason.id, user.id]
      );

      myGamesThisWeek = myGamesRow.rows.map((r) => ({
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
          superseded_by: null,
          supersede_reason: null,
          created_at: r.result_created_at,
        } : null,
      }));
    }

    let recentNotifications: unknown[] = [];
    let unreadNotificationCount = 0;
    let applicantActivity: unknown[] = [];
    if (user?.appUserId) {
      const notificationsRow = await pool.query(
        `SELECT id, league_id, event_type, title, body, data, created_at, read_at
           FROM notification_item
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 5`,
        [user.appUserId],
      );
      recentNotifications = notificationsRow.rows;

      const unreadRow = await pool.query<{ count: string }>(
        `SELECT count(*) AS count
           FROM notification_item
          WHERE user_id = $1 AND read_at IS NULL`,
        [user.appUserId],
      );
      unreadNotificationCount = Number(unreadRow.rows[0]?.count ?? 0);

      const activityRow = await pool.query(
        `WITH authorized AS (
           SELECT 1
             FROM league l
             LEFT JOIN league_membership lm
               ON lm.league_id = l.id
              AND lm.user_id = $2
              AND lm.left_at IS NULL
              AND lm.role IN ('commissioner', 'assistant_commissioner')
            WHERE l.id = $1
              AND (l.owner_user_id = $2 OR lm.id IS NOT NULL)
            LIMIT 1
         ),
         intake AS (
           SELECT 'signup'::text AS source, su.id, su.user_id,
                  au.display_name, 'pending'::text AS status, su.created_at, 1 AS source_priority
             FROM league_signup su
             JOIN app_user au ON au.id = su.user_id
            WHERE su.league_id = $1
           UNION ALL
           SELECT 'waitlist'::text, w.id, w.user_id,
                  au.display_name, w.status::text, w.joined_at, 2
             FROM waitlist_entry w
             JOIN app_user au ON au.id = w.user_id
            WHERE w.league_id = $1
              AND w.status IN ('waiting', 'invited')
           UNION ALL
           SELECT 'invite_request'::text, jr.id, jr.user_id,
                  au.display_name, jr.status::text, jr.created_at, 3
             FROM join_request jr
             JOIN app_user au ON au.id = jr.user_id
            WHERE jr.league_id = $1 AND jr.status = 'pending'
         ),
         deduplicated AS (
           SELECT DISTINCT ON (user_id)
                  source, id, user_id, display_name, status, created_at
             FROM intake
            ORDER BY user_id, source_priority, created_at DESC
         )
         SELECT source, id, user_id, display_name, status, created_at
           FROM deduplicated
          WHERE EXISTS (SELECT 1 FROM authorized)
          ORDER BY created_at DESC
          LIMIT 6`,
        [leagueId, user.appUserId],
      );
      applicantActivity = activityRow.rows;
    }

    res.json({
      league_id: leagueId,
      active_season_id: activeSeason?.id ?? null,
      active_season_label: activeSeason?.label ?? null,
      games_scheduled: gamesScheduled,
      games_confirmed: gamesConfirmed,
      games_on_time_pct: gamesScheduled > 0 ? gamesConfirmed / gamesScheduled : null,
      open_seats: openSeats,
      active_gms: activeGms,
      my_games_this_week: myGamesThisWeek,
      recent_notifications: recentNotifications,
      unread_notification_count: unreadNotificationCount,
      applicant_activity: applicantActivity,
      wire_transactions: wireTransactionsRow.rows,
      open_seat_details: openSeatDetailsRow.rows,
    });
  }
);

// GET /leagues/:leagueId/seasons
router.get(
  "/leagues/:leagueId/seasons",
  async (req: Request, res: Response): Promise<void> => {
    const leagueId = String(req.params.leagueId);
    if (!await requireLeagueRead(req, res, leagueId)) return;

    const { rows } = await pool.query(
      `SELECT id, league_id, settings_version_id, ordinal, label, game_title,
              starts_on, ends_on, salary_cap_cents,
              roster_min, roster_max, games_per_matchup,
              points_win, points_ot_loss, points_reg_loss,
              tiebreakers, is_active
         FROM season
        WHERE league_id = $1 AND ordinal > 0
        ORDER BY ordinal ASC`,
      [leagueId]
    );

    res.json({ data: rows });
  }
);

// GET /l/:slug — public league page (no auth required)
router.get(
  "/l/:slug",
  async (req: Request, res: Response): Promise<void> => {
    const { slug } = req.params;

    const leagueRow = await pool.query<{
      id: string; slug: string; name: string; visibility: string;
    }>(
       `SELECT id, slug, name, visibility FROM league WHERE slug = $1 AND deleted_at IS NULL`,
      [slug]
    );

    if (!leagueRow.rows[0]) { notFound(res, "League not found"); return; }
    const league = leagueRow.rows[0];
    if (league.visibility !== "public") { notFound(res, "League not found"); return; }

    // Listing (recruiting) info — included regardless of season state
    const listingRow = await pool.query<{
      is_listed: boolean;
      accepting_signups: boolean;
      accepting_waitlist: boolean;
      blurb: string | null;
      platform: string | null;
      competitiveness: string | null;
      suggested_division: string | null;
    }>(
      `SELECT is_listed, accepting_signups, accepting_waitlist,
              blurb, platform, competitiveness, suggested_division
       FROM league_listing
       WHERE league_id = $1 AND is_listed = TRUE
       LIMIT 1`,
      [league.id]
    );
    const listing = listingRow.rows[0] ?? null;

    // Active season
    const seasonRow = await pool.query<{ id: string; label: string }>(
      `SELECT id, label FROM season WHERE league_id = $1 AND is_active = TRUE LIMIT 1`,
      [league.id]
    );
    const season = seasonRow.rows[0] ?? null;

    if (!season) {
      res.json({ league, season: null, standings: [], listing });
      return;
    }

    // Standings rows from view
    const standingsRows = await pool.query(
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
         COALESCE(vs.gp, 0)       AS "GP",
         COALESCE(vs.w, 0)        AS "W",
         COALESCE(vs.l, 0)        AS "L",
         COALESCE(vs.otl, 0)      AS "OTL",
         COALESCE(vs.row_wins, 0) AS "ROW",
         COALESCE(vs.gf, 0)       AS "GF",
         COALESCE(vs.ga, 0)       AS "GA",
         COALESCE(vs.gf, 0) - COALESCE(vs.ga, 0) AS "DIFF",
         COALESCE(vs.points, 0)   AS "PTS"
       FROM team_season ts
       JOIN franchise f ON f.id = ts.franchise_id
       LEFT JOIN nhl_club nc ON nc.id = ts.nhl_club_id
       LEFT JOIN v_standings vs ON vs.team_season_id = ts.id
        LEFT JOIN gm_assignment ga ON ga.team_season_id = ts.id AND ga.ended_at IS NULL
        LEFT JOIN app_user u ON u.id = ga.user_id
      WHERE ts.season_id = $1
      ORDER BY "PTS" DESC, "ROW" DESC, "GF" DESC`,
      [season.id]
    );

    // Per-team provenance
    const provenanceRows = await pool.query<{
      team_season_id: string;
      unconfirmed: string;
      provenance: string;
    }>(
      `SELECT
         team_season_id,
         COUNT(*) FILTER (WHERE status IN ('reported','disputed')) AS unconfirmed,
         CASE
           WHEN BOOL_OR(status = 'disputed')                    THEN 'dispute'
           WHEN COUNT(*) FILTER (WHERE status = 'reported') > 0 THEN 'manual'
           WHEN MAX(src_rank) >= 4                              THEN 'reconciled'
           WHEN MAX(src_rank) = 3                               THEN 'ocr'
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
      [season.id]
    );

    const provMap = new Map<string, { unconfirmed: number; provenance: string }>();
    for (const r of provenanceRows.rows) {
      provMap.set(r.team_season_id, {
        unconfirmed: parseInt(r.unconfirmed, 10),
        provenance: r.provenance,
      });
    }

    const standings = standingsRows.rows.map((r, i) => {
      const prov = provMap.get(r.team_season_id as string) ??
        { unconfirmed: 0, provenance: "confirmed" };
      return {
        rank: i + 1,
        team_season_id: r.team_season_id as string,
        franchise_id: r.franchise_id as string,
        franchise_name: r.franchise_name as string | null,
        club_abbrev: r.club_abbrev as string | null,
        // The public slug projection intentionally exposes a display name only;
        // console identities remain available to authorized league members.
        gm_display_name: r.gm_display_name as string | null,
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

    res.json({ league, season, standings, listing });
  }
);

export default router;
