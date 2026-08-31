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
  "first_nhl_game",
  "profile_image_url",
  "favorite_club_id",
  "gm_card_display",
] as const;

type Identity = "xbox" | "playstation";
type GmCardDisplay = "first_game" | "favorite_team" | "both";
const GM_CARD_DISPLAY_VALUES: GmCardDisplay[] = ["first_game", "favorite_team", "both"];
type Profile = {
  id: string;
  display_name: string;
  timezone: string;
  xbox_gamertag: string | null;
  psn_online_id: string | null;
  systems_played: Identity[];
  primary_identity: Identity | null;
  first_nhl_game: string | null;
  profile_image_url: string | null;
  favorite_club_id: string | null;
  gm_card_display: GmCardDisplay;
};

// Cosmetic, self-reported — not fetched or verified, so only bounded and
// (for the URL) restricted to http(s) so it can't carry a javascript: URL.
const HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;

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
  if ("first_nhl_game" in input) {
    const value = input.first_nhl_game;
    if (value !== null && (typeof value !== "string" || !value.trim() || value.trim().length > 60)) {
      return { error: "first_nhl_game must be null or between 1 and 60 characters" };
    }
    values.first_nhl_game = typeof value === "string" ? value.trim() : null;
  }
  if ("profile_image_url" in input) {
    const value = input.profile_image_url;
    if (value !== null
        && (typeof value !== "string" || !value.trim() || value.trim().length > 500 || !HTTP_URL_PATTERN.test(value.trim()))) {
      return { error: "profile_image_url must be null or a valid http(s) URL of 500 characters or fewer" };
    }
    values.profile_image_url = typeof value === "string" ? value.trim() : null;
  }
  if ("favorite_club_id" in input) {
    const value = input.favorite_club_id;
    if (value !== null && typeof value !== "string") {
      return { error: "favorite_club_id must be null or a club id" };
    }
    values.favorite_club_id = value;
  }
  if ("gm_card_display" in input) {
    const value = input.gm_card_display;
    if (typeof value !== "string" || !GM_CARD_DISPLAY_VALUES.includes(value as GmCardDisplay)) {
      return { error: `gm_card_display must be one of: ${GM_CARD_DISPLAY_VALUES.join(", ")}` };
    }
    values.gm_card_display = value;
  }
  return { values };
}

function profileSelect(): string {
  return `id, display_name, timezone, xbox_gamertag, psn_online_id,
          systems_played, primary_identity, first_nhl_game, profile_image_url,
          favorite_club_id, gm_card_display`;
}

async function loadFavoriteClub(clubId: string | null) {
  if (!clubId) return null;
  const { rows } = await pool.query(
    `SELECT id, abbrev, name, conference, division, league_source FROM nhl_club WHERE id = $1`,
    [clubId],
  );
  return rows[0] ?? null;
}

router.get("/users/me", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user?.appUserId) {
    unauthorized(res, "Authentication required");
    return;
  }
  const result = await pool.query<Profile & { xbox_verified: boolean }>(
    `SELECT ${profileSelect()}, EXISTS(
       SELECT 1 FROM xbox_link xl WHERE xl.user_id = au.id
     ) AS xbox_verified
     FROM app_user au WHERE id = $1 AND deleted_at IS NULL`,
    [user.appUserId],
  );
  if (!result.rows[0]) {
    unauthorized(res, "User not found");
    return;
  }
  const profile = result.rows[0];
  const favorite_club = await loadFavoriteClub(profile.favorite_club_id);
  res.json({ ...profile, favorite_club });
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
    if (next.favorite_club_id) {
      const clubExists = await client.query(`SELECT 1 FROM nhl_club WHERE id = $1`, [next.favorite_club_id]);
      if (!clubExists.rows[0]) {
        await client.query("ROLLBACK");
        badRequest(res, "favorite_club_id does not match a known club");
        return;
      }
    }

    const updatedResult = await client.query<Profile>(
      `UPDATE app_user SET
         display_name = $2, timezone = $3, xbox_gamertag = $4,
         psn_online_id = $5, systems_played = $6, primary_identity = $7,
         first_nhl_game = $8, profile_image_url = $9, favorite_club_id = $10,
         gm_card_display = $11
       WHERE id = $1
       RETURNING ${profileSelect()}`,
      [
        user.appUserId, next.display_name, next.timezone, next.xbox_gamertag,
        next.psn_online_id, next.systems_played, next.primary_identity,
        next.first_nhl_game, next.profile_image_url, next.favorite_club_id,
        next.gm_card_display,
      ],
    );
    const updated = updatedResult.rows[0]!;
    await client.query(
      `INSERT INTO app_user_profile_history
         (user_id, display_name, timezone, xbox_gamertag, psn_online_id,
          systems_played, primary_identity, first_nhl_game, profile_image_url,
          favorite_club_id, gm_card_display, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $1)`,
      [
        user.appUserId, updated.display_name, updated.timezone, updated.xbox_gamertag,
        updated.psn_online_id, updated.systems_played, updated.primary_identity,
        updated.first_nhl_game, updated.profile_image_url, updated.favorite_club_id,
        updated.gm_card_display,
      ],
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id, entity_type, entity_id, action, before, after, reason)
       VALUES ($1, 'app_user', $1, 'update', $2::jsonb, $3::jsonb, 'self-service profile update')`,
      [user.appUserId, JSON.stringify(current), JSON.stringify(updated)],
    );
    await client.query("COMMIT");
    const favorite_club = await loadFavoriteClub(updated.favorite_club_id);
    res.json({ ...updated, favorite_club });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

export default router;