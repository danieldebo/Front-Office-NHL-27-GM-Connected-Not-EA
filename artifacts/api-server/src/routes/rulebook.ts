/**
 * Rulebook routes — versioned league bylaws.
 *
 * GET /leagues/:leagueId/rulebook              — latest revision
 * PUT /leagues/:leagueId/rulebook              — publish new revision
 * GET /leagues/:leagueId/rulebook/revisions    — full history
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
} from "../server/errors";
import { PublishRulebookBody } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /leagues/:leagueId/rulebook
router.get(
  "/leagues/:leagueId/rulebook",
  async (req: Request, res: Response): Promise<void> => {
    const { leagueId } = req.params;

    const leagueCheck = await pool.query(`SELECT id FROM league WHERE id = $1`, [leagueId]);
    if (!leagueCheck.rows[0]) { notFound(res, "League not found"); return; }

    const { rows } = await pool.query(
      `SELECT id, league_id, version, body_md, change_note, authored_by, effective_at
         FROM rulebook_revision
        WHERE league_id = $1
        ORDER BY effective_at DESC
        LIMIT 1`,
      [leagueId]
    );

    if (!rows[0]) {
      notFound(res, "No rulebook published yet for this league");
      return;
    }

    res.json(rows[0]);
  }
);

// PUT /leagues/:leagueId/rulebook — publish a new revision
router.put(
  "/leagues/:leagueId/rulebook",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const { leagueId } = req.params;

    const leagueRow = await pool.query<{ id: string; owner_user_id: string }>(
      `SELECT id, owner_user_id FROM league WHERE id = $1`,
      [leagueId]
    );
    if (!leagueRow.rows[0]) { notFound(res, "League not found"); return; }

    if (!can(user, "rulebook:write", { kind: "league", ownerId: leagueRow.rows[0].owner_user_id })) {
      forbidden(res, "Only the league owner can publish rulebook revisions");
      return;
    }

    const parsed = PublishRulebookBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }

    const { body_md, change_note } = parsed.data;

    // Determine next version string (1.0, 1.1, 1.2, ...)
    const latestRow = await pool.query<{ version: string }>(
      `SELECT version FROM rulebook_revision WHERE league_id = $1 ORDER BY effective_at DESC LIMIT 1`,
      [leagueId]
    );

    let nextVersion: string;
    if (!latestRow.rows[0]) {
      nextVersion = "1.0";
    } else {
      const parts = latestRow.rows[0].version.split(".");
      const major = parseInt(parts[0] ?? "1", 10);
      const minor = parseInt(parts[1] ?? "0", 10);
      nextVersion = `${major}.${minor + 1}`;
    }

    const authorRow = await pool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE replit_id = $1`,
      [user.id]
    );
    if (!authorRow.rows[0]) { badRequest(res, "User profile not found"); return; }

    const insertRow = await pool.query(
      `INSERT INTO rulebook_revision (league_id, version, body_md, change_note, authored_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, league_id, version, body_md, change_note, authored_by, effective_at`,
      [leagueId, nextVersion, body_md, change_note ?? null, authorRow.rows[0].id]
    );

    res.status(201).json(insertRow.rows[0]);
  }
);

// GET /leagues/:leagueId/rulebook/revisions
router.get(
  "/leagues/:leagueId/rulebook/revisions",
  async (req: Request, res: Response): Promise<void> => {
    const { leagueId } = req.params;

    const leagueCheck = await pool.query(`SELECT id FROM league WHERE id = $1`, [leagueId]);
    if (!leagueCheck.rows[0]) { notFound(res, "League not found"); return; }

    const { rows } = await pool.query(
      `SELECT id, league_id, version, body_md, change_note, authored_by, effective_at
         FROM rulebook_revision
        WHERE league_id = $1
        ORDER BY effective_at DESC`,
      [leagueId]
    );

    res.json({ data: rows });
  }
);

export default router;
