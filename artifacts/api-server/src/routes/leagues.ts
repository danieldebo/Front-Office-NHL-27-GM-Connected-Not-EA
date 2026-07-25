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

const router: IRouter = Router();

// GET /leagues/me
router.get("/leagues/me", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user) {
    unauthorized(res, "Authentication required");
    return;
  }

  // A user is "in" a league if they have an active gm_assignment on any
  // team_season in that league, OR if they are the league owner.
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
       WHERE l.owner_user_id = u.id
          OR EXISTS (
            SELECT 1
              FROM franchise fr
              JOIN team_season ts ON ts.franchise_id = fr.id
              JOIN gm_assignment ga ON ga.team_season_id = ts.id AND ga.ended_at IS NULL
             WHERE fr.league_id = l.id AND ga.user_id = u.id
          )
       ORDER BY l.name`,
    [user.id]
  );

  res.json({ data: rows });
});

// GET /leagues/:leagueId
router.get(
  "/leagues/:leagueId",
  async (req: Request, res: Response): Promise<void> => {
    const { leagueId } = req.params;

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
      `SELECT id, slug, name, visibility, logo_url, primary_color,
              secondary_color, owner_user_id, created_at
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
    const { leagueId } = req.params;
    const user = getCurrentUser(req);

    const leagueRow = await pool.query(
      `SELECT id FROM league WHERE id = $1`,
      [leagueId]
    );
    if (!leagueRow.rows[0]) {
      notFound(res, "League not found");
      return;
    }

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
                g.away_team_season_id, af.id AS away_franchise_id,
                af.name AS away_franchise_name,
                an.abbrev AS away_club_abbrev,
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
          gm_display_name: null,
        },
        away: {
          team_season_id: r.away_team_season_id,
          franchise_id: r.away_franchise_id,
          franchise_name: r.away_franchise_name,
          club_abbrev: r.away_club_abbrev ?? null,
          goals: r.away_goals ?? null,
          gm_display_name: null,
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
    });
  }
);

// GET /leagues/:leagueId/seasons
router.get(
  "/leagues/:leagueId/seasons",
  async (req: Request, res: Response): Promise<void> => {
    const { leagueId } = req.params;

    const leagueCheck = await pool.query(
      `SELECT id FROM league WHERE id = $1`,
      [leagueId]
    );
    if (!leagueCheck.rows[0]) {
      notFound(res, "League not found");
      return;
    }

    const { rows } = await pool.query(
      `SELECT id, league_id, ordinal, label, game_title,
              starts_on, ends_on, salary_cap_cents,
              roster_min, roster_max, games_per_matchup,
              points_win, points_ot_loss, points_reg_loss,
              tiebreakers, is_active
         FROM season
        WHERE league_id = $1
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
      id: string; slug: string; name: string; visibility: string; public_code: string | null;
    }>(
      `SELECT id, slug, name, visibility, public_code FROM league WHERE slug = $1`,
      [slug]
    );

    if (!leagueRow.rows[0]) { notFound(res, "League not found"); return; }
    const league = leagueRow.rows[0];

    // Active season
    const seasonRow = await pool.query<{ id: string; label: string }>(
      `SELECT id, label FROM season WHERE league_id = $1 AND is_active = TRUE LIMIT 1`,
      [league.id]
    );
    const season = seasonRow.rows[0] ?? null;

    if (!season) {
      res.json({ league, season: null, standings: [] });
      return;
    }

    // Standings rows from view
    const standingsRows = await pool.query(
      `SELECT
         ts.id              AS team_season_id,
         f.id               AS franchise_id,
         f.name             AS franchise_name,
         nc.abbrev          AS club_abbrev,
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
        gm_display_name: null,
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

    res.json({ league, season, standings });
  }
);

export default router;
