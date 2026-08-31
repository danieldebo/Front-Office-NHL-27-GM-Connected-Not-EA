import { describe, expect, it } from "vitest";
import { canonicalGmIdentity } from "../playerIdentity";

describe("canonicalGmIdentity", () => {
  it("uses primary_identity rather than stale legacy platform", () => {
    expect(canonicalGmIdentity({
      gm_display_name: "GM",
      gm_primary_identity: "playstation",
      gm_psn_online_id: "NewPSN",
      gm_xbox_gamertag: "XboxAlso",
      gm_playstation_identity_verified_at: "2026-08-30T12:00:00Z",
      gm_legacy_platform: "xbox",
      gm_legacy_gamertag: "OldXbox",
    })).toMatchObject({
      gm_display_name: "GM",
      gm_platform: "playstation",
      gm_primary_identity: "playstation",
      gm_gamertag: "NewPSN",
      gm_xbox_gamertag: "XboxAlso",
      gm_identity_verified: true,
    });
  });

  it("uses classified legacy evidence only as a deterministic migration fallback", () => {
    expect(canonicalGmIdentity({
      gm_legacy_platform: "psn",
      gm_legacy_gamertag: "LegacyPSN",
    })).toMatchObject({
      gm_platform: "playstation",
      gm_primary_identity: null,
      gm_gamertag: "LegacyPSN",
    });
    expect(canonicalGmIdentity({
      gm_legacy_platform: "switch",
      gm_legacy_gamertag: "LegacySwitch",
    }).gm_platform).toBeNull();
  });
});