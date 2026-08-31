/**
 * LeaguePublic — /l/:slug
 * Public-facing league page. No authentication required.
 * Shows the league name, active season, standings, and a recruiting banner
 * when the league is listed in the open-leagues directory.
 */
import { useState, useCallback } from 'react';
import { useParams, useSearch } from 'wouter';
import { useGetPublicLeague, StandingsRow } from '@workspace/api-client-react';
import { StandingsTable } from '@/components/Standings';
import SignupDrawer from '@/components/SignupDrawer';

// ── Recruiting banner ────────────────────────────────────────────────────────

interface ListingInfo {
  is_listed: boolean;
  accepting_signups: boolean;
  accepting_waitlist: boolean;
  blurb?: string | null;
  platform?: string | null;
  competitiveness?: string | null;
  suggested_division?: string | null;
}

function platformLabel(p: string | null | undefined): string {
  if (!p) return '';
  const map: Record<string, string> = {
    psn: 'PlayStation',
    xbox: 'Xbox',
    both: 'PlayStation & Xbox',
    crossplay: 'Crossplay',
    playstation: 'PlayStation',
  };
  return map[p] ?? p;
}

function competitivenessLabel(c: string | null | undefined): string {
  if (!c) return '';
  const map: Record<string, string> = {
    casual: 'Casual',
    competitive: 'Competitive',
    hardcore: 'Hardcore',
  };
  return map[c] ?? c;
}

function RecruitingBanner({
  leagueId,
  leagueName,
  listing,
}: {
  leagueId: string;
  leagueName: string;
  listing: ListingInfo;
}) {
  const [drawerMode, setDrawerMode] = useState<'signup' | 'waitlist' | null>(null);

  const canSignup = listing.accepting_signups;
  const canWaitlist = listing.accepting_waitlist;

  const pills: string[] = [];
  const platform = platformLabel(listing.platform);
  const comp = competitivenessLabel(listing.competitiveness);
  if (platform) pills.push(platform);
  if (comp) pills.push(comp);
  if (listing.suggested_division) pills.push(`Div: ${listing.suggested_division}`);

  return (
    <>
      <div style={{
        background: 'var(--slab)',
        borderBottom: '3px solid var(--bulb)',
        padding: '0',
      }}>
        <div className="wrap" style={{ paddingTop: '18px', paddingBottom: '20px' }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: 'var(--data)',
              fontSize: '10px',
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              background: 'var(--bulb)',
              color: 'var(--slab)',
              padding: '2px 8px',
              borderRadius: '2px',
              fontWeight: 600,
              flexShrink: 0,
            }}>
              Recruiting
            </span>
            {pills.map(pill => (
              <span key={pill} style={{
                fontFamily: 'var(--data)',
                fontSize: '10px',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                border: '1px solid rgba(255,255,255,.18)',
                color: '#B7C4CE',
                padding: '2px 8px',
                borderRadius: '2px',
              }}>
                {pill}
              </span>
            ))}
          </div>

          {/* Blurb */}
          {listing.blurb && (
            <p style={{
              fontFamily: 'var(--body)',
              fontSize: '14px',
              color: '#D6E0EA',
              margin: '0 0 16px',
              lineHeight: 1.55,
              maxWidth: '620px',
            }}>
              {listing.blurb}
            </p>
          )}

          {/* CTAs */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {canSignup && (
              <button
                className="btn"
                onClick={() => setDrawerMode('signup')}
                style={{ background: 'var(--bulb)', borderColor: 'var(--bulb)', color: 'var(--slab)' }}
              >
                Apply to join
              </button>
            )}
            {canWaitlist && (
              <button
                className="btn ghost"
                onClick={() => setDrawerMode('waitlist')}
                style={{ borderColor: 'rgba(255,255,255,.25)', color: '#B7C4CE' }}
              >
                Join waitlist
              </button>
            )}
          </div>
        </div>
      </div>

      {drawerMode && (
        <SignupDrawer
          league={{
            league_id: leagueId,
            name: leagueName,
            seats_open: 0,
            platform: listing.platform ?? null,
          }}
          mode={drawerMode}
          onClose={() => setDrawerMode(null)}
        />
      )}
    </>
  );
}

// ── Share link banner ────────────────────────────────────────────────────────

