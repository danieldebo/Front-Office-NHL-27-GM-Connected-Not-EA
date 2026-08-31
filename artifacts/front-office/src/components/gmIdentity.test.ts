import { describe, expect, it } from 'vitest';
import { gmIdentityLabel, gmPlatformLabel } from './gmIdentity';

describe('canonical GM identity labels', () => {
  it('prefers the primary identity over the legacy platform', () => {
    const side = {
      gm_platform: 'xbox',
      gm_primary_identity: 'playstation',
      gm_gamertag: 'CoachPSN',
    };

    expect(gmPlatformLabel(side)).toBe('PSN');
    expect(gmIdentityLabel(side)).toBe('PSN · CoachPSN · Self-reported');
    expect(gmIdentityLabel({ ...side, gm_identity_verified: true }))
      .toBe('PSN · CoachPSN · Verified');
  });

  it('does not render an identity when canonical fields are absent', () => {
    expect(gmIdentityLabel({ gm_display_name: 'Coach' })).toBeNull();
  });
});