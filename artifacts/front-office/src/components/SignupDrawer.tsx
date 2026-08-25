/**
 * SignupDrawer — inline sign-up form rendered below the league card grid.
 * Handles both "Sign up" (POST /api/leagues/:id/signup) and
 * "Join waitlist" (POST /api/leagues/:id/waitlist) flows.
 */
import React, { useState } from 'react';
import { useLocation } from 'wouter';

interface League {
  league_id: string;
  name: string;
  seats_open: number;
  platform: string | null;
}

export interface SignupFormValues {
  platform: string;
  timezone: string;
  countryCode: string;
  location: string;
  division: string;
  message: string;
  preferredClub: string;
}

interface Props {
  league: League;
  mode: 'signup' | 'waitlist';
  onClose: () => void;
  initialValues?: Partial<SignupFormValues>;
}

const DIVISIONS = ['Bronze', 'Silver', 'Gold', 'Diamond', 'Platinum', 'Elite', 'Ultimate'];

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Toronto',
  'America/Vancouver',
  'America/Halifax',
  'America/Winnipeg',
  'Europe/London',
  'Europe/Stockholm',
  'Europe/Helsinki',
  'Australia/Sydney',
  'Pacific/Auckland',
];

const COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'SE', name: 'Sweden' },
  { code: 'FI', name: 'Finland' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'RU', name: 'Russia' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'NO', name: 'Norway' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'OTHER', name: 'Other' },
];

type State = 'idle' | 'submitting' | 'success' | 'error';

const DRAFT_KEY = 'fo_signup_draft';

