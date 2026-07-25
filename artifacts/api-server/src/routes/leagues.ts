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
  rateLimiter({ getLeagueId: (r) => r.params.leagueId }),
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
                an.abbrev AS away_club_abbrev
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
          goals: null,
          gm_display_name: null,
        },
        away: {
          team_season_id: r.away_team_season_id,
          franchise_id: r.away_franchise_id,
          franchise_name: r.away_franchise_name,
          club_abbrev: r.away_club_abbrev ?? null,
          goals: null,
          gm_display_name: null,
        },
        result: null,
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

export default router;
