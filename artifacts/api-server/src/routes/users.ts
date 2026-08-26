import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { badRequest, unauthorized } from "../server/errors";

const router: IRouter = Router();
const editableFields = [
  "display_name",
  "timezone",
  "xbox_gamertag",
  "psn_online_id",
  "systems_played",
  "primary_identity",
] as const;

type Identity = "xbox" | "playstation";
type Profile = {
  id: string;
  display_name: string;
  timezone: string;
  xbox_gamertag: string | null;
  psn_online_id: string | null;
  systems_played: Identity[];
  primary_identity: Identity | null;
};

function validTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function validateProfilePatch(body: unknown): { values?: Record<string, unknown>; error?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be an object" };
  }
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).filter(
    (key) => !editableFields.includes(key as (typeof editableFields)[number]),
  );
  if (unknown.length) return { error: `Unknown profile field: ${unknown[0]}` };
  if (!Object.keys(input).length) return { error: "At least one profile field is required" };

  const values: Record<string, unknown> = {};
  if ("display_name" in input) {
    if (typeof input.display_name !== "string" || !input.display_name.trim() || input.display_name.trim().length > 100) {
      return { error: "display_name must be between 1 and 100 characters" };
    }
    values.display_name = input.display_name.trim();
  }
  if ("timezone" in input) {
    if (typeof input.timezone !== "string" || !validTimezone(input.timezone)) {
      return { error: "timezone must be a valid IANA timezone" };
    }
    values.timezone = input.timezone;
  }
  for (const field of ["xbox_gamertag", "psn_online_id"] as const) {
    if (field in input) {
      const value = input[field];
      if (value !== null && (typeof value !== "string" || !value.trim() || value.trim().length > 100)) {
        return { error: `${field} must be null or between 1 and 100 characters` };
      }
      values[field] = typeof value === "string" ? value.trim() : null;
    }
  }
  if ("systems_played" in input) {
    if (!Array.isArray(input.systems_played)
        || input.systems_played.some((v) => v !== "xbox" && v !== "playstation")) {
      return { error: "systems_played must contain only xbox and playstation" };
    }
    values.systems_played = [...new Set(input.systems_played)];
  }
  if ("primary_identity" in input) {
    if (input.primary_identity !== null
        && input.primary_identity !== "xbox"
        && input.primary_identity !== "playstation") {
      return { error: "primary_identity must be xbox, playstation, or null" };
    }
    values.primary_identity = input.primary_identity;
  }
  return { values };
}

function profileSelect(): string {
  return `id, display_name, timezone, xbox_gamertag, psn_online_id,
          systems_played, primary_identity`;
}

router.get("/users/me", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user?.appUserId) {
    unauthorized(res, "Authentication required");
    return;
  }
  const result = await pool.query<Profile>(
    `SELECT ${profileSelect()} FROM app_user WHERE id = $1 AND deleted_at IS NULL`,
    [user.appUserId],
  );
  if (!result.rows[0]) {
    unauthorized(res, "User not found");
    return;
  }
  res.json(result.rows[0]);
});

router.patch("/users/me", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user?.appUserId) {
    unauthorized(res, "Authentication required");
    return;
  }
  const parsed = validateProfilePatch(req.body);
  if (!parsed.values) {
    badRequest(res, parsed.error);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<Profile>(
      `SELECT ${profileSelect()} FROM app_user
       WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [user.appUserId],
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      unauthorized(res, "User not found");
      return;
    }
    const next = { ...current, ...parsed.values } as Profile;
    if (next.primary_identity === "xbox"
        && (!next.xbox_gamertag || !next.systems_played.includes("xbox"))) {
      await client.query("ROLLBACK");
      badRequest(res, "Xbox primary identity requires an Xbox gamertag and Xbox system");
      return;
    }
    if (next.primary_identity === "playstation"
        && (!next.psn_online_id || !next.systems_played.includes("playstation"))) {
      await client.query("ROLLBACK");
      badRequest(res, "PlayStation primary identity requires a PSN online ID and PlayStation system");
      return;
    }

    const updatedResult = await client.query<Profile>(
      `UPDATE app_user SET
         display_name = $2, timezone = $3, xbox_gamertag = $4,
         psn_online_id = $5, systems_played = $6, primary_identity = $7
       WHERE id = $1
       RETURNING ${profileSelect()}`,
      [
        user.appUserId, next.display_name, next.timezone, next.xbox_gamertag,
        next.psn_online_id, next.systems_played, next.primary_identity,
      ],
    );
    const updated = updatedResult.rows[0]!;
    await client.query(
      `INSERT INTO app_user_profile_history
         (user_id, display_name, timezone, xbox_gamertag, psn_online_id,
          systems_played, primary_identity, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $1)`,
      [
        user.appUserId, updated.display_name, updated.timezone, updated.xbox_gamertag,
        updated.psn_online_id, updated.systems_played, updated.primary_identity,
      ],
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id, entity_type, entity_id, action, before, after, reason)
       VALUES ($1, 'app_user', $1, 'update', $2::jsonb, $3::jsonb, 'self-service profile update')`,
      [user.appUserId, JSON.stringify(current), JSON.stringify(updated)],
    );
    await client.query("COMMIT");
    res.json(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

export default router;