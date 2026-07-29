/**
 * League + season write routes (commissioner-only mutations).
 *
 * POST  /leagues                     — create a league
 * PATCH /leagues/:leagueId           — update league settings
 * POST  /leagues/:leagueId/seasons   — create a season + 32 franchise seats
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import {
  notFound,
  unauthorized,
  forbidden,
  badRequest,
  conflict,
} from "../server/errors";
import {
  CreateLeagueBody,
  UpdateLeagueBody,
  CreateSeasonBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ────────────────────────────────────────────── Create league

router.post("/leagues", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user) {
    unauthorized(res, "Authentication required");
    return;
  }

  const parsed = CreateLeagueBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }

  const { name, slug, visibility = "public", primary_color, secondary_color, logo_url } =
    parsed.data;

  // Ensure app_user exists for this Replit user
  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM app_user WHERE replit_id = $1`,
    [user.id]
  );
  if (!userRow.rows[0]) {
    badRequest(res, "User profile not found. Complete onboarding first.");
    return;
  }
  const appUserId = userRow.rows[0].id;

  // Check slug uniqueness
  const slugCheck = await pool.query(
    `SELECT id FROM league WHERE slug = $1`,
    [slug]
  );
  if (slugCheck.rows[0]) {
    conflict(res, `The slug '${slug}' is already taken.`);
    return;
  }

  const insertRow = await pool.query<{
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
    `INSERT INTO league (name, slug, visibility, primary_color, secondary_color, logo_url, owner_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, slug, name, visibility, logo_url, primary_color, secondary_color, owner_user_id, created_at`,
    [name, slug, visibility, primary_color ?? null, secondary_color ?? null, logo_url ?? null, appUserId]
  );

  const league = insertRow.rows[0]!;

  // Create the owner's league_membership row
  await pool.query(
    `INSERT INTO league_membership (league_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (league_id, user_id) DO NOTHING`,
    [league.id, appUserId]
  );

  res.status(201).json(league);
});

// ────────────────────────────────────────────── Update league

router.patch(
  "/leagues/:leagueId",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) {
      unauthorized(res, "Authentication required");
      return;
    }

    const { leagueId } = req.params;

    const leagueRow = await pool.query<{ id: string; owner_user_id: string }>(
      `SELECT id, owner_user_id FROM league WHERE id = $1`,
      [leagueId]
    );
    if (!leagueRow.rows[0]) {
      notFound(res, "League not found");
      return;
    }

    const league = leagueRow.rows[0];

    if (!can(user, "league:write", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can update league settings");
      return;
    }

    const parsed = UpdateLeagueBody.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.message);
      return;
    }

    const { name, visibility, primary_color, secondary_color, logo_url } = parsed.data;

    const sets: string[] = [];
    const vals: unknown[] = [leagueId];

    if (name !== undefined) {
      vals.push(name);
      sets.push(`name = $${vals.length}`);
    }
    if (visibility !== undefined) {
      vals.push(visibility);
      sets.push(`visibility = $${vals.length}`);
    }
    if (primary_color !== undefined) {
      vals.push(primary_color);
      sets.push(`primary_color = $${vals.length}`);
    }
    if (secondary_color !== undefined) {
      vals.push(secondary_color);
      sets.push(`secondary_color = $${vals.length}`);
    }
    if (logo_url !== undefined) {
      vals.push(logo_url);
      sets.push(`logo_url = $${vals.length}`);
    }

    if (sets.length === 0) {
      badRequest(res, "No fields to update");
      return;
    }

    const updatedRow = await pool.query(
      `UPDATE league SET ${sets.join(", ")}
        WHERE id = $1
        RETURNING id, slug, name, visibility, logo_url, primary_color, secondary_color, owner_user_id, created_at`,
      vals
    );

    res.json(updatedRow.rows[0]);
  }
);

// ────────────────────────────────────────────── Create season

router.post(
  "/leagues/:leagueId/seasons",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) {
      unauthorized(res, "Authentication required");
      return;
    }

    const { leagueId } = req.params;

    const leagueRow = await pool.query<{
      id: string;
      owner_user_id: string;
    }>(
      `SELECT id, owner_user_id FROM league WHERE id = $1`,
      [leagueId]
    );
    if (!leagueRow.rows[0]) {
      notFound(res, "League not found");
      return;
    }

    if (!can(user, "season:create", { kind: "league", ownerId: leagueRow.rows[0].owner_user_id })) {
      forbidden(res, "Only the league owner can create a season");
      return;
    }

    const parsed = CreateSeasonBody.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.message);
      return;
    }

    const {
      label,
      game_title,
      starts_on,
      ends_on,
      salary_cap_cents,
      roster_min,
      roster_max,
      games_per_matchup = 1,
      points_win = 2,
      points_ot_loss = 1,
      points_reg_loss = 0,
      tiebreakers = ["points", "row", "wins", "goal_diff", "goals_for"],
    } = parsed.data;

    // Determine next ordinal
    const ordinalRow = await pool.query<{ max_ord: string | null }>(
      `SELECT MAX(ordinal) AS max_ord FROM season WHERE league_id = $1`,
      [leagueId]
    );
    const nextOrdinal = (parseInt(ordinalRow.rows[0]?.max_ord ?? "0", 10)) + 1;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Deactivate any currently active season
      await client.query(
        `UPDATE season SET is_active = FALSE WHERE league_id = $1 AND is_active = TRUE`,
        [leagueId]
      );

      // Create the new season
      const seasonRow = await client.query<{ id: string }>(
        `INSERT INTO season
           (league_id, ordinal, label, game_title, starts_on, ends_on,
            salary_cap_cents, roster_min, roster_max, games_per_matchup,
            points_win, points_ot_loss, points_reg_loss, tiebreakers, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE)
         RETURNING id`,
        [
          leagueId, nextOrdinal, label, game_title,
          starts_on ?? null, ends_on ?? null,
          salary_cap_cents ?? null, roster_min ?? null, roster_max ?? null,
          games_per_matchup, points_win, points_ot_loss, points_reg_loss,
          tiebreakers,
        ]
      );

      const seasonId = seasonRow.rows[0]!.id;

      // Load all 32 NHL clubs ordered by conference + division + abbrev
      const clubsRow = await client.query<{
        id: string;
        abbrev: string;
        name: string;
        conference: string | null;
        division: string | null;
      }>(
        `SELECT id, abbrev, name, conference, division
           FROM nhl_club
          ORDER BY conference, division, abbrev`
      );

      // For each NHL club: find or create a franchise, then create team_season
      for (const club of clubsRow.rows) {
        // Reuse an existing franchise from a previous season if one exists,
        // otherwise create a fresh one.
        let franchiseId: string;

        const existingFranchise = await client.query<{ id: string }>(
          `SELECT f.id FROM franchise f
            WHERE f.league_id = $1
              AND EXISTS (
                SELECT 1 FROM team_season ts
                 WHERE ts.franchise_id = f.id AND ts.nhl_club_id = $2
              )
            LIMIT 1`,
          [leagueId, club.id]
        );

        if (existingFranchise.rows[0]) {
          franchiseId = existingFranchise.rows[0].id;
        } else {
          const newFranchise = await client.query<{ id: string }>(
            `INSERT INTO franchise (league_id, name, founded_season_id)
             VALUES ($1, $2, $3) RETURNING id`,
            [leagueId, `${club.name}`, seasonId]
          );
          franchiseId = newFranchise.rows[0]!.id;
        }

        // Create team_season for this season
        await client.query(
          `INSERT INTO team_season
             (season_id, franchise_id, nhl_club_id, conference, division, seat_status)
           VALUES ($1, $2, $3, $4, $5, 'open')
           ON CONFLICT (season_id, franchise_id) DO NOTHING`,
          [seasonId, franchiseId, club.id, club.conference, club.division]
        );
      }

      await client.query("COMMIT");

      // Return the created season
      const result = await pool.query(
        `SELECT id, league_id, ordinal, label, game_title, starts_on, ends_on,
                salary_cap_cents, roster_min, roster_max, games_per_matchup,
                points_win, points_ot_loss, points_reg_loss, tiebreakers, is_active
           FROM season WHERE id = $1`,
        [seasonId]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

// ────────────────────────────────────────────── Get listing settings

router.get(
  "/leagues/:leagueId/listing",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) {
      unauthorized(res, "Authentication required");
      return;
    }

    const { leagueId } = req.params;

    const leagueRow = await pool.query<{ id: string; owner_user_id: string }>(
      `SELECT id, owner_user_id FROM league WHERE id = $1`,
      [leagueId]
    );
    if (!leagueRow.rows[0]) {
      notFound(res, "League not found");
      return;
    }

    if (!can(user, "league:write", { kind: "league", ownerId: leagueRow.rows[0].owner_user_id })) {
      forbidden(res, "Only the league owner can view listing settings");
      return;
    }

    const listingRow = await pool.query<{
      league_id: string;
      is_listed: boolean;
      accepting_signups: boolean;
      accepting_waitlist: boolean;
      blurb: string | null;
      platform: string | null;
      competitiveness: string | null;
      suggested_division: string | null;
      timezone_focus: string | null;
      listed_at: Date | null;
      updated_at: Date;
    }>(
      `SELECT league_id, is_listed, accepting_signups, accepting_waitlist,
              blurb, platform, competitiveness, suggested_division,
              timezone_focus, listed_at, updated_at
         FROM league_listing WHERE league_id = $1`,
      [leagueId]
    );

    if (!listingRow.rows[0]) {
      // No listing row yet — return nulls
      res.json({
        league_id: leagueId,
        is_listed: false,
        accepting_signups: false,
        accepting_waitlist: true,
        blurb: null,
        platform: null,
        competitiveness: null,
        suggested_division: null,
        timezone_focus: null,
        listed_at: null,
        updated_at: null,
      });
      return;
    }

    res.json(listingRow.rows[0]);
  }
);

// ────────────────────────────────────────────── Update listing settings

router.put(
  "/leagues/:leagueId/listing",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) {
      unauthorized(res, "Authentication required");
      return;
    }

    const { leagueId } = req.params;

    const leagueRow = await pool.query<{ id: string; owner_user_id: string }>(
      `SELECT id, owner_user_id FROM league WHERE id = $1`,
      [leagueId]
    );
    if (!leagueRow.rows[0]) {
      notFound(res, "League not found");
      return;
    }

    if (!can(user, "league:write", { kind: "league", ownerId: leagueRow.rows[0].owner_user_id })) {
      forbidden(res, "Only the league owner can update listing settings");
      return;
    }

    const {
      is_listed,
      accepting_signups,
      accepting_waitlist,
      blurb,
      platform,
      competitiveness,
      suggested_division,
      timezone_focus,
    } = req.body as {
      is_listed?: boolean;
      accepting_signups?: boolean;
      accepting_waitlist?: boolean;
      blurb?: string | null;
      platform?: string | null;
      competitiveness?: string | null;
      suggested_division?: string | null;
      timezone_focus?: string | null;
    };

    // Validate enums if provided
    const validPlatforms = ["psn", "xbox", "both", null];
    if (platform !== undefined && !validPlatforms.includes(platform)) {
      badRequest(res, `platform must be one of: psn, xbox, both`);
      return;
    }
    const validCompetitiveness = ["casual", "competitive", "hardcore", null];
    if (competitiveness !== undefined && !validCompetitiveness.includes(competitiveness)) {
      badRequest(res, `competitiveness must be one of: casual, competitive, hardcore`);
      return;
    }
    const validDivisions = ["bronze", "silver", "gold", "diamond", "platinum", "elite", "ultimate", null];
    if (suggested_division !== undefined && !validDivisions.includes(suggested_division)) {
      badRequest(res, `suggested_division must be a valid ranked division`);
      return;
    }

    // Guard: cannot list a league that has no active season — applicants would
    // see NULL seat counts in v_open_leagues, which is misleading.
    if (is_listed === true) {
      const activeSeason = await pool.query<{ id: string }>(
        `SELECT id FROM season WHERE league_id = $1 AND is_active = TRUE LIMIT 1`,
        [leagueId]
      );
      if (!activeSeason.rows[0]) {
        badRequest(
          res,
          "Cannot list a league with no active season. Create and activate a season first so applicants can see seat availability."
        );
        return;
      }
    }

    // Upsert the listing row
    const now = new Date();
    const listedAt = is_listed ? now : undefined;

    const result = await pool.query<{
      league_id: string;
      is_listed: boolean;
      accepting_signups: boolean;
      accepting_waitlist: boolean;
      blurb: string | null;
      platform: string | null;
      competitiveness: string | null;
      suggested_division: string | null;
      timezone_focus: string | null;
      listed_at: Date | null;
      updated_at: Date;
    }>(
      `INSERT INTO league_listing
         (league_id, is_listed, accepting_signups, accepting_waitlist,
          blurb, platform, competitiveness, suggested_division, timezone_focus,
          listed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               CASE WHEN $2 THEN now() ELSE NULL END, now())
       ON CONFLICT (league_id) DO UPDATE SET
         is_listed          = EXCLUDED.is_listed,
         accepting_signups  = EXCLUDED.accepting_signups,
         accepting_waitlist = EXCLUDED.accepting_waitlist,
         blurb              = EXCLUDED.blurb,
         platform           = EXCLUDED.platform,
         competitiveness    = EXCLUDED.competitiveness,
         suggested_division = EXCLUDED.suggested_division,
         timezone_focus     = EXCLUDED.timezone_focus,
         listed_at          = CASE
                                WHEN EXCLUDED.is_listed AND league_listing.listed_at IS NULL
                                THEN now()
                                WHEN NOT EXCLUDED.is_listed
                                THEN NULL
                                ELSE league_listing.listed_at
                              END,
         updated_at         = now()
       RETURNING league_id, is_listed, accepting_signups, accepting_waitlist,
                 blurb, platform, competitiveness, suggested_division,
                 timezone_focus, listed_at, updated_at`,
      [
        leagueId,
        is_listed ?? false,
        accepting_signups ?? false,
        accepting_waitlist ?? true,
        blurb ?? null,
        platform ?? null,
        competitiveness ?? null,
        suggested_division ?? null,
        timezone_focus ?? null,
      ]
    );

    res.json(result.rows[0]);
  }
);

export default router;
