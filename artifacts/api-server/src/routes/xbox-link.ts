/**
 * Xbox Live identity verification routes.
 *
 * GET    /xbox/link             — current link status for the caller
 * GET    /xbox/link/start       — begin OAuth, redirects to Microsoft
 * GET    /xbox/link/callback    — OAuth redirect target, redirects back to the app
 * DELETE /xbox/link             — unlink
 */
import { createHash, randomBytes } from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCurrentUser } from "../server/auth";
import { unauthorized, notFound } from "../server/errors";
import { rateLimiter } from "../middlewares/rateLimiter";
import { encryptSecret, signToken, verifyToken } from "../lib/secretBox";
import {
  buildAuthorizeUrl,
  exchangeCodeForMsaTokens,
  verifyXboxIdentity,
  XboxVerificationError,
} from "../server/xboxLive";

const router: IRouter = Router();

const STATE_ENV = "XBOX_STATE_SECRET";
const TOKEN_ENC_ENV = "XBOX_TOKEN_ENC_KEY";
const STATE_TTL_SECONDS = 10 * 60;

type LinkState = { uid: string; verifier: string };

function frontendBase(): string {
  return (process.env["CALLBACK_BASE_URL"] ?? "").replace(/\/$/, "");
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

router.get("/xbox/link", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user?.appUserId) { unauthorized(res, "Authentication required"); return; }

  const { rows } = await pool.query<{ gamertag: string; xuid: string; linked_at: Date; last_verified_at: Date }>(
    `SELECT gamertag, xuid, linked_at, last_verified_at FROM xbox_link WHERE user_id = $1`,
    [user.appUserId],
  );
  if (!rows[0]) {
    res.json({ linked: false });
    return;
  }
  res.json({ linked: true, ...rows[0] });
});

router.get("/xbox/link/start", rateLimiter(), (req: Request, res: Response): void => {
  const user = getCurrentUser(req);
  if (!user?.appUserId) { unauthorized(res, "Authentication required"); return; }

  // buildAuthorizeUrl/signToken throw a plain Error when XBOX_CLIENT_ID,
  // CALLBACK_BASE_URL, or XBOX_STATE_SECRET aren't set in this environment —
  // an unhandled 500 with no explanation. Fail into the same error-banner
  // path the OAuth callback already uses instead, so a misconfigured
  // deployment (rather than a real Xbox Live failure) is visible and
  // actionable instead of a raw crash page.
  try {
    const { verifier, challenge } = pkcePair();
    const state = signToken({ uid: user.appUserId, verifier } satisfies LinkState, STATE_ENV, STATE_TTL_SECONDS);
    res.redirect(buildAuthorizeUrl(state, challenge));
  } catch (err) {
    const base = frontendBase();
    if (!base) {
      // Can't even build a redirect target — CALLBACK_BASE_URL itself is
      // unset, so there's nowhere safe to send the user back to.
      throw err;
    }
    res.redirect(`${base}/profile?xbox=error&reason=xbox_not_configured`);
  }
});

router.get("/xbox/link/callback", async (req: Request, res: Response): Promise<void> => {
  const base = frontendBase();
  const fail = (reason: string) => res.redirect(`${base}/profile?xbox=error&reason=${encodeURIComponent(reason)}`);

  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) { fail(error); return; }
  if (!code || !state) { fail("missing_code"); return; }

  const claims = verifyToken<LinkState>(state, STATE_ENV);
  if (!claims) { fail("expired_or_invalid_state"); return; }

  try {
    const tokens = await exchangeCodeForMsaTokens(code, claims.verifier);
    const identity = await verifyXboxIdentity(tokens.access_token);

    const refreshCiphertext = tokens.refresh_token
      ? encryptSecret(tokens.refresh_token, TOKEN_ENC_ENV)
      : null;
    const refreshExpiresAt = tokens.refresh_token
      ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // MSA refresh tokens are long-lived; re-checked on next silent verify
      : null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO xbox_link (user_id, xuid, gamertag, refresh_token_ciphertext, refresh_token_expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET
           xuid = EXCLUDED.xuid,
           gamertag = EXCLUDED.gamertag,
           last_verified_at = now(),
           refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
           refresh_token_expires_at = EXCLUDED.refresh_token_expires_at`,
        [claims.uid, identity.xuid, identity.gamertag, refreshCiphertext, refreshExpiresAt],
      );
      // Keep the self-reported field in step with the verified gamertag so
      // eligibility checks and everywhere else that reads app_user.xbox_gamertag
      // see the real value, not stale free text.
      await client.query(
        `UPDATE app_user SET xbox_gamertag = $2 WHERE id = $1`,
        [claims.uid, identity.gamertag],
      );
      await client.query("COMMIT");
    } catch (err: unknown) {
      await client.query("ROLLBACK");
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr?.code === "23505" && pgErr.constraint === "xbox_link_xuid_key") {
        fail("xbox_account_already_linked");
        return;
      }
      throw err;
    } finally {
      client.release();
    }

    res.redirect(`${base}/profile?xbox=linked`);
  } catch (err) {
    if (err instanceof XboxVerificationError) {
      fail(err.reason);
      return;
    }
    throw err;
  }
});

router.delete("/xbox/link", async (req: Request, res: Response): Promise<void> => {
  const user = getCurrentUser(req);
  if (!user?.appUserId) { unauthorized(res, "Authentication required"); return; }

  const result = await pool.query(`DELETE FROM xbox_link WHERE user_id = $1`, [user.appUserId]);
  if (result.rowCount === 0) { notFound(res, "No Xbox account linked"); return; }
  res.status(204).send();
});

export default router;
