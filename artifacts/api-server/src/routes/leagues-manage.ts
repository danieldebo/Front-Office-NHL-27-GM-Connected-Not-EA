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
import { ensureClubCatalog, provisionSeasonSeats } from "../server/seasonProvisioning";
import { getTemplate } from "../server/leagueSettingsTemplates";

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

  const {
    name, slug, visibility = "public", primary_color, secondary_color, logo_url,
    platform = "crossplay", team_count = 32, settings_template_id,
  } = parsed.data;
  const template = getTemplate(settings_template_id);

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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const insertRow = await client.query<{
      id: string;
      slug: string;
      name: string;
      visibility: string;
      platform: string;
      logo_url: string | null;
      primary_color: string | null;
      secondary_color: string | null;
      owner_user_id: string;
      created_at: Date;
    }>(
      `INSERT INTO league (name, slug, visibility, platform, primary_color, secondary_color, logo_url, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, slug, name, visibility, platform, logo_url, primary_color, secondary_color, owner_user_id, created_at`,
      [name, slug, visibility, platform, primary_color ?? null, secondary_color ?? null, logo_url ?? null, appUserId]
    );

    const league = insertRow.rows[0]!;

    await client.query(
      `INSERT INTO league_membership (league_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (league_id, user_id) DO NOTHING`,
      [league.id, appUserId]
    );

    const f = template.fields;
    const initial = await client.query<{ id: string }>(
      `INSERT INTO league_settings_version (
         league_id, version, platform, team_count, roster_source, schedule_format,
         schedule_settings, playoff_format, salary_cap_cents, roster_min, roster_max,
         divisions, conferences, rules_notes, slider_presets, require_verified_identities,
         changed_by, change_summary
       ) VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        league.id, platform, team_count, f.roster_source, f.schedule_format,
        f.schedule_settings, f.playoff_format, f.salary_cap_cents, f.roster_min, f.roster_max,
        JSON.stringify(f.divisions), JSON.stringify(f.conferences), f.rules_notes, f.slider_presets,
        f.require_verified_identities, appUserId, `Initial league settings — ${template.name} template`,
      ],
    );
    await client.query(
      `INSERT INTO league_settings_active (league_id, settings_version_id)
       VALUES ($1, $2)`,
      [league.id, initial.rows[0]!.id],
    );
    await client.query("COMMIT");
    res.status(201).json(league);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

    const leagueId = req.params.leagueId as string;

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

    const leagueId = req.params.leagueId as string;

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
      points_win = 2,
      points_ot_loss = 1,
      points_reg_loss = 0,
      tiebreakers = ["points", "row", "wins", "goal_diff", "goals_for"],
    } = parsed.data;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [leagueId]);

      const settingsRow = await client.query<{
        settings_version_id: string;
        team_count: number;
        salary_cap_cents: string | null;
        roster_min: number | null;
        roster_max: number | null;
        schedule_format: string;
        schedule_settings: Record<string, unknown>;
      }>(
        `SELECT v.id AS settings_version_id, v.team_count, v.salary_cap_cents, v.roster_min, v.roster_max,
                v.schedule_format, v.schedule_settings
           FROM league_settings_active a
           JOIN league_settings_version v ON v.id = a.settings_version_id
          WHERE a.league_id = $1`,
        [leagueId],
      );
      const settings = settingsRow.rows[0];
      if (!settings) {
        throw new Error(`League ${leagueId} has no active settings version`);
      }
      const configuredGamesPerMatchup =
        settings.schedule_format === "double_round_robin" ? 2 :
        settings.schedule_format === "round_robin" ? 1 :
        Number(settings.schedule_settings.games_per_matchup);

      const ordinalRow = await client.query<{ max_ord: string | null }>(
        `SELECT MAX(ordinal) AS max_ord FROM season WHERE league_id = $1`,
        [leagueId]
      );
      const nextOrdinal = (parseInt(ordinalRow.rows[0]?.max_ord ?? "0", 10)) + 1;

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
             points_win, points_ot_loss, points_reg_loss, tiebreakers, is_active,
             max_seats, settings_version_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15,$16)
         RETURNING id`,
        [
          leagueId, nextOrdinal, label, game_title,
          starts_on ?? null, ends_on ?? null,
          settings.salary_cap_cents,
          settings.roster_min,
          settings.roster_max,
          configuredGamesPerMatchup,
          points_win, points_ot_loss, points_reg_loss, tiebreakers,
          settings.team_count,
          settings.settings_version_id,
        ]
      );

      const seasonId = seasonRow.rows[0]!.id;

      await ensureClubCatalog(client);
      await provisionSeasonSeats(client, leagueId, seasonId, settings.team_count);

      await client.query("COMMIT");

      // Return the created season
      const result = await pool.query(
        `SELECT id, league_id, settings_version_id, ordinal, label, game_title, starts_on, ends_on,
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
