/**
 * Authorization layer — the SOLE location for permission checks.
 *
 * Rules:
 *  - All checks go through `can(user, action, resource)`.
 *  - Callers must not duplicate permission logic; they call can() and branch on the result.
 *  - No RLS in Phase 1. authz.ts is the single enforcement point.
 */
import type { AuthUser } from "./auth";

export type Action =
  | "league:read"
  | "league:write"           // update league settings
  | "season:read"
  | "season:create"          // commissioner creates a season
  | "game:read"
  | "game:manage"            // commissioner: shift window, postpone, force-resolve
  | "schedule:generate"      // commissioner: generate the season schedule
  | "result:report"
  | "result:confirm"
  | "result:dispute"
  | "seat:manage"            // assign / revoke GM, approve join requests
  | "invite:manage"          // create / revoke invite links
  | "rulebook:write"         // publish a new revision
  | "transaction:act"        // GM acting on their own team's side of a transaction, or commissioner acting for any team
  | "transaction:approve";   // commissioner-only: approve/reject a trade, resolve a waiver

export interface LeagueResource {
  kind: "league";
  ownerId: string;
  memberIds?: string[];
  commissionerIds?: string[];
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

export interface TransactionResource {
  kind: "transaction";
  ownerId: string;
  commissionerIds?: string[];
  // The GM(s) whose team(s) this action touches — a GM may act for their own
  // team without being a commissioner (propose/accept a trade, sign or
  // release their own player, submit a waiver claim). Irrelevant for
  // transaction:approve, which is commissioner-only.
  gmUserIds?: (string | null)[];
}

export type Resource = LeagueResource | GameResource | ResultResource | TransactionResource;

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
  const domainUserId = user.appUserId ?? user.id;

  switch (action) {
    case "league:read":
    case "season:read":
    case "game:read":
      // All authenticated users can read league/season/game data.
      return true;

    case "league:write":
    case "season:create":
    case "game:manage":
    case "schedule:generate":
    case "seat:manage":
    case "invite:manage":
    case "rulebook:write": {
      if (resource.kind !== "league") return false;
      return resource.ownerId === domainUserId ||
        (resource.commissionerIds?.includes(domainUserId) ?? false);
    }

    case "result:report": {
      if (resource.kind !== "game") return false;
      return (
        resource.homeGmUserId === domainUserId ||
        resource.awayGmUserId === domainUserId
      );
    }

    case "transaction:act": {
      if (resource.kind !== "transaction") return false;
      const isCommissioner = resource.ownerId === domainUserId ||
        (resource.commissionerIds?.includes(domainUserId) ?? false);
      return isCommissioner || (resource.gmUserIds?.includes(domainUserId) ?? false);
    }

    case "transaction:approve": {
      if (resource.kind !== "transaction") return false;
      return resource.ownerId === domainUserId ||
        (resource.commissionerIds?.includes(domainUserId) ?? false);
    }

    case "result:confirm":
    case "result:dispute": {
      if (resource.kind !== "result") return false;
      const isGameGm =
        resource.gameHomeGmUserId === domainUserId ||
        resource.gameAwayGmUserId === domainUserId;
      // Must be a GM in the game AND must not be the reporter (no self-confirmation).
      return isGameGm && resource.reportedByUserId !== domainUserId;
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
