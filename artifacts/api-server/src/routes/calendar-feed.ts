/**
 * Calendar feed — read-only .ics subscription URLs, one per league (all
 * games, commissioner-only to mint) and one per GM (that member's own
 * team's games). Tokens are revocable: revoking closes the old row and
 * issues a fresh one rather than editing in place.
 *
 * GET  /leagues/:leagueId/calendar-feed/mine           — caller's personal feed
 * POST /leagues/:leagueId/calendar-feed/mine/revoke    — reissue caller's token
 * GET  /leagues/:leagueId/calendar-feed/league         — commissioner-only, whole league
 * POST /leagues/:leagueId/calendar-feed/league/revoke  — commissioner-only, reissue
 * GET  /calendar/:token                                — public, serves the .ics file
 */
import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import { forbidden, notFound, unauthorized } from "../server/errors";
import { buildIcs, type IcsEvent } from "../server/ics";

const router: IRouter = Router();

function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function icsUrl(req: Request, token: string): string {
  return `${req.protocol}://${req.get("host")}/api/calendar/${token}`;
}

async function getLeagueOwnerForCalendar(leagueId: string): Promise<{ ownerId: string } | null> {
  const { rows } = await pool.query<{ owner_user_id: string }>(
    `SELECT owner_user_id FROM league WHERE id = $1`,
    [leagueId]
  );
  return rows[0] ? { ownerId: rows[0].owner_user_id } : null;
}

