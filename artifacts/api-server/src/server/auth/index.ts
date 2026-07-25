/**
 * Auth adapter — exposes getCurrentUser(req) as the ONLY way for route handlers
 * to obtain the current user. Callers never import Replit Auth directly.
 *
 * This thin wrapper isolates the rest of the server from the auth implementation
 * so swapping Replit Auth for Discord OAuth (Phase 2) touches only this file.
 */
import type { Request } from "express";
import type { AuthUser } from "@workspace/api-zod";

/**
 * Returns the authenticated user attached to the request by authMiddleware,
 * or null if the request is unauthenticated / the session has expired.
 */
export function getCurrentUser(req: Request): AuthUser | null {
  if (req.isAuthenticated?.()) {
    return req.user ?? null;
  }
  return null;
}
