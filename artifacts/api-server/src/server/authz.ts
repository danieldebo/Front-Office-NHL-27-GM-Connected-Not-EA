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
  | "season:write"           // commissioner edits a season's editable fields (e.g. starts_on)
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
  | "transaction:approve"    // commissioner-only: approve/reject a trade, resolve a waiver
  | "keeper:write"           // GM designating/releasing a keeper on their own team, or commissioner on any team (override)
  | "boxscore:review"        // commissioner-only: approve/reject an uploaded box score, toggle auto-approve
  | "calendar:manage"        // commissioner-only: mint/revoke the league-wide calendar feed token
  | "partners:write"         // commissioner-only: edit charity/sponsor profile fields
  | "digest:manage";         // commissioner-only: edit the weekly email digest settings

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
    case "season:write":
    case "game:manage":
    case "schedule:generate":
    case "seat:manage":
    case "invite:manage":
    case "rulebook:write":
    case "boxscore:review":
    case "calendar:manage":
    case "partners:write":
    case "digest:manage": {
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

    case "transaction:act":
    case "keeper:write": {
      // Same rule for both: "GM writes only their own team; commissioner
      // writes league-scoped" (keeper-addendum.md §2) — identical to a GM
      // acting on their own side of a transaction.
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