function ShareLinkBanner({ publicCode }: { publicCode: string }) {
  const [copied, setCopied] = useState(false);

  const shareUrl = `${window.location.origin}/j/${publicCode}`;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [shareUrl]);

  return (
    <div style={{
      background: '#EDF4FC',
      borderBottom: '1px solid #BDD5EE',
      padding: '10px 0',
    }}>
      <div className="wrap" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--data)',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '.09em',
          color: 'var(--steel)',
          flexShrink: 0,
        }}>
          Share link
        </span>
        <span style={{
          fontFamily: 'var(--data)',
          fontSize: '12px',
          color: 'var(--crease)',
          letterSpacing: '.03em',
          flexGrow: 1,
        }}>
          {shareUrl}
        </span>
        <button
          onClick={handleCopy}
          style={{
            fontFamily: 'var(--data)',
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '.09em',
            background: copied ? '#2563EB' : 'var(--crease)',
            color: '#fff',
            border: 'none',
            borderRadius: '3px',
            padding: '4px 12px',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background .15s',
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function LeaguePublic() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? '';
  const search = useSearch();
  const code = new URLSearchParams(search).get('code') ?? undefined;

  const { data, isLoading, isError } = useGetPublicLeague(
    slug,
    { code },
    { query: { enabled: slug.length > 0 } as any },
  );

  if (isLoading) {
    return (
      <>
        <header className="masthead">
          <div className="wrap">
            <div className="crest">…</div>
            <div>
              <div className="league-name">Loading…</div>
            </div>
          </div>
        </header>
        <section className="slab">
          <div className="wrap" style={{ minHeight: '200px' }} />
        </section>
      </>
    );
  }

  if (isError || !data) {
    return (
      <div className="wrap">
        <div className="empty-state" style={{ marginTop: '60px' }}>
          <h2>League not found</h2>
          <p style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
            The league "{slug}" doesn't exist or is private.
          </p>
        </div>
      </div>
    );
  }

  const { league, season, standings, listing, schedule, rulebook, partners } = data;

  // Stat counts derived from standings rows
  const teamCount = standings.length;
  const confirmedGames = standings.reduce((acc, r: StandingsRow) => acc + (r.GP ?? 0), 0) / 2;

  const initials = league.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('');

  const isRecruiting = listing?.is_listed &&
    (listing.accepting_signups || listing.accepting_waitlist);

  return (
    <>
      {/* Masthead */}
      <header className="masthead">
        <div className="wrap">
          <div className="crest">{initials || league.slug.slice(0, 2).toUpperCase()}</div>
          <div>
            <div className="league-name">{league.name}</div>
            <div className="league-meta">
              {season ? `${season.label} · ` : ''}Public standings
            </div>
          </div>
          <nav style={{ marginLeft: 'auto' }}>
            <a
              href={`/front-office/`}
              style={{
                fontFamily: 'var(--data)',
                fontSize: '11.5px',
                letterSpacing: '.09em',
                textTransform: 'uppercase',
                color: 'var(--steel)',
                textDecoration: 'none',
              }}
            >
              Sign in
            </a>
          </nav>
        </div>
      </header>

      {/* Recruiting banner — shown when league is actively recruiting */}
      {isRecruiting && (
        <RecruitingBanner
          leagueId={league.id}
          leagueName={league.name}
          listing={listing!}
        />
      )}

      {/* Share link banner — visible to all visitors when public_code is set */}
      {league.public_code ? (
        <ShareLinkBanner publicCode={league.public_code} />
      ) : null}

      {/* Slab */}
      <section className="slab">
        <div className="wrap">
          <div>
            <div className="eyebrow">{season?.label ?? 'Offseason'} · Public standings</div>
            <h1>{league.name}</h1>
            <p className="sub">
              Live standings derived from confirmed game results. Updated as games are reported and confirmed.
            </p>
          </div>
          <div className="slab-right">
            <div className="stat-cell">
              <div className="k">{teamCount}</div>
              <div className="l">Teams</div>
            </div>
            <div className="stat-cell">
              <div className="k">{Math.round(confirmedGames)}</div>
              <div className="l">Confirmed</div>
            </div>
            <div className="stat-cell">
              <div className="k">{initials || '??'}</div>
              <div className="l">League</div>
            </div>
          </div>
        </div>
      </section>

      {/* Standings */}
      <div className="wrap">
        <div style={{ paddingTop: '28px', paddingBottom: '20px' }}>
          {season ? (
            <StandingsTable rows={standings} />
          ) : (
            <section className="panel" id="standings">
              <div className="panel-head"><h2>Standings</h2></div>
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--steel)' }}>
                No active season yet.
              </div>
            </section>
          )}
        </div>

        {/* Schedule */}
        {schedule && (schedule.recent.length > 0 || schedule.upcoming.length > 0) && (
          <section className="panel" style={{ marginBottom: '20px' }}>
            <div className="panel-head"><h2>Schedule</h2></div>
            <div style={{ padding: '16px', display: 'grid', gap: '20px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              <div>
                <h3 style={{ fontFamily: 'var(--data)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--steel)' }}>Recent results</h3>
                {schedule.recent.length === 0 && <p style={{ color: 'var(--steel)', fontSize: '12px' }}>No games played yet.</p>}
                {schedule.recent.map((g) => (
                  <div key={g.id} style={{ fontFamily: 'var(--data)', fontSize: '13px', padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>
                    {g.away_label} {g.away_goals} @ {g.home_label} {g.home_goals}
                  </div>
                ))}
              </div>
              <div>
                <h3 style={{ fontFamily: 'var(--data)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--steel)' }}>Upcoming games</h3>
                {schedule.upcoming.length === 0 && <p style={{ color: 'var(--steel)', fontSize: '12px' }}>Nothing scheduled this week.</p>}
                {schedule.upcoming.map((g) => (
                  <div key={g.id} style={{ fontFamily: 'var(--data)', fontSize: '13px', padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>
                    {g.away_label} @ {g.home_label} — {new Date(g.window_opens_at).toDateString()}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Rulebook */}
        {rulebook && (
          <section className="panel" style={{ marginBottom: '20px' }}>
            <div className="panel-head"><h2>Rulebook · v{rulebook.version}</h2></div>
            <div style={{ padding: '16px', whiteSpace: 'pre-wrap', fontFamily: 'var(--body)', fontSize: '14px', lineHeight: 1.6 }}>
              {rulebook.body_md}
            </div>
          </section>
        )}

        {/* Charity & sponsors */}
        {partners && (partners.charities.length > 0 || partners.sponsors.length > 0) && (
          <section className="panel" style={{ marginBottom: '60px' }}>
            <div className="panel-head"><h2>Charity &amp; Sponsors</h2></div>
            <div style={{ padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
              {[...partners.charities, ...partners.sponsors].map((p) => (
                <a key={p.id} href={p.link} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: 'var(--crease)' }}>
                  {p.logo_url && <img src={p.logo_url} alt="" style={{ height: '28px', width: 'auto' }} />}
                  <span style={{ fontFamily: 'var(--data)', fontSize: '13px' }}>{p.name}</span>
                </a>
              ))}
            </div>
          </section>
        )}
        <div style={{ paddingBottom: '20px' }} />
      </div>
    </>
  );
}
