/**
 * SignupDrawer — inline sign-up form rendered below the league card grid.
 * Handles both "Sign up" (POST /api/leagues/:id/signup) and
 * "Join waitlist" (POST /api/leagues/:id/waitlist) flows.
 */
import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { ApplicantSeatOption } from '@workspace/api-client-react';

interface League {
  league_id: string;
  name: string;
  seats_open: number;
  platform: string | null;
  open_seat_options?: ApplicantSeatOption[];
}

export interface SignupFormValues {
  countryCode: string;
  location: string;
  division: string;
  message: string;
  teamSeasonIds: string[];
}

interface Props {
  league: League;
  mode: 'signup' | 'waitlist';
  onClose: () => void;
  initialValues?: Partial<SignupFormValues>;
}

const DIVISIONS = ['Bronze', 'Silver', 'Gold', 'Diamond', 'Platinum', 'Elite', 'Ultimate'];

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
  const [countryCode, setCountryCode] = useState(initialValues?.countryCode ?? '');
  const [location, setLocation] = useState(initialValues?.location ?? '');
  const [division, setDivision] = useState(initialValues?.division ?? '');
  const [message, setMessage] = useState(initialValues?.message ?? '');
  const [teamSeasonIds, setTeamSeasonIds] = useState(initialValues?.teamSeasonIds ?? []);
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [profileError, setProfileError] = useState(false);
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
    if ((league.open_seat_options?.length ?? 0) > 0 && teamSeasonIds.length === 0) {
      setErrorMsg('Choose at least one franchise seat');
      return;
    }
    setState('submitting');
    setErrorMsg('');
    setProfileError(false);

    try {
      const url =
        mode === 'signup'
          ? `${base}/api/leagues/${leagueId}/signup`
          : `${base}/api/leagues/${leagueId}/waitlist`;

      const body =
        mode === 'signup'
          ? {
              country_code: countryCode !== 'OTHER' ? countryCode : undefined,
              location: location || undefined,
              stated_division: division ? division.toLowerCase() : undefined,
              message: message || undefined,
              team_season_ids: teamSeasonIds,
            }
          : { team_season_ids: teamSeasonIds };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (res.status === 401) {
        // Session expired mid-form — save state and redirect to login
        const draft: SignupFormValues = { countryCode, location, division, message, teamSeasonIds };
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
          leagueId,
          mode,
          league,
          formState: draft,
          savedAt: Date.now(),
        }));
        sessionStorage.setItem('fo_return_path', '/leagues/open');
        navigate('/sign-in?redirect_url=/leagues/open');
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const responseError = data as { detail?: string; code?: string; error?: string };
        const detail = responseError.detail ?? responseError.error ?? 'Something went wrong. Please try again.';
        const eligibilityText = `${responseError.code ?? ''} ${detail}`.toLowerCase();
        setProfileError(/profile|identity|timezone|time zone|platform|system|eligib/.test(eligibilityText));
        setErrorMsg(detail);
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
              <div className="profile-eligibility full">
                <strong>Eligibility uses your saved profile</strong>
                <span>Your systems, primary gaming identity, and time zone are checked automatically. </span>
                <Link href="/profile" data-testid="link-edit-profile-signup">Review profile</Link>
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
                <div className="div-picker" role="radiogroup" aria-label="Your ranked division">
                  {DIVISIONS.map(d => (
                    <label
                      key={d}
                      className={`div-opt${division === d ? ' sel' : ''}`}
                    >
                      <input
                        type="radio"
                        name="ranked-division"
                        value={d}
                        checked={division === d}
                        onChange={() => setDivision(d)}
                      />
                      {d}
                    </label>
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
                  placeholder="Been running franchise mode for years and looking for a competitive league…"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  maxLength={500}
                />
              </div>
            </div>
          )}

          {mode === 'waitlist' && (
            <div style={{ padding: '16px 18px', color: '#33414c', fontSize: 14 }}>
              <p style={{ margin: '0 0 12px' }}>
                You're joining the waitlist for <strong>{league.name}</strong>. You'll be invited when a seat opens.
              </p>
              <p className="profile-eligibility">
                Your saved systems, primary gaming identity, and time zone determine eligibility.{' '}
                <Link href="/profile" data-testid="link-edit-profile-waitlist">Review profile</Link>
              </p>
            </div>
          )}

          <fieldset style={{ margin: '0 18px 18px', padding: '14px', border: '1px solid var(--rule)', borderRadius: 4 }}>
            <legend style={{ padding: '0 6px', fontFamily: 'var(--data)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Franchise seats you want
            </legend>
            {(league.open_seat_options?.length ?? 0) === 0 ? (
              <p style={{ margin: 0, color: 'var(--steel)', fontSize: 13 }}>
                No specific franchise seat is open right now. You can still join for a future opening.
              </p>
            ) : (
              <>
                <p style={{ margin: '0 0 10px', color: 'var(--steel)', fontSize: 13 }}>
                  Choose every open seat you would be willing to take.
                </p>
                <div style={{ display: 'grid', gap: 8 }}>
                  {league.open_seat_options?.map((seat) => {
                    const checked = teamSeasonIds.includes(seat.team_season_id);
                    const label = seat.club_name
                      ? `${seat.franchise_name} · ${seat.club_name}`
                      : seat.franchise_name;
                    return (
                      <label
                        key={seat.team_season_id}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13 }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setTeamSeasonIds(current => checked
                            ? current.filter(id => id !== seat.team_season_id)
                            : [...current, seat.team_season_id])}
                        />
                        <span>{label}</span>
                        {seat.club_abbrev && <span style={{ color: 'var(--steel)', marginLeft: 'auto' }}>{seat.club_abbrev}</span>}
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </fieldset>

          <div className="signup-foot">
            {mode === 'signup' && league.seats_open > 0 && (
              <span style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>
                {league.seats_open} seat{league.seats_open !== 1 ? 's' : ''} open — this may place you directly.
              </span>
            )}
            {errorMsg && (
              <span role="alert" style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--goal)' }}>
                {errorMsg}
                {profileError && <> <Link href="/profile" data-testid="link-fix-profile-error">Update your profile</Link>.</>}
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
