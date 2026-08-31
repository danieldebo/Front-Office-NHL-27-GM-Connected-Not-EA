import type { Request, Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser, type AuthUser } from "./auth";
import { can, type LeagueResource } from "./authz";
import { notFound } from "./errors";

export type LeagueAccess = {
  leagueId: string;
  ownerId: string;
  visibility: "public" | "unlisted" | "private";
  callerId: string | null;
  callerRole: string | null;
  commissionerIds: string[];
};

/**
 * Loads the policy facts for a league. Membership is deliberately based on an
 * active league_membership row; the owner remains an implicit member so old
 * leagues are safe even if their owner row was not backfilled.
 */
export async function leagueAccessFor(
  leagueId: string,
  user?: AuthUser | null,
): Promise<LeagueAccess | null> {
  const identity = user?.appUserId ?? user?.id ?? null;
  const { rows } = await pool.query<LeagueAccess>(
    `SELECT l.id AS "leagueId", l.owner_user_id AS "ownerId",
            l.visibility::text AS visibility, caller.id AS "callerId",
            membership.role::text AS "callerRole",
            COALESCE(array_agg(all_members.user_id) FILTER (
              WHERE all_members.role IN ('commissioner', 'assistant_commissioner')
                AND all_members.left_at IS NULL
            ), '{}') AS "commissionerIds"
       FROM league l
       LEFT JOIN app_user caller
         ON caller.id::text = $2 OR caller.replit_id = $2
       LEFT JOIN league_membership membership
         ON membership.league_id = l.id
        AND membership.user_id = caller.id
        AND membership.left_at IS NULL
       LEFT JOIN league_membership all_members
         ON all_members.league_id = l.id
        AND all_members.left_at IS NULL
      WHERE l.id = $1 AND l.deleted_at IS NULL
      GROUP BY l.id, caller.id, membership.role`,
    [leagueId, identity],
  );
  return rows[0] ?? null;
}

export function leagueResource(access: LeagueAccess): LeagueResource {
  return {
    kind: "league",
    ownerId: access.ownerId,
    memberIds: access.callerId && access.callerRole ? [access.callerId] : [],
    commissionerIds: access.commissionerIds,
  };
}

export function canReadLeague(user: AuthUser | null | undefined, access: LeagueAccess): boolean {
  return access.visibility === "public" || can(user, "league:read", leagueResource(access));
}

/** Returns null and writes a deliberately non-enumerating 404 when unreadable. */
export async function requireLeagueRead(
  req: Request,
  res: Response,
  leagueId: string,
): Promise<LeagueAccess | null> {
  const access = await leagueAccessFor(leagueId, getCurrentUser(req));
  if (!access || !canReadLeague(getCurrentUser(req), access)) {
    notFound(res, "League not found");
    return null;
  }
  return access;
}

export async function leagueAccessForSeason(
  seasonId: string,
  user?: AuthUser | null,
): Promise<LeagueAccess | null> {
  const row = await pool.query<{ league_id: string }>(
    `SELECT league_id FROM season WHERE id = $1`,
    [seasonId],
  );
  return row.rows[0] ? leagueAccessFor(row.rows[0].league_id, user) : null;
}

export async function leagueAccessForGame(
  gameId: string,
  user?: AuthUser | null,
): Promise<LeagueAccess | null> {
  const row = await pool.query<{ league_id: string }>(
    `SELECT s.league_id FROM game g JOIN season s ON s.id = g.season_id WHERE g.id = $1`,
    [gameId],
  );
  return row.rows[0] ? leagueAccessFor(row.rows[0].league_id, user) : null;
}

export async function requireSeasonRead(req: Request, res: Response, seasonId: string): Promise<LeagueAccess | null> {
  const access = await leagueAccessForSeason(seasonId, getCurrentUser(req));
  if (!access || !canReadLeague(getCurrentUser(req), access)) {
    notFound(res, "Season not found");
    return null;
  }
  return access;
}

export async function requireGameRead(req: Request, res: Response, gameId: string): Promise<LeagueAccess | null> {
  const access = await leagueAccessForGame(gameId, getCurrentUser(req));
  if (!access || !canReadLeague(getCurrentUser(req), access)) {
    notFound(res, "Game not found");
    return null;
  }
  return access;
}