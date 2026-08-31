import { randomBytes } from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { badRequest, forbidden, notFound, unauthorized } from "../server/errors";
import { identityVerificationRateLimiter } from "../middlewares/rateLimiter";

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
  xbox_identity_verified_at: Date | null;
  playstation_identity_verified_at: Date | null;
};

const CHALLENGE_TTL_MINUTES = 15;

export function officialProfileUrl(platform: Identity, gamertag: string): string {
  if (platform === "xbox") {
    const url = new URL("https://account.xbox.com/en-us/profile");
    url.searchParams.set("gamertag", gamertag);
    return url.toString();
  }
  return `https://profile.playstation.com/${encodeURIComponent(gamertag)}`;
}

function platformFromRequest(req: Request): Identity | null {
  const value = String(req.params.platform);
  return value === "xbox" || value === "playstation" ? value : null;
}

function gamertagFor(profile: Profile, platform: Identity): string | null {
  return platform === "xbox" ? profile.xbox_gamertag : profile.psn_online_id;
}

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
          systems_played, primary_identity, xbox_identity_verified_at,
          playstation_identity_verified_at`;
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
          psn_online_id = $5, systems_played = $6, primary_identity = $7,
          xbox_identity_verified_at = CASE
            WHEN xbox_gamertag IS DISTINCT FROM $4 THEN NULL
            ELSE xbox_identity_verified_at END,
          playstation_identity_verified_at = CASE
            WHEN psn_online_id IS DISTINCT FROM $5 THEN NULL
            ELSE playstation_identity_verified_at END
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

router.post(
  "/users/me/identity-verifications/:platform/challenge",
  identityVerificationRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user?.appUserId) { unauthorized(res, "Authentication required"); return; }
    const platform = platformFromRequest(req);
    if (!platform) { badRequest(res, "platform must be xbox or playstation"); return; }
    const current = await pool.query<Profile>(
      `SELECT ${profileSelect()} FROM app_user WHERE id = $1 AND deleted_at IS NULL`,
      [user.appUserId],
    );
    const gamertag = current.rows[0] && gamertagFor(current.rows[0], platform);
    if (!gamertag) {
      badRequest(res, `Save a ${platform === "xbox" ? "Xbox Gamertag" : "PSN Online ID"} before verification`);
      return;
    }
    const code = `FO-${randomBytes(12).toString("hex").toUpperCase()}`;
    const profileUrl = officialProfileUrl(platform, gamertag);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE identity_verification_challenge
            SET superseded_at = now()
          WHERE user_id = $1 AND platform = $2
            AND completed_at IS NULL AND superseded_at IS NULL AND expires_at > now()`,
        [user.appUserId, platform],
      );
      const { rows } = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO identity_verification_challenge
           (user_id, platform, gamertag, code, profile_url, expires_at)
         VALUES ($1,$2,$3,$4,$5,now() + ($6 * interval '1 minute'))
          RETURNING id, expires_at`,
        [user.appUserId, platform, gamertag, code, profileUrl, CHALLENGE_TTL_MINUTES],
      );
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id,entity_type,entity_id,action,after,reason)
         VALUES ($1,'app_user',$1,'create_identity_challenge',$2::jsonb,$3)`,
        [user.appUserId, JSON.stringify({ platform, gamertag, expires_at: rows[0]!.expires_at }),
          "commissioner-attested console profile verification"],
      );
      await client.query("COMMIT");
      res.status(201).json({
        challenge_id: rows[0]!.id, platform, gamertag, code, profile_url: profileUrl,
        expires_at: rows[0]!.expires_at,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);

router.post(
  "/users/me/identity-verifications/:platform/complete",
  identityVerificationRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const user = getCurrentUser(req);
    if (!user?.appUserId) { unauthorized(res, "Authentication required"); return; }
    const platform = platformFromRequest(req);
    if (!platform) { badRequest(res, "platform must be xbox or playstation"); return; }
    const submitted = await pool.query<{ id: string; submitted_at: Date; expires_at: Date }>(
      `UPDATE identity_verification_challenge SET submitted_at = now()
        WHERE id = (
          SELECT id FROM identity_verification_challenge
           WHERE user_id = $1 AND platform = $2 AND completed_at IS NULL
             AND submitted_at IS NULL AND superseded_at IS NULL AND expires_at > now()
           ORDER BY created_at DESC LIMIT 1
        )
        RETURNING id, submitted_at, expires_at`,
      [user.appUserId, platform],
    );
    const challenge = submitted.rows[0];
    if (!challenge) { badRequest(res, "No active unsubmitted verification challenge; create a new challenge"); return; }
    res.json({
      challenge_id: challenge.id, platform, submitted_at: challenge.submitted_at,
      expires_at: challenge.expires_at,
      review_path: `/identity-verifications/review/${challenge.id}`,
      status: "pending_commissioner_review",
    });
  },
);

type ReviewChallenge = {
  id: string; user_id: string; display_name: string; platform: Identity; gamertag: string;
  code: string; profile_url: string; expires_at: Date; submitted_at: Date | null;
  completed_at: Date | null; superseded_at: Date | null;
};