async function appUserIdFor(replitOrDomainId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM app_user WHERE id::text = $1 OR replit_id = $1`,
    [replitOrDomainId]
  );
  return rows[0]?.id ?? null;
}

async function getOrCreateToken(leagueId: string, gmUserId: string | null): Promise<string> {
  const existing = await pool.query<{ token: string }>(
    gmUserId
      ? `SELECT token FROM calendar_feed_token WHERE league_id = $1 AND gm_user_id = $2 AND revoked_at IS NULL`
      : `SELECT token FROM calendar_feed_token WHERE league_id = $1 AND gm_user_id IS NULL AND revoked_at IS NULL`,
    gmUserId ? [leagueId, gmUserId] : [leagueId]
  );
  if (existing.rows[0]) return existing.rows[0].token;

  const token = newToken();
  await pool.query(
    `INSERT INTO calendar_feed_token (league_id, gm_user_id, token) VALUES ($1, $2, $3)`,
    [leagueId, gmUserId, token]
  );
  return token;
}

async function revokeAndReissue(leagueId: string, gmUserId: string | null): Promise<string> {
  await pool.query(
    gmUserId
      ? `UPDATE calendar_feed_token SET revoked_at = NOW() WHERE league_id = $1 AND gm_user_id = $2 AND revoked_at IS NULL`
      : `UPDATE calendar_feed_token SET revoked_at = NOW() WHERE league_id = $1 AND gm_user_id IS NULL AND revoked_at IS NULL`,
    gmUserId ? [leagueId, gmUserId] : [leagueId]
  );
  const token = newToken();
  await pool.query(
    `INSERT INTO calendar_feed_token (league_id, gm_user_id, token) VALUES ($1, $2, $3)`,
    [leagueId, gmUserId, token]
  );
  return token;
}

router.get(
  "/leagues/:leagueId/calendar-feed/mine",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwnerForCalendar(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    const appUserId = await appUserIdFor(user.appUserId ?? user.id);
    if (!appUserId) { unauthorized(res, "User not found"); return; }

    const token = await getOrCreateToken(leagueId, appUserId);
    res.json({ token, ics_url: icsUrl(req, token), scope: "gm" });
  }
);

router.post(
  "/leagues/:leagueId/calendar-feed/mine/revoke",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwnerForCalendar(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    const appUserId = await appUserIdFor(user.appUserId ?? user.id);
    if (!appUserId) { unauthorized(res, "User not found"); return; }

    const token = await revokeAndReissue(leagueId, appUserId);
    res.json({ token, ics_url: icsUrl(req, token), scope: "gm" });
  }
);

router.get(
  "/leagues/:leagueId/calendar-feed/league",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwnerForCalendar(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "calendar:manage", { kind: "league", ownerId: league.ownerId })) {
      forbidden(res, "Only the commissioner can access the whole-league feed"); return;
    }

    const token = await getOrCreateToken(leagueId, null);
    res.json({ token, ics_url: icsUrl(req, token), scope: "league" });
  }
);

router.post(
  "/leagues/:leagueId/calendar-feed/league/revoke",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwnerForCalendar(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "calendar:manage", { kind: "league", ownerId: league.ownerId })) {
      forbidden(res, "Only the commissioner can revoke the whole-league feed"); return;
    }

    const token = await revokeAndReissue(leagueId, null);
    res.json({ token, ics_url: icsUrl(req, token), scope: "league" });
  }
);

// Public — no auth. The token itself is the credential.
router.get(
  "/calendar/:token",
  async (req: Request, res: Response): Promise<void> => {
    const token = req.params.token as string;
    const tokenRow = await pool.query<{ league_id: string; gm_user_id: string | null }>(
      `SELECT league_id, gm_user_id FROM calendar_feed_token WHERE token = $1 AND revoked_at IS NULL`,
      [token]
    );
    if (!tokenRow.rows[0]) { notFound(res, "This calendar feed link is invalid or has been revoked"); return; }
    const { league_id: leagueId, gm_user_id: gmUserId } = tokenRow.rows[0];

    const leagueRow = await pool.query<{ name: string }>(`SELECT name FROM league WHERE id = $1`, [leagueId]);
    const leagueName = leagueRow.rows[0]?.name ?? "Front Office";

    const gamesRes = await pool.query<{
      id: string; window_opens_at: Date; window_closes_at: Date; status: string;
      home_name: string | null; away_name: string | null;
    }>(
      gmUserId
        ? `SELECT g.id, g.window_opens_at, g.window_closes_at, g.status,
                  hf.name AS home_name, af.name AS away_name
             FROM game g
             JOIN season s ON s.id = g.season_id
             JOIN team_season hts ON hts.id = g.home_team_season_id
             JOIN team_season ats ON ats.id = g.away_team_season_id
             JOIN franchise hf ON hf.id = hts.franchise_id
             JOIN franchise af ON af.id = ats.franchise_id
            WHERE s.league_id = $1
              AND (
                EXISTS (SELECT 1 FROM gm_assignment ga WHERE ga.team_season_id = hts.id AND ga.user_id = $2 AND ga.ended_at IS NULL)
                OR
                EXISTS (SELECT 1 FROM gm_assignment ga WHERE ga.team_season_id = ats.id AND ga.user_id = $2 AND ga.ended_at IS NULL)
              )
            ORDER BY g.window_opens_at ASC`
        : `SELECT g.id, g.window_opens_at, g.window_closes_at, g.status,
                  hf.name AS home_name, af.name AS away_name
             FROM game g
             JOIN season s ON s.id = g.season_id
             JOIN team_season hts ON hts.id = g.home_team_season_id
             JOIN team_season ats ON ats.id = g.away_team_season_id
             JOIN franchise hf ON hf.id = hts.franchise_id
             JOIN franchise af ON af.id = ats.franchise_id
            WHERE s.league_id = $1
            ORDER BY g.window_opens_at ASC`,
      gmUserId ? [leagueId, gmUserId] : [leagueId]
    );

    const events: IcsEvent[] = gamesRes.rows.map((g) => ({
      uid: g.id,
      start: g.window_opens_at,
      end: g.window_closes_at,
      summary: `${g.away_name ?? "Away"} @ ${g.home_name ?? "Home"}`,
      status:
        g.status === "voided" ? "CANCELLED" :
        g.status === "confirmed" || g.status === "forfeited" ? "CONFIRMED" :
        "TENTATIVE",
    }));

    const ics = buildIcs(leagueName, events);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${leagueName.replace(/[^a-z0-9]+/gi, "-")}.ics"`);
    res.send(ics);
  }
);

export default router;
