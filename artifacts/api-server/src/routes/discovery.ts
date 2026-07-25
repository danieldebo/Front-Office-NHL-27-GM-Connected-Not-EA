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
import { unauthorized, badRequest, conflict, notFound } from "../server/errors";
import { rateLimiter } from "../middlewares/rateLimiter";

const router: IRouter = Router();

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

    const leagueId = String(req.params.id);

    // Resolve app_user id from replit_id
    const userRow = await pool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE replit_id = $1`,
      [user.id]
    );
    if (!userRow.rows[0]) { unauthorized(res, "User not found"); return; }
    const appUserId = userRow.rows[0].id;

    // Verify league is listed and accepting signups
    const listingRow = await pool.query<{
      league_id: string;
      accepting_signups: boolean;
      accepting_waitlist: boolean;
    }>(
      `SELECT league_id, accepting_signups, accepting_waitlist FROM league_listing WHERE league_id = $1 AND is_listed = TRUE`,
      [leagueId]
    );
    if (!listingRow.rows[0]) { notFound(res, "League not found or not recruiting"); return; }

    // Enforce accepting_signups gate
    if (!listingRow.rows[0].accepting_signups) {
      conflict(res, "This league is not accepting new sign-ups at this time");
      return;
    }

    const { platform, timezone, country_code, location, stated_division, message, preferred_club } = req.body as {
      platform?: string;
      timezone?: string;
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
           (league_id, user_id, stated_division, platform, timezone, country_code, location, message, preferred_club)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, created_at`,
        [
          leagueId, appUserId,
          stated_division ?? null,
          platform ?? null,
          timezone ?? null,
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
        platform: platform ?? null,
        timezone: timezone ?? null,
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

    // Resolve app_user id from replit_id
    const userRow = await pool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE replit_id = $1`,
      [user.id]
    );
    if (!userRow.rows[0]) { unauthorized(res, "User not found"); return; }
    const appUserId = userRow.rows[0].id;

    // Verify league exists and accepts waitlist
    const listingRow = await pool.query<{ accepting_waitlist: boolean }>(
      `SELECT accepting_waitlist FROM league_listing WHERE league_id = $1 AND is_listed = TRUE`,
      [leagueId]
    );
    if (!listingRow.rows[0]) { notFound(res, "League not found or not recruiting"); return; }
    if (!listingRow.rows[0].accepting_waitlist) {
      conflict(res, "This league is not accepting waitlist entries");
      return;
    }

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
        `INSERT INTO waitlist_entry (league_id, user_id, signup_id, status, position)
         VALUES ($1, $2, $3, 'waiting', $4)
         RETURNING id, position, joined_at`,
        [leagueId, appUserId, signupId, nextPos]
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

export default router;
