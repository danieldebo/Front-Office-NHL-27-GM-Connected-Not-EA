export type GmIdentitySource = {
  gm_display_name?: string | null;
  gm_primary_identity?: string | null;
  gm_xbox_gamertag?: string | null;
  gm_psn_online_id?: string | null;
  gm_xbox_identity_verified_at?: string | Date | null;
  gm_playstation_identity_verified_at?: string | Date | null;
  gm_legacy_platform?: string | null;
  gm_legacy_gamertag?: string | null;
};

export type CanonicalGmIdentity = {
  gm_display_name: string | null;
  gm_platform: "xbox" | "playstation" | null;
  gm_primary_identity: "xbox" | "playstation" | null;
  gm_gamertag: string | null;
  gm_xbox_gamertag: string | null;
  gm_psn_online_id: string | null;
  gm_identity_verified: boolean;
};

/**
 * `app_user.platform` is legacy evidence, never an API platform value. It is
 * considered only when a migrated row has no canonical primary identity.
 */
export function canonicalGmIdentity(source: GmIdentitySource): CanonicalGmIdentity {
  const primary = source.gm_primary_identity === "xbox" || source.gm_primary_identity === "playstation"
    ? source.gm_primary_identity
    : null;
  const legacyPlatform = ["psn", "ps", "playstation"].includes(
    (source.gm_legacy_platform ?? "").toLowerCase(),
  )
    ? "playstation"
    : (source.gm_legacy_platform ?? "").toLowerCase() === "xbox"
      ? "xbox"
      : null;
  const platform = primary ?? (source.gm_legacy_gamertag ? legacyPlatform : null);
  const gamertag = primary === "xbox"
    ? source.gm_xbox_gamertag ?? null
    : primary === "playstation"
      ? source.gm_psn_online_id ?? null
      : source.gm_legacy_gamertag ?? null;
  return {
    gm_display_name: source.gm_display_name ?? null,
    gm_platform: platform,
    gm_primary_identity: primary,
    gm_gamertag: gamertag,
    gm_xbox_gamertag: source.gm_xbox_gamertag ?? null,
    gm_psn_online_id: source.gm_psn_online_id ?? null,
    gm_identity_verified: primary === "xbox"
      ? Boolean(source.gm_xbox_identity_verified_at)
      : primary === "playstation"
        ? Boolean(source.gm_playstation_identity_verified_at)
        : false,
  };
}