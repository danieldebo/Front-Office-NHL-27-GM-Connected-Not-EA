import { describe, expect, it } from "vitest";
import { validateProfilePatch } from "../users";
import { savedIdentityForLeague } from "../discovery";

const profile = {
  id: "user-id",
  timezone: "America/New_York",
  xbox_gamertag: "XboxTag",
  psn_online_id: "PsnId",
  systems_played: ["xbox", "playstation"],
  primary_identity: "playstation",
};

describe("saved player profile validation", () => {
  it("validates IANA timezones and canonical identity fields", () => {
    expect(validateProfilePatch({
      display_name: "  Player One  ",
      timezone: "America/Chicago",
      systems_played: ["xbox", "xbox"],
      primary_identity: "xbox",
    })).toEqual({
      values: {
        display_name: "Player One",
        timezone: "America/Chicago",
        systems_played: ["xbox"],
        primary_identity: "xbox",
      },
    });
    expect(validateProfilePatch({ timezone: "not/a-timezone" }).error)
      .toMatch(/valid IANA timezone/);
    expect(validateProfilePatch({ platform: "xbox" }).error)
      .toMatch(/Unknown profile field/);
  });

  it("uses league platform and saved identity instead of request data", () => {
    expect(savedIdentityForLeague("xbox", profile)).toEqual({
      platform: "xbox",
      gamertag: "XboxTag",
    });
    expect(savedIdentityForLeague("playstation", profile)).toEqual({
      platform: "playstation",
      gamertag: "PsnId",
    });
    expect(savedIdentityForLeague("crossplay", profile)).toEqual({
      platform: "playstation",
      gamertag: "PsnId",
    });
  });

  it("rejects a matching gamertag when the saved system is absent", () => {
    expect(savedIdentityForLeague("xbox", {
      ...profile,
      systems_played: ["playstation"],
    })).toBeNull();
  });
});