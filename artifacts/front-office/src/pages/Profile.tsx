import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import Header from '@/components/Header';
import { Form } from '@/components/ui/form';

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
};

function errorDetail(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'detail' in value && typeof value.detail === 'string') {
    return value.detail;
  }
  return fallback;
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
      });
      setSaved(true);
    } catch {
      setSaveError('Network error. Please try again.');
    }
  });

  const errors = form.formState.errors;
  const selectedSystems = form.watch('systems_played');

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
      </main>
    </>
  );
}