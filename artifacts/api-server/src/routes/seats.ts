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
 * PUT    /team-seasons/:teamSeasonId/gm                    — assign GM
 * DELETE /team-seasons/:teamSeasonId/gm                    — revoke GM
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
import { AssignGmBody, CreateInviteBody } from "@workspace/api-zod";

const router: IRouter = Router();

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
       ga.started_at AS gm_started_at,
       ga.role AS gm_role
     FROM team_season ts
     JOIN franchise fr ON fr.id = ts.franchise_id
     LEFT JOIN nhl_club nc ON nc.id = ts.nhl_club_id
     LEFT JOIN gm_assignment ga ON ga.team_season_id = ts.id AND ga.ended_at IS NULL
     LEFT JOIN app_user au ON au.id = ga.user_id
    WHERE ts.id = $1`,
    [teamSeasonId]
  );
  return rows[0] ?? null;
}

function formatSeat(r: Record<string, unknown>) {
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
    gm: r.assignment_id
      ? {
          assignment_id: r.assignment_id,
          user_id: r.gm_user_id,
          display_name: r.gm_display_name ?? null,
          started_at: r.gm_started_at,
          role: r.gm_role,
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
              jr.status, jr.reviewed_by, jr.reviewed_at, jr.note, jr.created_at
         FROM join_request jr
         JOIN app_user au ON au.id = jr.user_id
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

// GET /leagues/:leagueId/seats
router.get(
  "/leagues/:leagueId/seats",
  async (req: Request, res: Response): Promise<void> => {
    const leagueId = req.params.leagueId as string;

    const leagueCheck = await pool.query(`SELECT id FROM league WHERE id = $1`, [leagueId]);
    if (!leagueCheck.rows[0]) { notFound(res, "League not found"); return; }

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
         ga.started_at AS gm_started_at,
         ga.role AS gm_role
       FROM team_season ts
       JOIN franchise fr ON fr.id = ts.franchise_id
       LEFT JOIN nhl_club nc ON nc.id = ts.nhl_club_id
       LEFT JOIN gm_assignment ga ON ga.team_season_id = ts.id AND ga.ended_at IS NULL
       LEFT JOIN app_user au ON au.id = ga.user_id
      WHERE ts.season_id = $1
      ORDER BY ts.conference, ts.division, nc.abbrev`,
      [seasonRow.rows[0].id]
    );

    res.json({ data: rows.map(formatSeat) });
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
    res.json(formatSeat(seat as Record<string, unknown>));
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

export default router;
