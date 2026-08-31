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
  UpdateLeagueListingBody,
  UpdateLeagueListingParams,
} from "@workspace/api-zod";
import { ensureClubCatalog, provisionSeasonSeats } from "../server/seasonProvisioning";
import { leagueAccessFor } from "../server/leagueAccess";
import { scheduleSettingsForStorage, templateChangeSummary, validateSettings } from "./league-settings";

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

  const { name, slug, visibility = "public", primary_color, secondary_color, logo_url, settings } =
    parsed.data;
  const validationError = validateSettings(settings);
  if (validationError) {
    badRequest(res, validationError);
    return;
  }
  const summary = templateChangeSummary(settings.applied_template_id ?? undefined, settings.change_summary);
  if ("error" in summary) {
    badRequest(res, summary.error);
    return;
  }

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

    await client.query(
      `INSERT INTO league_membership (league_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (league_id, user_id) DO NOTHING`,
      [league.id, appUserId]
    );

    const initial = await client.query<{ id: string }>(
      `INSERT INTO league_settings_version
         (league_id, version, ea_league_id, platform, team_count, roster_source,
          schedule_format, schedule_settings, playoff_format, salary_cap_cents,
          roster_min, roster_max, divisions, conferences, rules_notes,
          slider_presets, require_verified_identities, applied_template_id,
          changed_by, change_summary)
       VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        league.id, settings.ea_league_id ?? null, settings.platform, settings.team_count,
        settings.roster_source, settings.schedule_format, scheduleSettingsForStorage(settings),
        settings.playoff_format, settings.salary_cap_cents ?? null,
        settings.roster_min ?? null, settings.roster_max ?? null,
        JSON.stringify(settings.divisions), JSON.stringify(settings.conferences),
        settings.rules_notes ?? null, settings.slider_presets,
        settings.require_verified_identities, settings.applied_template_id ?? null,
        appUserId, summary.changeSummary,
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

    const league = await leagueAccessFor(leagueId, user);
    if (!league) {
      notFound(res, "League not found");
      return;
    }

    if (!can(user, "league:write", { kind: "league", ownerId: league.ownerId, commissionerIds: league.commissionerIds })) {
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

    const league = await leagueAccessFor(leagueId, user);
    if (!league) {
      notFound(res, "League not found");
      return;
    }

    if (!can(user, "season:create", { kind: "league", ownerId: league.ownerId, commissionerIds: league.commissionerIds })) {
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
      games_per_matchup,
      points_win,
      points_ot_loss,
      points_reg_loss,
      tiebreakers,
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
        points_win: number;
        points_ot_loss: number;
        points_reg_loss: number;
        tiebreakers: string[];
        use_league_defaults: boolean;
      }>(
        `SELECT v.id AS settings_version_id, v.team_count, v.salary_cap_cents, v.roster_min, v.roster_max,
                v.schedule_format, v.schedule_settings,
                COALESCE((v.schedule_settings->>'points_win')::int, 2) AS points_win,
                COALESCE((v.schedule_settings->>'points_ot_loss')::int, 1) AS points_ot_loss,
                COALESCE((v.schedule_settings->>'points_reg_loss')::int, 0) AS points_reg_loss,
                CASE WHEN jsonb_typeof(v.schedule_settings->'tiebreakers') = 'array'
                     THEN ARRAY(SELECT jsonb_array_elements_text(v.schedule_settings->'tiebreakers'))
                     ELSE ARRAY['points','rw','row','wins','diff','gf'] END AS tiebreakers,
                COALESCE((v.schedule_settings->>'use_league_defaults')::boolean, true) AS use_league_defaults
           FROM league_settings_active a
           JOIN league_settings_version v ON v.id = a.settings_version_id
          WHERE a.league_id = $1`,
        [leagueId],
      );
      const settings = settingsRow.rows[0];
      if (!settings) {
        throw new Error(`League ${leagueId} has no active settings version`);
      }
      const overrideValues = [
        salary_cap_cents, roster_min, roster_max, games_per_matchup,
        points_win, points_ot_loss, points_reg_loss, tiebreakers,
      ];
      if (!settings.use_league_defaults && overrideValues.some(value => value === undefined)) {
        await client.query("ROLLBACK");
        badRequest(res, "Select a template or complete every season setting before creating the season");
        return;
      }
      const resolvedSalaryCap = salary_cap_cents === undefined ? settings.salary_cap_cents : salary_cap_cents;
      const resolvedRosterMin = roster_min === undefined ? settings.roster_min : roster_min;
      const resolvedRosterMax = roster_max === undefined ? settings.roster_max : roster_max;
      const resolvedGames = games_per_matchup ?? Number(settings.schedule_settings.games_per_matchup);
      const resolvedPointsWin = points_win ?? settings.points_win;
      const resolvedPointsOtLoss = points_ot_loss ?? settings.points_ot_loss;
      const resolvedPointsRegLoss = points_reg_loss ?? settings.points_reg_loss;
      const resolvedTiebreakers = tiebreakers ?? settings.tiebreakers;
      if (resolvedRosterMin != null && resolvedRosterMax != null && resolvedRosterMin > resolvedRosterMax) {
        await client.query("ROLLBACK");
        badRequest(res, "roster_min must not exceed roster_max");
        return;
      }

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
          resolvedSalaryCap,
          resolvedRosterMin,
          resolvedRosterMax,
          resolvedGames,
          resolvedPointsWin, resolvedPointsOtLoss, resolvedPointsRegLoss, resolvedTiebreakers,
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

    const leagueId = String(req.params.leagueId);

    const league = await leagueAccessFor(leagueId, user);
    if (!league) {
      notFound(res, "League not found");
      return;
    }

    if (!can(user, "league:write", { kind: "league", ownerId: league.ownerId, commissionerIds: league.commissionerIds })) {
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

const updateLeagueListing = async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) {
      unauthorized(res, "Authentication required");
      return;
    }

    const params = UpdateLeagueListingParams.safeParse(req.params);
    if (!params.success) {
      badRequest(res, params.error.message);
      return;
    }
    const leagueId = params.data.leagueId;

    const league = await leagueAccessFor(leagueId, user);
    if (!league) {
      notFound(res, "League not found");
      return;
    }

    if (!can(user, "league:write", { kind: "league", ownerId: league.ownerId, commissionerIds: league.commissionerIds })) {
      forbidden(res, "Only the league owner can update listing settings");
      return;
    }

    const parsed = UpdateLeagueListingBody.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.message);
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      badRequest(res, "No fields to update");
      return;
    }
    const update = parsed.data;
    // Persist canonical database enum values while retaining the legacy request
    // vocabulary documented by the listing update contract.
    const platformAliases: Record<string, "playstation" | "xbox" | "crossplay"> = {
      psn: "playstation", playstation: "playstation", xbox: "xbox",
      both: "crossplay", crossplay: "crossplay",
    };
    const normalizedUpdate = update.platform === undefined || update.platform === null
      ? update
      : { ...update, platform: platformAliases[update.platform] };
    const existing = await pool.query<{
      is_listed: boolean; accepting_signups: boolean; accepting_waitlist: boolean;
      blurb: string | null; platform: string | null; competitiveness: string | null;
      suggested_division: string | null; timezone_focus: string | null;
    }>(`SELECT is_listed, accepting_signups, accepting_waitlist, blurb, platform,
               competitiveness, suggested_division, timezone_focus
          FROM league_listing WHERE league_id = $1`, [leagueId]);
    const current = existing.rows[0] ?? {
      is_listed: false, accepting_signups: false, accepting_waitlist: true,
      blurb: null, platform: null, competitiveness: null,
      suggested_division: null, timezone_focus: null,
    };
    const listing = { ...current, ...normalizedUpdate };
    const { is_listed, accepting_signups, accepting_waitlist, blurb, platform,
      competitiveness, suggested_division, timezone_focus } = listing;
    const validDivisions = ["bronze", "silver", "gold", "diamond", "platinum", "elite", "ultimate", null];
    if (!validDivisions.includes(suggested_division)) {
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
        is_listed,
        accepting_signups,
        accepting_waitlist,
        blurb,
        platform,
        competitiveness,
        suggested_division,
        timezone_focus,
      ]
    );

    res.json(result.rows[0]);
};

router.patch("/leagues/:leagueId/listing", updateLeagueListing);
// Backwards-compatible transport alias while API clients migrate to PATCH.
// Both methods use identical partial-update semantics.
router.put("/leagues/:leagueId/listing", updateLeagueListing);

export default router;