export default function SignupDrawer({ league, mode, onClose, initialValues }: Props) {
  const [platform, setPlatform] = useState(initialValues?.platform ?? league.platform ?? '');
  const [timezone, setTimezone] = useState(initialValues?.timezone ?? '');
  const [countryCode, setCountryCode] = useState(initialValues?.countryCode ?? '');
  const [location, setLocation] = useState(initialValues?.location ?? '');
  const [division, setDivision] = useState(initialValues?.division ?? '');
  const [message, setMessage] = useState(initialValues?.message ?? '');
  const [preferredClub, setPreferredClub] = useState(initialValues?.preferredClub ?? '');
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const [, navigate] = useLocation();

  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const leagueId = league.league_id;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Country is only required for the sign-up form, not the waitlist path.
    if (mode === 'signup' && !countryCode) {
      setErrorMsg('Country is required');
      return;
    }
    setState('submitting');
    setErrorMsg('');

    try {
      const url =
        mode === 'signup'
          ? `${base}/api/leagues/${leagueId}/signup`
          : `${base}/api/leagues/${leagueId}/waitlist`;

      const body =
        mode === 'signup'
          ? {
              platform: platform || undefined,
              timezone: timezone || undefined,
              country_code: countryCode !== 'OTHER' ? countryCode : undefined,
              location: location || undefined,
              stated_division: division ? division.toLowerCase() : undefined,
              message: message || undefined,
              preferred_club: preferredClub || undefined,
            }
          : {};

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (res.status === 401) {
        // Session expired mid-form — save state and redirect to login
        const draft: SignupFormValues = { platform, timezone, countryCode, location, division, message, preferredClub };
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
          leagueId,
          mode,
          league,
          formState: draft,
        }));
        sessionStorage.setItem('fo_return_path', '/leagues/open');
        navigate('/sign-in?redirect_url=/leagues/open');
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg((data as { detail?: string }).detail ?? 'Something went wrong. Please try again.');
        setState('error');
        return;
      }

      const data = await res.json() as { position?: number };
      if (data.position !== undefined) {
        setWaitlistPosition(data.position);
      }
      setState('success');
    } catch {
      setErrorMsg('Network error. Please try again.');
      setState('error');
    }
  };

  const title = mode === 'signup'
    ? `Sign up — ${league.name}`
    : `Join waitlist — ${league.name}`;

  return (
    <div className="signup" style={{ marginBottom: '36px' }}>
      <div className="signup-head">{title}</div>

      {state === 'success' ? (
        <div style={{ padding: '32px 18px', textAlign: 'center' }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#F1F8F4', color: 'var(--pos)', border: '1px solid #B7D9C6', display: 'grid', placeItems: 'center', fontSize: 22, margin: '0 auto 12px' }}>
            ✓
          </div>
          {mode === 'signup' ? (
            <>
              <div style={{ fontFamily: 'var(--display)', fontSize: 20, letterSpacing: '.03em', textTransform: 'uppercase', margin: '0 0 6px' }}>
                Application submitted!
              </div>
              <p style={{ color: 'var(--steel)', fontSize: 13.5, margin: '0 0 18px' }}>
                The commissioner will review your application and be in touch.
              </p>
            </>
          ) : (
            <>
              <div style={{ fontFamily: 'var(--display)', fontSize: 20, letterSpacing: '.03em', textTransform: 'uppercase', margin: '0 0 6px' }}>
                You're on the list!
              </div>
              <p style={{ color: 'var(--steel)', fontSize: 13.5, margin: '0 0 18px' }}>
                {waitlistPosition !== null
                  ? `You're #${waitlistPosition} on the waitlist. You'll be invited when a seat opens.`
                  : `You'll be invited when a seat opens.`}
              </p>
            </>
          )}
          <button className="btn" onClick={onClose} style={{ margin: '0 auto', display: 'block' }}>
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="signup-body">
              <div className="field">
                <label htmlFor="su-platform">Platform</label>
                <select id="su-platform" value={platform} onChange={e => setPlatform(e.target.value)}>
                  <option value="">Any</option>
                  <option value="psn">PSN</option>
                  <option value="xbox">Xbox</option>
                  <option value="both">Crossplay</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="su-tz">Time zone</label>
                <select id="su-tz" value={timezone} onChange={e => setTimezone(e.target.value)}>
                  <option value="">Select…</option>
                  {COMMON_TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="su-country">Country <span style={{ textTransform: 'none', letterSpacing: 0, opacity: .8, fontFamily: 'var(--body)' }}>*</span></label>
                <select id="su-country" value={countryCode} onChange={e => setCountryCode(e.target.value)} required>
                  <option value="">Select…</option>
                  {COUNTRIES.map(c => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="su-location">Location <span style={{ textTransform: 'none', letterSpacing: 0, opacity: .8 }}>(your region)</span></label>
                <input
                  id="su-location"
                  type="text"
                  placeholder="Chicago, IL"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div className="field full">
                <label>Your ranked division — you pick this</label>
                <div className="div-picker">
                  {DIVISIONS.map(d => (
                    <span
                      key={d}
                      className={`div-opt${division === d ? ' sel' : ''}`}
                      onClick={() => setDivision(d === division ? '' : d)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setDivision(d === division ? '' : d); }}
                    >
                      {d}
                    </span>
                  ))}
                </div>
                <span className="selfnote">
                  Self-reported — a bracket you choose, editable any time. It helps the commissioner gauge fit; it never auto-rejects you.
                </span>
              </div>
              <div className="field full">
                <label htmlFor="su-message">Message to the commissioner (optional)</label>
                <input
                  id="su-message"
                  type="text"
                  placeholder="Been running franchise mode since NHL 18, looking for a competitive PSN league…"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  maxLength={500}
                />
              </div>
              <div className="field">
                <label htmlFor="su-club">Preferred club (optional)</label>
                <input
                  id="su-club"
                  type="text"
                  placeholder="Any"
                  value={preferredClub}
                  onChange={e => setPreferredClub(e.target.value)}
                  maxLength={100}
                />
              </div>
            </div>
          )}

          {mode === 'waitlist' && (
            <div style={{ padding: '16px 18px', color: '#33414c', fontSize: 14 }}>
              <p style={{ margin: '0 0 12px' }}>
                You're joining the waitlist for <strong>{league.name}</strong>. You'll be invited when a seat opens.
              </p>
            </div>
          )}

          <div className="signup-foot">
            {mode === 'signup' && league.seats_open > 0 && (
              <span style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>
                {league.seats_open} seat{league.seats_open !== 1 ? 's' : ''} open — this may place you directly.
              </span>
            )}
            {errorMsg && (
              <span style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--goal)' }}>
                {errorMsg}
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn"
                style={{ background: 'transparent', color: 'var(--slab)', border: '1px solid var(--rule)' }}
                onClick={onClose}
                disabled={state === 'submitting'}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="submit"
                style={{ fontFamily: 'var(--data)', fontSize: '11px', letterSpacing: '.07em', textTransform: 'uppercase', border: '1px solid var(--slab)', background: 'var(--slab)', color: '#fff', padding: '9px 18px', borderRadius: 2, cursor: 'pointer' }}
                disabled={state === 'submitting'}
              >
                {state === 'submitting'
                  ? 'Submitting…'
                  : mode === 'signup' ? 'Submit sign-up' : 'Join waitlist'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
