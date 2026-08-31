/**
 * Weekly commissioner email digest — settings and unsubscribe.
 * Delivery itself lives in server/jobs/digestScheduler.ts + the outbox.
 *
 * GET/PATCH /leagues/:leagueId/digest-settings — commissioner-only
 * POST      /leagues/:leagueId/digest-unsubscribe — caller unsubscribes self
 * GET       /digest/unsubscribe/:token — public, one-click email footer link
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import { badRequest, forbidden, notFound, unauthorized } from "../server/errors";
import { UpdateDigestSettingsBody } from "@workspace/api-zod";

const router: IRouter = Router();

async function getLeagueOwnerForDigest(leagueId: string): Promise<{ ownerId: string } | null> {
  const { rows } = await pool.query<{ owner_user_id: string }>(
    `SELECT owner_user_id FROM league WHERE id = $1`,
    [leagueId]
  );
  return rows[0] ? { ownerId: rows[0].owner_user_id } : null;
}

function selectSettings() {
  return `digest_enabled, digest_day_of_week, digest_hour_local, digest_timezone, digest_template_md`;
}

router.get(
  "/leagues/:leagueId/digest-settings",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwnerForDigest(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "digest:manage", { kind: "league", ownerId: league.ownerId })) {
      forbidden(res, "Only the commissioner can view digest settings"); return;
    }

    const { rows } = await pool.query(`SELECT ${selectSettings()} FROM league WHERE id = $1`, [leagueId]);
    res.json(rows[0]);
  }
);

router.patch(
  "/leagues/:leagueId/digest-settings",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = req.params.leagueId as string;
    const league = await getLeagueOwnerForDigest(leagueId);
    if (!league) { notFound(res, "League not found"); return; }

    if (!can(user, "digest:manage", { kind: "league", ownerId: league.ownerId })) {
      forbidden(res, "Only the commissioner can edit digest settings"); return;
    }

    const parsed = UpdateDigestSettingsBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const d = parsed.data;

    const { rows } = await pool.query(
      `UPDATE league SET
         digest_enabled     = COALESCE($1, digest_enabled),
         digest_day_of_week = COALESCE($2, digest_day_of_week),
         digest_hour_local  = COALESCE($3, digest_hour_local),
         digest_timezone    = COALESCE($4, digest_timezone),
         digest_template_md = COALESCE($5, digest_template_md)
       WHERE id = $6
       RETURNING ${selectSettings()}`,
      [
        d.digest_enabled ?? null,
        d.digest_day_of_week ?? null,
        d.digest_hour_local ?? null,
        d.digest_timezone ?? null,
        d.digest_template_md ?? null,
        leagueId,
      ]
    );
    res.json(rows[0]);
  }
);

router.post(
  "/leagues/:leagueId/digest-unsubscribe",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = req.params.leagueId as string;
    const appUserRow = await pool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE id::text = $1 OR replit_id = $1`,
      [user.appUserId ?? user.id]
    );
    const appUserId = appUserRow.rows[0]?.id;
    if (!appUserId) { unauthorized(res, "User not found"); return; }

    const { rows } = await pool.query(
      `UPDATE league_membership SET digest_unsubscribed_at = NOW()
        WHERE league_id = $1 AND user_id = $2
        RETURNING id`,
      [leagueId, appUserId]
    );
    if (!rows[0]) { notFound(res, "You are not a member of this league"); return; }

    res.json({ unsubscribed: true });
  }
);

router.get(
  "/digest/unsubscribe/:token",
  async (req: Request, res: Response): Promise<void> => {
    const token = req.params.token as string;
    let rows;
    try {
      ({ rows } = await pool.query(
        `UPDATE league_membership SET digest_unsubscribed_at = COALESCE(digest_unsubscribed_at, NOW())
          WHERE digest_unsub_token = $1
          RETURNING id`,
        [token]
      ));
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr?.code === "22P02") { notFound(res, "Invalid unsubscribe link"); return; }
      throw err;
    }
    if (!rows[0]) { notFound(res, "Invalid unsubscribe link"); return; }
    res.setHeader("Content-Type", "text/plain");
    res.send("You've been unsubscribed from this league's weekly digest.");
  }
);

export default router;
