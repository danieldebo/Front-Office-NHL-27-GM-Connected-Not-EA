import { describe, it, expect } from "vitest";
import { generateInviteToken } from "../inviteWords";

describe("generateInviteToken", () => {
  it("returns a hockey-word-gamer-word-suffix token, not a UUID", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
    // A UUID would have four hyphens and 32 hex chars; this has two hyphens
    // and two short lowercase words plus a 4-char suffix.
    expect(token).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("is unlikely to collide across many calls", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateInviteToken()));
    expect(tokens.size).toBe(500);
  });
});
