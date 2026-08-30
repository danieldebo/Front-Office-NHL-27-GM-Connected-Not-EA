import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "crypto";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { CreateLeagueSettingsVersionBody } from "@workspace/api-zod";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import { idempotencyMiddleware } from "../middlewares/idempotency";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../server/errors";
import { LEAGUE_SETTINGS_TEMPLATES } from "../server/leagueSettingsTemplates";

const router: IRouter = Router();

// GET /league-settings/templates — static, no auth required (feeds the
// template picker on Create League, which runs before the league exists).
router.get("/league-settings/templates", (_req: Request, res: Response): void => {
  res.json({ data: LEAGUE_SETTINGS_TEMPLATES });
});

type Access = {
  leagueId: string;
  ownerId: string;
  appUserId: string;
  role: string | null;
};

async function accessFor(leagueId: string, replitId: string): Promise<Access | null> {
  const { rows } = await pool.query<Access>(
    `SELECT l.id AS "leagueId", l.owner_user_id AS "ownerId",
            caller.id AS "appUserId", lm.role::text AS role
       FROM league l
       JOIN app_user caller ON caller.replit_id = $2
       LEFT JOIN league_membership lm
         ON lm.league_id = l.id AND lm.user_id = caller.id AND lm.left_at IS NULL
      WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [leagueId, replitId],
  );
  return rows[0] ?? null;
}

function isMember(access: Access): boolean {
  return access.ownerId === access.appUserId || access.role !== null;
}

function settingsSelect(where: string): string {
  return `SELECT v.id, v.league_id, v.version, v.ea_league_id, v.platform,
                 v.team_count, v.roster_source, v.schedule_format,
                 v.schedule_settings, v.playoff_format, v.salary_cap_cents,
                 v.roster_min, v.roster_max, v.divisions, v.conferences,
                 v.rules_notes, v.slider_presets, v.require_verified_identities,
                 v.points_win, v.points_ot_loss, v.points_reg_loss, v.tiebreakers,
                 v.changed_by, v.changed_at,
                 v.change_summary, (a.settings_version_id = v.id) AS is_active
            FROM league_settings_version v
            LEFT JOIN league_settings_active a ON a.league_id = v.league_id
           ${where}`;
}

function formatSettings(row: Record<string, unknown>, canManage: boolean): Record<string, unknown> {
  return {
    ...row,
    salary_cap_cents: row.salary_cap_cents == null ? null : Number(row.salary_cap_cents),
    can_manage: canManage,
  };
}

export function validateSettings(input: {
  team_count: number;
  schedule_format: string;
  schedule_settings: Record<string, unknown>;
  playoff_format: Record<string, unknown>;
  salary_cap_cents?: number | null;
  roster_min?: number | null;
  roster_max?: number | null;
  divisions: string[];
  conferences: string[];
}): string | null {
  if (!Number.isInteger(input.team_count) || input.team_count < 3 || input.team_count > 32) {
    return "team_count must be an integer from 3 to 32";
  }
  if (input.salary_cap_cents != null &&
      (!Number.isSafeInteger(input.salary_cap_cents) || input.salary_cap_cents < 0)) {
    return "salary_cap_cents must be a non-negative integer";
  }
  if (input.roster_min != null && !Number.isInteger(input.roster_min)) {
    return "roster_min must be an integer";
  }
  if (input.roster_max != null && !Number.isInteger(input.roster_max)) {
    return "roster_max must be an integer";
  }
  if (input.roster_min != null && input.roster_max != null && input.roster_min > input.roster_max) {
    return "roster_min must not exceed roster_max";
  }
  const games = input.schedule_settings.games_per_matchup;
  const expected = input.schedule_format === "round_robin" ? 1 :
    input.schedule_format === "double_round_robin" ? 2 : null;
  if (expected !== null && games !== undefined && games !== expected) {
    return `${input.schedule_format} requires games_per_matchup=${expected}`;
  }
  if (input.schedule_format === "custom" &&
      (!Number.isInteger(games) || Number(games) < 1 || Number(games) > 8)) {
    return "custom schedule_settings.games_per_matchup must be an integer from 1 to 8";
  }
  const duration = input.schedule_settings.week_duration_days;
  if (duration !== undefined &&
      (!Number.isInteger(duration) || Number(duration) < 1 || Number(duration) > 31)) {
    return "schedule_settings.week_duration_days must be an integer from 1 to 31";
  }
  const playoffTeams = input.playoff_format.teams;
  if (playoffTeams !== undefined &&
      (!Number.isInteger(playoffTeams) || Number(playoffTeams) < 2 || Number(playoffTeams) > input.team_count)) {
    return "playoff_format.teams must be an integer from 2 through team_count";
  }
  for (const [name, values] of [["divisions", input.divisions], ["conferences", input.conferences]] as const) {
    if (values.some((value) => value.trim().length === 0) || new Set(values).size !== values.length) {
      return `${name} must contain unique, non-empty names`;
    }
  }
  return null;
}

router.get("/leagues/:leagueId/settings", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user) { unauthorized(res, "Authentication required"); return; }
  const leagueId = req.params.leagueId as string;
  const access = await accessFor(leagueId, user.id);
  if (!access) { notFound(res, "League not found"); return; }
  if (!isMember(access)) { forbidden(res, "Active league membership required"); return; }

  const { rows } = await pool.query(
    settingsSelect(`JOIN league_settings_active active
                      ON active.settings_version_id = v.id
                    WHERE v.league_id = $1`),
    [leagueId],
  );
  const canManage = ["owner", "commissioner", "assistant_commissioner"].includes(access.role ?? "") ||
    access.ownerId === access.appUserId;
  // Every league created through this API seeds version 1 at creation, so this
  // should be unreachable in practice — but a league created another way must
  // still get a working "create your first settings version" screen instead
  // of a 404 the client has no way to recover from.
  if (!rows[0]) { res.json({ can_manage: canManage }); return; }
  res.json(formatSettings(rows[0], canManage));
});

router.get("/leagues/:leagueId/settings/history", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user) { unauthorized(res, "Authentication required"); return; }
  const leagueId = req.params.leagueId as string;
  const access = await accessFor(leagueId, user.id);
  if (!access) { notFound(res, "League not found"); return; }
  if (!isMember(access)) { forbidden(res, "Active league membership required"); return; }
  const { rows } = await pool.query(
    settingsSelect(`WHERE v.league_id = $1 ORDER BY v.version DESC`),
    [leagueId],
  );
  const canManage = ["owner", "commissioner", "assistant_commissioner"].includes(access.role ?? "") ||
    access.ownerId === access.appUserId;
  res.json({ data: rows.map((row) => formatSettings(row, canManage)) });
});

router.post(
  "/leagues/:leagueId/settings/versions",
  idempotencyMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res, "Authentication required"); return; }
    const leagueId = req.params.leagueId as string;
    const access = await accessFor(leagueId, user.id);
    if (!access) { notFound(res, "League not found"); return; }
    const commissionerIds =
      ["owner", "commissioner", "assistant_commissioner"].includes(access.role ?? "")
        ? [user.appUserId ?? user.id] : [];
    if (!can(user, "league:write", {
      kind: "league", ownerId: access.ownerId, commissionerIds,
    })) {
      forbidden(res, "Commissioner access required");
      return;
    }

    const parsed = CreateLeagueSettingsVersionBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const validationError = validateSettings(parsed.data);
    if (validationError) { badRequest(res, validationError); return; }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [leagueId]);
      const idempotencyKey = req.headers["idempotency-key"];
      const key = typeof idempotencyKey === "string" && idempotencyKey.length <= 255
        ? idempotencyKey : null;
      const digest = createHash("sha256").update(JSON.stringify(req.body ?? "")).digest("hex");
      if (key) {
        const prior = await client.query<{
          request_digest: string; response_status: number; response_body: Record<string, unknown>;
        }>(
          `SELECT request_digest, response_status, response_body
             FROM idempotency_key
            WHERE user_id = $1 AND key = $2
            FOR UPDATE`,
          [access.appUserId, key],
        );
        if (prior.rows[0]) {
          await client.query("COMMIT");
          if (prior.rows[0].request_digest !== digest) {
            res.status(422).json({
              type: "https://frontoffice.example/probs/422",
              title: "Unprocessable Entity",
              status: 422,
              detail: "This Idempotency-Key was previously used with a different request body.",
              trace_id: req.id,
            });
            return;
          }
          res.status(prior.rows[0].response_status).json(prior.rows[0].response_body);
          return;
        }
      }
      const current = await client.query<Record<string, unknown>>(
        settingsSelect(`JOIN league_settings_active active
                          ON active.settings_version_id = v.id
                        WHERE v.league_id = $1 FOR UPDATE OF active`),
        [leagueId],
      );
      const nextVersion = Number(current.rows[0]?.version ?? 0) + 1;
      const d = parsed.data;
      const inserted = await client.query<Record<string, unknown>>(
        `INSERT INTO league_settings_version (
           league_id, version, ea_league_id, platform, team_count, roster_source,
           schedule_format, schedule_settings, playoff_format, salary_cap_cents,
           roster_min, roster_max, divisions, conferences, rules_notes,
           slider_presets, require_verified_identities, points_win, points_ot_loss,
           points_reg_loss, tiebreakers, changed_by, change_summary
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING *`,
        [leagueId, nextVersion, d.ea_league_id ?? null, d.platform, d.team_count,
         d.roster_source, d.schedule_format, d.schedule_settings, d.playoff_format,
         d.salary_cap_cents ?? null, d.roster_min ?? null, d.roster_max ?? null,
         JSON.stringify(d.divisions), JSON.stringify(d.conferences), d.rules_notes ?? null,
         d.slider_presets, d.require_verified_identities ?? false,
         d.points_win ?? 2, d.points_ot_loss ?? 1, d.points_reg_loss ?? 0,
         JSON.stringify(d.tiebreakers ?? ["points", "row", "wins", "goal_diff", "goals_for"]),
         access.appUserId, d.change_summary],
      );
      const version = inserted.rows[0]!;
      await client.query(
        `INSERT INTO league_settings_active (league_id, settings_version_id)
         VALUES ($1, $2)
         ON CONFLICT (league_id) DO UPDATE SET settings_version_id = EXCLUDED.settings_version_id`,
        [leagueId, version.id],
      );
      // league.platform is the canonical, cross-feature field (discovery,
      // eligibility) — keep it in step with what the settings editor calls
      // "Platform" rather than maintaining two independently-editable copies.
      await client.query(`UPDATE league SET platform = $2 WHERE id = $1`, [leagueId, d.platform]);
      let updatedActiveSeasonId: string | null = null;
      if (d.apply_to_active_season) {
        const activeSeason = await client.query<{ id: string }>(
          `UPDATE season
              SET points_win = $2, points_ot_loss = $3, points_reg_loss = $4, tiebreakers = $5
            WHERE league_id = $1 AND is_active = TRUE
           RETURNING id`,
          [leagueId, version.points_win, version.points_ot_loss, version.points_reg_loss,
           version.tiebreakers],
        );
        updatedActiveSeasonId = activeSeason.rows[0]?.id ?? null;
      }
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, league_id, entity_type, entity_id, action, before, after, reason)
         VALUES ($1,$2,'league_settings_version',$3,'create_version',$4,$5,$6)`,
        [access.appUserId, leagueId, version.id, current.rows[0] ?? null, version,
         d.change_summary],
      );
      const response = {
        ...formatSettings({ ...version, is_active: true }, true),
        applied_to_active_season_id: updatedActiveSeasonId,
      };
      if (key) {
        await client.query(
          `INSERT INTO idempotency_key
             (user_id, key, request_digest, response_status, response_body, expires_at)
           VALUES ($1,$2,$3,201,$4,NOW() + INTERVAL '24 hours')`,
          [access.appUserId, key, digest, JSON.stringify(response)],
        );
      }
      await client.query("COMMIT");
      res.status(201).json(response);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);

export default router;