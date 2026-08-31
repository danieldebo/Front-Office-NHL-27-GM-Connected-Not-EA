/**
 * Commissioner links routes.
 *
 * GET    /leagues/:leagueId/commissioner-invite         — get active invite + public_code
 * POST   /leagues/:leagueId/commissioner-invite         — create first invite
 * POST   /leagues/:leagueId/commissioner-invite/rotate  — rotate (revoke old, issue new)
 * PATCH  /leagues/:leagueId/commissioner-invite         — update max_uses / expires_at
 * DELETE /leagues/:leagueId/commissioner-invite         — revoke active invite
 * PATCH  /leagues/:leagueId/public-code                 — set / update league public_code
 *
 * GET    /join/:token                                   — public landing page data
 * POST   /join/:token/claim                             — authenticated seat claim
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import { leagueAccessFor, leagueResource } from "../server/leagueAccess";
import {
  notFound,
  unauthorized,
  forbidden,
  badRequest,
  conflict,
} from "../server/errors";
import { rateLimiter } from "../middlewares/rateLimiter";
import crypto from "crypto";
import {
  CreateCommissionerInviteBody,
  CreateCommissionerInviteParams,
  UpdateCommissionerInviteBody,
  UpdateCommissionerInviteParams,
  RotateCommissionerInviteBody,
  RotateCommissionerInviteParams,
  SetPublicCodeBody,
  SetPublicCodeParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ────────────────────────────────────────────── helpers

async function getLeaguePublicCode(leagueId: string) {
  const row = await pool.query<{ public_code: string | null }>(
    `SELECT public_code FROM league WHERE id = $1 AND deleted_at IS NULL`,
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

async function getActiveInvite(leagueId: string) {
  const row = await pool.query<{
    id: string; league_id: string; token: string; created_by: string;
    max_uses: number | null; uses: number; expires_at: Date | null;
    is_active: boolean; revoked_at: Date | null; created_at: Date;
  }>(
    `SELECT id, league_id, token, created_by, max_uses, uses, expires_at,
            is_active, revoked_at, created_at
       FROM commissioner_invite
      WHERE league_id = $1 AND is_active = true`,
    [leagueId]
  );
  return row.rows[0] ?? null;
}

// ────────────────────────────────────────────── Commissioner invite CRUD

// GET /leagues/:leagueId/commissioner-invite
router.get(
  "/leagues/:leagueId/commissioner-invite",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const params = CreateCommissionerInviteParams.safeParse(req.params);
    if (!params.success) { badRequest(res, params.error.message); return; }
    const leagueId = params.data.leagueId;
    const league = await leagueAccessFor(leagueId, user);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "invite:manage", leagueResource(league))) {
      forbidden(res, "Commissioner access is required to manage invite links");
      return;
    }

    const invite = await getActiveInvite(leagueId);
    const publicCode = await getLeaguePublicCode(leagueId);

    res.json({
      public_code: publicCode?.public_code ?? null,
      invite: invite ?? null,
    });
  }
);

// POST /leagues/:leagueId/commissioner-invite — create the first invite
router.post(
  "/leagues/:leagueId/commissioner-invite",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const params = CreateCommissionerInviteParams.safeParse(req.params);
    if (!params.success) { badRequest(res, params.error.message); return; }
    const leagueId = params.data.leagueId;
    const league = await leagueAccessFor(leagueId, user);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "invite:manage", leagueResource(league))) {
      forbidden(res, "Commissioner access is required to create invite links");
      return;
    }

    const existing = await getActiveInvite(leagueId);
    if (existing) {
      conflict(res, "An active invite already exists. Use /rotate to issue a new one.");
      return;
    }

    const creatorId = user.appUserId ?? await getAppUserId(user.id);
    if (!creatorId) { badRequest(res, "User profile not found"); return; }

    const token = crypto.randomUUID();
    const parsed = CreateCommissionerInviteBody.safeParse(req.body ?? {});
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const { max_uses, expires_at } = parsed.data;

    const row = await pool.query(
      `INSERT INTO commissioner_invite (league_id, token, created_by, max_uses, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, league_id, token, created_by, max_uses, uses, expires_at, is_active, revoked_at, created_at`,
      [leagueId, token, creatorId, max_uses ?? null, expires_at ?? null]
    );

    res.status(201).json(row.rows[0]);
  }
);

// POST /leagues/:leagueId/commissioner-invite/rotate
router.post(
  "/leagues/:leagueId/commissioner-invite/rotate",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const params = RotateCommissionerInviteParams.safeParse(req.params);
    if (!params.success) { badRequest(res, params.error.message); return; }
    const leagueId = params.data.leagueId;
    const league = await leagueAccessFor(leagueId, user);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "invite:manage", leagueResource(league))) {
      forbidden(res, "Commissioner access is required to rotate invite links");
      return;
    }

    const parsed = RotateCommissionerInviteBody.safeParse(req.body ?? {});
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const { max_uses, expires_at } = parsed.data;

    const creatorId = user.appUserId ?? await getAppUserId(user.id);
    if (!creatorId) { badRequest(res, "User profile not found"); return; }

    const newToken = crypto.randomUUID();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Revoke the current active invite (if any)
      await client.query(
        `UPDATE commissioner_invite
            SET is_active = false, revoked_at = now()
          WHERE league_id = $1 AND is_active = true`,
        [leagueId]
      );

      // Insert the new invite
      const row = await client.query(
        `INSERT INTO commissioner_invite (league_id, token, created_by, max_uses, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, league_id, token, created_by, max_uses, uses, expires_at, is_active, revoked_at, created_at`,
        [leagueId, newToken, creatorId, max_uses ?? null, expires_at ?? null]
      );

      await client.query("COMMIT");
      res.json(row.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

// PATCH /leagues/:leagueId/commissioner-invite — update max_uses / expires_at
router.patch(
  "/leagues/:leagueId/commissioner-invite",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const params = UpdateCommissionerInviteParams.safeParse(req.params);
    if (!params.success) { badRequest(res, params.error.message); return; }
    const leagueId = params.data.leagueId;
    const league = await leagueAccessFor(leagueId, user);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "invite:manage", leagueResource(league))) {
      forbidden(res, "Commissioner access is required to update the invite");
      return;
    }

    const invite = await getActiveInvite(leagueId);
    if (!invite) { notFound(res, "No active commissioner invite found"); return; }

    const parsed = UpdateCommissionerInviteBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    if (Object.keys(parsed.data).length === 0) {
      badRequest(res, "No fields to update. Provide max_uses and/or expires_at.");
      return;
    }
    const { max_uses, expires_at } = parsed.data;

    const sets: string[] = [];
    const vals: unknown[] = [invite.id];

    if (max_uses !== undefined) {
      vals.push(max_uses);
      sets.push(`max_uses = $${vals.length}`);
    }
    if (expires_at !== undefined) {
      vals.push(expires_at);
      sets.push(`expires_at = $${vals.length}`);
    }

    if (sets.length === 0) {
      badRequest(res, "No fields to update. Provide max_uses and/or expires_at.");
      return;
    }

    const updated = await pool.query(
      `UPDATE commissioner_invite
          SET ${sets.join(", ")}
        WHERE id = $1
        RETURNING id, league_id, token, created_by, max_uses, uses, expires_at, is_active, revoked_at, created_at`,
      vals
    );

    res.json(updated.rows[0]);
  }
);

// DELETE /leagues/:leagueId/commissioner-invite — revoke active invite
router.delete(
  "/leagues/:leagueId/commissioner-invite",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = String(req.params["leagueId"]);
    const league = await leagueAccessFor(leagueId, user);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "invite:manage", leagueResource(league))) {
      forbidden(res, "Commissioner access is required to revoke the invite");
      return;
    }

    const invite = await getActiveInvite(leagueId);
    if (!invite) { notFound(res, "No active commissioner invite found"); return; }

    await pool.query(
      `UPDATE commissioner_invite
          SET is_active = false, revoked_at = now()
        WHERE id = $1`,
      [invite.id]
    );

    res.sendStatus(204);
  }
);

// PATCH /leagues/:leagueId/public-code
router.patch(
  "/leagues/:leagueId/public-code",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const params = SetPublicCodeParams.safeParse(req.params);
    if (!params.success) { badRequest(res, params.error.message); return; }
    const leagueId = params.data.leagueId;
    const league = await leagueAccessFor(leagueId, user);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "league:write", leagueResource(league))) {
      forbidden(res, "Commissioner access is required to set the public code");
      return;
    }

    const parsed = SetPublicCodeBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    if (!Object.prototype.hasOwnProperty.call(parsed.data, "public_code")) {
      badRequest(res, "public_code is required; use null to clear it");
      return;
    }
    const { public_code } = parsed.data;

    if (public_code === null) {
      // Allow clearing the code
      await pool.query(`UPDATE league SET public_code = NULL WHERE id = $1`, [leagueId]);
      res.json({ public_code: null });
      return;
    }

    try {
      const row = await pool.query<{ public_code: string }>(
        `UPDATE league SET public_code = $1 WHERE id = $2 RETURNING public_code`,
        [public_code, leagueId]
      );
      res.json({ public_code: row.rows[0]?.public_code ?? null });
    } catch (err: unknown) {
      // unique constraint violation
      if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505") {
        conflict(res, `The public code '${public_code}' is already taken.`);
      } else {
        throw err;
      }
    }
  }
);

// ────────────────────────────────────────────── Public code lookup

// GET /j/:code — resolve a league public code to its slug, no auth required
router.get(
  "/j/:code",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const code = String(req.params["code"]).toUpperCase();

    const { rows } = await pool.query<{ slug: string }>(
      `SELECT slug
         FROM league
        WHERE UPPER(public_code) = $1
          AND visibility = 'public'
          AND deleted_at IS NULL
        LIMIT 1`,
      [code]
    );

    if (!rows[0]) {
      notFound(res, `No league found with public code '${code}'.`);
      return;
    }

    res.json({ slug: rows[0].slug });
  }
);

// ────────────────────────────────────────────── Public join endpoints

// GET /join/:token — public landing page, no auth required
router.get(
  "/join/:token",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const token = String(req.params["token"]);

    const { rows } = await pool.query<{
      invite_id: string; league_id: string; token: string;
      usable: boolean; uses: number; max_uses: number | null; expires_at: Date | null;
      revoked_at: Date | null; is_active: boolean;
      league_name: string; league_slug: string; platform: string | null;
    }>(
      `SELECT ci.id AS invite_id, ci.league_id, ci.token,
              (ci.is_active
               AND ci.revoked_at IS NULL
               AND (ci.expires_at IS NULL OR ci.expires_at > now())
               AND (ci.max_uses IS NULL OR ci.uses < ci.max_uses)) AS usable,
              ci.uses, ci.max_uses, ci.expires_at, ci.revoked_at, ci.is_active,
              l.name AS league_name, l.slug AS league_slug,
              s.game_title AS platform
         FROM commissioner_invite ci
         JOIN league l ON l.id = ci.league_id
         LEFT JOIN season s ON s.league_id = l.id AND s.is_active = true
        WHERE ci.token = $1`,
      [token]
    );

    if (!rows[0]) {
      res.status(410).json({
        type: "https://frontoffice.example/probs/410",
        title: "Invite No Longer Active",
        status: 410,
        detail: "This invite link is no longer active or does not exist.",
      });
      return;
    }

    const row = rows[0];
    const reason = !row.usable
      ? (row.revoked_at || !row.is_active
          ? "This invite has been revoked."
          : row.max_uses !== null && row.uses >= row.max_uses
          ? "This invite has reached its use limit."
          : row.expires_at && row.expires_at < new Date()
          ? "This invite has expired."
          : "This invite is no longer active.")
      : null;

    res.json({
      invite_id: row.invite_id,
      token: row.token,
      league_id: row.league_id,
      league_name: row.league_name,
      league_slug: row.league_slug,
      platform: row.platform ?? null,
      usable: row.usable,
      reason,
      uses: row.uses,
      max_uses: row.max_uses,
      expires_at: row.expires_at,
    });
  }
);

// POST /join/:token/claim — authenticated seat claim
router.post(
  "/join/:token/claim",
  rateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Must be signed in to claim a seat"); return; }

    const token = String(req.params["token"]);

    const appUserId = await getAppUserId(user.id);
    if (!appUserId) { badRequest(res, "User profile not found"); return; }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // (a) Re-check usability directly on base table with row lock
      const inviteRow = await client.query<{
        invite_id: string; league_id: string; usable: boolean;
        uses: number; max_uses: number | null;
      }>(
        `SELECT
           ci.id AS invite_id,
           ci.league_id,
           ci.uses,
           ci.max_uses,
           (ci.is_active
            AND ci.revoked_at IS NULL
            AND (ci.expires_at IS NULL OR ci.expires_at > now())
            AND (ci.max_uses IS NULL OR ci.uses < ci.max_uses)) AS usable
         FROM commissioner_invite ci
        WHERE ci.token = $1
        FOR UPDATE`,
        [token]
      );

      if (!inviteRow.rows[0]) {
        await client.query("ROLLBACK");
        res.status(410).json({
          type: "https://frontoffice.example/probs/410",
          title: "Invite No Longer Active",
          status: 410,
          detail: "This invite link does not exist or has been revoked.",
        });
        return;
      }

      if (!inviteRow.rows[0].usable) {
        await client.query("ROLLBACK");
        res.status(410).json({
          type: "https://frontoffice.example/probs/410",
          title: "Invite No Longer Active",
          status: 410,
          detail: "This invite link is expired or has reached its use limit.",
        });
        return;
      }

      const { invite_id, league_id } = inviteRow.rows[0];

      // Check for duplicate claim
      const dupRow = await client.query(
        `SELECT id FROM commissioner_invite_claim WHERE invite_id = $1 AND user_id = $2`,
        [invite_id, appUserId]
      );
      if (dupRow.rows[0]) {
        await client.query("ROLLBACK");
        conflict(res, "You have already claimed this invite link.");
        return;
      }

      // (b) Increment uses
      await client.query(
        `UPDATE commissioner_invite SET uses = uses + 1 WHERE id = $1`,
        [invite_id]
      );

      // Check seat availability — compare taken gm_assignments vs roster_max in active season.
      // roster_max caps how many GMs can hold a franchise at once; if not set, league is open.
      const seatRow = await client.query<{
        taken_seats: string; roster_max: string | null;
      }>(
        `SELECT
           COUNT(ga.id) FILTER (WHERE ga.ended_at IS NULL) AS taken_seats,
           s.roster_max
         FROM season s
         JOIN team_season ts ON ts.season_id = s.id
         LEFT JOIN gm_assignment ga ON ga.team_season_id = ts.id
        WHERE s.league_id = $1 AND s.is_active = true
        GROUP BY s.roster_max`,
        [league_id]
      );

      const takenSeats = parseInt(seatRow.rows[0]?.taken_seats ?? "0", 10);
      const rosterMax = seatRow.rows[0]?.roster_max ? parseInt(seatRow.rows[0].roster_max, 10) : null;

      const isFull = rosterMax !== null && takenSeats >= rosterMax;
      const outcome = isFull ? "waitlist" : "member";

      // (c) Insert claim record
      await client.query(
        `INSERT INTO commissioner_invite_claim (invite_id, user_id, resulted_in)
         VALUES ($1, $2, $3)`,
        [invite_id, appUserId, outcome]
      );

      // (d) For "member" outcome: add the user to league_membership (same step as
      //     approving a join_request in seats.ts). The commissioner pre-authorized
      //     this by sharing the invite link. Franchise seat assignment (GP assignment)
      //     is handled separately in CP9.
      if (outcome === "member") {
        await client.query(
          `INSERT INTO league_membership (league_id, user_id, role)
           VALUES ($1, $2, 'gm')
           ON CONFLICT (league_id, user_id) DO UPDATE SET left_at = NULL, role = 'gm'`,
          [league_id, appUserId]
        );
      }

      await client.query("COMMIT");

      res.json({ outcome, league_id, invite_id });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);

export default router;
