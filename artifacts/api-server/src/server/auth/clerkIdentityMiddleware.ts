import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";
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

/**
 * Maps a Clerk session to the legacy domain identity used by app_user.replit_id.
 * Migrated accounts retain their original subject through sessionClaims.userId;
 * newly created Clerk accounts use their Clerk ID until a legacy subject exists.
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
    const email = claim(claims, "email");
    const firstName = claim(claims, "firstName");
    const lastName = claim(claims, "lastName");
    const profileImageUrl = claim(claims, "imageUrl");

    req.authUser = {
      id: userId,
      email,
      firstName,
      lastName,
      profileImageUrl,
    };

    // Migrated users already have a domain row. For new Clerk accounts, create
    // one when Clerk supplied an email so domain authorization works immediately.
    if (email) {
      const displayName = [firstName, lastName].filter(Boolean).join(" ") || email;
      await pool.query(
        `INSERT INTO app_user (replit_id, display_name, email, external_ids)
         VALUES ($1, $2, $3, jsonb_build_object('clerk_user_id', $4::text))
         ON CONFLICT (replit_id) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               external_ids = app_user.external_ids || EXCLUDED.external_ids`,
        [userId, displayName, email, auth.userId],
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}