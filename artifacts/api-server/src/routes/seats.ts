/**
 * Seat management routes.
 *
 * POST   /leagues/:leagueId/invites                        — create invite link
 * GET    /leagues/:leagueId/invites                        — list invite links
 * GET    /invites/:token                                   — preview invite
 * DELETE /invites/:token                                   — revoke invite
 * POST   /invites/:token/join                              — submit join request
 * GET    /leagues/:leagueId/join-requests                  — list join requests
 * POST   /leagues/:leagueId/join-requests/:id/approve      — approve
 * POST   /leagues/:leagueId/join-requests/:id/reject       — reject
 * GET    /leagues/:leagueId/seats                          — list seats
 * GET    /leagues/:leagueId/members/unassigned             — members with no seat, for the assign picker
 * PUT    /team-seasons/:teamSeasonId/gm                    — assign GM
 * DELETE /team-seasons/:teamSeasonId/gm                    — revoke GM
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import { repairActiveSeasonSeats } from "../server/seasonProvisioning";
import {
  notFound,
  unauthorized,
  forbidden,
  badRequest,
  conflict,
} from "../server/errors";
import { AssignGmBody, CreateInviteBody } from "@workspace/api-zod";
import { canonicalGmIdentity } from "../server/core/playerIdentity";
import { LEAGUE_MEMBERSHIP_CAP, countActiveLeagueMemberships } from "../server/core/leagueLimits";

const router: IRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ────────────────────────────────────────────── helpers

async function getLeagueOwner(leagueId: string) {
  const row = await pool.query<{ id: string; owner_user_id: string }>(
    `SELECT id, owner_user_id FROM league WHERE id = $1`,
    [leagueId]
  );
  return row.rows[0] ?? null;
}

async function getAppUserId(replitId: string): Promise<string | null> {
  const row = await pool.query<{ id: string }>(
    `SELECT id FROM app_user WHERE replit_id = $1`,
    [replitId]
  );
  return row.rows[0]?.id ?? null;
}

async function loadSeat(teamSeasonId: string) {
  const { rows } = await pool.query(
    `SELECT
       ts.id AS team_season_id,
       ts.franchise_id,
       fr.name AS franchise_name,
       ts.nhl_club_id,
       nc.abbrev AS club_abbrev,
       nc.name AS club_name,
       ts.conference,
       ts.division,
       ts.seat_status,
       ga.id AS assignment_id,
       ga.user_id AS gm_user_id,
       au.display_name AS gm_display_name,
       to_jsonb(au)->>'primary_identity' AS gm_primary_identity,
       to_jsonb(au)->>'xbox_gamertag' AS gm_xbox_gamertag,
       to_jsonb(au)->>'psn_online_id' AS gm_psn_online_id,
       au.platform::text AS gm_legacy_platform,
       au.platform_gamertag AS gm_legacy_gamertag,
       au.first_nhl_game AS gm_first_nhl_game,
       au.profile_image_url AS gm_profile_image_url,
       au.gm_card_display AS gm_card_display,
       fc.id AS gm_favorite_club_id,
       fc.abbrev AS gm_favorite_club_abbrev,
       fc.name AS gm_favorite_club_name,
       fc.conference AS gm_favorite_club_conference,
       fc.division AS gm_favorite_club_division,
       fc.league_source AS gm_favorite_club_league_source,
       ga.started_at AS gm_started_at,
       ga.role AS gm_role
     FROM team_season ts
     JOIN franchise fr ON fr.id = ts.franchise_id
     LEFT JOIN nhl_club nc ON nc.id = ts.nhl_club_id
     LEFT JOIN gm_assignment ga ON ga.team_season_id = ts.id AND ga.ended_at IS NULL
     LEFT JOIN app_user au ON au.id = ga.user_id
     LEFT JOIN nhl_club fc ON fc.id = au.favorite_club_id
    WHERE ts.id = $1`,
    [teamSeasonId]
  );
  return rows[0] ?? null;
}

type GmRecord = { w: number; l: number; otl: number };
const ZERO_GM_RECORD: GmRecord = { w: 0, l: 0, otl: 0 };

// Batched so the seats list (up to ~32 GMs) costs one query, not one per row.
// "Combined record" sums every completed, standings-counting game across
// every team_season this user has ever held a gm_assignment for — league-
// scoped and site-wide. A user who has managed two teams that played each
// other correctly gets a win credited to one seat and a loss to the other.
async function getGmCareerRecords(
  userIds: string[],
  leagueId: string
): Promise<Map<string, { league: GmRecord; site: GmRecord }>> {
  const map = new Map<string, { league: GmRecord; site: GmRecord }>();
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return map;

  const { rows } = await pool.query<{
    user_id: string;
    site_w: string; site_l: string; site_otl: string;
    league_w: string; league_l: string; league_otl: string;
  }>(
    `WITH my_seats AS (
       SELECT DISTINCT ga.user_id, ga.team_season_id
         FROM gm_assignment ga
        WHERE ga.user_id = ANY($1::uuid[])
     ),
     games AS (
       SELECT
         ms.user_id,
         (s.league_id = $2) AS in_league,
         CASE WHEN g.home_team_season_id = ms.team_season_id THEN gr.home_goals ELSE gr.away_goals END AS goals_for,
         CASE WHEN g.home_team_season_id = ms.team_season_id THEN gr.away_goals ELSE gr.home_goals END AS goals_against,
         gr.decision
         FROM my_seats ms
         JOIN team_season ts ON ts.id = ms.team_season_id
         JOIN season s ON s.id = ts.season_id
         JOIN game g ON g.home_team_season_id = ms.team_season_id OR g.away_team_season_id = ms.team_season_id
         JOIN game_result gr ON gr.game_id = g.id
        WHERE gr.superseded_by IS NULL
          AND g.status IN ('confirmed', 'forfeited', 'simulated')
          AND gr.counts_toward_standings = TRUE
     )
     SELECT
       user_id,
       COUNT(*) FILTER (WHERE goals_for > goals_against)                                AS site_w,
       COUNT(*) FILTER (WHERE goals_for < goals_against AND decision = 'regulation')     AS site_l,
       COUNT(*) FILTER (WHERE goals_for < goals_against AND decision <> 'regulation')    AS site_otl,
       COUNT(*) FILTER (WHERE in_league AND goals_for > goals_against)                   AS league_w,
       COUNT(*) FILTER (WHERE in_league AND goals_for < goals_against
                          AND decision = 'regulation')                                   AS league_l,
       COUNT(*) FILTER (WHERE in_league AND goals_for < goals_against
                          AND decision <> 'regulation')                                  AS league_otl
     FROM games
     GROUP BY user_id`,
    [uniqueIds, leagueId]
  );

  for (const row of rows) {
    map.set(row.user_id, {
      site: { w: Number(row.site_w), l: Number(row.site_l), otl: Number(row.site_otl) },
      league: { w: Number(row.league_w), l: Number(row.league_l), otl: Number(row.league_otl) },
    });
  }
  return map;
}

function formatSeat(
  r: Record<string, unknown>,
  records?: Map<string, { league: GmRecord; site: GmRecord }>
) {
  const record = r.gm_user_id ? records?.get(r.gm_user_id as string) : undefined;
  return {
    team_season_id: r.team_season_id,
    franchise_id: r.franchise_id,
    franchise_name: r.franchise_name,
    nhl_club_id: r.nhl_club_id ?? null,
    club_abbrev: r.club_abbrev ?? null,
    club_name: r.club_name ?? null,
    conference: r.conference ?? null,
    division: r.division ?? null,
    seat_status: r.seat_status,
    // Only meaningful for an open seat: was it ever filled before, and if
    // so, when did the last GM leave. "hist" is only joined by the seats
    // list query below, not loadSeat() (used right after an assign/revoke),
    // so these are undefined there — fine, since that response always has a
    // fresh `gm` right after the mutation that produced it.
    vacated_at: !r.assignment_id && r.ever_assigned ? (r.last_vacated_at ?? null) : null,
    never_filled: !r.assignment_id && r.ever_assigned !== undefined ? !r.ever_assigned : undefined,
    gm: r.assignment_id
      ? {
          assignment_id: r.assignment_id,
          user_id: r.gm_user_id,
           ...canonicalGmIdentity({
             gm_display_name: r.gm_display_name as string | null,
             gm_primary_identity: r.gm_primary_identity as string | null,
             gm_xbox_gamertag: r.gm_xbox_gamertag as string | null,
             gm_psn_online_id: r.gm_psn_online_id as string | null,
             gm_legacy_platform: r.gm_legacy_platform as string | null,
             gm_legacy_gamertag: r.gm_legacy_gamertag as string | null,
           }),
          started_at: r.gm_started_at,
          role: r.gm_role,
          first_nhl_game: r.gm_first_nhl_game ?? null,
          profile_image_url: r.gm_profile_image_url ?? null,
          favorite_club: r.gm_favorite_club_id
            ? {
                id: r.gm_favorite_club_id,
                abbrev: r.gm_favorite_club_abbrev,
                name: r.gm_favorite_club_name,
                conference: r.gm_favorite_club_conference ?? null,
                division: r.gm_favorite_club_division ?? null,
                league_source: r.gm_favorite_club_league_source,
              }
            : null,
          gm_card_display: (r.gm_card_display as string | null) ?? "first_game",
          league_record: record?.league ?? ZERO_GM_RECORD,
          site_record: record?.site ?? ZERO_GM_RECORD,
        }
      : null,
  };
}

// ────────────────────────────────────────────── Invites

// POST /leagues/:leagueId/invites
router.post(
  "/leagues/:leagueId/invites",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwner(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "invite:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can create invite links");
      return;
    }

    const parsed = CreateInviteBody.safeParse(req.body ?? {});
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    const creatorId = await getAppUserId(user.id);
    if (!creatorId) { badRequest(res, "User profile not found"); return; }

    const { max_uses, expires_in_hours } = parsed.data;
    const expiresAt = expires_in_hours
      ? new Date(Date.now() + expires_in_hours * 3_600_000).toISOString()
      : null;

    const row = await pool.query(
      `INSERT INTO invite_link (league_id, created_by, max_uses, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, token, league_id, max_uses, use_count, expires_at, created_at, revoked_at`,
      [leagueId, creatorId, max_uses ?? null, expiresAt]
    );

    res.status(201).json({ ...row.rows[0], league_name: null });
  }
);

// GET /leagues/:leagueId/invites
router.get(
  "/leagues/:leagueId/invites",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwner(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "invite:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can view invite links");
      return;
    }

    const { rows } = await pool.query(
      `SELECT il.id, il.token, il.league_id, il.max_uses, il.use_count,
              il.expires_at, il.created_at, il.revoked_at,
              l.name AS league_name
         FROM invite_link il
         JOIN league l ON l.id = il.league_id
        WHERE il.league_id = $1
          AND il.revoked_at IS NULL
          AND (il.expires_at IS NULL OR il.expires_at > now())
        ORDER BY il.created_at DESC`,
      [leagueId]
    );

    res.json({ data: rows });
  }
);

// GET /invites/:token — preview before joining
router.get(
  "/invites/:token",
  async (req: Request, res: Response): Promise<void> => {
    const token = req.params.token as string;

    const { rows } = await pool.query(
      `SELECT il.id, il.token, il.league_id, il.max_uses, il.use_count,
              il.expires_at, il.created_at, il.revoked_at,
              l.name AS league_name
         FROM invite_link il
         JOIN league l ON l.id = il.league_id
        WHERE il.token = $1
          AND il.revoked_at IS NULL
          AND (il.expires_at IS NULL OR il.expires_at > now())
          AND (il.max_uses IS NULL OR il.use_count < il.max_uses)`,
      [token]
    );

    if (!rows[0]) {
      notFound(res, "Invite link not found or expired");
      return;
    }

    res.json(rows[0]);
  }
);

// DELETE /invites/:token
router.delete(
  "/invites/:token",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const token = req.params.token as string;

    const inviteRow = await pool.query<{ id: string; league_id: string }>(
      `SELECT id, league_id FROM invite_link WHERE token = $1 AND revoked_at IS NULL`,
      [token]
    );
    if (!inviteRow.rows[0]) { notFound(res, "Invite not found"); return; }

    const invite = inviteRow.rows[0];
    const league = await getLeagueOwner(invite.league_id);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "invite:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can revoke invite links");
      return;
    }

    await pool.query(`UPDATE invite_link SET revoked_at = now() WHERE id = $1`, [invite.id]);
    res.sendStatus(204);
  }
);

// POST /invites/:token/join
router.post(
  "/invites/:token/join",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Must be signed in to join a league"); return; }

    const token = req.params.token as string;

    const inviteRow = await pool.query<{ id: string; league_id: string }>(
      `SELECT id, league_id FROM invite_link
        WHERE token = $1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
          AND (max_uses IS NULL OR use_count < max_uses)`,
      [token]
    );
    if (!inviteRow.rows[0]) {
      notFound(res, "Invite link not found, expired, or exhausted");
      return;
    }

    const invite = inviteRow.rows[0];
    const appUserId = await getAppUserId(user.id);
    if (!appUserId) { badRequest(res, "User profile not found"); return; }

    // Check for existing join request
    const existing = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM join_request WHERE league_id = $1 AND user_id = $2`,
      [invite.league_id, appUserId]
    );

    if (existing.rows[0]) {
      // Already requested — return the existing one
      const jrRow = await pool.query(
        `SELECT jr.id, jr.league_id, jr.user_id, au.display_name,
                jr.status, jr.reviewed_by, jr.reviewed_at, jr.note, jr.created_at
           FROM join_request jr
           JOIN app_user au ON au.id = jr.user_id
          WHERE jr.id = $1`,
        [existing.rows[0].id]
      );
      res.json(jrRow.rows[0]);
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const jrRow = await client.query(
        `INSERT INTO join_request (league_id, user_id, invite_link_id)
         VALUES ($1, $2, $3)
         RETURNING id, league_id, user_id, status, reviewed_by, reviewed_at, note, created_at`,
        [invite.league_id, appUserId, invite.id]
      );

      await client.query(
        `UPDATE invite_link SET use_count = use_count + 1 WHERE id = $1`,
        [invite.id]
      );

      await client.query("COMMIT");

      const jr = jrRow.rows[0]!;
      const auRow = await pool.query<{ display_name: string }>(
        `SELECT display_name FROM app_user WHERE id = $1`,
        [appUserId]
      );

      res.status(201).json({ ...jr, display_name: auRow.rows[0]?.display_name ?? null });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

// ────────────────────────────────────────────── Join requests

// GET /leagues/:leagueId/join-requests
router.get(
  "/leagues/:leagueId/join-requests",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwner(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "seat:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can view join requests");
      return;
    }

    const { status } = req.query as { status?: string };
    const params: unknown[] = [leagueId];
    let statusClause = "";
    if (status) {
      params.push(status);
      statusClause = `AND jr.status = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT jr.id, jr.league_id, jr.user_id, au.display_name,
              jr.status, jr.reviewed_by, jr.reviewed_at, jr.note, jr.created_at,
              reviewer.display_name AS reviewed_by_name
         FROM join_request jr
         JOIN app_user au ON au.id = jr.user_id
         LEFT JOIN app_user reviewer ON reviewer.id = jr.reviewed_by
        WHERE jr.league_id = $1 ${statusClause}
        ORDER BY jr.created_at ASC`,
      params
    );

    res.json({ data: rows });
  }
);

// POST /leagues/:leagueId/join-requests/:requestId/approve
router.post(
  "/leagues/:leagueId/join-requests/:requestId/approve",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const leagueId = req.params.leagueId as string;
    const requestId = req.params.requestId as string;
    const league = await getLeagueOwner(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "seat:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can approve join requests");
      return;
    }

    const jrRow = await pool.query<{ id: string; user_id: string; status: string }>(
      `SELECT id, user_id, status FROM join_request WHERE id = $1 AND league_id = $2`,
      [requestId, leagueId]
    );
    if (!jrRow.rows[0]) { notFound(res, "Join request not found"); return; }

    const jr = jrRow.rows[0];
    if (jr.status !== "pending") {
      conflict(res, `Request is already '${jr.status}'`);
      return;
    }

    if ((await countActiveLeagueMemberships(jr.user_id)) >= LEAGUE_MEMBERSHIP_CAP) {
      conflict(res, `This applicant is already in ${LEAGUE_MEMBERSHIP_CAP} leagues — the maximum allowed — and can't be added.`);
      return;
    }

    const reviewerAppUserId = await getAppUserId(user.id);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE join_request SET status='approved', reviewed_by=$1, reviewed_at=now() WHERE id=$2`,
        [reviewerAppUserId, requestId]
      );

      // Add to league_membership
      await client.query(
        `INSERT INTO league_membership (league_id, user_id, role)
         VALUES ($1, $2, 'gm')
         ON CONFLICT (league_id, user_id) DO UPDATE SET left_at = NULL, role = 'gm'`,
        [leagueId, jr.user_id]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const updated = await pool.query(
      `SELECT jr.id, jr.league_id, jr.user_id, au.display_name,
              jr.status, jr.reviewed_by, jr.reviewed_at, jr.note, jr.created_at
         FROM join_request jr JOIN app_user au ON au.id = jr.user_id WHERE jr.id = $1`,
      [requestId]
    );
    res.json(updated.rows[0]);
  }
);

// POST /leagues/:leagueId/join-requests/:requestId/reject
router.post(
  "/leagues/:leagueId/join-requests/:requestId/reject",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const leagueId = req.params.leagueId as string;
    const requestId = req.params.requestId as string;
    const league = await getLeagueOwner(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "seat:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can reject join requests");
      return;
    }

    const jrRow = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM join_request WHERE id = $1 AND league_id = $2`,
      [requestId, leagueId]
    );
    if (!jrRow.rows[0]) { notFound(res, "Join request not found"); return; }
    if (jrRow.rows[0].status !== "pending") {
      conflict(res, `Request is already '${jrRow.rows[0].status}'`);
      return;
    }

    const reviewerAppUserId = await getAppUserId(user.id);
    await pool.query(
      `UPDATE join_request SET status='rejected', reviewed_by=$1, reviewed_at=now() WHERE id=$2`,
      [reviewerAppUserId, requestId]
    );

    const updated = await pool.query(
      `SELECT jr.id, jr.league_id, jr.user_id, au.display_name,
              jr.status, jr.reviewed_by, jr.reviewed_at, jr.note, jr.created_at
         FROM join_request jr JOIN app_user au ON au.id = jr.user_id WHERE jr.id = $1`,
      [requestId]
    );
    res.json(updated.rows[0]);
  }
);

// ────────────────────────────────────────────── Seats

// GET /leagues/:leagueId/members/unassigned — league members with no active
// franchise seat, for the commissioner to pick from when assigning a GM.
router.get(
  "/leagues/:leagueId/members/unassigned",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwner(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "seat:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can view assignable members");
      return;
    }

    const seasonRow = await pool.query<{ id: string }>(
      `SELECT id FROM season WHERE league_id = $1 AND is_active = TRUE LIMIT 1`,
      [leagueId]
    );
    const activeSeasonId = seasonRow.rows[0]?.id ?? null;

    const { rows } = await pool.query(
      `SELECT
         lm.user_id,
         au.display_name,
         to_jsonb(au)->>'primary_identity' AS primary_identity,
         to_jsonb(au)->>'xbox_gamertag' AS xbox_gamertag,
         to_jsonb(au)->>'psn_online_id' AS psn_online_id,
         au.platform::text AS legacy_platform,
         au.platform_gamertag AS legacy_gamertag
       FROM league_membership lm
       JOIN app_user au ON au.id = lm.user_id
      WHERE lm.league_id = $1 AND lm.left_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM gm_assignment ga
          JOIN team_season ts ON ts.id = ga.team_season_id
          WHERE ga.user_id = lm.user_id AND ga.ended_at IS NULL
            AND ($2::uuid IS NULL OR ts.season_id = $2)
        )
      ORDER BY au.display_name ASC`,
      [leagueId, activeSeasonId]
    );

    res.json({
      data: rows.map((r) => ({
        user_id: r.user_id,
        display_name: r.display_name,
        identity: canonicalGmIdentity({
          gm_display_name: r.display_name,
          gm_primary_identity: r.primary_identity,
          gm_xbox_gamertag: r.xbox_gamertag,
          gm_psn_online_id: r.psn_online_id,
          gm_legacy_platform: r.legacy_platform,
          gm_legacy_gamertag: r.legacy_gamertag,
        }),
      })),
    });
  }
);

// GET /leagues/:leagueId/seats
router.get(
  "/leagues/:leagueId/seats",
  async (req: Request, res: Response): Promise<void> => {
    const leagueId = req.params.leagueId as string;

    const leagueCheck = await pool.query(`SELECT id FROM league WHERE id = $1`, [leagueId]);
    if (!leagueCheck.rows[0]) { notFound(res, "League not found"); return; }

    // Self-heal seasons created before the club catalog was available in production.
    await repairActiveSeasonSeats(leagueId);

    // Use the active season's team_seasons
    const seasonRow = await pool.query<{ id: string }>(
      `SELECT id FROM season WHERE league_id = $1 AND is_active = TRUE LIMIT 1`,
      [leagueId]
    );
    if (!seasonRow.rows[0]) {
      // No active season yet — return empty
      res.json({ data: [] });
      return;
    }

    const { rows } = await pool.query(
      `SELECT
         ts.id AS team_season_id,
         ts.franchise_id,
         fr.name AS franchise_name,
         ts.nhl_club_id,
         nc.abbrev AS club_abbrev,
         nc.name AS club_name,
         ts.conference,
         ts.division,
         ts.seat_status,
         ga.id AS assignment_id,
         ga.user_id AS gm_user_id,
         au.display_name AS gm_display_name,
         to_jsonb(au)->>'primary_identity' AS gm_primary_identity,
         to_jsonb(au)->>'xbox_gamertag' AS gm_xbox_gamertag,
         to_jsonb(au)->>'psn_online_id' AS gm_psn_online_id,
         au.platform::text AS gm_legacy_platform,
         au.platform_gamertag AS gm_legacy_gamertag,
         au.first_nhl_game AS gm_first_nhl_game,
         au.profile_image_url AS gm_profile_image_url,
         au.gm_card_display AS gm_card_display,
         fc.id AS gm_favorite_club_id,
         fc.abbrev AS gm_favorite_club_abbrev,
         fc.name AS gm_favorite_club_name,
         fc.conference AS gm_favorite_club_conference,
         fc.division AS gm_favorite_club_division,
         fc.league_source AS gm_favorite_club_league_source,
         ga.started_at AS gm_started_at,
         ga.role AS gm_role,
         hist.ever_assigned,
         hist.last_vacated_at
       FROM team_season ts
       JOIN franchise fr ON fr.id = ts.franchise_id
       LEFT JOIN nhl_club nc ON nc.id = ts.nhl_club_id
       LEFT JOIN gm_assignment ga ON ga.team_season_id = ts.id AND ga.ended_at IS NULL
       LEFT JOIN app_user au ON au.id = ga.user_id
       LEFT JOIN nhl_club fc ON fc.id = au.favorite_club_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) > 0 AS ever_assigned, MAX(g.ended_at) AS last_vacated_at
           FROM gm_assignment g WHERE g.team_season_id = ts.id
       ) hist ON TRUE
      WHERE ts.season_id = $1
      ORDER BY ts.conference, ts.division, nc.abbrev`,
      [seasonRow.rows[0].id]
    );

    const gmUserIds = rows
      .map((r) => r.gm_user_id as string | null)
      .filter((id): id is string => Boolean(id));
    const records = await getGmCareerRecords(gmUserIds, leagueId);

    res.json({ data: rows.map((r) => formatSeat(r, records)) });
  }
);

// PUT /team-seasons/:teamSeasonId/gm — assign GM
router.put(
  "/team-seasons/:teamSeasonId/gm",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const teamSeasonId = req.params.teamSeasonId as string;

    // Load team_season to get league
    const tsRow = await pool.query<{ id: string; franchise_id: string; season_id: string }>(
      `SELECT ts.id, ts.franchise_id, ts.season_id
         FROM team_season ts WHERE ts.id = $1`,
      [teamSeasonId]
    );
    if (!tsRow.rows[0]) { notFound(res, "Team season not found"); return; }

    const seasonRow = await pool.query<{ league_id: string }>(
      `SELECT league_id FROM season WHERE id = $1`,
      [tsRow.rows[0].season_id]
    );
    const leagueId = seasonRow.rows[0]?.league_id;
    if (!leagueId) { notFound(res, "Season not found"); return; }

    const league = await getLeagueOwner(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "seat:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can assign GMs");
      return;
    }

    const parsed = AssignGmBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    const { user_id: targetUserId, role = "gm", end_reason } = parsed.data;

    // Look up target user by their app_user.id (UUID)
    const targetUserRow = await pool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE id = $1`,
      [targetUserId]
    );
    if (!targetUserRow.rows[0]) {
      notFound(res, "Target user not found");
      return;
    }

    if ((await countActiveLeagueMemberships(targetUserId)) >= LEAGUE_MEMBERSHIP_CAP) {
      conflict(res, `This user is already in ${LEAGUE_MEMBERSHIP_CAP} leagues — the maximum allowed — and can't be added.`);
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Close any existing active assignment for this seat
      await client.query(
        `UPDATE gm_assignment
            SET ended_at = now(), end_reason = $1
          WHERE team_season_id = $2 AND ended_at IS NULL`,
        [end_reason ?? "reassigned", teamSeasonId]
      );

      // Open new assignment
      await client.query(
        `INSERT INTO gm_assignment (team_season_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [teamSeasonId, targetUserId, role]
      );

      // Mark seat as filled
      await client.query(
        `UPDATE team_season SET seat_status = 'filled' WHERE id = $1`,
        [teamSeasonId]
      );

      // Ensure GM is in league_membership
      await client.query(
        `INSERT INTO league_membership (league_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (league_id, user_id) DO UPDATE SET left_at = NULL, role = $3`,
        [leagueId, targetUserId, role]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const seat = await loadSeat(teamSeasonId);
    const records = await getGmCareerRecords([targetUserId], leagueId);
    res.json(formatSeat(seat as Record<string, unknown>, records));
  }
);

// DELETE /team-seasons/:teamSeasonId/gm — revoke GM
router.delete(
  "/team-seasons/:teamSeasonId/gm",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const teamSeasonId = req.params.teamSeasonId as string;
    const reason = (req.query.reason as string | undefined) ?? "removed";

    const tsRow = await pool.query<{ id: string; season_id: string }>(
      `SELECT id, season_id FROM team_season WHERE id = $1`,
      [teamSeasonId]
    );
    if (!tsRow.rows[0]) { notFound(res, "Team season not found"); return; }

    const seasonRow = await pool.query<{ league_id: string }>(
      `SELECT league_id FROM season WHERE id = $1`,
      [tsRow.rows[0].season_id]
    );
    const leagueId = seasonRow.rows[0]?.league_id;
    if (!leagueId) { notFound(res, "Season not found"); return; }

    const league = await getLeagueOwner(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "seat:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can revoke GM assignments");
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE gm_assignment
            SET ended_at = now(), end_reason = $1
          WHERE team_season_id = $2 AND ended_at IS NULL`,
        [reason, teamSeasonId]
      );

      await client.query(
        `UPDATE team_season SET seat_status = 'open' WHERE id = $1`,
        [teamSeasonId]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const seat = await loadSeat(teamSeasonId);
    res.json(formatSeat(seat as Record<string, unknown>));
  }
);

// ────────────────────────────────────────────── Club catalog & team management

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

// GET /clubs — the full club catalog (NHL + curated alternate leagues)
router.get(
  "/clubs",
  async (req: Request, res: Response): Promise<void> => {
    const leagueSource = req.query.league_source as string | undefined;
    const params: unknown[] = [];
    let where = "";
    if (leagueSource) {
      params.push(leagueSource);
      where = `WHERE league_source = $1`;
    }
    const { rows } = await pool.query(
      `SELECT id, abbrev, name, conference, division, league_source
         FROM nhl_club
         ${where}
        ORDER BY league_source, conference NULLS LAST, division NULLS LAST, abbrev`,
      params
    );
    res.json({ data: rows });
  }
);

// POST /leagues/:leagueId/seasons/:seasonId/teams — add a franchise seat
router.post(
  "/leagues/:leagueId/seasons/:seasonId/teams",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const leagueId = req.params.leagueId as string;
    const seasonId = req.params.seasonId as string;
    const league = await getLeagueOwner(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "seat:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can add teams");
      return;
    }

    const seasonRow = await pool.query<{ id: string }>(
      `SELECT id FROM season WHERE id = $1 AND league_id = $2`,
      [seasonId, leagueId]
    );
    if (!seasonRow.rows[0]) { notFound(res, "Season not found"); return; }

    const clubId = (req.body as { nhl_club_id?: unknown })?.nhl_club_id;
    if (typeof clubId !== "string" || !UUID_PATTERN.test(clubId)) {
      badRequest(res, "nhl_club_id must be a valid club id");
      return;
    }

    const clubRow = await pool.query<{ id: string; name: string; conference: string | null; division: string | null }>(
      `SELECT id, name, conference, division FROM nhl_club WHERE id = $1`,
      [clubId]
    );
    const club = clubRow.rows[0];
    if (!club) { notFound(res, "Club not found"); return; }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const franchise = await client.query<{ id: string }>(
        `INSERT INTO franchise (league_id, name, founded_season_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [leagueId, club.name, seasonId]
      );

      let teamSeasonId: string;
      try {
        const teamSeason = await client.query<{ id: string }>(
          `INSERT INTO team_season (season_id, franchise_id, nhl_club_id, conference, division, seat_status)
           VALUES ($1, $2, $3, $4, $5, 'open')
           RETURNING id`,
          [seasonId, franchise.rows[0]!.id, club.id, club.conference, club.division]
        );
        teamSeasonId = teamSeason.rows[0]!.id;
      } catch (err) {
        await client.query("ROLLBACK");
        client.release();
        const pgErr = err as { code?: string };
        if (pgErr?.code === "23505") {
          conflict(res, "That club is already used by a seat in this season");
          return;
        }
        throw err;
      }

      await client.query("COMMIT");
      client.release();

      const seat = await loadSeat(teamSeasonId);
      res.status(201).json(formatSeat(seat as Record<string, unknown>));
    } catch (err) {
      client.release();
      throw err;
    }
  }
);

// PATCH /team-seasons/:teamSeasonId/club — rename/replace a seat's club
router.patch(
  "/team-seasons/:teamSeasonId/club",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const teamSeasonId = req.params.teamSeasonId as string;
    const tsRow = await pool.query<{ id: string; season_id: string; franchise_id: string }>(
      `SELECT id, season_id, franchise_id FROM team_season WHERE id = $1`,
      [teamSeasonId]
    );
    if (!tsRow.rows[0]) { notFound(res, "Team season not found"); return; }

    const seasonRow = await pool.query<{ league_id: string }>(
      `SELECT league_id FROM season WHERE id = $1`,
      [tsRow.rows[0].season_id]
    );
    const leagueId = seasonRow.rows[0]?.league_id;
    if (!leagueId) { notFound(res, "Season not found"); return; }

    const league = await getLeagueOwner(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "seat:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can rename/replace a team");
      return;
    }

    const clubId = (req.body as { nhl_club_id?: unknown })?.nhl_club_id;
    if (typeof clubId !== "string" || !UUID_PATTERN.test(clubId)) {
      badRequest(res, "nhl_club_id must be a valid club id");
      return;
    }

    const clubRow = await pool.query<{ id: string; name: string; conference: string | null; division: string | null }>(
      `SELECT id, name, conference, division FROM nhl_club WHERE id = $1`,
      [clubId]
    );
    const club = clubRow.rows[0];
    if (!club) { notFound(res, "Club not found"); return; }

    try {
      await pool.query(
        `UPDATE team_season SET nhl_club_id = $2, conference = $3, division = $4 WHERE id = $1`,
        [teamSeasonId, club.id, club.conference, club.division]
      );
    } catch (err) {
      const pgErr = err as { code?: string };
      if (pgErr?.code === "23505") {
        conflict(res, "That club is already used by another seat in this season");
        return;
      }
      throw err;
    }
    // The franchise is the continuity layer that persists across seasons —
    // keep its display name in step with the club it currently represents.
    await pool.query(`UPDATE franchise SET name = $2 WHERE id = $1`, [tsRow.rows[0].franchise_id, club.name]);

    const seat = await loadSeat(teamSeasonId);
    res.json(formatSeat(seat as Record<string, unknown>));
  }
);

// DELETE /team-seasons/:teamSeasonId — remove a franchise seat (must be open)
router.delete(
  "/team-seasons/:teamSeasonId",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const teamSeasonId = req.params.teamSeasonId as string;
    const tsRow = await pool.query<{ id: string; season_id: string; seat_status: string }>(
      `SELECT id, season_id, seat_status FROM team_season WHERE id = $1`,
      [teamSeasonId]
    );
    if (!tsRow.rows[0]) { notFound(res, "Team season not found"); return; }

    const seasonRow = await pool.query<{ league_id: string }>(
      `SELECT league_id FROM season WHERE id = $1`,
      [tsRow.rows[0].season_id]
    );
    const leagueId = seasonRow.rows[0]?.league_id;
    if (!leagueId) { notFound(res, "Season not found"); return; }

    const league = await getLeagueOwner(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "seat:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can remove a team");
      return;
    }

    if (tsRow.rows[0].seat_status !== "open") {
      conflict(res, "This seat has an active GM — revoke them first");
      return;
    }

    await pool.query(`DELETE FROM team_season WHERE id = $1`, [teamSeasonId]);
    res.sendStatus(204);
  }
);

// POST /leagues/:leagueId/seats/approve-all — autofill open seats and
// randomize team designation, or (fill_source=none) reshuffle GM<->seat
// pairing among already-filled seats. See openapi.yaml ApproveAllInput.
router.post(
  "/leagues/:leagueId/seats/approve-all",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwner(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "seat:manage", { kind: "league", ownerId: league.owner_user_id })) {
      forbidden(res, "Only the league owner can approve all seats");
      return;
    }

    const body = req.body as { fill_source?: unknown; reshuffle_existing?: unknown };
    const fillSource = body?.fill_source;
    if (fillSource !== "queue" && fillSource !== "members" && fillSource !== "none") {
      badRequest(res, "fill_source must be one of: queue, members, none");
      return;
    }
    // Only meaningful alongside queue/members — 'none' already reshuffles
    // every currently-assigned GM, so the flag is a no-op there.
    const reshuffleExisting = Boolean(body?.reshuffle_existing);

    const seasonRow = await pool.query<{ id: string }>(
      `SELECT id FROM season WHERE league_id = $1 AND is_active = TRUE LIMIT 1`,
      [leagueId]
    );
    const seasonId = seasonRow.rows[0]?.id;
    if (!seasonId) { notFound(res, "No active season"); return; }

    let filled = 0;
    let randomized = 0;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const seatsRow = await client.query<{ id: string; seat_status: string }>(
        `SELECT id, seat_status FROM team_season WHERE season_id = $1 FOR UPDATE`,
        [seasonId]
      );
      const openSeatIds = shuffle(seatsRow.rows.filter((r) => r.seat_status === "open").map((r) => r.id));

      if (fillSource === "queue" || fillSource === "members") {
        let candidateIds: string[] = [];
        if (fillSource === "queue") {
          const candidates = await client.query<{ user_id: string; signup_id: string | null }>(
            `SELECT DISTINCT ON (user_id) user_id, signup_id, sort_key FROM (
               SELECT w.user_id AS user_id, su.id AS signup_id, w.position AS sort_key, 0 AS pool
                 FROM waitlist_entry w
                 LEFT JOIN league_signup su ON su.id = w.signup_id
                WHERE w.league_id = $1 AND w.status = 'waiting'
               UNION ALL
               SELECT su.user_id AS user_id, su.id AS signup_id,
                      EXTRACT(EPOCH FROM su.created_at) AS sort_key, 1 AS pool
                 FROM league_signup su
                WHERE su.league_id = $1 AND su.status = 'pending'
                  AND NOT EXISTS (
                    SELECT 1 FROM waitlist_entry w2
                     WHERE w2.league_id = su.league_id AND w2.user_id = su.user_id AND w2.status = 'waiting'
                  )
             ) queue
             WHERE NOT EXISTS (
               SELECT 1 FROM league_membership lm WHERE lm.league_id = $1 AND lm.user_id = queue.user_id AND lm.left_at IS NULL
             )
             ORDER BY user_id, pool, sort_key`,
            [leagueId]
          );
          candidateIds = candidates.rows.map((r) => r.user_id);
          // resolve each accepted candidate's queue entries, mirroring
          // POST /leagues/:id/signups/:signupId/accept
          for (const row of candidates.rows.slice(0, openSeatIds.length)) {
            await client.query(
              `UPDATE waitlist_entry SET status = 'placed', resolved_at = now(), decided_by = $3
                WHERE league_id = $1 AND user_id = $2 AND status IN ('waiting','invited')`,
              [leagueId, row.user_id, league.owner_user_id]
            );
            if (row.signup_id) {
              await client.query(
                `UPDATE league_signup SET status = 'accepted', decided_by = $1, decided_at = now() WHERE id = $2`,
                [league.owner_user_id, row.signup_id]
              );
            }
            await client.query(
              `INSERT INTO league_membership (league_id, user_id, role)
               VALUES ($1, $2, 'gm')
               ON CONFLICT (league_id, user_id) DO UPDATE SET left_at = NULL`,
              [leagueId, row.user_id]
            );
          }
        } else {
          const candidates = await client.query<{ user_id: string }>(
            `SELECT lm.user_id
               FROM league_membership lm
              WHERE lm.league_id = $1 AND lm.left_at IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM gm_assignment ga
                  JOIN team_season ts ON ts.id = ga.team_season_id
                  WHERE ga.user_id = lm.user_id AND ga.ended_at IS NULL AND ts.season_id = $2
                )
              ORDER BY lm.joined_at ASC`,
            [leagueId, seasonId]
          );
          candidateIds = candidates.rows.map((r) => r.user_id);
        }

        const newCandidateIds = candidateIds.slice(0, openSeatIds.length);

        if (reshuffleExisting) {
          // Pool every currently-assigned GM together with the new
          // candidates, then shuffle across EVERY seat in the season (not
          // just the open ones) — an existing GM can land on a different
          // team in the same pass that fills the empty seats.
          const existingAssignments = await client.query<{
            assignment_id: string; team_season_id: string; user_id: string; role: string;
          }>(
            `SELECT ga.id AS assignment_id, ga.team_season_id, ga.user_id, ga.role
               FROM gm_assignment ga
               JOIN team_season ts ON ts.id = ga.team_season_id
              WHERE ts.season_id = $1 AND ga.ended_at IS NULL`,
            [seasonId]
          );
          type Placement =
            | { kind: "existing"; assignmentId: string; userId: string; role: string; previousSeatId: string }
            | { kind: "new"; userId: string };
          const pool: Placement[] = [
            ...existingAssignments.rows.map((r) => ({
              kind: "existing" as const,
              assignmentId: r.assignment_id,
              userId: r.user_id,
              role: r.role,
              previousSeatId: r.team_season_id,
            })),
            ...newCandidateIds.map((userId) => ({ kind: "new" as const, userId })),
          ];
          const shuffledPool = shuffle(pool);
          const allSeatIds = shuffle(seatsRow.rows.map((r) => r.id));
          const placements = Math.min(shuffledPool.length, allSeatIds.length);

          // Open every seat first so one vacated by a moved GM doesn't stay
          // "filled" if this pass doesn't happen to land anyone on it.
          await client.query(`UPDATE team_season SET seat_status = 'open' WHERE season_id = $1`, [seasonId]);

          for (let i = 0; i < placements; i++) {
            const seatId = allSeatIds[i]!;
            const placement = shuffledPool[i]!;
            if (placement.kind === "existing") {
              if (placement.previousSeatId !== seatId) {
                await client.query(
                  `UPDATE gm_assignment SET ended_at = now(), end_reason = 'approve_all_randomize' WHERE id = $1`,
                  [placement.assignmentId]
                );
                await client.query(
                  `INSERT INTO gm_assignment (team_season_id, user_id, role) VALUES ($1, $2, $3)`,
                  [seatId, placement.userId, placement.role]
                );
                randomized++;
              }
            } else {
              await client.query(
                `INSERT INTO gm_assignment (team_season_id, user_id, role) VALUES ($1, $2, 'gm')`,
                [seatId, placement.userId]
              );
              filled++;
            }
            await client.query(`UPDATE team_season SET seat_status = 'filled' WHERE id = $1`, [seatId]);
          }
        } else {
          const pairs = Math.min(openSeatIds.length, newCandidateIds.length);
          for (let i = 0; i < pairs; i++) {
            const seatId = openSeatIds[i]!;
            const userId = newCandidateIds[i]!;
            await client.query(
              `INSERT INTO gm_assignment (team_season_id, user_id, role) VALUES ($1, $2, 'gm')`,
              [seatId, userId]
            );
            await client.query(`UPDATE team_season SET seat_status = 'filled' WHERE id = $1`, [seatId]);
            filled++;
          }
        }
      } else {
        // fill_source = 'none' — reshuffle which seat each currently-assigned
        // GM occupies, without changing who's in the league or seat count.
        const assignments = await client.query<{ assignment_id: string; team_season_id: string; user_id: string; role: string }>(
          `SELECT ga.id AS assignment_id, ga.team_season_id, ga.user_id, ga.role
             FROM gm_assignment ga
             JOIN team_season ts ON ts.id = ga.team_season_id
            WHERE ts.season_id = $1 AND ga.ended_at IS NULL`,
          [seasonId]
        );
        const seatIds = shuffle(assignments.rows.map((r) => r.team_season_id));
        for (let i = 0; i < assignments.rows.length; i++) {
          const assignment = assignments.rows[i]!;
          const newSeatId = seatIds[i]!;
          if (newSeatId === assignment.team_season_id) continue;
          await client.query(
            `UPDATE gm_assignment SET ended_at = now(), end_reason = 'approve_all_randomize' WHERE id = $1`,
            [assignment.assignment_id]
          );
          await client.query(
            `INSERT INTO gm_assignment (team_season_id, user_id, role) VALUES ($1, $2, $3)`,
            [newSeatId, assignment.user_id, assignment.role]
          );
          randomized++;
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const { rows } = await pool.query(
      `SELECT
         ts.id AS team_season_id, ts.franchise_id, fr.name AS franchise_name,
         ts.nhl_club_id, nc.abbrev AS club_abbrev, nc.name AS club_name,
         ts.conference, ts.division, ts.seat_status,
         ga.id AS assignment_id, ga.user_id AS gm_user_id,
         au.display_name AS gm_display_name,
         to_jsonb(au)->>'primary_identity' AS gm_primary_identity,
         to_jsonb(au)->>'xbox_gamertag' AS gm_xbox_gamertag,
         to_jsonb(au)->>'psn_online_id' AS gm_psn_online_id,
         au.platform::text AS gm_legacy_platform,
         au.platform_gamertag AS gm_legacy_gamertag,
         au.first_nhl_game AS gm_first_nhl_game,
         au.profile_image_url AS gm_profile_image_url,
         au.gm_card_display AS gm_card_display,
         fc.id AS gm_favorite_club_id,
         fc.abbrev AS gm_favorite_club_abbrev,
         fc.name AS gm_favorite_club_name,
         fc.conference AS gm_favorite_club_conference,
         fc.division AS gm_favorite_club_division,
         fc.league_source AS gm_favorite_club_league_source,
         ga.started_at AS gm_started_at, ga.role AS gm_role
       FROM team_season ts
       JOIN franchise fr ON fr.id = ts.franchise_id
       LEFT JOIN nhl_club nc ON nc.id = ts.nhl_club_id
       LEFT JOIN gm_assignment ga ON ga.team_season_id = ts.id AND ga.ended_at IS NULL
       LEFT JOIN app_user au ON au.id = ga.user_id
       LEFT JOIN nhl_club fc ON fc.id = au.favorite_club_id
      WHERE ts.season_id = $1
      ORDER BY ts.conference, ts.division, nc.abbrev`,
      [seasonId]
    );
    const gmUserIds = rows.map((r) => r.gm_user_id as string | null).filter((id): id is string => Boolean(id));
    const records = await getGmCareerRecords(gmUserIds, leagueId);
    res.json({ data: rows.map((r) => formatSeat(r, records)), filled, randomized });
  }
);

export default router;
