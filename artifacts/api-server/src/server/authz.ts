/**
 * Authorization layer — the SOLE location for permission checks.
 *
 * Rules:
 *  - All checks go through `can(user, action, resource)`.
 *  - Callers must not duplicate permission logic; they call can() and branch on the result.
 *  - No RLS in Phase 1. authz.ts is the single enforcement point.
 */
import type { AuthUser } from "@workspace/api-zod";

export type Action =
  | "league:read"
  | "league:write"           // update league settings
  | "season:read"
  | "season:create"          // commissioner creates a season
  | "game:read"
  | "result:report"
  | "result:confirm"
  | "result:dispute"
  | "seat:manage"            // assign / revoke GM, approve join requests
  | "invite:manage"          // create / revoke invite links
  | "rulebook:write";        // publish a new revision

export interface LeagueResource {
  kind: "league";
  ownerId: string;
  memberIds?: string[];
}

export interface GameResource {
  kind: "game";
  homeGmUserId: string | null;
  awayGmUserId: string | null;
}

export interface ResultResource {
  kind: "result";
  reportedByUserId: string | null;
  gameHomeGmUserId: string | null;
  gameAwayGmUserId: string | null;
}

export type Resource = LeagueResource | GameResource | ResultResource;

/**
 * Returns true when `user` is permitted to perform `action` on `resource`.
 *
 * @param user   The authenticated user. Null means unauthenticated.
 * @param action The action being attempted.
 * @param resource The target resource with enough context for the check.
 */
export function can(
  user: AuthUser | null | undefined,
  action: Action,
  resource: Resource
): boolean {
  if (!user) return false;

  switch (action) {
    case "league:read":
    case "season:read":
    case "game:read":
      // All authenticated users can read league/season/game data.
      return true;

    case "league:write":
    case "season:create":
    case "seat:manage":
    case "invite:manage":
    case "rulebook:write": {
      if (resource.kind !== "league") return false;
      // Only the league owner (commissioner) may write.
      return resource.ownerId === user.id;
    }

    case "result:report": {
      if (resource.kind !== "game") return false;
      return (
        resource.homeGmUserId === user.id ||
        resource.awayGmUserId === user.id
      );
    }

    case "result:confirm":
    case "result:dispute": {
      if (resource.kind !== "result") return false;
      const isGameGm =
        resource.gameHomeGmUserId === user.id ||
        resource.gameAwayGmUserId === user.id;
      // Must be a GM in the game AND must not be the reporter (no self-confirmation).
      return isGameGm && resource.reportedByUserId !== user.id;
    }

    default:
      return false;
  }
}

/**
 * Convenience: throws if the user is not authenticated.
 */
export function requireAuth(
  user: AuthUser | null | undefined
): asserts user is AuthUser {
  if (!user) {
    throw new AuthError("Authentication required");
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
