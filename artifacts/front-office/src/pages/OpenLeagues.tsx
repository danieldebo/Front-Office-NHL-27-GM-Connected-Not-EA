/**
 * OpenLeagues — /leagues/open
 * Public page (no auth required) listing recruiting Connected Franchise leagues.
 * Unauthenticated users who click "Sign up" are redirected to Clerk sign-in with their
 * form intent saved in sessionStorage, then brought back here automatically.
 */
import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@clerk/react';
import Header from '@/components/Header';
import SignupDrawer, { SignupFormValues } from '@/components/SignupDrawer';
import { resolvePublicCode } from '@workspace/api-client-react';

interface OpenLeague {
  league_id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  blurb: string | null;
  platform: string | null;
  competitiveness: string | null;
  suggested_division: string | null;
  accepting_signups: boolean;
  accepting_waitlist: boolean;
  active_season_id: string | null;
  max_seats: number;
  seats_filled: number;
  seats_open: number;
  waitlist_length: number;
  games_confirmed: number | null;
  active_gms: number | null;
  partners?: {
    charities: Array<{ id: string; name: string; link: string; logo_url: string | null }>;
    sponsors: Array<{ id: string; name: string; link: string; logo_url: string | null }>;
  };
}

interface SignupDraft {
  leagueId: string;
  mode: 'signup' | 'waitlist';
  league: OpenLeague;
  formState: SignupFormValues;
  savedAt: number;
}

const DRAFT_KEY = 'fo_signup_draft';

const DRAFT_TTL_MS = 30 * 60 * 1000;
type Filter = 'all' | 'psn' | 'xbox' | 'both' | 'seats_open' | 'competitive';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'psn', label: 'PlayStation' },
  { key: 'xbox', label: 'Xbox' },
  { key: 'both', label: 'Crossplay' },
  { key: 'seats_open', label: 'Seats open' },
  { key: 'competitive', label: 'Competitive' },
];

function leagueInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

function leagueLogoStyle(name: string): React.CSSProperties {
  // Deterministic gradient based on name
  const h = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const hue = h % 360;
  const hue2 = (hue + 40) % 360;
  return { background: `linear-gradient(135deg, hsl(${hue},55%,35%), hsl(${hue2},60%,20%))` };
}

function divisionTagClass(division: string | null): string {
  if (!division) return '';
  const d = division.toLowerCase();
  if (d.includes('diamond') || d.includes('platinum')) return 'div-tag div-diamond';
  if (d.includes('elite') || d.includes('ultimate')) return 'div-tag div-elite';
  return 'div-tag div-gold';
}

// Normalise platform values from the API — accepts both pre-1.5.0 text ('psn','both')
// and post-1.5.0 enum values ('playstation','crossplay').
function normalisePlatform(p: string | null): 'playstation' | 'xbox' | 'crossplay' | null {
  if (!p) return null;
  const l = p.toLowerCase();
  if (l === 'psn' || l === 'playstation') return 'playstation';
  if (l === 'xbox') return 'xbox';
  if (l === 'both' || l === 'crossplay') return 'crossplay';
  return null;
}

function platformLabel(p: string | null): string {
  const n = normalisePlatform(p);
  if (n === 'playstation') return 'PSN';
  if (n === 'xbox') return 'Xbox';
  if (n === 'crossplay') return 'Crossplay';
  return p ?? '';
}

function matchesFilter(league: OpenLeague, filter: Filter): boolean {
  if (filter === 'all') return true;
  const np = normalisePlatform(league.platform ?? null);
  if (filter === 'psn') return np === 'playstation';
  if (filter === 'xbox') return np === 'xbox';
  if (filter === 'both') return np === 'crossplay';
  if (filter === 'seats_open') return league.seats_open > 0;
  if (filter === 'competitive') {
    const c = league.competitiveness?.toLowerCase() ?? '';
    return c === 'competitive' || c === 'hardcore';
  }
  return true;
}

