import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useGetXboxLink, useUnlinkXbox } from '@workspace/api-client-react';
import Header from '@/components/Header';
import { Form } from '@/components/ui/form';
import TeamPicker from '@/components/TeamPicker';
import { DEFAULT_PROFILE_ICON, PROFILE_ICON_OPTIONS } from '@/components/profileIcons';
import { confirmToast } from '@/hooks/use-toast';

const GM_CARD_DISPLAY_OPTIONS: { value: 'first_game' | 'favorite_team' | 'both'; label: string }[] = [
  { value: 'first_game', label: 'First NHL game' },
  { value: 'favorite_team', label: 'Favorite team' },
  { value: 'both', label: 'Both' },
];

const SYSTEMS = [
  { value: 'xbox', label: 'Xbox' },
  { value: 'playstation', label: 'PlayStation' },
] as const;

const profileSchema = z.object({
  display_name: z.string().trim().min(1, 'Display name is required').max(100),
  timezone: z.string().trim().min(1, 'Time zone is required').refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, 'Enter a valid IANA time zone, such as America/New_York'),
  xbox_gamertag: z.string().trim().max(100),
  psn_online_id: z.string().trim().max(100),
  systems_played: z.array(z.enum(['xbox', 'playstation'])),
  primary_identity: z.enum(['xbox', 'playstation']).or(z.literal('')),
  first_nhl_game: z.string().trim().max(60, 'Keep it to 60 characters or fewer'),
  profile_image_url: z.string().trim().max(500).refine(
    (value) => !value || /^https?:\/\/\S+$/i.test(value),
    'Enter a full http(s) image URL',
  ),
  favorite_club_id: z.string().nullable(),
  gm_card_display: z.enum(['first_game', 'favorite_team', 'both']),
}).superRefine((values, context) => {
  if (values.primary_identity && !values.systems_played.includes(values.primary_identity)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['primary_identity'],
      message: 'Primary identity must be one of your selected systems',
    });
  }
  if (values.primary_identity === 'xbox' && !values.xbox_gamertag) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['xbox_gamertag'],
      message: 'Xbox Gamertag is required for an Xbox primary identity',
    });
  }
  if (values.primary_identity === 'playstation' && !values.psn_online_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['psn_online_id'],
      message: 'PSN Online ID is required for a PlayStation primary identity',
    });
  }
  if ((values.gm_card_display === 'favorite_team' || values.gm_card_display === 'both') && !values.favorite_club_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['favorite_club_id'],
      message: 'Pick a favorite team to show it on your GM card',
    });
  }
});

type ProfileValues = z.infer<typeof profileSchema>;
type ProfileData = Omit<Partial<ProfileValues>, 'primary_identity'> & {
  primary_identity?: 'xbox' | 'playstation' | null;
};
type ProfileResponse = ProfileData & { data?: ProfileData };

const EMPTY_PROFILE: ProfileValues = {
  display_name: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  xbox_gamertag: '',
  psn_online_id: '',
  systems_played: [],
  primary_identity: '',
  first_nhl_game: '',
  profile_image_url: '',
  favorite_club_id: null,
  gm_card_display: 'first_game',
};

function errorDetail(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'detail' in value && typeof value.detail === 'string') {
    return value.detail;
  }
  return fallback;
}

const XBOX_ERROR_MESSAGES: Record<string, string> = {
  missing_code: 'Microsoft did not return an authorization code. Please try again.',
  expired_or_invalid_state: 'That link expired. Please start the verification again.',
  token_exchange_failed: "Microsoft couldn't verify your sign-in. Please try again.",
  xbox_live_failed: "Xbox Live couldn't verify this account. Please try again.",
  no_xbox_account: "That Microsoft account doesn't have an Xbox Live profile.",
  region_unavailable: 'Xbox Live verification is not available in this account’s region.',
  adult_verification_required: 'This Microsoft account needs adult age verification on xbox.com before it can be linked.',
  child_account: 'Child Microsoft accounts cannot be linked here — an adult account is required.',
  no_gamertag: "Xbox Live didn't return a gamertag for this account.",
  xbox_account_already_linked: 'That Xbox account is already linked to a different Front Office profile.',
  xbox_not_configured: 'Xbox verification is not set up on this deployment yet — the site owner needs to configure it.',
};

