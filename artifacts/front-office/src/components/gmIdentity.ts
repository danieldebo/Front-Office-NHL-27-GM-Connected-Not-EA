/**
 * Canonical GM identity fields are present on game sides. Keep this tolerant
 * while older responses are still in caches or a surface has not regenerated
 * its client type yet.
 */
export type GmIdentityFields = {
  gm_display_name?: string | null;
  gm_primary_identity?: string | null;
  gm_platform?: string | null;
  gm_gamertag?: string | null;
  gm_identity_verified?: boolean | null;
};

export function gmPlatformLabel(side: GmIdentityFields): string | null {
  const platform = side.gm_primary_identity ?? side.gm_platform;
  if (!platform) return null;
  if (platform === 'playstation' || platform === 'psn') return 'PSN';
  if (platform === 'xbox') return 'Xbox';
  return platform;
}

export function gmIdentityLabel(side: GmIdentityFields): string | null {
  const platform = gmPlatformLabel(side);
  if (!platform && !side.gm_gamertag) return null;
  return [platform, side.gm_gamertag, side.gm_identity_verified ? 'Verified' : 'Self-reported']
    .filter(Boolean).join(' · ');
}