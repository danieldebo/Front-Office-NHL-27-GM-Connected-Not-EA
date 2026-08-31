/**
 * Per-user league membership limits.
 *
 * A user may belong to (create + join, counted the same way via
 * league_membership) at most LEAGUE_MEMBERSHIP_CAP leagues at once. Of
 * those, the first FREE_LEAGUE_CREATE_LIMIT they create are unrestricted
 * apart from a cooldown between creations; creating beyond that requires
 * app_user.extra_leagues_approved (a manual, admin-only flag — there is no
 * in-app admin role, so this is flipped by hand in the database).
 */
import { pool } from "@workspace/db";

export const LEAGUE_MEMBERSHIP_CAP = 10;
export const FREE_LEAGUE_CREATE_LIMIT = 5;
export const LEAGUE_CREATE_COOLDOWN_HOURS = 4;

export async function countActiveLeagueMemberships(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM league_membership WHERE user_id = $1 AND left_at IS NULL`,
    [userId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function countLeaguesCreated(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM league WHERE owner_user_id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function canCreateExtraLeagues(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ extra_leagues_approved: boolean }>(
    `SELECT extra_leagues_approved FROM app_user WHERE id = $1`,
    [userId]
  );
  return rows[0]?.extra_leagues_approved ?? false;
}

/** Seconds until this user's next league creation is allowed, or 0 if it's allowed now. */
export async function leagueCreateCooldownRemainingSecs(userId: string): Promise<number> {
  const { rows } = await pool.query<{ created_at: Date }>(
    `SELECT created_at FROM league
      WHERE owner_user_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  const last = rows[0]?.created_at;
  if (!last) return 0;
  const cooldownMs = LEAGUE_CREATE_COOLDOWN_HOURS * 3_600_000;
  const remainingMs = new Date(last).getTime() + cooldownMs - Date.now();
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}