async function isLeagueOwner(userId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM league WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId],
  );
  return Boolean(result.rows[0]);
}

async function reviewChallenge(id: string): Promise<ReviewChallenge | null> {
  const result = await pool.query<ReviewChallenge>(
    `SELECT c.id, c.user_id, u.display_name, c.platform, c.gamertag, c.code, c.profile_url,
            c.expires_at, c.submitted_at, c.completed_at, c.superseded_at
       FROM identity_verification_challenge c JOIN app_user u ON u.id = c.user_id
      WHERE c.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

router.get("/identity-verifications/review/:challengeId", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user?.appUserId) { unauthorized(res, "Authentication required"); return; }
  if (!await isLeagueOwner(user.appUserId)) {
    forbidden(res, "Only a commissioner who owns an active league may review identities"); return;
  }
  const challenge = await reviewChallenge(String(req.params.challengeId));
  if (!challenge) { notFound(res, "Verification challenge not found"); return; }
  if (challenge.user_id === user.appUserId) {
    forbidden(res, "Challenge owners cannot review their own identity"); return;
  }
  res.json({
    challenge_id: challenge.id, display_name: challenge.display_name, platform: challenge.platform,
    gamertag: challenge.gamertag, code: challenge.code, profile_url: challenge.profile_url,
    expires_at: challenge.expires_at, submitted_at: challenge.submitted_at,
    completed_at: challenge.completed_at, superseded_at: challenge.superseded_at,
    status: challenge.completed_at ? "commissioner_verified" :
      !challenge.submitted_at ? "not_submitted" :
      challenge.superseded_at ? "superseded" :
      new Date(challenge.expires_at) <= new Date() ? "expired" : "pending_commissioner_review",
  });
});

router.post(
  "/identity-verifications/review/:challengeId/approve",
  identityVerificationRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const reviewer = getCurrentUser(req);
    if (!reviewer?.appUserId) { unauthorized(res, "Authentication required"); return; }
    if (!await isLeagueOwner(reviewer.appUserId)) {
      forbidden(res, "Only a commissioner who owns an active league may approve identities"); return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const challengeResult = await client.query<ReviewChallenge>(
        `SELECT c.id, c.user_id, u.display_name, c.platform, c.gamertag, c.code, c.profile_url,
                c.expires_at, c.submitted_at, c.completed_at, c.superseded_at
           FROM identity_verification_challenge c JOIN app_user u ON u.id = c.user_id
          WHERE c.id = $1 FOR UPDATE`,
        [String(req.params.challengeId)],
      );
      const challenge = challengeResult.rows[0];
      if (!challenge) { await client.query("ROLLBACK"); notFound(res, "Verification challenge not found"); return; }
      if (challenge.user_id === reviewer.appUserId) {
        await client.query("ROLLBACK"); forbidden(res, "Challenge owners cannot approve their own identity"); return;
      }
      const verificationColumn = challenge.platform === "xbox" ? "xbox_identity_verified_at" : "playstation_identity_verified_at";
      const identityColumn = challenge.platform === "xbox" ? "xbox_gamertag" : "psn_online_id";
      const approved = await client.query<{ id: string }>(
        `UPDATE identity_verification_challenge c SET completed_at = now(), reviewed_by = $2
          FROM app_user u
         WHERE c.id = $1 AND c.user_id = u.id AND c.submitted_at IS NOT NULL
           AND c.completed_at IS NULL AND c.superseded_at IS NULL AND c.expires_at > now()
           AND u.${identityColumn} = c.gamertag
         RETURNING c.id`,
        [challenge.id, reviewer.appUserId],
      );
      if (!approved.rows[0]) {
        await client.query("ROLLBACK");
        badRequest(res, "Challenge is not submitted, active, unexpired, or its saved identity changed"); return;
      }
      const updated = await client.query<Profile>(
        `UPDATE app_user SET ${verificationColumn} = now()
          WHERE id = $1 AND ${identityColumn} = $2
          RETURNING ${profileSelect()}`,
        [challenge.user_id, challenge.gamertag],
      );
      if (!updated.rows[0]) {
        await client.query("ROLLBACK");
        badRequest(res, "Saved identity changed while approval was in progress"); return;
      }
      await client.query(
        `INSERT INTO identity_verification_evidence
           (challenge_id,user_id,platform,gamertag,profile_url,method,reviewer_user_id,code_found,outcome)
         VALUES ($1,$2,$3,$4,$5,'commissioner_attestation',$6,TRUE,'verified')`,
        [challenge.id, challenge.user_id, challenge.platform, challenge.gamertag, challenge.profile_url, reviewer.appUserId],
      );
      await client.query(
        `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after,reason)
         VALUES ($1,'app_user',$2,'verify_identity',$3::jsonb,'commissioner attestation')`,
        [reviewer.appUserId, challenge.user_id, JSON.stringify({
          platform: challenge.platform, gamertag: challenge.gamertag, challenge_id: challenge.id,
          reviewer_user_id: reviewer.appUserId, method: "commissioner_attestation",
        })],
      );
      await client.query("COMMIT");
      res.json({ challenge_id: challenge.id, status: "commissioner_verified", profile: updated.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);

export default router;