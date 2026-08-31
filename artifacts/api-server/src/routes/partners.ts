/**
 * Charity and sponsor display fields on the league profile — name, link,
 * blurb, optional logo, max 2 of each. Replace-all semantics: PUT sends the
 * full charities[] and sponsors[] arrays and this replaces whatever existed.
 *
 * GET /leagues/:leagueId/partners — public
 * PUT /leagues/:leagueId/partners — commissioner-only
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import { badRequest, forbidden, notFound, unauthorized } from "../server/errors";
import { UpdatePartnersBody } from "@workspace/api-zod";

const router: IRouter = Router();

function groupPartners(rows: { id: string; kind: string; name: string; link: string; blurb: string | null; logo_url: string | null }[]) {
  return {
    charities: rows.filter((r) => r.kind === "charity"),
    sponsors: rows.filter((r) => r.kind === "sponsor"),
  };
}

router.get(
  "/leagues/:leagueId/partners",
  async (req: Request, res: Response): Promise<void> => {
    const leagueId = req.params.leagueId as string;
    const leagueCheck = await pool.query(`SELECT id FROM league WHERE id = $1`, [leagueId]);
    if (!leagueCheck.rows[0]) { notFound(res, "League not found"); return; }

    const { rows } = await pool.query(
      `SELECT id, kind, name, link, blurb, logo_url FROM league_partner
        WHERE league_id = $1 ORDER BY kind, display_order`,
      [leagueId]
    );
    res.json(groupPartners(rows));
  }
);

router.put(
  "/leagues/:leagueId/partners",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }

    const leagueId = req.params.leagueId as string;
    const leagueRow = await pool.query<{ owner_user_id: string }>(
      `SELECT owner_user_id FROM league WHERE id = $1`,
      [leagueId]
    );
    if (!leagueRow.rows[0]) { notFound(res, "League not found"); return; }

    if (!can(user, "partners:write", { kind: "league", ownerId: leagueRow.rows[0].owner_user_id })) {
      forbidden(res, "Only the commissioner can edit charity/sponsor fields"); return;
    }

    const parsed = UpdatePartnersBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const { charities, sponsors } = parsed.data;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM league_partner WHERE league_id = $1`, [leagueId]);

      for (const [kind, items] of [["charity", charities], ["sponsor", sponsors]] as const) {
        for (let i = 0; i < items.length; i++) {
          const p = items[i]!;
          await client.query(
            `INSERT INTO league_partner (league_id, kind, name, link, blurb, logo_url, display_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [leagueId, kind, p.name, p.link, p.blurb ?? null, p.logo_url ?? null, i]
          );
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
      `SELECT id, kind, name, link, blurb, logo_url FROM league_partner
        WHERE league_id = $1 ORDER BY kind, display_order`,
      [leagueId]
    );
    res.json(groupPartners(rows));
  }
);

export default router;
