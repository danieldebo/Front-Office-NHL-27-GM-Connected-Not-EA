/**
 * Discovery routes — open leagues directory and sign-up/waitlist intake.
 *
 * GET  /leagues/open               — public list of recruiting leagues
 * POST /leagues/:id/signup         — authenticated sign-up for a seat
 * POST /leagues/:id/waitlist       — authenticated join waitlist
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { unauthorized, badRequest, conflict, notFound, forbidden } from "../server/errors";
import { rateLimiter } from "../middlewares/rateLimiter";
import { LEAGUE_MEMBERSHIP_CAP, countActiveLeagueMemberships } from "../server/core/leagueLimits";

const router: IRouter = Router();

type EligibilityProfile = {
  id: string;
  timezone: string;
  xbox_gamertag: string | null;
  psn_online_id: string | null;
  systems_played: string[];
  primary_identity: string | null;
};

export function savedIdentityForLeague(
  leaguePlatform: string,
  profile: EligibilityProfile,
): { platform: "xbox" | "playstation"; gamertag: string } | null {
  const xbox = profile.systems_played.includes("xbox") && profile.xbox_gamertag
    ? { platform: "xbox" as const, gamertag: profile.xbox_gamertag }
    : null;
  const playstation = profile.systems_played.includes("playstation") && profile.psn_online_id
    ? { platform: "playstation" as const, gamertag: profile.psn_online_id }
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
): Promise<{ profile: EligibilityProfile; leaguePlatform: string } | null> {
  const result = await pool.query<EligibilityProfile & { league_platform: string }>(
    `SELECT u.id, u.timezone, u.xbox_gamertag, u.psn_online_id,
            u.systems_played, u.primary_identity, l.platform::text AS league_platform
       FROM app_user u CROSS JOIN league l
      WHERE u.id = $1 AND u.deleted_at IS NULL
        AND l.id = $2 AND l.deleted_at IS NULL`,
    [appUserId, leagueId],
  );
  const row = result.rows[0];
  return row ? { profile: row, leaguePlatform: row.league_platform } : null;
}

// A user can hold at most one live intake state per league: commissioners never
// apply to their own league, existing members never re-apply, and a sign-up and
// a waitlist join are mutually exclusive so the commissioner never sees the same
// person as two disconnected queue entries.
async function intakeConflict(
  leagueId: string,
  appUserId: string,
  ownerUserId: string,
  otherQueue: "signup" | "waitlist",
): Promise<string | null> {
  if (ownerUserId === appUserId) {
    return "You're the commissioner of this league — commissioners can't submit a sign-up or waitlist request to their own league.";
  }
  const membership = await pool.query(
    `SELECT 1 FROM league_membership WHERE league_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [leagueId, appUserId],
  );
  if (membership.rows[0]) {
    return "You're already a member of this league.";
  }
  if (otherQueue === "waitlist") {
    const existing = await pool.query<{ position: number }>(
      `SELECT position FROM waitlist_entry WHERE league_id = $1 AND user_id = $2 AND status IN ('waiting','invited')`,
      [leagueId, appUserId],
    );
    if (existing.rows[0]) {
      return `You're already on the waitlist for this league (position ${existing.rows[0].position}). Leave the waitlist first if you want to submit a new sign-up instead.`;
    }
  } else {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM league_signup WHERE league_id = $1 AND user_id = $2 AND status = 'pending'`,
      [leagueId, appUserId],
    );
    if (existing.rows[0]) {
      return "You've already applied to this league. Wait for the commissioner to review your sign-up instead of joining the waitlist separately.";
    }
  }
  return null;
}

// ──────────────────────────────────────────────── GET /leagues/open

router.get(
  "/leagues/open",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const { platform, competitiveness, seats_open, health_min } = req.query as Record<string, string>;

    const params: unknown[] = [];
    const conditions: string[] = [];
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
    if (seats_open === "true" || seats_open === "1") {
      conditions.push(`seats_open > 0`);
    }
    // health_min filter is a no-op for now (health grade not in view), kept for API compat
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

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
          active_gms
       FROM v_open_leagues
       ${where}
       ORDER BY seats_open DESC, games_confirmed DESC NULLS LAST`,
      params
    );

    const leagueIds = rows.map((r) => r.league_id as string);
    const partnersByLeague = new Map<string, { charities: unknown[]; sponsors: unknown[] }>();
    if (leagueIds.length > 0) {
      const partnerRows = await pool.query<{
        league_id: string; id: string; kind: string; name: string; link: string; blurb: string | null; logo_url: string | null;
      }>(
        `SELECT league_id, id, kind, name, link, blurb, logo_url FROM league_partner
          WHERE league_id = ANY($1::uuid[]) ORDER BY league_id, kind, display_order`,
        [leagueIds]
      );
      for (const p of partnerRows.rows) {
        const entry = partnersByLeague.get(p.league_id) ?? { charities: [], sponsors: [] };
        (p.kind === "charity" ? entry.charities : entry.sponsors).push({
          id: p.id, name: p.name, link: p.link, blurb: p.blurb, logo_url: p.logo_url,
        });
        partnersByLeague.set(p.league_id, entry);
      }
    }
    const data = rows.map((r) => ({
      ...r,
      partners: partnersByLeague.get(r.league_id as string) ?? { charities: [], sponsors: [] },
    }));

    res.json({ data, total: data.length });
  }
);

// ──────────────────────────────────────────────── POST /leagues/:id/signup

router.post(
  "/leagues/:id/signup",
  rateLimiter({ getLeagueId: (r) => String(r.params.id) }),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = String(req.params.id);

    if (!user.appUserId) { unauthorized(res, "User not found"); return; }
    const appUserId = user.appUserId;

    // Verify league is listed and accepting signups
    const listingRow = await pool.query<{
      league_id: string;
      accepting_signups: boolean;
      accepting_waitlist: boolean;
      owner_user_id: string;
    }>(
      `SELECT ll.league_id, ll.accepting_signups, ll.accepting_waitlist, l.owner_user_id
         FROM league_listing ll JOIN league l ON l.id = ll.league_id
        WHERE ll.league_id = $1 AND ll.is_listed = TRUE`,
      [leagueId]
    );
    if (!listingRow.rows[0]) { notFound(res, "League not found or not recruiting"); return; }

    // Enforce accepting_signups gate
    if (!listingRow.rows[0].accepting_signups) {
      conflict(res, "This league is not accepting new sign-ups at this time");
      return;
    }

    const conflictReason = await intakeConflict(leagueId, appUserId, listingRow.rows[0].owner_user_id, "waitlist");
    if (conflictReason) { conflict(res, conflictReason); return; }

    const eligibility = await getEligibility(appUserId, leagueId);
    const identity = eligibility
      ? savedIdentityForLeague(eligibility.leaguePlatform, eligibility.profile)
      : null;
    if (!eligibility || !identity) {
      badRequest(res, "Your saved profile does not have an eligible console identity for this league");
      return;
    }

    const { country_code, location, stated_division, message, preferred_club } = req.body as {
      country_code?: string;
      location?: string;
      stated_division?: string;
      message?: string;
      preferred_club?: string;
    };

    // Validate country_code format if provided
    if (country_code && !/^[A-Z]{2}$/.test(country_code)) {
      badRequest(res, "country_code must be ISO 3166-1 alpha-2 (two uppercase letters)");
      return;
    }

    const validDivisions = ["bronze", "silver", "gold", "diamond", "platinum", "elite", "ultimate"];
    if (stated_division && !validDivisions.includes(stated_division)) {
      badRequest(res, `stated_division must be one of: ${validDivisions.join(", ")}`);
      return;
    }

    try {
      const { rows } = await pool.query<{ id: string; created_at: Date }>(
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

      res.status(201).json({
        id: rows[0]!.id,
        league_id: leagueId,
        user_id: appUserId,
        platform: identity.platform,
        platform_gamertag: identity.gamertag,
        timezone: eligibility.profile.timezone,
        country_code: country_code ?? null,
        location: location ?? null,
        stated_division: stated_division ?? null,
        message: message ?? null,
        preferred_club: preferred_club ?? null,
        created_at: rows[0]!.created_at,
      });
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr?.code === "23505") {
        conflict(res, "You have already signed up for this league");
        return;
      }
      throw err;
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

    // Verify league exists and accepts waitlist
    const listingRow = await pool.query<{ accepting_waitlist: boolean; owner_user_id: string }>(
      `SELECT ll.accepting_waitlist, l.owner_user_id
         FROM league_listing ll JOIN league l ON l.id = ll.league_id
        WHERE ll.league_id = $1 AND ll.is_listed = TRUE`,
      [leagueId]
    );
    if (!listingRow.rows[0]) { notFound(res, "League not found or not recruiting"); return; }
    if (!listingRow.rows[0].accepting_waitlist) {
      conflict(res, "This league is not accepting waitlist entries");
      return;
    }

    const conflictReason = await intakeConflict(String(leagueId), appUserId, listingRow.rows[0].owner_user_id, "signup");
    if (conflictReason) { conflict(res, conflictReason); return; }

    const eligibility = await getEligibility(appUserId, String(leagueId));
    const identity = eligibility
      ? savedIdentityForLeague(eligibility.leaguePlatform, eligibility.profile)
      : null;
    if (!eligibility || !identity) {
      badRequest(res, "Your saved profile does not have an eligible console identity for this league");
      return;
    }

    // A live sign-up would already have been rejected above by intakeConflict, so
    // any waitlist entry created here is never linked to one.
    const signupId: string | null = null;

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

      await client.query("COMMIT");

      res.status(201).json({
        id: rows[0]!.id,
        league_id: leagueId,
        user_id: appUserId,
        signup_id: signupId,
        status: "waiting",
        position: rows[0]!.position,
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

async function getLeagueOwnerDiscovery(leagueId: string) {
  const row = await pool.query<{ id: string; owner_user_id: string }>(
    `SELECT id, owner_user_id FROM league WHERE id = $1 AND deleted_at IS NULL`,
    [leagueId]
  );
  return row.rows[0] ?? null;
}

async function getAppUserIdDiscovery(replitId: string): Promise<string | null> {
  const row = await pool.query<{ id: string }>(
    `SELECT id FROM app_user WHERE replit_id = $1`,
    [replitId]
  );
  return row.rows[0]?.id ?? null;
}

// ──────────────────────────────────────────────── GET /leagues/:id/signups

router.get(
  "/leagues/:id/signups",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = String(req.params.id);
    const league = await getLeagueOwnerDiscovery(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    // Resolve Replit sub → app_user.id (UUID) before comparing to league.owner_user_id
    const callerAppUserId = await getAppUserIdDiscovery(user.id);
    if (!callerAppUserId || callerAppUserId !== league.owner_user_id) {
      forbidden(res, "Only the league commissioner can view sign-ups");
      return;
    }

    // ?status=pending (default) shows the live queue; ?status=resolved shows
    // past decisions; ?status=all shows everything.
    const statusFilter = typeof req.query.status === "string" ? req.query.status : "pending";
    const statusClause =
      statusFilter === "all" ? "" :
      statusFilter === "resolved" ? "AND su.status <> 'pending'" :
      "AND su.status = 'pending'";

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
          su.message,
          su.preferred_club,
          su.created_at,
          su.status,
          su.decided_at,
          su.decision_note,
          decider.display_name                          AS decided_by_name,
          w.status                                      AS waitlist_status,
          w.position                                    AS waitlist_position
       FROM league_signup su
       JOIN app_user u ON u.id = su.user_id
       LEFT JOIN app_user decider ON decider.id = su.decided_by
       LEFT JOIN waitlist_entry w ON w.signup_id = su.id
       WHERE su.league_id = $1 ${statusClause}
       ORDER BY su.created_at ASC`,
      [leagueId]
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
    const league = await getLeagueOwnerDiscovery(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    const callerAppUserId = await getAppUserIdDiscovery(user.id);
    if (!callerAppUserId || callerAppUserId !== league.owner_user_id) {
      forbidden(res, "Only the league commissioner can view the waitlist");
      return;
    }

    const statusFilter = typeof req.query.status === "string" ? req.query.status : "active";
    const statusClause =
      statusFilter === "all" ? "" :
      statusFilter === "resolved" ? "AND w.status IN ('placed','declined','withdrawn','expired')" :
      "AND w.status IN ('waiting','invited')";

    // v_waitlist only carries the live queue (waiting/invited) — resolved
    // entries are queried directly off the base tables here so a
    // waitlist-only decision (no league_signup row) still has a history.
    const { rows } = await pool.query(
      `SELECT
           w.id                                          AS waitlist_entry_id,
           w.signup_id,
           w.league_id,
           w.position,
           w.status,
           w.user_id,
           u.display_name,
           su.stated_division                            AS skill_division,
           COALESCE(su.country_code, u.country_code)      AS country_code,
           COALESCE(su.location, u.location)              AS location,
           COALESCE(su.timezone, u.timezone)               AS timezone,
           COALESCE(su.platform::text, w.platform)         AS platform,
           COALESCE(su.platform_gamertag, w.platform_gamertag)
                                                            AS platform_gamertag,
           w.joined_at,
           w.invited_at,
           w.invite_expires_at,
           w.resolved_at,
           w.decline_note,
           decider.display_name                           AS decided_by_name
        FROM waitlist_entry w
        JOIN app_user u ON u.id = w.user_id
        LEFT JOIN league_signup su ON su.id = w.signup_id
        LEFT JOIN app_user decider ON decider.id = w.decided_by
       WHERE w.league_id = $1 ${statusClause}
       ORDER BY w.position ASC`,
      [leagueId]
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

    const leagueId = String(req.params.id);
    const signupId = String(req.params.signupId);

    const league = await getLeagueOwnerDiscovery(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    // Resolve Replit sub → app_user.id (UUID) before comparing to league.owner_user_id
    const callerAppUserId = await getAppUserIdDiscovery(user.id);
    if (!callerAppUserId || callerAppUserId !== league.owner_user_id) {
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

    if ((await countActiveLeagueMemberships(applicant.user_id)) >= LEAGUE_MEMBERSHIP_CAP) {
      conflict(res, `This applicant is already in ${LEAGUE_MEMBERSHIP_CAP} leagues — the maximum allowed — and can't be accepted.`);
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Resolve waitlist entries for this applicant in this league. Filter by
      // (league_id, user_id) — not just signup_id — so rows where the user
      // joined the waitlist without a signup (signup_id IS NULL) are also
      // captured. signup_id is left intact now that the signup row it points
      // to is never deleted — that link is part of the history too.
      await client.query(
        `UPDATE waitlist_entry
            SET status = 'placed', resolved_at = now(), decided_by = $3
          WHERE league_id = $1 AND user_id = $2 AND status IN ('waiting','invited')`,
        [leagueId, applicant.user_id, callerAppUserId]
      );

      // Upsert league_membership so the applicant becomes a league member.
      // role = 'gm' — commissioner assigns the franchise seat separately.
      await client.query(
        `INSERT INTO league_membership (league_id, user_id, role)
         VALUES ($1, $2, 'gm')
         ON CONFLICT (league_id, user_id) DO NOTHING`,
        [leagueId, applicant.user_id]
      );

      // Record the decision rather than deleting the signup, so a
      // commissioner can look back at who they accepted and when.
      if (signupRow.rows[0]) {
        await client.query(
          `UPDATE league_signup SET status = 'accepted', decided_by = $1, decided_at = now() WHERE id = $2`,
          [callerAppUserId, signupId]
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

    const leagueId = String(req.params.id);
    const signupId = String(req.params.signupId);

    const league = await getLeagueOwnerDiscovery(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    // Resolve Replit sub → app_user.id (UUID) before comparing to league.owner_user_id
    const callerAppUserId = await getAppUserIdDiscovery(user.id);
    if (!callerAppUserId || callerAppUserId !== league.owner_user_id) {
      forbidden(res, "Only the league commissioner can decline applicants");
      return;
    }

    const { note } = (req.body ?? {}) as { note?: unknown };
    if (note !== undefined && (typeof note !== "string" || note.length > 500)) {
      badRequest(res, "note must be a string of 500 characters or fewer");
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

      // Resolve waitlist entries for this applicant in this league. Filter by
      // (league_id, user_id) — not just signup_id — so rows where the user
      // joined the waitlist without a signup (signup_id IS NULL) are also
      // captured. signup_id is left intact — the signup row it points to is
      // never deleted, so that link stays part of the history.
      if (note === undefined) {
        await client.query(
          `UPDATE waitlist_entry
              SET status = 'declined', resolved_at = now(), decided_by = $3
            WHERE league_id = $1 AND user_id = $2 AND status IN ('waiting','invited')`,
          [leagueId, applicant.user_id, callerAppUserId]
        );
      } else {
        await client.query(
          `UPDATE waitlist_entry
              SET status = 'declined', resolved_at = now(), decline_note = $3, decided_by = $4
            WHERE league_id = $1 AND user_id = $2 AND status IN ('waiting','invited')`,
          [leagueId, applicant.user_id, note, callerAppUserId]
        );
      }

      // Record the decision rather than deleting the signup, so a
      // commissioner can look back at who they declined, when, and why.
      if (signupRow.rows[0]) {
        await client.query(
          `UPDATE league_signup
              SET status = 'declined', decided_by = $1, decided_at = now(), decision_note = $2
            WHERE id = $3`,
          [callerAppUserId, note ?? null, signupId]
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

    const leagueId = String(req.params.id);
    const targetUserId = String(req.params.userId);

    const league = await getLeagueOwnerDiscovery(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    const callerAppUserId = await getAppUserIdDiscovery(user.id);
    if (!callerAppUserId || callerAppUserId !== league.owner_user_id) {
      forbidden(res, "Only the league commissioner can reorder the waitlist");
      return;
    }

    const { position } = req.body as { position?: unknown };
    if (typeof position !== "number" || !Number.isInteger(position) || position < 1) {
      badRequest(res, "position must be a positive integer");
      return;
    }

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
