/**
 * Keepers & player registry routes — build-queue prompt F.
 *
 * PATCH  /leagues/:leagueId/seasons/:seasonId/keeper-settings   — set keepers_per_team / keeper_deadline_at (commissioner)
 * GET    /franchises/:franchiseId/seasons/:seasonId/keepers     — active keepers + slot count for this team
 * POST   /franchises/:franchiseId/seasons/:seasonId/keepers     — designate a keeper
 * DELETE /keepers/:keeperId                                     — release a keeper
 * GET    /players/search                                        — typo-tolerant registry name search
 * GET    /players/:playerId/stat-cards                          — cached 1/3/5-year cards, refreshed lazily
 * POST   /registry-sync/run                                     — manually trigger a registry sync
 *
 * Note on the keeper limit and "commissioner override": schema-keepers.sql's
 * enforce_keeper_limit trigger deliberately does NOT let a commissioner
 * override exceed the season's keepers_per_team — see the trigger's own
 * comment ("the override is about WHOSE roster the commissioner can edit,
 * not about exceeding the cap... if a league wants the commissioner to
 * exceed it, raise the limit"). The build-queue prompt's "can exceed the
 * limit with a required note" conflicts with that already-made, documented
 * schema decision; this keeps the schema's call rather than reversing it
 * with a bypass, and returns the trigger's clean 409 as-is. The "required
 * note" is enforced here for what schema-keepers.sql actually models:
 * `is_commissioner_override` — a commissioner acting on a team that is not
 * their own.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../server/errors";
import { CreateKeeperBody, SetKeeperSettingsBody } from "@workspace/api-zod";

const router: IRouter = Router();

// ────────────────────────────────────────────── helpers

async function appUserIdFor(replitId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM app_user WHERE replit_id = $1`, [replitId]);
  return rows[0]?.id ?? null;
}

async function callerRole(leagueId: string, appUserId: string): Promise<string | null> {
  const { rows } = await pool.query<{ role: string | null }>(
    `SELECT role::text AS role FROM league_membership WHERE league_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [leagueId, appUserId],
  );
  return rows[0]?.role ?? null;
}

function isCommissionerRole(ownerId: string, appUserId: string, role: string | null): boolean {
  return ownerId === appUserId || ["commissioner", "assistant_commissioner"].includes(role ?? "");
}

async function franchiseLeagueAndGm(franchiseId: string, seasonId: string) {
  const { rows } = await pool.query<{
    league_id: string; owner_user_id: string; gm_user_id: string | null;
    keepers_per_team: number; keeper_deadline_at: string | null;
  }>(
    `SELECT f.league_id, l.owner_user_id, ga.user_id AS gm_user_id,
            s.keepers_per_team, s.keeper_deadline_at
       FROM franchise f
       JOIN league l ON l.id = f.league_id
       JOIN season s ON s.id = $2
       LEFT JOIN team_season ts ON ts.franchise_id = f.id AND ts.season_id = $2
       LEFT JOIN gm_assignment ga ON ga.team_season_id = ts.id AND ga.ended_at IS NULL
      WHERE f.id = $1`,
    [franchiseId, seasonId],
  );
  return rows[0] ?? null;
}

function pastDeadline(keeperDeadlineAt: string | null): boolean {
  return keeperDeadlineAt != null && new Date(keeperDeadlineAt) <= new Date();
}

// ────────────────────────────────────────────── keeper settings

router.patch(
  "/leagues/:leagueId/seasons/:seasonId/keeper-settings",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const leagueId = req.params.leagueId as string;
    const seasonId = req.params.seasonId as string;

    const league = await pool.query<{ owner_user_id: string }>(`SELECT owner_user_id FROM league WHERE id = $1`, [leagueId]);
    if (!league.rows[0]) { notFound(res, "League not found"); return; }
    const appUserId = await appUserIdFor(user.id);
    if (!appUserId) { badRequest(res, "User profile not found"); return; }
    const role = await callerRole(leagueId, appUserId);
    if (!can(user, "league:write", { kind: "league", ownerId: league.rows[0].owner_user_id, commissionerIds: isCommissionerRole(league.rows[0].owner_user_id, appUserId, role) ? [appUserId] : [] })) {
      forbidden(res, "Only the commissioner can change keeper settings");
      return;
    }

    const parsed = SetKeeperSettingsBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const { keepers_per_team, keeper_deadline_at } = parsed.data;

    const season = await pool.query<{ id: string }>(`SELECT id FROM season WHERE id = $1 AND league_id = $2`, [seasonId, leagueId]);
    if (!season.rows[0]) { notFound(res, "Season not found"); return; }

    try {
      const { rows } = await pool.query<{ keepers_per_team: number; keeper_deadline_at: string | null }>(
        `UPDATE season SET
           keepers_per_team = COALESCE($2, keepers_per_team),
           keeper_deadline_at = CASE WHEN $3 THEN $4 ELSE keeper_deadline_at END
         WHERE id = $1
         RETURNING keepers_per_team, keeper_deadline_at`,
        [seasonId, keepers_per_team ?? null, "keeper_deadline_at" in parsed.data, keeper_deadline_at ?? null],
      );
      res.json(rows[0]);
    } catch (err) {
      if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23514") {
        badRequest(res, "keepers_per_team must be between 0 and 50");
        return;
      }
      throw err;
    }
  },
);

// ────────────────────────────────────────────── keeper CRUD

router.get(
  "/franchises/:franchiseId/seasons/:seasonId/keepers",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const franchiseId = req.params.franchiseId as string;
    const seasonId = req.params.seasonId as string;

    const [keepers, slots] = await Promise.all([
      pool.query(
        `SELECT id, player_id, full_name, position, is_manual, registry_matched,
                first_marked_at, designated_at, is_commissioner_override, seasons_kept
           FROM v_active_keepers
          WHERE franchise_id = $1 AND season_id = $2
          ORDER BY designated_at ASC`,
        [franchiseId, seasonId],
      ),
      pool.query<{ allowed: number; used: number; open_slots: number }>(
        `SELECT allowed, used, open_slots FROM v_keeper_slots WHERE franchise_id = $1 AND season_id = $2`,
        [franchiseId, seasonId],
      ),
    ]);
    const slotsRow = slots.rows[0];
    res.json({
      data: keepers.rows,
      slots: slotsRow
        ? { allowed: Number(slotsRow.allowed), used: Number(slotsRow.used), open_slots: Number(slotsRow.open_slots) }
        : { allowed: 0, used: 0, open_slots: 0 },
    });
  },
);

router.post(
  "/franchises/:franchiseId/seasons/:seasonId/keepers",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const franchiseId = req.params.franchiseId as string;
    const seasonId = req.params.seasonId as string;

    const context = await franchiseLeagueAndGm(franchiseId, seasonId);
    if (!context) { notFound(res, "Franchise or season not found"); return; }

    const appUserId = await appUserIdFor(user.id);
    if (!appUserId) { badRequest(res, "User profile not found"); return; }
    const role = await callerRole(context.league_id, appUserId);
    const isCommissioner = isCommissionerRole(context.owner_user_id, appUserId, role);
    if (!can(user, "keeper:write", { kind: "transaction", ownerId: context.owner_user_id, commissionerIds: isCommissioner ? [appUserId] : [], gmUserIds: [context.gm_user_id] })) {
      forbidden(res, "Only this team's GM or the commissioner can designate a keeper");
      return;
    }

    const isOverride = isCommissioner && appUserId !== context.gm_user_id;
    if (isOverride && pastDeadline(context.keeper_deadline_at)) {
      // Commissioner overrides are exactly what stays allowed post-deadline.
    } else if (pastDeadline(context.keeper_deadline_at)) {
      forbidden(res, "The keeper deadline has passed; only the commissioner can make changes now");
      return;
    }

    const parsed = CreateKeeperBody.safeParse(req.body);
    if (!parsed.success) { badRequest(res, parsed.error.message); return; }
    const { player_id, note } = parsed.data;
    if (isOverride && !note?.trim()) {
      badRequest(res, "A note is required when the commissioner designates a keeper on another team's roster");
      return;
    }

    const player = await pool.query(`SELECT id FROM player WHERE id = $1`, [player_id]);
    if (!player.rows[0]) { notFound(res, "Player not found"); return; }

    try {
      const { rows } = await pool.query(
        `INSERT INTO keeper (league_id, franchise_id, player_id, season_id, designated_by, is_commissioner_override)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, first_marked_at, designated_at, is_commissioner_override`,
        [context.league_id, franchiseId, player_id, seasonId, appUserId, isOverride],
      );
      if (isOverride) {
        await pool.query(
          `INSERT INTO audit_log (actor_user_id, league_id, entity_type, entity_id, action, after, reason)
           VALUES ($1,$2,'keeper',$3,'commissioner_override_designate',$4,$5)`,
          [appUserId, context.league_id, rows[0]!.id, JSON.stringify(rows[0]), note],
        );
      }
      res.status(201).json(rows[0]);
    } catch (err) {
      if (typeof err === "object" && err !== null && "code" in err) {
        const code = (err as { code: string; message?: string }).code;
        if (code === "23514") { // check_violation (SQLSTATE, not the symbolic name)
          const message = (err as { message?: string }).message ?? "";
          conflict(res, message.includes("disabled") ? "Keepers are disabled for this season" : "This franchise already holds its full allotment of keepers this season");
          return;
        }
        if (code === "23P01") { // exclusion_violation: keeper_one_franchise_per_season
          conflict(res, "This player is already an active keeper for another franchise this season");
          return;
        }
      }
      throw err;
    }
  },
);

router.delete(
  "/keepers/:keeperId",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const keeperId = req.params.keeperId as string;
    const reason = typeof req.query.reason === "string" ? req.query.reason : null;

    const keeper = await pool.query<{ franchise_id: string; season_id: string; released_at: string | null }>(
      `SELECT franchise_id, season_id, released_at FROM keeper WHERE id = $1`,
      [keeperId],
    );
    if (!keeper.rows[0]) { notFound(res, "Keeper designation not found"); return; }
    if (keeper.rows[0].released_at) { conflict(res, "This keeper has already been released"); return; }

    const context = await franchiseLeagueAndGm(keeper.rows[0].franchise_id, keeper.rows[0].season_id);
    if (!context) { notFound(res, "Franchise or season not found"); return; }

    const appUserId = await appUserIdFor(user.id);
    if (!appUserId) { badRequest(res, "User profile not found"); return; }
    const role = await callerRole(context.league_id, appUserId);
    const isCommissioner = isCommissionerRole(context.owner_user_id, appUserId, role);
    if (!can(user, "keeper:write", { kind: "transaction", ownerId: context.owner_user_id, commissionerIds: isCommissioner ? [appUserId] : [], gmUserIds: [context.gm_user_id] })) {
      forbidden(res, "Only this team's GM or the commissioner can release a keeper");
      return;
    }
    const isOverride = isCommissioner && appUserId !== context.gm_user_id;
    if (!isOverride && pastDeadline(context.keeper_deadline_at)) {
      forbidden(res, "The keeper deadline has passed; only the commissioner can make changes now");
      return;
    }
    if (isOverride && !reason?.trim()) {
      badRequest(res, "A reason is required when the commissioner releases a keeper on another team's roster");
      return;
    }

    await pool.query(
      `UPDATE keeper SET released_at = now(), released_by = $2, release_reason = $3 WHERE id = $1`,
      [keeperId, appUserId, reason],
    );
    if (isOverride) {
      await pool.query(
        `INSERT INTO audit_log (actor_user_id, league_id, entity_type, entity_id, action, reason)
         VALUES ($1,$2,'keeper',$3,'commissioner_override_release',$4)`,
        [appUserId, context.league_id, keeperId, reason],
      );
    }
    res.sendStatus(204);
  },
);

// ────────────────────────────────────────────── player registry search

router.get(
  "/players/search",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) { res.json({ data: [] }); return; }

    const { rows } = await pool.query(
      `SELECT id, full_name, position, current_team_abbrev, is_manual,
              (external_ids ? 'nhl_api') AS registry_matched,
              similarity(full_name, $1) AS score
         FROM player
        WHERE full_name % $1 OR full_name ILIKE $1 || '%'
        ORDER BY score DESC, full_name ASC
        LIMIT 15`,
      [q],
    );
    res.json({ data: rows });
  },
);

// ────────────────────────────────────────────── stat cards

router.get(
  "/players/:playerId/stat-cards",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }
    const playerId = req.params.playerId as string;

    const player = await pool.query<{ id: string; external_ids: Record<string, unknown> }>(
      `SELECT id, external_ids FROM player WHERE id = $1`,
      [playerId],
    );
    if (!player.rows[0]) { notFound(res, "Player not found"); return; }
    if (!("nhl_api" in (player.rows[0].external_ids ?? {}))) {
      res.json({ data: [], registry_matched: false });
      return;
    }

    const cards = await pool.query(
      `SELECT window_years, stat_line, season_span, fetched_at, stale_after
         FROM player_stat_card WHERE player_id = $1 ORDER BY window_years ASC`,
      [playerId],
    );
    const isStale = cards.rows.length < 3 || cards.rows.some((c) => new Date(c.stale_after) <= new Date());
    if (isStale) {
      const existing = await pool.query(
        `SELECT 1 FROM outbox WHERE topic = 'statcard.refresh.requested' AND payload->>'player_id' = $1 AND processed_at IS NULL`,
        [playerId],
      );
      if (!existing.rows[0]) {
        await pool.query(`INSERT INTO outbox (topic, payload) VALUES ('statcard.refresh.requested', $1)`, [JSON.stringify({ player_id: playerId })]);
      }
    }
    res.json({ data: cards.rows, registry_matched: true, refreshing: isStale });
  },
);

// ────────────────────────────────────────────── manual registry sync trigger

router.post(
  "/registry-sync/run",
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user) { unauthorized(res); return; }

    const existing = await pool.query(
      `SELECT 1 FROM outbox WHERE topic = 'registry.sync.requested' AND processed_at IS NULL`,
    );
    if (existing.rows[0]) { conflict(res, "A registry sync is already pending"); return; }

    await pool.query(`INSERT INTO outbox (topic, payload) VALUES ('registry.sync.requested', '{}')`);
    res.status(202).json({ queued: true });
  },
);

export default router;
