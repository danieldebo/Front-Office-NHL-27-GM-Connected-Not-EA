/**
 * Discovery routes — open leagues directory and sign-up/waitlist intake.
 *
 * GET  /leagues/open               — public list of recruiting leagues
 * POST /leagues/:id/signup         — authenticated sign-up for a seat
 * POST /leagues/:id/waitlist       — authenticated join waitlist
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth/index.js";
import { unauthorized, badRequest, conflict, notFound, forbidden } from "../server/errors";
import { rateLimiter } from "../middlewares/rateLimiter";
import { can } from "../server/authz";
import { leagueAccessFor, type LeagueAccess } from "../server/leagueAccess";
import {
  JoinLeagueWaitlistBody,
  ListOpenLeaguesQueryParams,
  ListLeagueSignupsQueryParams,
  ListLeagueWaitlistQueryParams,
  SignupForLeagueBody,
  SignupForLeagueParams,
  DeclineApplicantBody,
  DeclineApplicantParams,
  ReorderWaitlistEntryBody,
  ReorderWaitlistEntryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EligibilityProfile = {
  id: string;
  timezone: string;
  xbox_gamertag: string | null;
  psn_online_id: string | null;
  systems_played: string[];
  primary_identity: string | null;
  xbox_identity_verified_at: Date | null;
  playstation_identity_verified_at: Date | null;
};

export function savedIdentityForLeague(
  leaguePlatform: string,
  profile: EligibilityProfile,
): { platform: "xbox" | "playstation"; gamertag: string; verified: boolean } | null {
  const xbox = profile.systems_played.includes("xbox") && profile.xbox_gamertag
    ? { platform: "xbox" as const, gamertag: profile.xbox_gamertag,
        verified: Boolean(profile.xbox_identity_verified_at) }
    : null;
  const playstation = profile.systems_played.includes("playstation") && profile.psn_online_id
    ? { platform: "playstation" as const, gamertag: profile.psn_online_id,
        verified: Boolean(profile.playstation_identity_verified_at) }
    : null;
  if (leaguePlatform === "xbox") return xbox;
  if (leaguePlatform === "playstation") return playstation;
  if (profile.primary_identity === "xbox" && xbox) return xbox;
  if (profile.primary_identity === "playstation" && playstation) return playstation;
  return xbox ?? playstation;
}

async function getEligibility(
  appUserId: string,
  leagueId: string,
): Promise<{ profile: EligibilityProfile; leaguePlatform: string; requireVerified: boolean } | null> {
  const result = await pool.query<EligibilityProfile & {
    league_platform: string; require_verified_identities: boolean;
  }>(
    `SELECT u.id, u.timezone, u.xbox_gamertag, u.psn_online_id,
             u.systems_played, u.primary_identity, u.xbox_identity_verified_at,
             u.playstation_identity_verified_at, l.platform::text AS league_platform,
             COALESCE(v.require_verified_identities, FALSE) AS require_verified_identities
        FROM app_user u CROSS JOIN league l
        LEFT JOIN league_settings_active a ON a.league_id = l.id
        LEFT JOIN league_settings_version v ON v.id = a.settings_version_id
      WHERE u.id = $1 AND u.deleted_at IS NULL
        AND l.id = $2 AND l.deleted_at IS NULL`,
    [appUserId, leagueId],
  );
  const row = result.rows[0];
  return row ? {
    profile: row,
    leaguePlatform: row.league_platform,
    requireVerified: row.require_verified_identities,
  } : null;
}

async function validateSeatPreferences(
  queryable: Pick<typeof pool, "query">,
  leagueId: string,
  teamSeasonIds: string[],
): Promise<boolean> {
  if (teamSeasonIds.length === 0) return true;
  if (teamSeasonIds.some((id) => !UUID_PATTERN.test(id))) return false;

  const result = await queryable.query<{ id: string }>(
    `SELECT ts.id
       FROM team_season ts
       JOIN season s ON s.id = ts.season_id
       JOIN franchise f ON f.id = ts.franchise_id
      WHERE f.league_id = $1
        AND s.is_active = TRUE
        AND ts.id = ANY($2::uuid[])
        AND ts.seat_status IN ('open', 'vacated')
        AND NOT EXISTS (
          SELECT 1
            FROM gm_assignment ga
           WHERE ga.team_season_id = ts.id
             AND ga.ended_at IS NULL
        )
      ORDER BY ts.id
      FOR UPDATE OF ts`,
    [leagueId, teamSeasonIds],
  );
  return result.rows.length === teamSeasonIds.length;
}

async function replaceSeatPreferences(
  queryable: Pick<typeof pool, "query">,
  leagueId: string,
  applicantUserId: string,
  teamSeasonIds: string[],
): Promise<void> {
  if (teamSeasonIds.length === 0) {
    const tableCheck = await queryable.query<{ exists: boolean }>(
      `SELECT to_regclass('public.applicant_team_season_preference') IS NOT NULL AS exists`,
    );
    if (!tableCheck.rows[0]?.exists) return;
  }
  await queryable.query(
    `DELETE FROM applicant_team_season_preference
      WHERE league_id = $1 AND applicant_user_id = $2`,
    [leagueId, applicantUserId],
  );
  if (teamSeasonIds.length === 0) return;
  await queryable.query(
    `INSERT INTO applicant_team_season_preference
       (league_id, applicant_user_id, team_season_id)
     SELECT $1, $2, unnest($3::uuid[])`,
    [leagueId, applicantUserId, teamSeasonIds],
  );
}

async function seatPreferenceTableExists(): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.applicant_team_season_preference') IS NOT NULL AS exists`,
  );
  return result.rows[0]?.exists ?? false;
}

// ──────────────────────────────────────────────── GET /leagues/open

router.get(
  "/leagues/open",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const query = ListOpenLeaguesQueryParams.safeParse(req.query);
    if (!query.success) { badRequest(res, query.error.message); return; }
    const { platform, competitiveness, seats_open, health_min } = query.data;

    const params: unknown[] = [];
    const conditions: string[] = [
      `EXISTS (
         SELECT 1
           FROM league public_league
          WHERE public_league.id = v_open_leagues.league_id
            AND public_league.deleted_at IS NULL
            AND public_league.visibility = 'public'
       )`,
    ];
    // v_open_leagues already filters is_listed = true (in the view JOIN)

    if (platform) {
      // Normalise vocabulary: accept both pre-1.5.0 ('psn','both') and post-1.5.0 ('playstation','crossplay')
      const normalised: Record<string, string[]> = {
        psn: ["psn", "playstation"],
        playstation: ["psn", "playstation"],
        xbox: ["xbox"],
        both: ["both", "crossplay"],
        crossplay: ["both", "crossplay"],
      };
      const aliases = normalised[platform.toLowerCase()];
      if (aliases) {
        params.push(aliases);
        conditions.push(`LOWER(platform) = ANY($${params.length}::text[])`);
      }
    }
    if (competitiveness) {
      params.push(competitiveness.toLowerCase());
      conditions.push(`LOWER(competitiveness) = $${params.length}`);
    }
    if (seats_open === "true") {
      conditions.push(`seats_open > 0`);
    }
    // health_min filter is a no-op for now (health grade not in view), kept for API compat
    const where = `WHERE ${conditions.join(" AND ")}`;
    const preferencesAvailable = await seatPreferenceTableExists();
    const openSeatOptionsProjection = preferencesAvailable
      ? `COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'team_season_id', ts.id,
                'franchise_id', f.id,
                'franchise_name', f.name,
                'club_abbrev', nc.abbrev,
                'club_name', nc.name
              )
              ORDER BY f.name
            )
              FROM team_season ts
              JOIN franchise f ON f.id = ts.franchise_id
              LEFT JOIN nhl_club nc ON nc.id = ts.nhl_club_id
             WHERE ts.season_id = v_open_leagues.active_season_id
               AND ts.seat_status IN ('open', 'vacated')
               AND NOT EXISTS (
                 SELECT 1 FROM gm_assignment ga
                  WHERE ga.team_season_id = ts.id AND ga.ended_at IS NULL
               )
          ), '[]'::jsonb)`
      : `'[]'::jsonb`;

    const { rows } = await pool.query(
      `SELECT
          league_id,
          slug,
          name,
          logo_url,
          blurb,
          platform,
          competitiveness,
          suggested_division,
          accepting_signups,
          accepting_waitlist,
          active_season_id,
          max_seats,
          seats_filled,
          seats_open,
          waitlist_length,
          games_confirmed,
          active_gms,
          ${openSeatOptionsProjection} AS open_seat_options
       FROM v_open_leagues
       ${where}
       ORDER BY seats_open DESC, games_confirmed DESC NULLS LAST`,
      params
    );

    res.json({ data: rows, total: rows.length });
  }
);

// ──────────────────────────────────────────────── POST /leagues/:id/signup

router.post(
  "/leagues/:id/signup",
  rateLimiter({ getLeagueId: (r) => String(r.params.id) }),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const params = SignupForLeagueParams.safeParse({ leagueId: req.params.id });
    if (!params.success) { badRequest(res, params.error.message); return; }
    const leagueId = params.data.leagueId;

    if (!user.appUserId) { unauthorized(res, "User not found"); return; }
    const appUserId = user.appUserId;

    // Public recruitment is available only through the intentional public
    // projection; a stale listing row must not reopen a private league.
    const listingRow = await pool.query<{
      league_id: string;
      accepting_signups: boolean;
      accepting_waitlist: boolean;
    }>(
       `SELECT ll.league_id, ll.accepting_signups, ll.accepting_waitlist
          FROM league_listing ll
          JOIN league l ON l.id = ll.league_id
         WHERE ll.league_id = $1
           AND ll.is_listed = TRUE
           AND l.visibility = 'public'
           AND l.deleted_at IS NULL`,
      [leagueId]
    );
    if (!listingRow.rows[0]) { notFound(res, "League not found or not recruiting"); return; }

    // Enforce accepting_signups gate
    if (!listingRow.rows[0].accepting_signups) {
      conflict(res, "This league is not accepting new sign-ups at this time");
      return;
    }

    const eligibility = await getEligibility(appUserId, leagueId);
    const identity = eligibility
      ? savedIdentityForLeague(eligibility.leaguePlatform, eligibility.profile)
      : null;
    if (!eligibility || !identity) {
      badRequest(res, "Your saved profile does not have an eligible console identity for this league");
      return;
    }
    if (eligibility.requireVerified && !identity.verified) {
      badRequest(res, "This league requires a verified console identity; verify it from your profile");
      return;
    }

    const parsed = SignupForLeagueBody.safeParse(req.body ?? {});
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const {
      country_code,
      location,
      stated_division,
      message,
      preferred_club,
      team_season_ids = [],
    } = parsed.data;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (team_season_ids.length > 0 && !await seatPreferenceTableExists()) {
        await client.query("ROLLBACK");
        conflict(res, "Seat preferences are unavailable until the schema migration is applied");
        return;
      }
      if (!await validateSeatPreferences(client, leagueId, team_season_ids)) {
        await client.query("ROLLBACK");
        badRequest(res, "Every selected franchise seat must still be open in this league's active season");
        return;
      }

      const { rows } = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO league_signup
            (league_id, user_id, stated_division, platform, platform_gamertag,
             xbox_gamertag, psn_online_id, systems_played, primary_identity,
             timezone, country_code, location, message, preferred_club)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id, created_at`,
        [
          leagueId, appUserId,
          stated_division ?? null,
          identity.platform,
          identity.gamertag,
          eligibility.profile.xbox_gamertag,
          eligibility.profile.psn_online_id,
          eligibility.profile.systems_played,
          eligibility.profile.primary_identity,
          eligibility.profile.timezone,
          country_code ?? null,
          location ?? null,
          message ?? null,
          preferred_club ?? null,
        ]
      );
      await replaceSeatPreferences(client, leagueId, appUserId, team_season_ids);
      await client.query("COMMIT");

      res.status(201).json({
        id: rows[0]!.id,
        league_id: leagueId,
        user_id: appUserId,
        platform: identity.platform,
        platform_gamertag: identity.gamertag,
        identity_verified: identity.verified,
        timezone: eligibility.profile.timezone,
        country_code: country_code ?? null,
        location: location ?? null,
        stated_division: stated_division ?? null,
        message: message ?? null,
        preferred_club: preferred_club ?? null,
        team_season_ids,
        created_at: rows[0]!.created_at,
      });
    } catch (err: unknown) {
      await client.query("ROLLBACK");
      const pgErr = err as { code?: string };
      if (pgErr?.code === "23505") {
        conflict(res, "You have already signed up for this league");
        return;
      }
      throw err;
    } finally {
      client.release();
    }
  }
);

// ──────────────────────────────────────────────── POST /leagues/:id/waitlist

router.post(
  "/leagues/:id/waitlist",
  rateLimiter({ getLeagueId: (r) => String(r.params.id) }),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const { id: leagueId } = req.params;

    if (!user.appUserId) { unauthorized(res, "User not found"); return; }
    const appUserId = user.appUserId;

    // Keep direct-ID waitlist requests behind the same public projection.
    const listingRow = await pool.query<{ accepting_waitlist: boolean }>(
      `SELECT ll.accepting_waitlist
         FROM league_listing ll
         JOIN league l ON l.id = ll.league_id
        WHERE ll.league_id = $1
          AND ll.is_listed = TRUE
          AND l.visibility = 'public'
          AND l.deleted_at IS NULL`,
      [leagueId]
    );
    if (!listingRow.rows[0]) { notFound(res, "League not found or not recruiting"); return; }
    if (!listingRow.rows[0].accepting_waitlist) {
      conflict(res, "This league is not accepting waitlist entries");
      return;
    }

    const eligibility = await getEligibility(appUserId, String(leagueId));
    const identity = eligibility
      ? savedIdentityForLeague(eligibility.leaguePlatform, eligibility.profile)
      : null;
    if (!eligibility || !identity) {
      badRequest(res, "Your saved profile does not have an eligible console identity for this league");
      return;
    }
    if (eligibility.requireVerified && !identity.verified) {
      badRequest(res, "This league requires a verified console identity; verify it from your profile");
      return;
    }

    const parsed = JoinLeagueWaitlistBody.safeParse(req.body ?? {});
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const teamSeasonIds = parsed.data.team_season_ids ?? [];

    // Find existing signup for this user/league (optional — can join waitlist without prior signup)
    const signupRow = await pool.query<{ id: string }>(
      `SELECT id FROM league_signup WHERE league_id = $1 AND user_id = $2`,
      [leagueId, appUserId]
    );
    const signupId = signupRow.rows[0]?.id ?? null;

    // Check if user is already on the waitlist before attempting insert.
    // Doing this pre-check avoids conflating a user-uniqueness violation with a
    // position-collision during the insert that follows.
    const existingEntry = await pool.query<{ id: string; position: number; status: string; joined_at: Date }>(
      `SELECT id, position, status, joined_at FROM waitlist_entry WHERE league_id = $1 AND user_id = $2`,
      [leagueId, appUserId]
    );
    if (existingEntry.rows[0]) {
      const e = existingEntry.rows[0];
      res.status(200).json({
        id: e.id,
        league_id: leagueId,
        user_id: appUserId,
        signup_id: signupId,
        status: e.status,
        position: e.position,
        joined_at: e.joined_at,
        already_joined: true,
      });
      return;
    }

    // Assign position inside a serializable transaction to prevent two concurrent
    // requests from racing to claim the same position. The advisory lock on the
    // league_id string key serialises concurrent joins for the same league.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (teamSeasonIds.length > 0 && !await seatPreferenceTableExists()) {
        await client.query("ROLLBACK");
        conflict(res, "Seat preferences are unavailable until the schema migration is applied");
        return;
      }
      if (!await validateSeatPreferences(client, String(leagueId), teamSeasonIds)) {
        await client.query("ROLLBACK");
        badRequest(res, "Every selected franchise seat must still be open in this league's active season");
        return;
      }

      // Advisory lock: prevents concurrent joins from reading the same MAX(position)
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [leagueId]
      );

      const posRow = await client.query<{ next_pos: string }>(
        `SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM waitlist_entry WHERE league_id = $1`,
        [leagueId]
      );
      const nextPos = parseInt(posRow.rows[0]!.next_pos, 10);

      const { rows } = await client.query<{ id: string; position: number; joined_at: Date }>(
        `INSERT INTO waitlist_entry
           (league_id, user_id, signup_id, status, position, platform,
            platform_gamertag, xbox_gamertag, psn_online_id,
            systems_played, primary_identity)
         VALUES ($1, $2, $3, 'waiting', $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, position, joined_at`,
        [
          leagueId, appUserId, signupId, nextPos, identity.platform,
          identity.gamertag, eligibility.profile.xbox_gamertag,
          eligibility.profile.psn_online_id, eligibility.profile.systems_played,
          eligibility.profile.primary_identity,
        ]
      );
      await replaceSeatPreferences(client, String(leagueId), appUserId, teamSeasonIds);

      await client.query("COMMIT");

      res.status(201).json({
        id: rows[0]!.id,
        league_id: leagueId,
        user_id: appUserId,
        signup_id: signupId,
        status: "waiting",
        position: rows[0]!.position,
        team_season_ids: teamSeasonIds,
        joined_at: rows[0]!.joined_at,
      });
    } catch (err: unknown) {
      await client.query("ROLLBACK");
      // 23505 here can only be a position collision (user-uniqueness was already
      // checked above). Retry would need orchestration; surface as 409 instead.
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr?.code === "23505") {
        conflict(res, "A concurrent waitlist join caused a conflict — please try again");
        return;
      }
      throw err;
    } finally {
      client.release();
    }
  }
);

// ──────────────────────────────────────────────── helpers (shared)

async function getAppUserIdDiscovery(replitId: string): Promise<string | null> {
  const row = await pool.query<{ id: string }>(
    `SELECT id FROM app_user WHERE replit_id = $1`,
    [replitId]
  );
  return row.rows[0]?.id ?? null;
}

async function canManageDiscovery(user: NonNullable<ReturnType<typeof getCurrentUser>>, league: LeagueAccess): Promise<boolean> {
  const appUserId = user.appUserId ?? await getAppUserIdDiscovery(user.id);
  if (!appUserId) return false;
  return can({ ...user, appUserId }, "league:write", {
    kind: "league", ownerId: league.ownerId, commissionerIds: league.commissionerIds,
  });
}

// ──────────────────────────────────────────────── GET /leagues/:id/signups

router.get(
  "/leagues/:id/signups",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = String(req.params.id);
    const league = await leagueAccessFor(leagueId, user);
    if (!league) { notFound(res, "League not found"); return; }

    if (!await canManageDiscovery(user, league)) {
      forbidden(res, "Only the league commissioner can view sign-ups");
      return;
    }

    const query = ListLeagueSignupsQueryParams.safeParse(req.query);
    if (!query.success) { badRequest(res, query.error.message); return; }
    const seat = query.data.seat ?? null;
    if (seat && !UUID_PATTERN.test(seat)) { badRequest(res, "Invalid seat"); return; }
    const preferencesAvailable = await seatPreferenceTableExists();
    if (seat && !preferencesAvailable) {
      conflict(res, "Seat preference review is unavailable until the schema migration is applied");
      return;
    }
    const preferredSeatsProjection = preferencesAvailable
      ? `COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'team_season_id', preference.team_season_id,
                'franchise_name', preference_franchise.name,
                'club_abbrev', preference_club.abbrev,
                'club_name', preference_club.name
              )
              ORDER BY preference_franchise.name
            )
              FROM applicant_team_season_preference preference
              JOIN team_season preference_team ON preference_team.id = preference.team_season_id
              JOIN franchise preference_franchise ON preference_franchise.id = preference_team.franchise_id
              LEFT JOIN nhl_club preference_club ON preference_club.id = preference_team.nhl_club_id
             WHERE preference.league_id = su.league_id
               AND preference.applicant_user_id = su.user_id
          ), '[]'::jsonb)`
      : `'[]'::jsonb`;
    const seatFilter = seat
      ? `AND EXISTS (
           SELECT 1
             FROM applicant_team_season_preference preference_filter
            WHERE preference_filter.league_id = su.league_id
              AND preference_filter.applicant_user_id = su.user_id
              AND preference_filter.team_season_id = $2
         )`
      : "";

    // Query underlying tables directly so we can include su.id (signup id),
    // which v_league_applicants omits but the commissioner needs for accept/decline.
    const { rows } = await pool.query(
      `SELECT
          su.id                                          AS signup_id,
          su.league_id,
          su.user_id,
          u.display_name,
          su.stated_division                            AS skill_division,
          COALESCE(su.country_code, u.country_code)    AS country_code,
          COALESCE(su.location, u.location)             AS location,
          COALESCE(su.timezone, u.timezone)             AS timezone,
          su.platform,
           su.platform_gamertag,
           su.xbox_gamertag,
           su.psn_online_id,
           su.systems_played,
           su.primary_identity,
           u.xbox_identity_verified_at,
           u.playstation_identity_verified_at,
           CASE su.platform::text
             WHEN 'xbox' THEN u.xbox_identity_verified_at IS NOT NULL
               AND u.xbox_gamertag = su.platform_gamertag
             WHEN 'playstation' THEN u.playstation_identity_verified_at IS NOT NULL
               AND u.psn_online_id = su.platform_gamertag
             ELSE FALSE
           END                                           AS identity_verified,
          su.message,
          su.preferred_club,
          ${preferredSeatsProjection}                  AS preferred_seats,
          su.created_at,
          w.status                                      AS waitlist_status,
          w.position                                    AS waitlist_position
       FROM league_signup su
       JOIN app_user u ON u.id = su.user_id
       LEFT JOIN waitlist_entry w ON w.signup_id = su.id
       WHERE su.league_id = $1
         ${seatFilter}
       ORDER BY su.created_at ASC`,
      seat ? [leagueId, seat] : [leagueId]
    );

    res.json({ data: rows, total: rows.length });
  }
);

// ──────────────────────────────────────────────── GET /leagues/:id/waitlist

router.get(
  "/leagues/:id/waitlist",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = String(req.params.id);
    const league = await leagueAccessFor(leagueId, user);
    if (!league) { notFound(res, "League not found"); return; }

    if (!await canManageDiscovery(user, league)) {
      forbidden(res, "Only the league commissioner can view the waitlist");
      return;
    }

    const query = ListLeagueWaitlistQueryParams.safeParse(req.query);
    if (!query.success) { badRequest(res, query.error.message); return; }
    const seat = query.data.seat ?? null;
    if (seat && !UUID_PATTERN.test(seat)) { badRequest(res, "Invalid seat"); return; }
    const preferencesAvailable = await seatPreferenceTableExists();
    if (seat && !preferencesAvailable) {
      conflict(res, "Seat preference review is unavailable until the schema migration is applied");
      return;
    }
    const preferredSeatsProjection = preferencesAvailable
      ? `COALESCE((
             SELECT jsonb_agg(
               jsonb_build_object(
                 'team_season_id', preference.team_season_id,
                 'franchise_name', preference_franchise.name,
                 'club_abbrev', preference_club.abbrev,
                 'club_name', preference_club.name
               )
               ORDER BY preference_franchise.name
             )
               FROM applicant_team_season_preference preference
               JOIN team_season preference_team ON preference_team.id = preference.team_season_id
               JOIN franchise preference_franchise ON preference_franchise.id = preference_team.franchise_id
               LEFT JOIN nhl_club preference_club ON preference_club.id = preference_team.nhl_club_id
              WHERE preference.league_id = v.league_id
                AND preference.applicant_user_id = v.user_id
           ), '[]'::jsonb)`
      : `'[]'::jsonb`;
    const seatFilter = seat
      ? `AND EXISTS (
           SELECT 1
             FROM applicant_team_season_preference preference_filter
            WHERE preference_filter.league_id = v.league_id
              AND preference_filter.applicant_user_id = v.user_id
              AND preference_filter.team_season_id = $2
         )`
      : "";

    const { rows } = await pool.query(
      `SELECT
           w.id                                          AS waitlist_entry_id,
           w.signup_id,
           v.league_id,
           v.position,
           v.status,
           v.user_id,
           v.display_name,
           v.skill_division,
           v.country_code,
           v.location,
           v.timezone,
            COALESCE(su.platform::text, w.platform)      AS platform,
            COALESCE(su.platform_gamertag, w.platform_gamertag)
                                                            AS platform_gamertag,
            u.xbox_identity_verified_at,
            u.playstation_identity_verified_at,
            CASE COALESCE(su.platform::text, w.platform)
              WHEN 'xbox' THEN u.xbox_identity_verified_at IS NOT NULL
                AND u.xbox_gamertag = COALESCE(su.platform_gamertag, w.platform_gamertag)
              WHEN 'playstation' THEN u.playstation_identity_verified_at IS NOT NULL
                AND u.psn_online_id = COALESCE(su.platform_gamertag, w.platform_gamertag)
              ELSE FALSE
            END                                           AS identity_verified,
           ${preferredSeatsProjection}                    AS preferred_seats,
           v.joined_at,
           v.invited_at,
           v.invite_expires_at
        FROM v_waitlist v
        JOIN waitlist_entry w
          ON w.league_id = v.league_id AND w.user_id = v.user_id
         LEFT JOIN league_signup su ON su.id = w.signup_id
         JOIN app_user u ON u.id = v.user_id
       WHERE v.league_id = $1
         ${seatFilter}
        ORDER BY v.position ASC`,
      seat ? [leagueId, seat] : [leagueId]
    );

    res.json({ data: rows, total: rows.length });
  }
);

// ──────────────────────────────────────────────── POST /leagues/:id/signups/:signupId/accept

router.post(
  "/leagues/:id/signups/:signupId/accept",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const params = DeclineApplicantParams.safeParse({
      leagueId: req.params.id, signupId: req.params.signupId,
    });
    if (!params.success) { badRequest(res, params.error.message); return; }
    const { leagueId, signupId } = params.data;

    const league = await leagueAccessFor(leagueId, user);
    if (!league) { notFound(res, "League not found"); return; }

    if (!await canManageDiscovery(user, league)) {
      forbidden(res, "Only the league commissioner can accept applicants");
      return;
    }

    // Load a signup-backed applicant first. Waitlist-only applicants are reviewed
    // with their waitlist entry id because they have no league_signup row.
    const signupRow = await pool.query<{ id: string; user_id: string; league_id: string }>(
      `SELECT id, user_id, league_id FROM league_signup WHERE id = $1 AND league_id = $2`,
      [signupId, leagueId]
    );
    const waitlistOnlyRow = signupRow.rows[0]
      ? null
      : (await pool.query<{ id: string; user_id: string; league_id: string }>(
          `SELECT id, user_id, league_id
             FROM waitlist_entry
            WHERE id = $1 AND league_id = $2 AND signup_id IS NULL
              AND status IN ('waiting','invited')`,
          [signupId, leagueId]
        )).rows[0] ?? null;
    const applicant = signupRow.rows[0] ?? waitlistOnlyRow;
    if (!applicant) { notFound(res, "Applicant not found"); return; }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Resolve waitlist entries for this applicant in this league.
      // We filter by (league_id, user_id) — not just signup_id — so rows where
      // the user joined the waitlist without a signup (signup_id IS NULL) are also
      // captured. Nulling signup_id is idempotent and keeps the FK safe before
      // the signup row is deleted below.
      await client.query(
        `UPDATE waitlist_entry
            SET signup_id = NULL, status = 'placed', resolved_at = now()
          WHERE league_id = $1 AND user_id = $2 AND status IN ('waiting','invited')`,
        [leagueId, applicant.user_id]
      );

      // Upsert league_membership so the applicant becomes a league member.
      // role = 'gm' — commissioner assigns the franchise seat separately.
      await client.query(
        `INSERT INTO league_membership (league_id, user_id, role)
         VALUES ($1, $2, 'gm')
         ON CONFLICT (league_id, user_id) DO NOTHING`,
        [leagueId, applicant.user_id]
      );

      // Remove the signup so it no longer appears in the pending queue.
      if (signupRow.rows[0]) {
        await client.query(
          `DELETE FROM league_signup WHERE id = $1`,
          [signupId]
        );
      }

      await client.query("COMMIT");

      res.json({
        signup_id: signupRow.rows[0]?.id ?? null,
        user_id: applicant.user_id,
        league_id: leagueId,
        outcome: "accepted",
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

// ──────────────────────────────────────────────── POST /leagues/:id/signups/:signupId/decline

router.post(
  "/leagues/:id/signups/:signupId/decline",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const params = DeclineApplicantParams.safeParse({
      leagueId: req.params.id, signupId: req.params.signupId,
    });
    if (!params.success) { badRequest(res, params.error.message); return; }
    const { leagueId, signupId } = params.data;

    const league = await leagueAccessFor(leagueId, user);
    if (!league) { notFound(res, "League not found"); return; }

    if (!await canManageDiscovery(user, league)) {
      forbidden(res, "Only the league commissioner can decline applicants");
      return;
    }

    const parsed = DeclineApplicantBody.safeParse(req.body ?? {});
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const { note } = parsed.data;

    // Load a signup-backed applicant first. Waitlist-only applicants are reviewed
    // with their waitlist entry id because they have no league_signup row.
    const signupRow = await pool.query<{ id: string; user_id: string; league_id: string }>(
      `SELECT id, user_id, league_id FROM league_signup WHERE id = $1 AND league_id = $2`,
      [signupId, leagueId]
    );
    const waitlistOnlyRow = signupRow.rows[0]
      ? null
      : (await pool.query<{ id: string; user_id: string; league_id: string }>(
          `SELECT id, user_id, league_id
             FROM waitlist_entry
            WHERE id = $1 AND league_id = $2 AND signup_id IS NULL
              AND status IN ('waiting','invited')`,
          [signupId, leagueId]
        )).rows[0] ?? null;
    const applicant = signupRow.rows[0] ?? waitlistOnlyRow;
    if (!applicant) { notFound(res, "Applicant not found"); return; }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Resolve waitlist entries for this applicant in this league.
      // Filter by (league_id, user_id) — not just signup_id — so rows where
      // the user joined the waitlist without a signup (signup_id IS NULL) are
      // also captured. Nulling signup_id is idempotent and keeps the FK safe.
      if (note === undefined) {
        await client.query(
          `UPDATE waitlist_entry
              SET signup_id = NULL, status = 'declined', resolved_at = now()
            WHERE league_id = $1 AND user_id = $2 AND status IN ('waiting','invited')`,
          [leagueId, applicant.user_id]
        );
      } else {
        await client.query(
          `UPDATE waitlist_entry
              SET signup_id = NULL, status = 'declined', resolved_at = now(), decline_note = $3
            WHERE league_id = $1 AND user_id = $2 AND status IN ('waiting','invited')`,
          [leagueId, applicant.user_id, note]
        );
      }

      // Remove the signup so it no longer appears in the pending queue.
      if (signupRow.rows[0]) {
        await client.query(
          `DELETE FROM league_signup WHERE id = $1`,
          [signupId]
        );
      }

      await client.query("COMMIT");

      res.json({
        signup_id: signupRow.rows[0]?.id ?? null,
        user_id: applicant.user_id,
        league_id: leagueId,
        outcome: "declined",
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

// ──────────────────────────────────── PATCH /leagues/:id/waitlist/:userId/position

router.patch(
  "/leagues/:id/waitlist/:userId/position",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const params = ReorderWaitlistEntryParams.safeParse({
      leagueId: req.params.id, userId: req.params.userId,
    });
    if (!params.success) { badRequest(res, params.error.message); return; }
    const { leagueId, userId: targetUserId } = params.data;

    const league = await leagueAccessFor(leagueId, user);
    if (!league) { notFound(res, "League not found"); return; }

    if (!await canManageDiscovery(user, league)) {
      forbidden(res, "Only the league commissioner can reorder the waitlist");
      return;
    }

    const parsed = ReorderWaitlistEntryBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const { position } = parsed.data;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialise concurrent reorder requests for the same league
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [leagueId]);

      // Load ALL active entries (waiting + invited) so we can repack positions
      // globally and avoid collisions with the table-wide UNIQUE (league_id, position)
      // constraint. Resolved statuses (placed/declined/withdrawn/expired) are excluded
      // because they are no longer in the live queue.
      const allActiveRes = await client.query<{ id: string; user_id: string; status: string }>(
        `SELECT id, user_id, status
           FROM waitlist_entry
          WHERE league_id = $1 AND status IN ('waiting','invited')
          ORDER BY position ASC`,
        [leagueId]
      );
      const waiting = allActiveRes.rows.filter(r => r.status === 'waiting');
      const invited = allActiveRes.rows.filter(r => r.status === 'invited');

      const currentIdx = waiting.findIndex(e => e.user_id === targetUserId);
      if (currentIdx === -1) {
        await client.query("ROLLBACK");
        const isInvited = invited.some(e => e.user_id === targetUserId);
        if (isInvited) {
          badRequest(res, "Cannot reorder an entry that has already been invited off the waitlist");
        } else {
          notFound(res, "User not found on the active waiting list");
        }
        return;
      }

      // Clamp target to valid range within the waiting sub-queue, then splice
      const targetPos = Math.min(position, waiting.length);
      const [entry] = waiting.splice(currentIdx, 1);
      waiting.splice(targetPos - 1, 0, entry!);

      // Rewrite positions for ALL active rows so the table-wide unique constraint
      // is satisfied in the final committed state.
      // waiting entries → 1..M   |   invited entries → M+1..M+K
      for (let i = 0; i < waiting.length; i++) {
        await client.query(
          `UPDATE waitlist_entry SET position = $1 WHERE id = $2`,
          [i + 1, waiting[i]!.id]
        );
      }
      for (let i = 0; i < invited.length; i++) {
        await client.query(
          `UPDATE waitlist_entry SET position = $1 WHERE id = $2`,
          [waiting.length + i + 1, invited[i]!.id]
        );
      }

      await client.query("COMMIT");
      res.json({ league_id: leagueId, user_id: targetUserId, position: targetPos });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

export default router;
