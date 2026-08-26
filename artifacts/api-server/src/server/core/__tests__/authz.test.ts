/**
 * Unit tests — server/authz.ts
 *
 * Covers every action/resource combination including:
 *   - GM cannot report another team's game
 *   - GM cannot self-confirm a result
 *   - Commissioner can manage league operations
 *   - Cross-league isolation (owner of league A cannot touch league B)
 */
import { describe, it, expect } from "vitest";
import { can, type Action } from "../../authz.js";
import type { AuthUser } from "../../auth/index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function user(id: string): AuthUser {
  return {
    id,
    email: null,
    firstName: null,
    lastName: null,
    profileImageUrl: null,
  };
}

const COMMISSIONER = user("commissioner-1");
const GM_A = user("gm-a");
const GM_B = user("gm-b");
const OUTSIDER = user("outsider");

const LEAGUE_OWNED_BY_COMMISSIONER = {
  kind: "league" as const,
  ownerId: COMMISSIONER.id,
  memberIds: [GM_A.id, GM_B.id],
};

const LEAGUE_OWNED_BY_OTHER = {
  kind: "league" as const,
  ownerId: "other-commissioner",
};

const GAME_A_VS_B = {
  kind: "game" as const,
  homeGmUserId: GM_A.id,
  awayGmUserId: GM_B.id,
};

const GAME_NO_GMS = {
  kind: "game" as const,
  homeGmUserId: null,
  awayGmUserId: null,
};

// ── Unauthenticated ───────────────────────────────────────────────────────────

describe("can() — unauthenticated", () => {
  const readActions: Action[] = ["league:read", "season:read", "game:read"];
  for (const action of readActions) {
    it(`denies ${action} for null user`, () => {
      expect(can(null, action, LEAGUE_OWNED_BY_COMMISSIONER)).toBe(false);
    });
    it(`denies ${action} for undefined user`, () => {
      expect(can(undefined, action, LEAGUE_OWNED_BY_COMMISSIONER)).toBe(false);
    });
  }
});

// ── Read actions (all authenticated users) ────────────────────────────────────

describe("can() — read actions allow all authenticated users", () => {
  const readActions: Action[] = ["league:read", "season:read", "game:read"];

  for (const action of readActions) {
    it(`allows ${action} for commissioner`, () => {
      expect(can(COMMISSIONER, action, LEAGUE_OWNED_BY_COMMISSIONER)).toBe(true);
    });
    it(`allows ${action} for member GM`, () => {
      expect(can(GM_A, action, LEAGUE_OWNED_BY_COMMISSIONER)).toBe(true);
    });
    it(`allows ${action} for outsider`, () => {
      expect(can(OUTSIDER, action, LEAGUE_OWNED_BY_COMMISSIONER)).toBe(true);
    });
  }
});

// ── Commissioner-only write actions ──────────────────────────────────────────

const commissionerActions: Action[] = [
  "league:write",
  "season:create",
  "game:manage",
  "schedule:generate",
  "seat:manage",
  "invite:manage",
  "rulebook:write",
];

describe("can() — commissioner-only actions", () => {
  it("uses the domain user id when Clerk and app_user ids differ", () => {
    const clerkUser = {
      ...COMMISSIONER,
      id: "user_clerk_123",
      appUserId: COMMISSIONER.id,
    };

    expect(can(clerkUser, "season:create", LEAGUE_OWNED_BY_COMMISSIONER)).toBe(true);
  });

  for (const action of commissionerActions) {
    it(`allows ${action} for the league owner`, () => {
      expect(can(COMMISSIONER, action, LEAGUE_OWNED_BY_COMMISSIONER)).toBe(true);
    });

    it(`denies ${action} for a GM member (cross-league isolation: member ≠ owner)`, () => {
      expect(can(GM_A, action, LEAGUE_OWNED_BY_COMMISSIONER)).toBe(false);
    });

    it(`denies ${action} for an outsider`, () => {
      expect(can(OUTSIDER, action, LEAGUE_OWNED_BY_COMMISSIONER)).toBe(false);
    });

    it(`denies ${action} when the user owns a different league (cross-league isolation)`, () => {
      // COMMISSIONER owns LEAGUE_OWNED_BY_COMMISSIONER, but NOT LEAGUE_OWNED_BY_OTHER
      expect(can(COMMISSIONER, action, LEAGUE_OWNED_BY_OTHER)).toBe(false);
    });

    it(`denies ${action} when resource kind is not 'league'`, () => {
      expect(can(COMMISSIONER, action, GAME_A_VS_B)).toBe(false);
    });
  }
});

// ── result:report ─────────────────────────────────────────────────────────────

describe("can() — result:report", () => {
  it("allows GM_A (home GM) to report the game", () => {
    expect(can(GM_A, "result:report", GAME_A_VS_B)).toBe(true);
  });

  it("allows GM_B (away GM) to report the game", () => {
    expect(can(GM_B, "result:report", GAME_A_VS_B)).toBe(true);
  });

  it("denies an outsider from reporting the game (403 scenario)", () => {
    expect(can(OUTSIDER, "result:report", GAME_A_VS_B)).toBe(false);
  });

  it("denies the commissioner (not a GM in this game) from reporting", () => {
    expect(can(COMMISSIONER, "result:report", GAME_A_VS_B)).toBe(false);
  });

  it("denies when game has no assigned GMs", () => {
    expect(can(GM_A, "result:report", GAME_NO_GMS)).toBe(false);
  });

  it("denies when resource kind is not 'game'", () => {
    expect(can(GM_A, "result:report", LEAGUE_OWNED_BY_COMMISSIONER)).toBe(false);
  });
});

// ── result:confirm / result:dispute ───────────────────────────────────────────

describe("can() — result:confirm (self-confirmation blocked)", () => {
  // GM_A reported the result
  const resultReportedByA = {
    kind: "result" as const,
    reportedByUserId: GM_A.id,
    gameHomeGmUserId: GM_A.id,
    gameAwayGmUserId: GM_B.id,
  };

  it("allows GM_B to confirm a result reported by GM_A", () => {
    expect(can(GM_B, "result:confirm", resultReportedByA)).toBe(true);
  });

  it("denies GM_A from self-confirming their own report (403 scenario)", () => {
    expect(can(GM_A, "result:confirm", resultReportedByA)).toBe(false);
  });

  it("denies an outsider from confirming (not a game GM)", () => {
    expect(can(OUTSIDER, "result:confirm", resultReportedByA)).toBe(false);
  });

  it("denies the commissioner (not a game GM) from confirming", () => {
    expect(can(COMMISSIONER, "result:confirm", resultReportedByA)).toBe(false);
  });

  it("denies self-confirmation for result:dispute as well", () => {
    expect(can(GM_A, "result:dispute", resultReportedByA)).toBe(false);
  });

  it("allows GM_B to dispute a result reported by GM_A", () => {
    expect(can(GM_B, "result:dispute", resultReportedByA)).toBe(true);
  });

  it("denies when resource kind is not 'result'", () => {
    expect(can(GM_B, "result:confirm", GAME_A_VS_B)).toBe(false);
  });
});

// ── commissioner game:manage (force-resolve) ──────────────────────────────────

describe("can() — commissioner can force-resolve via game:manage", () => {
  it("commissioner can manage games in their own league", () => {
    expect(can(COMMISSIONER, "game:manage", LEAGUE_OWNED_BY_COMMISSIONER)).toBe(true);
  });

  it("commissioner cannot manage games in another league (cross-league isolation)", () => {
    expect(can(COMMISSIONER, "game:manage", LEAGUE_OWNED_BY_OTHER)).toBe(false);
  });
});
