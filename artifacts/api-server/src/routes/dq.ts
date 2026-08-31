/**
 * DQ (Data Quality) routes — commissioner-only.
 *
 * GET   /leagues/:leagueId/dq-findings                 — list findings for this league
 * PATCH /leagues/:leagueId/dq-findings/:findingId/resolve — mark resolved (must belong to league)
 *
 * The dq.finding table is populated by dq.run_all() (called by the nightly
 * job and post-ingest hook). This endpoint exposes findings to the league
 * commissioner so they can monitor data trust and dismiss resolved items.
 *
 * Authorization:
 * - The caller must be the commissioner (owner_user_id) of leagueId.
 * - All SQL predicates include league_id = leagueId so cross-league access
 *   is impossible even if a commissioner knows another league's finding ID.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { notFound, forbidden, unauthorized, badRequest } from "../server/errors";
import { can } from "../server/authz";
import { leagueAccessFor } from "../server/leagueAccess";
import { ListDqFindingsParams, ListDqFindingsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// ── Helper: assert the authenticated user is the league commissioner ──────────

async function assertCommissioner(
  req: Request,
  res: Response,
  leagueId: string,
): Promise<string | null> {
  const user = await getCurrentUser(req);
  if (!user) { unauthorized(res); return null; }

  const league = await leagueAccessFor(leagueId, user);
  if (!league) { notFound(res, "League not found"); return null; }
  const appUserId = user.appUserId ?? (
    await pool.query<{ id: string }>(`SELECT id FROM app_user WHERE replit_id = $1`, [user.id])
  ).rows[0]?.id;
  if (!appUserId || !can({ ...user, appUserId }, "league:write", {
    kind: "league", ownerId: league.ownerId, commissionerIds: league.commissionerIds,
  })) { forbidden(res); return null; }
  return appUserId;
}

// ── GET /leagues/:leagueId/dq-findings ───────────────────────────────────────

router.get(
  "/leagues/:leagueId/dq-findings",
  async (req: Request, res: Response): Promise<void> => {
    const params = ListDqFindingsParams.safeParse(req.params);
    const query = ListDqFindingsQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      badRequest(res, "Invalid path or query parameters");
      return;
    }
    const leagueId = params.data.leagueId;

    const userId = await assertCommissioner(req, res, leagueId);
    if (!userId) return;

    const { severity: sev, resolved = false, limit, offset } = query.data;

    // resolved=true → show only resolved; resolved=false (default) → only open
    const showResolved = resolved;

    try {
      const { rows, rowCount } = await pool.query<{
        id: number;
        checked_at: string;
        check_name: string;
        severity: string;
        league_id: string | null;
        season_id: string | null;
        entity_id: string | null;
        detail: string;
        resolved_at: string | null;
        resolved_by: string | null;
        total: string;
      }>(
        `SELECT
           id, checked_at, check_name, severity,
           league_id, season_id, entity_id, detail,
           resolved_at, resolved_by,
           COUNT(*) OVER () AS total
         FROM dq.finding
         WHERE league_id = $1
           AND ($2::text IS NULL OR severity = $2)
           AND (
             CASE WHEN $3 THEN resolved_at IS NOT NULL
                  ELSE resolved_at IS NULL
             END
           )
         ORDER BY
           CASE severity WHEN 'BLOCK' THEN 1 WHEN 'ALERT' THEN 2 ELSE 3 END,
           checked_at DESC
         LIMIT $4 OFFSET $5`,
        [leagueId, sev, showResolved, limit, offset],
      );

      void rowCount; // used only to avoid unused-var lint
      const total = rows[0] ? parseInt(rows[0].total, 10) : 0;
      const data = rows.map(({ total: _t, ...row }) => row);

      res.json({ data, total });
    } catch (err: unknown) {
      // dq schema may not exist yet in dev environments
      const pg = err as { code?: string; message?: string };
      if (pg?.code === "42P01" || pg?.message?.includes("dq")) {
        res.json({ data: [], total: 0 });
        return;
      }
      throw err;
    }
  },
);

// ── PATCH /leagues/:leagueId/dq-findings/:findingId/resolve ──────────────────

router.patch(
  "/leagues/:leagueId/dq-findings/:findingId/resolve",
  async (req: Request, res: Response): Promise<void> => {
    const leagueId  = String(req.params["leagueId"]);
    const findingId = String(req.params["findingId"]);

    const userId = await assertCommissioner(req, res, leagueId);
    if (!userId) return;

    const id = parseInt(findingId, 10);
    if (isNaN(id)) { notFound(res, "Finding not found"); return; }

    try {
      const { rows } = await pool.query<{
        id: number;
        checked_at: string;
        check_name: string;
        severity: string;
        league_id: string | null;
        season_id: string | null;
        entity_id: string | null;
        detail: string;
        resolved_at: string | null;
        resolved_by: string | null;
      }>(
        `UPDATE dq.finding
         SET resolved_at = now(), resolved_by = $3
         WHERE id = $1
           AND league_id = $2
         RETURNING id, checked_at, check_name, severity,
                   league_id, season_id, entity_id, detail,
                   resolved_at, resolved_by`,
        [id, leagueId, userId],
      );

      if (!rows[0]) { notFound(res, "Finding not found"); return; }
      res.json(rows[0]);
    } catch (err: unknown) {
      const pg = err as { code?: string; message?: string };
      if (pg?.code === "42P01") {
        notFound(res, "Finding not found");
        return;
      }
      throw err;
    }
  },
);

export default router;
