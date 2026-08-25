/**
 * Auth adapter — exposes getCurrentUser(req) as the only way route handlers
 * obtain the authenticated identity.
 */
import type { Request } from "express";

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

/**
 * Returns the Clerk identity prepared by the request middleware, or null when
 * the browser does not have a valid Clerk session.
 */
export function getCurrentUser(req: Request): AuthUser | null {
  return req.authUser ?? null;
}
