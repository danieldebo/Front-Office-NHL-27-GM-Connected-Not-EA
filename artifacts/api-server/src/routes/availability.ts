/**
 * Availability routes — per-GM scheduling preferences + overlap surfacing.
 *
 * PUT /leagues/:leagueId/availability      — set my availability for this league
 * GET /leagues/:leagueId/availability/me   — get my availability
 * GET /games/:gameId/overlap               — overlapping slots for a matchup's GMs
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { notFound, unauthorized, badRequest } from "../server/errors";
import { rateLimiter } from "../middlewares/rateLimiter";
import { computeOverlap } from "../server/core/availability";
import { SetAvailabilityBody } from "@workspace/api-zod";

const router: IRouter = Router();

// ─────────────────────────────────────── Set my availability

router.put(
  "/leagues/:leagueId/availability",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const { leagueId } = req.params;

    // League must exist
    const leagueRow = await pool.query(
      `SELECT id FROM league WHERE id = $1`,
      [leagueId]
    );
    if (!leagueRow.rows[0]) { notFound(res, "League not found"); return; }

    const parsed = SetAvailabilityBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    const { timezone, slots } = parsed.data;

    // Look up app_user
    const userRow = await pool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE replit_id = $1`,
      [user.id]
    );
    if (!userRow.rows[0]) {
      badRequest(res, "User profile not found. Sign in again to provision your profile.");
      return;
    }
    const appUserId = userRow.rows[0].id;

    // Validate IANA timezone
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      badRequest(res, `Invalid IANA timezone: ${timezone}`); return;
    }

    // Validate each slot
    const validBlocks = ["morning", "afternoon", "evening", "night"] as const;
    for (const slot of slots) {
      if (slot.dow < 0 || slot.dow > 6) {
        badRequest(res, `Invalid dow ${slot.dow}: must be 0 (Sun) – 6 (Sat)`); return;
      }
      if (!validBlocks.includes(slot.block as typeof validBlocks[number])) {
        badRequest(res, `Invalid block: ${slot.block}`); return;
      }
    }

    const result = await pool.query<{
      id: string; timezone: string; slots: unknown; updated_at: Date;
    }>(
      `INSERT INTO gm_availability (user_id, league_id, timezone, slots, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW())
       ON CONFLICT (user_id, league_id)
       DO UPDATE SET timezone = EXCLUDED.timezone,
                     slots    = EXCLUDED.slots,
                     updated_at = NOW()
       RETURNING id, timezone, slots, updated_at`,
      [appUserId, leagueId, timezone, JSON.stringify(slots)]
    );

    res.json(result.rows[0]);
  }
);

// ─────────────────────────────────────── Get my availability

router.get(
  "/leagues/:leagueId/availability/me",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const { leagueId } = req.params;

    const userRow = await pool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE replit_id = $1`,
      [user.id]
    );
    if (!userRow.rows[0]) {
      // Not provisioned yet — return empty availability
      res.json({ timezone: "UTC", slots: [] });
      return;
    }

    const result = await pool.query<{
      id: string; timezone: string; slots: unknown; updated_at: Date;
    }>(
      `SELECT id, timezone, slots, updated_at
         FROM gm_availability
        WHERE user_id = $1 AND league_id = $2`,
      [userRow.rows[0].id, leagueId]
    );

    if (!result.rows[0]) {
      res.json({ timezone: "UTC", slots: [] });
      return;
    }

    res.json(result.rows[0]);
  }
);

// ─────────────────────────────────────── Overlap for a matchup

router.get(
  "/games/:gameId/overlap",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const { gameId } = req.params;

    // Load game + both GMs' app_user IDs and availability
    const gameRow = await pool.query<{
      id: string;
      window_opens_at: Date;
      window_closes_at: Date;
      home_app_user_id: string | null;
      away_app_user_id: string | null;
    }>(
      `SELECT
         g.id,
         g.window_opens_at,
         g.window_closes_at,
         hga_user.id  AS home_app_user_id,
         aga_user.id  AS away_app_user_id
       FROM game g
       LEFT JOIN gm_assignment hga ON hga.team_season_id = g.home_team_season_id AND hga.ended_at IS NULL
       LEFT JOIN app_user hga_user  ON hga_user.id = hga.user_id
       LEFT JOIN gm_assignment aga ON aga.team_season_id = g.away_team_season_id AND aga.ended_at IS NULL
       LEFT JOIN app_user aga_user  ON aga_user.id = aga.user_id
      WHERE g.id = $1`,
      [gameId]
    );

    if (!gameRow.rows[0]) { notFound(res, "Game not found"); return; }
    const game = gameRow.rows[0];

    // Load availability for both GMs (NULL if unset)
    const getAvail = async (
      appUserId: string | null,
      leagueId: string
    ): Promise<{ timezone: string; slots: unknown } | null> => {
      if (!appUserId) return null;
      const r = await pool.query<{ timezone: string; slots: unknown }>(
        `SELECT ga.timezone, ga.slots
           FROM gm_availability ga
           JOIN game g ON g.season_id = (SELECT season_id FROM game WHERE id = $3)
          WHERE ga.user_id = $1
            AND ga.league_id = (SELECT s.league_id FROM game gg JOIN season s ON s.id = gg.season_id WHERE gg.id = $3)`,
        [appUserId, appUserId, gameId]
      );
      return r.rows[0] ?? null;
    };

    // Simpler: load league_id from season, then query availability directly
    const leagueRow = await pool.query<{ league_id: string }>(
      `SELECT s.league_id FROM game g JOIN season s ON s.id = g.season_id WHERE g.id = $1`,
      [gameId]
    );
    const leagueId = leagueRow.rows[0]?.league_id ?? "";

    const availRow = async (appUserId: string | null) => {
      if (!appUserId) return null;
      const r = await pool.query<{ timezone: string; slots: unknown }>(
        `SELECT timezone, slots FROM gm_availability WHERE user_id = $1 AND league_id = $2`,
        [appUserId, leagueId]
      );
      return r.rows[0] ?? null;
    };

    const [av1, av2] = await Promise.all([
      availRow(game.home_app_user_id),
      availRow(game.away_app_user_id),
    ]);

    // If either GM hasn't set availability, return that info
    if (!av1 || !av2) {
      res.json({
        has_overlap: false,
        overlaps: [],
        message: !av1
          ? "Home GM has not set their availability"
          : "Away GM has not set their availability",
      });
      return;
    }

    type Slot = { dow: number; block: "morning" | "afternoon" | "evening" | "night" };
    const parseSlots = (raw: unknown): Slot[] =>
      Array.isArray(raw) ? (raw as Slot[]) : [];

    const result = computeOverlap(
      { timezone: av1.timezone, slots: parseSlots(av1.slots) },
      { timezone: av2.timezone, slots: parseSlots(av2.slots) },
      game.window_opens_at,
      game.window_closes_at
    );

    res.json({
      game_id: gameId,
      window_opens_at:  game.window_opens_at,
      window_closes_at: game.window_closes_at,
      has_overlap:  result.hasOverlap,
      overlaps: result.overlaps.map((o) => ({
        start_utc: o.startUtc,
        end_utc:   o.endUtc,
        home_gm:   o.gm1Local,
        away_gm:   o.gm2Local,
      })),
    });
  }
);

export default router;