function XboxVerificationPanel() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const queryClient = useQueryClient();
  const { data: link, isLoading } = useGetXboxLink();
  const unlinkXbox = useUnlinkXbox();
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const xbox = params.get('xbox');
    if (!xbox) return;
    if (xbox === 'linked') {
      setBanner({ kind: 'success', text: 'Xbox account verified.' });
      queryClient.invalidateQueries({ queryKey: ['/api/xbox/link'] as any });
      queryClient.invalidateQueries({ queryKey: ['/api/users/me'] as any });
    } else if (xbox === 'error') {
      const reason = params.get('reason') ?? '';
      setBanner({ kind: 'error', text: XBOX_ERROR_MESSAGES[reason] ?? 'Could not verify your Xbox account. Please try again.' });
    }
    params.delete('xbox');
    params.delete('reason');
    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState(null, '', next);
  }, [queryClient]);

  const handleUnlink = async () => {
    const ok = await confirmToast('Your saved gamertag stays, but it goes back to self-reported.', {
      title: 'Unlink your verified Xbox account?',
      confirmLabel: 'Unlink',
    });
    if (!ok) return;
    unlinkXbox.mutate(undefined, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/xbox/link'] as any }),
    });
  };

  return (
    <section className="panel profile-panel xbox-panel" aria-labelledby="xbox-heading">
      <div className="panel-head">
        <h2 id="xbox-heading">Xbox verification</h2>
        <span className="note">Real, not typed</span>
      </div>
      <div className="xbox-panel-body">
        {banner && (
          <div className={`xbox-banner xbox-banner-${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>
            {banner.text}
          </div>
        )}
        <p className="field-help" style={{ margin: '0 0 14px' }}>
          Sign in with the Microsoft account tied to your Xbox to prove you actually
          control that gamertag, instead of just typing one in above. There is no
          equivalent for PlayStation — Sony doesn't offer this to third-party apps.
        </p>
        {isLoading ? (
          <div className="profile-status">Checking status…</div>
        ) : link?.linked ? (
          <div className="xbox-linked-row">
            <span className="chip conf chip-pulse" data-testid="chip-xbox-verified">✓ Verified</span>
            <span className="xbox-gamertag" data-testid="text-verified-gamertag">{link.gamertag}</span>
            <button
              type="button"
              className="btn ghost"
              onClick={handleUnlink}
              disabled={unlinkXbox.isPending}
              data-testid="button-unlink-xbox"
            >
              {unlinkXbox.isPending ? 'Unlinking…' : 'Unlink'}
            </button>
          </div>
        ) : (
          <a className="btn btn-xbox" href={`${base}/api/xbox/link/start`} data-testid="link-verify-xbox">
            Verify with Xbox
          </a>
        )}
      </div>
    </section>
  );
}

export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: EMPTY_PROFILE,
  });
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`${base}/api/users/me`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as ProfileResponse;
        if (!response.ok) throw new Error(errorDetail(body, 'Unable to load your profile.'));
        const profile = body.data ?? body;
        const systems = Array.isArray(profile.systems_played)
          ? profile.systems_played.filter((system): system is 'xbox' | 'playstation' =>
              system === 'xbox' || system === 'playstation')
          : [];
        form.reset({
          display_name: profile.display_name ?? '',
          timezone: profile.timezone ?? EMPTY_PROFILE.timezone,
          xbox_gamertag: profile.xbox_gamertag ?? '',
          psn_online_id: profile.psn_online_id ?? '',
          systems_played: systems,
          primary_identity:
            profile.primary_identity === 'playstation' || profile.primary_identity === 'xbox'
              ? profile.primary_identity
              : '',
          first_nhl_game: profile.first_nhl_game ?? '',
          profile_image_url: profile.profile_image_url ?? '',
          favorite_club_id: profile.favorite_club_id ?? null,
          gm_card_display: profile.gm_card_display ?? 'first_game',
        });
        setLoadError('');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(error instanceof Error ? error.message : 'Unable to load your profile.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base, form]);

  const submit = form.handleSubmit(async (values) => {
    setSaveError('');
    setSaved(false);
    try {
      const response = await fetch(`${base}/api/users/me`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          xbox_gamertag: values.xbox_gamertag || null,
          psn_online_id: values.psn_online_id || null,
          primary_identity: values.primary_identity || null,
          first_nhl_game: values.first_nhl_game || null,
          profile_image_url: values.profile_image_url || null,
        }),
      });
      const body = await response.json().catch(() => ({})) as ProfileResponse;
      if (!response.ok) {
        setSaveError(errorDetail(body, 'Unable to save your profile.'));
        return;
      }
      const profile = body.data ?? body;
      form.reset({
        ...values,
        ...profile,
        xbox_gamertag: profile.xbox_gamertag ?? '',
        psn_online_id: profile.psn_online_id ?? '',
        systems_played: profile.systems_played ?? values.systems_played,
        primary_identity: profile.primary_identity ?? '',
        first_nhl_game: profile.first_nhl_game ?? '',
        profile_image_url: profile.profile_image_url ?? '',
        favorite_club_id: profile.favorite_club_id ?? null,
        gm_card_display: profile.gm_card_display ?? values.gm_card_display,
      });
      setSaved(true);
    } catch {
      setSaveError('Network error. Please try again.');
    }
  });

  const errors = form.formState.errors;
  const selectedSystems = form.watch('systems_played');
  const profileImageUrl = form.watch('profile_image_url');
  const previewUrl = (!errors.profile_image_url && profileImageUrl) || DEFAULT_PROFILE_ICON;

  return (
    <>
      <Header />
      <section className="slab">
        <div className="wrap profile-hero">
          <div>
            <div className="eyebrow">Account settings</div>
            <h1>Player profile</h1>
            <p className="sub">Your saved identity and time zone determine which league openings you can apply for.</p>
          </div>
        </div>
      </section>
      <main className="wrap profile-page">
        <section className="panel profile-panel" aria-labelledby="profile-heading">
          <div className="panel-head">
            <h2 id="profile-heading">Profile details</h2>
            <span className="note">Fields marked * are required</span>
          </div>
          {loading ? (
            <div className="profile-status" role="status" data-testid="status-profile-loading">Loading profile…</div>
          ) : loadError ? (
            <div className="profile-status profile-error" role="alert" data-testid="status-profile-error">
              {loadError}
              <button type="button" className="btn ghost" onClick={() => window.location.reload()} data-testid="button-retry-profile">
                Retry
              </button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={submit} className="profile-form" noValidate>
                <div className="field">
                  <label htmlFor="profile-display-name">Display name *</label>
                  <input
                    id="profile-display-name"
                    autoComplete="nickname"
                    aria-invalid={!!errors.display_name}
                    aria-describedby={errors.display_name ? 'profile-display-name-error' : undefined}
                    data-testid="input-display-name"
                    {...form.register('display_name')}
                  />
                  {errors.display_name && <span id="profile-display-name-error" className="field-error">{errors.display_name.message}</span>}
                </div>
                <div className="field">
                  <label htmlFor="profile-timezone">IANA time zone *</label>
                  <input
                    id="profile-timezone"
                    list="profile-timezones"
                    placeholder="America/New_York"
                    autoComplete="off"
                    aria-invalid={!!errors.timezone}
                    aria-describedby="profile-timezone-help profile-timezone-error"
                    data-testid="input-timezone"
                    {...form.register('timezone')}
                  />
                  <datalist id="profile-timezones">
                    {['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'Europe/London', 'Europe/Stockholm', 'Australia/Sydney'].map((zone) => <option key={zone} value={zone} />)}
                  </datalist>
                  <span id="profile-timezone-help" className="field-help">Use a region-based IANA name, not an abbreviation.</span>
                  {errors.timezone && <span id="profile-timezone-error" className="field-error">{errors.timezone.message}</span>}
                </div>
                <fieldset className="field full profile-systems">
                  <legend>Systems played</legend>
                  <div className="profile-checks">
                    {SYSTEMS.map((system) => (
                      <label key={system.value}>
                        <input
                          type="checkbox"
                          value={system.value}
                          checked={selectedSystems.includes(system.value)}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...selectedSystems, system.value]
                              : selectedSystems.filter((value) => value !== system.value);
                            form.setValue('systems_played', next, { shouldDirty: true, shouldValidate: true });
                          }}
                          data-testid={`checkbox-system-${system.value}`}
                        />
                        {system.label}
                      </label>
                    ))}
                  </div>
                  {errors.systems_played && <span className="field-error">{errors.systems_played.message}</span>}
                </fieldset>
                <div className="field">
                  <label htmlFor="profile-xbox">Xbox Gamertag</label>
                  <input id="profile-xbox" autoComplete="off" aria-invalid={!!errors.xbox_gamertag} data-testid="input-xbox-gamertag" {...form.register('xbox_gamertag')} />
                  {errors.xbox_gamertag && <span className="field-error">{errors.xbox_gamertag.message}</span>}
                </div>
                <div className="field">
                  <label htmlFor="profile-psn">PSN Online ID</label>
                  <input id="profile-psn" autoComplete="off" aria-invalid={!!errors.psn_online_id} data-testid="input-psn-online-id" {...form.register('psn_online_id')} />
                  {errors.psn_online_id && <span className="field-error">{errors.psn_online_id.message}</span>}
                </div>
                <div className="field full">
                  <label htmlFor="profile-primary">Primary identity</label>
                  <select id="profile-primary" aria-invalid={!!errors.primary_identity} data-testid="select-primary-identity" {...form.register('primary_identity')}>
                    <option value="">None selected</option>
                    <option value="xbox" disabled={!selectedSystems.includes('xbox')}>Xbox</option>
                    <option value="playstation" disabled={!selectedSystems.includes('playstation')}>PlayStation</option>
                  </select>
                  <span className="field-help">This is the identity opponents see with your display name.</span>
                  {errors.primary_identity && <span className="field-error">{errors.primary_identity.message}</span>}
                </div>
                <div className="field">
                  <label htmlFor="profile-first-game">First NHL game you ever played/owned</label>
                  <input
                    id="profile-first-game"
                    autoComplete="off"
                    placeholder="NHL 94"
                    aria-invalid={!!errors.first_nhl_game}
                    data-testid="input-first-nhl-game"
                    {...form.register('first_nhl_game')}
                  />
                  {errors.first_nhl_game && <span className="field-error">{errors.first_nhl_game.message}</span>}
                </div>
                <div className="field full">
                  <label htmlFor="profile-image-url">Profile image</label>
                  <div className="profile-avatar-row">
                    <span className="profile-avatar-preview" aria-hidden="true">
                      <img
                        src={previewUrl}
                        alt=""
                        onError={(e) => { if (e.currentTarget.src !== DEFAULT_PROFILE_ICON) e.currentTarget.src = DEFAULT_PROFILE_ICON; }}
                      />
                    </span>
                    <input
                      id="profile-image-url"
                      type="url"
                      autoComplete="off"
                      placeholder="https://example.com/your-avatar.png"
                      aria-invalid={!!errors.profile_image_url}
                      data-testid="input-profile-image-url"
                      {...form.register('profile_image_url')}
                    />
                  </div>
                  <div className="profile-icon-grid" role="group" aria-label="Choose a default icon" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                    {PROFILE_ICON_OPTIONS.map((icon) => {
                      const selected = profileImageUrl === icon;
                      return (
                        <button
                          key={icon}
                          type="button"
                          onClick={() => form.setValue('profile_image_url', icon, { shouldDirty: true, shouldValidate: true })}
                          aria-pressed={selected}
                          aria-label="Use this icon"
                          data-testid={`button-profile-icon-${icon.split('/').pop()}`}
                          style={{
                            width: '44px',
                            height: '44px',
                            padding: '4px',
                            borderRadius: '50%',
                            border: selected ? '2px solid var(--crease)' : '1px solid var(--rule)',
                            background: '#fff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <img src={icon} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        </button>
                      );
                    })}
                  </div>
                  <span className="field-help">Pick one of these, or paste your own public image URL above. Defaults to the first icon if you don't set one.</span>
                  {errors.profile_image_url && <span className="field-error">{errors.profile_image_url.message}</span>}
                </div>
                <div className="field">
                  <label htmlFor="profile-favorite-club">Favorite team</label>
                  <TeamPicker
                    id="profile-favorite-club"
                    aria-label="Favorite team"
                    allowNone
                    value={form.watch('favorite_club_id')}
                    onChange={(clubId) => form.setValue('favorite_club_id', clubId, { shouldDirty: true, shouldValidate: true })}
                  />
                  {errors.favorite_club_id && <span className="field-error">{errors.favorite_club_id.message}</span>}
                </div>
                <div className="field">
                  <label htmlFor="profile-card-display">Show on GM seat card</label>
                  <select
                    id="profile-card-display"
                    aria-invalid={!!errors.gm_card_display}
                    data-testid="select-gm-card-display"
                    {...form.register('gm_card_display')}
                  >
                    {GM_CARD_DISPLAY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                  <span className="field-help">Which of these shows on your franchise seat card — pick Favorite team or Both once you've set one above.</span>
                  {errors.gm_card_display && <span className="field-error">{errors.gm_card_display.message}</span>}
                </div>
                <div className="profile-actions">
                  <div aria-live="polite">
                    {saved && <span className="profile-success" data-testid="status-profile-saved">Profile saved.</span>}
                    {saveError && <span className="field-error" role="alert" data-testid="status-profile-save-error">{saveError}</span>}
                  </div>
                  <button className="btn" type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty} data-testid="button-save-profile">
                    {form.formState.isSubmitting ? 'Saving…' : 'Save profile'}
                  </button>
                </div>
              </form>
            </Form>
          )}
        </section>
        <XboxVerificationPanel />
      </main>
    </>
  );
}