export default function OpenLeagues() {
  const [leagues, setLeagues] = React.useState<OpenLeague[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<Filter>('all');
  const [selectedLeague, setSelectedLeague] = useState<OpenLeague | null>(null);
  const [drawerMode, setDrawerMode] = useState<'signup' | 'waitlist'>('signup');
  const [drawerInitialValues, setDrawerInitialValues] = useState<Partial<SignupFormValues> | undefined>(undefined);
  const { isSignedIn, isLoaded } = useAuth();
  const [, navigate] = useLocation();

  // Code-search state
  const [codeInput, setCodeInput] = useState('');
  const [codeSearching, setCodeSearching] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const handleCodeSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setCodeError(null);
    setCodeSearching(true);
    try {
      const result = await resolvePublicCode(code);
      if (result?.slug) {
        navigate(`/l/${result.slug}`);
      } else {
        setCodeError(`No league found for code "${code}".`);
      }
    } catch {
      setCodeError(`No league found for code "${code}".`);
    } finally {
      setCodeSearching(false);
    }
  };

  React.useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    fetch(`${base}/api/leagues/open`)
      .then(r => r.json())
      .then((data: { data: OpenLeague[] }) => {
        setLeagues(data.data ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load leagues');
        setLoading(false);
      });
  }, []);

  // After returning from login, restore any saved draft
  React.useEffect(() => {
    if (!isLoaded || !isSignedIn || loading) return;

    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;

    try {
      const draft: SignupDraft = JSON.parse(raw);
      sessionStorage.removeItem(DRAFT_KEY);

      if (
        typeof draft.savedAt !== 'number'
        || !Number.isFinite(draft.savedAt)
        || Date.now() - draft.savedAt > DRAFT_TTL_MS
      ) {
        return;
      }

      // Try to find a fresh copy of the league from the loaded list (seats may have changed)
      const freshLeague = leagues.find(l => l.league_id === draft.leagueId) ?? draft.league;

      setDrawerInitialValues(draft.formState);
      setSelectedLeague(freshLeague);
      setDrawerMode(draft.mode);
    } catch {
      sessionStorage.removeItem(DRAFT_KEY);
    }
  }, [isLoaded, isSignedIn, loading, leagues]);

  const filtered = leagues.filter(l => matchesFilter(l, activeFilter));

  /** Open the sign-up drawer, redirecting to login first if not authenticated. */
  const handleOpenSignup = (league: OpenLeague) => {
    if (!isSignedIn) {
      const emptyForm: SignupFormValues = {
        countryCode: '',
        location: '',
        division: '',
        message: '',
        preferredClub: '',
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        leagueId: league.league_id,
        mode: 'signup',
        league,
        formState: emptyForm,
        savedAt: Date.now(),
      }));
      sessionStorage.setItem('fo_return_path', '/leagues/open');
      navigate('/sign-in?redirect_url=/leagues/open');
      return;
    }
    setDrawerInitialValues(undefined);
    setSelectedLeague(league);
    setDrawerMode('signup');
  };

  /** Open the waitlist drawer, redirecting to login first if not authenticated. */
  const handleOpenWaitlist = (league: OpenLeague) => {
    if (!isSignedIn) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        leagueId: league.league_id,
        mode: 'waitlist',
        league,
        formState: { countryCode: '', location: '', division: '', message: '', preferredClub: '' },
        savedAt: Date.now(),
      }));
      sessionStorage.setItem('fo_return_path', '/leagues/open');
      navigate('/sign-in?redirect_url=/leagues/open');
      return;
    }
    setDrawerInitialValues(undefined);
    setSelectedLeague(league);
    setDrawerMode('waitlist');
  };

  const handleCloseDrawer = () => {
    setSelectedLeague(null);
    setDrawerInitialValues(undefined);
  };

  return (
    <>
      <Header />
      {/* Hero slab */}
      <section className="slab" style={{ '--slab-wrap-grid': 'none' } as React.CSSProperties}>
        <div className="wrap" style={{ display: 'block', padding: '32px 20px 34px' }}>
          <div className="eyebrow">
            {loading ? '…' : `${leagues.length} leagues recruiting · Franchise 27`}
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(30px,5vw,50px)', lineHeight: '.95', letterSpacing: '.01em', textTransform: 'uppercase', margin: '8px 0 6px' }}>
            Find your league.
          </h1>
          <p style={{ color: '#9FB1BF', maxWidth: '52ch', margin: 0 }}>
            Active, well-run Connected Franchise leagues looking for GMs. Sign up for an open seat, or join a waitlist and get invited when one opens.
          </p>

          {/* Code search */}
          <form
            onSubmit={handleCodeSearch}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '20px', alignItems: 'flex-start' }}
          >
            <input
              type="text"
              className="input"
              placeholder="Have a league code? e.g. RUSTBELT"
              value={codeInput}
              onChange={e => { setCodeInput(e.target.value); setCodeError(null); }}
              style={{ width: '260px', fontFamily: 'var(--data)', letterSpacing: '.05em', textTransform: 'uppercase' }}
              aria-label="League public code"
              disabled={codeSearching}
            />
            <button
              type="submit"
              className="btn"
              disabled={codeSearching || !codeInput.trim()}
            >
              {codeSearching ? 'Searching…' : 'Go'}
            </button>
            {codeError && (
              <p style={{ width: '100%', margin: '4px 0 0', color: 'var(--goal)', fontFamily: 'var(--data)', fontSize: '12px' }}>
                {codeError}
              </p>
            )}
          </form>
        </div>
      </section>

      <div className="wrap">
        {/* Filter chips */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', padding: '16px 0' }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`chip-filter${activeFilter === f.key ? ' active' : ''}`}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>
            Sorted by: seats open · games confirmed
          </span>
        </div>

        {/* Error / loading */}
        {error && (
          <div className="empty-state" style={{ margin: '20px 0' }}>
            <p style={{ color: 'var(--goal)' }}>{error}</p>
          </div>
        )}

        {loading && !error && (
          <div className="empty-state" style={{ margin: '20px 0' }}>
            <p style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              Loading leagues…
            </p>
          </div>
        )}

        {/* League grid */}
        {!loading && !error && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: '16px', paddingBottom: '36px' }}>
            {filtered.length === 0 && (
              <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                <h2>No leagues match</h2>
                <p style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>Try a different filter.</p>
              </div>
            )}
            {filtered.map(league => (
              <div key={league.league_id} className="lcard">
                <div className="lcard-top">
                  <div className="llogo" style={leagueLogoStyle(league.name)}>
                    {leagueInitials(league.name)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="lname">{league.name}</div>
                    <div className="lmeta">
                      {league.platform && <span>{platformLabel(league.platform)}</span>}
                      {league.platform && league.competitiveness && <span>·</span>}
                      {league.competitiveness && (
                        <span style={{ textTransform: 'capitalize' }}>{league.competitiveness}</span>
                      )}
                    </div>
                  </div>
                  <div className="health">
                    <div className="g" style={{ fontFamily: 'var(--display)', fontSize: '22px', lineHeight: 1, color: 'var(--pos)' }}>
                      {league.seats_open > 0 ? '✓' : '—'}
                    </div>
                    <div className="l" style={{ fontFamily: 'var(--data)', fontSize: '8.5px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--steel)' }}>
                      {league.seats_open === 0
                        ? 'Full'
                        : !league.active_gms
                          ? 'New'
                          : !league.games_confirmed
                            ? 'Just opened'
                            : 'Recruiting'}
                    </div>
                  </div>
                </div>
                {league.blurb && (
                  <div className="lblurb">{league.blurb}</div>
                )}
                {league.partners && (league.partners.charities.length > 0 || league.partners.sponsors.length > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                    {[...league.partners.charities, ...league.partners.sponsors].map((p) => (
                      <span
                        key={p.id}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          fontFamily: 'var(--data)', fontSize: '10px', letterSpacing: '.04em',
                          border: '1px solid var(--rule)', borderRadius: '2px', padding: '2px 6px',
                          color: 'var(--steel)',
                        }}
                      >
                        {p.logo_url && <img src={p.logo_url} alt="" style={{ height: '12px', width: 'auto' }} />}
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className="lstats">
                  <div className="lstat">
                    <div className={`v ${league.seats_open > 0 ? 'open' : 'full'}`}>{league.seats_open}</div>
                    <div className="k">Seats open</div>
                  </div>
                  <div className="lstat">
                    <div className="v">{league.seats_filled} / {league.max_seats}</div>
                    <div className="k">Filled</div>
                  </div>
                  <div className="lstat">
                    <div className="v">{league.waitlist_length}</div>
                    <div className="k">Waitlist</div>
                  </div>
                </div>
                <div className="lfoot">
                  {league.suggested_division && (
                    <span className={divisionTagClass(league.suggested_division)}>
                      {league.suggested_division.charAt(0).toUpperCase() + league.suggested_division.slice(1)}+
                    </span>
                  )}
                  {league.accepting_signups && league.seats_open > 0 ? (
                    <button
                      className="btn"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => handleOpenSignup(league)}
                    >
                      {isSignedIn ? 'Sign up' : 'Log in to sign up'}
                    </button>
                  ) : (
                    <button
                      className="btn wait"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => handleOpenWaitlist(league)}
                      disabled={!league.accepting_waitlist}
                    >
                      {!league.accepting_waitlist
                        ? 'Closed'
                        : isSignedIn
                          ? 'Join waitlist'
                          : 'Log in to join waitlist'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sign-up / waitlist drawer */}
        {selectedLeague && (
          <SignupDrawer
            league={selectedLeague}
            mode={drawerMode}
            onClose={handleCloseDrawer}
            initialValues={drawerInitialValues}
          />
        )}
      </div>
    </>
  );
}
