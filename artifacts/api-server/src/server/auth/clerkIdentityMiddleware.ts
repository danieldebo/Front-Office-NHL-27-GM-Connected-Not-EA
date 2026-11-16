import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";
import { logger } from "../../lib/logger";
import type { AuthUser } from ".";

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

function claim(claims: Record<string, unknown> | null, name: string): string | null {
  const value = claims?.[name];
  return typeof value === "string" && value.trim() ? value : null;
}

interface ClerkProfile {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

// How long to wait for Clerk's API before giving up on a profile lookup.
export const CLERK_LOOKUP_TIMEOUT_MS = 5000;
// After a lookup fails or finds no email, skip asking Clerk again for this long,
// so a phone-only account or a Clerk outage does not add a call to every request.
export const CLERK_LOOKUP_RETRY_AFTER_MS = 5 * 60 * 1000;
const failedLookups = new Map<string, number>();

/** Test hook: forget remembered lookup failures. */
export function resetClerkLookupCache(): void {
  failedLookups.clear();
}

/**
 * Reads the user's email and name straight from Clerk. Used only when the
 * session token does not carry an email claim and no app_user row exists yet,
 * which is the case for a Clerk application whose session token has not been
 * customised. Returns null when Clerk is slow, unreachable or has no email.
 */
async function lookUpClerkProfile(clerkUserId: string): Promise<ClerkProfile | null> {
  const failedAt = failedLookups.get(clerkUserId);
  if (failedAt !== undefined && Date.now() - failedAt < CLERK_LOOKUP_RETRY_AFTER_MS) {
    return null;
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    const user = await Promise.race([
      clerkClient.users.getUser(clerkUserId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Clerk user lookup timed out after ${CLERK_LOOKUP_TIMEOUT_MS} ms`)),
          CLERK_LOOKUP_TIMEOUT_MS,
        );
      }),
    ]);
    const primary =
      user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId) ??
      user.emailAddresses[0];
    const email = primary?.emailAddress?.trim() || null;
    if (!email) {
      failedLookups.set(clerkUserId, Date.now());
      logger.warn({ clerkUserId }, "auth: Clerk account has no email address; app_user not created");
      return null;
    }
    failedLookups.delete(clerkUserId);
    return {
      email,
      firstName: user.firstName?.trim() || null,
      lastName: user.lastName?.trim() || null,
      imageUrl: user.imageUrl?.trim() || null,
    };
  } catch (error) {
    failedLookups.set(clerkUserId, Date.now());
    logger.warn(
      { clerkUserId, err: error instanceof Error ? error.message : String(error) },
      "auth: Clerk profile lookup failed; app_user not created",
    );
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function upsertAppUser(
  userId: string,
  profile: ClerkProfile & { email: string },
  clerkUserId: string,
): Promise<string | null> {
  const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.email;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email, external_ids)
     VALUES ($1, $2, $3, jsonb_build_object('clerk_user_id', $4::text))
     ON CONFLICT (replit_id) DO UPDATE
       SET external_ids = app_user.external_ids || EXCLUDED.external_ids
     RETURNING id`,
    [userId, displayName, profile.email, clerkUserId],
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Maps a Clerk session to the legacy domain identity used by app_user.replit_id.
 * Migrated accounts retain their original subject through sessionClaims.userId;
 * newly created Clerk accounts use their Clerk ID until a legacy subject exists.
 *
 * The email, name and image normally come from custom session-token claims
 * (see docs/local-development.md). When the token has no email claim and the
 * user has no app_user row yet, the profile is read from Clerk's API instead,
 * so a first sign-in still creates the account.
 */
export async function clerkIdentityMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      next();
      return;
    }

    const claims = (auth.sessionClaims ?? null) as Record<string, unknown> | null;
    const userId = claim(claims, "userId") ?? auth.userId;
    let profile: ClerkProfile = {
      email: claim(claims, "email"),
      firstName: claim(claims, "firstName"),
      lastName: claim(claims, "lastName"),
      imageUrl: claim(claims, "imageUrl"),
    };

    let appUserId: string | null = null;
    if (profile.email) {
      // Migrated users already have a domain row. For new Clerk accounts, create
      // one when Clerk supplied an email so domain authorization works immediately.
      appUserId = await upsertAppUser(userId, { ...profile, email: profile.email }, auth.userId);
    } else {
      const result = await pool.query<{ id: string }>(
        `SELECT id FROM app_user WHERE replit_id = $1`,
        [userId],
      );
      appUserId = result.rows[0]?.id ?? null;

      if (!appUserId) {
        const fromClerk = await lookUpClerkProfile(auth.userId);
        if (fromClerk?.email) {
          profile = fromClerk;
          appUserId = await upsertAppUser(userId, { ...fromClerk, email: fromClerk.email }, auth.userId);
        }
      }
    }

    req.authUser = {
      id: userId,
      appUserId,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      profileImageUrl: profile.imageUrl,
    };

    next();
  } catch (error) {
    next(error);
  }
}
