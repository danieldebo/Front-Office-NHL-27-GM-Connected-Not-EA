/**
 * LeaguePublic — /l/:slug
 * Public-facing league page. No authentication required.
 * Shows the league name, active season, and standings.
 */
import { useState, useCallback } from 'react';
import { useParams } from 'wouter';
import { useGetPublicLeague, StandingsRow } from '@workspace/api-client-react';
import { StandingsTable } from '@/components/Standings';

function PublicSlab({
  leagueName,
  seasonLabel,
  teamCount,
  confirmedGames,
}: {
  leagueName: string;
  seasonLabel: string | null;
  teamCount: number;
  confirmedGames: number;
}) {
  const initials = leagueName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <section className="slab">
      <div className="wrap">
        <div>
          <div className="eyebrow">{seasonLabel ?? 'Offseason'} · Public standings</div>
          <h1 style={{ whiteSpace: 'pre-line' }}>{leagueName}</h1>
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
            <div className="k">{confirmedGames}</div>
            <div className="l">Confirmed</div>
          </div>
          <div className="stat-cell">
            <div className="k">{initials || '??'}</div>
            <div className="l">League</div>
          </div>
        </div>
      </div>
    </section>
  );
}

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

export default function LeaguePublic() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? '';

  const { data, isLoading, isError } = useGetPublicLeague(slug, {
    query: { enabled: slug.length > 0 },
  });

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

  const { league, season, standings } = data;

  // Stat counts derived from standings rows
  const teamCount = standings.length;
  const confirmedGames = standings.reduce((acc, r: StandingsRow) => acc + (r.GP ?? 0), 0) / 2;

  const initials = league.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('');

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

      {/* Share link banner — visible to all visitors when public_code is set */}
      {league.public_code ? (
        <ShareLinkBanner publicCode={league.public_code} />
      ) : null}

      {/* Slab */}
      <PublicSlab
        leagueName={league.name}
        seasonLabel={season?.label ?? null}
        teamCount={teamCount}
        confirmedGames={Math.round(confirmedGames)}
      />

      {/* Standings */}
      <div className="wrap">
        <div style={{ paddingTop: '28px', paddingBottom: '60px' }}>
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
      </div>

    </>
  );
}
