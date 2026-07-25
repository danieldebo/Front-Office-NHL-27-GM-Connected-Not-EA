/**
 * JoinInvite — /join/:token
 * Public landing page for commissioner invite links.
 * Unauthenticated users are prompted to log in first.
 * Authenticated users can claim a seat.
 */
import React, { useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useGetCommissionerInvitePublic, useClaimCommissionerInvite } from '@workspace/api-client-react';
import { useGetCurrentAuthUser } from '@workspace/api-client-react';

export default function JoinInvite() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const [claimError, setClaimError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'member' | 'waitlist' | null>(null);
  const [claimedLeagueId, setClaimedLeagueId] = useState<string | null>(null);

  const { data: userResponse, isLoading: isLoadingUser } = useGetCurrentAuthUser();
  const { data: invite, isLoading: isLoadingInvite, isError } = useGetCommissionerInvitePublic(
    token ?? '',
    { query: { enabled: !!token } }
  );
  const claim = useClaimCommissionerInvite();

  const user = userResponse?.user;
  const isAuthenticated = !!user;

  const handleClaim = () => {
    if (!token) return;
    setClaimError(null);
    claim.mutate({ token }, {
      onSuccess: (data) => {
        setOutcome(data.outcome as 'member' | 'waitlist');
        setClaimedLeagueId(data.league_id);
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
        setClaimError(msg);
      },
    });
  };

  const handleGoToLeague = () => {
    if (claimedLeagueId) setLocation(`/leagues/${claimedLeagueId}/hub`);
    else setLocation('/');
  };

  // ─── Loading
  if (isLoadingUser || isLoadingInvite) {
    return (
      <>
        <header className="masthead">
          <div className="wrap">
            <div className="crest">…</div>
            <div><div className="league-name">Loading…</div></div>
          </div>
        </header>
        <section className="slab">
          <div className="wrap" style={{ minHeight: '200px' }} />
        </section>
      </>
    );
  }

  // ─── Invite not found / expired at load time
  if (isError || !invite) {
    return (
      <>
        <header className="masthead">
          <div className="wrap">
            <div className="crest">!</div>
            <div>
              <div className="league-name">Invite Not Found</div>
              <div className="league-meta">Front Office</div>
            </div>
          </div>
        </header>
        <section className="slab">
          <div className="wrap">
            <div className="eyebrow">Commissioner Invite</div>
            <h1>This invite link is no longer active</h1>
            <p className="sub">The link may have expired, been revoked, or already reached its use limit.</p>
          </div>
        </section>
        <div className="wrap" style={{ paddingTop: '40px' }}>
          <a href="/" className="btn ghost">Go to Front Office</a>
        </div>
      </>
    );
  }

  // ─── Invite found but not usable
  if (!invite.usable && outcome === null) {
    return (
      <>
        <header className="masthead">
          <div className="wrap">
            <div className="crest">{invite.league_name.slice(0, 2).toUpperCase()}</div>
            <div>
              <div className="league-name">{invite.league_name}</div>
              <div className="league-meta">{invite.platform ?? 'Front Office'}</div>
            </div>
          </div>
        </header>
        <section className="slab">
          <div className="wrap">
            <div className="eyebrow">Commissioner Invite</div>
            <h1>{invite.league_name}</h1>
            <p className="sub">{invite.reason ?? 'This invite is no longer active.'}</p>
          </div>
        </section>
        <div className="wrap" style={{ paddingTop: '40px' }}>
          <a href="/" className="btn ghost">Go to Front Office</a>
        </div>
      </>
    );
  }

  const initials = invite.league_name
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '').join('');

  return (
    <>
      {/* Masthead */}
      <header className="masthead">
        <div className="wrap">
          <div className="crest">{initials || invite.league_slug?.slice(0, 2).toUpperCase()}</div>
          <div>
            <div className="league-name">{invite.league_name}</div>
            <div className="league-meta">{invite.platform ?? 'Front Office'}</div>
          </div>
          {!isAuthenticated && (
            <nav style={{ marginLeft: 'auto' }}>
              <a
                href="/api/login"
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
          )}
        </div>
      </header>

      {/* Slab */}
      <section className="slab">
        <div className="wrap">
          <div className="eyebrow">Commissioner Invite</div>
          <h1>You're invited to join</h1>
          <p className="sub">
            {invite.league_name}
            {invite.platform ? ` · ${invite.platform}` : ''}
          </p>
          {invite.max_uses && (
            <p style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)', marginTop: '8px' }}>
              {invite.uses} / {invite.max_uses} seats claimed
            </p>
          )}
        </div>
      </section>

      <div className="wrap" style={{ paddingTop: '40px', paddingBottom: '60px' }}>
        {/* Outcome: successfully claimed */}
        {outcome === 'member' && (
          <div className="panel" style={{ maxWidth: '480px' }}>
            <div className="panel-head">
              <h2 style={{ color: '#1F7A4C' }}>✓ Seat claimed!</h2>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ fontFamily: 'var(--body)', fontSize: '14px', color: 'var(--ink)' }}>
                You've joined <strong>{invite.league_name}</strong>. Head to your league hub to get started.
              </p>
              <button className="btn" onClick={handleGoToLeague}>
                Go to League Hub
              </button>
            </div>
          </div>
        )}

        {/* Outcome: waitlisted */}
        {outcome === 'waitlist' && (
          <div className="panel" style={{ maxWidth: '480px' }}>
            <div className="panel-head">
              <h2 style={{ color: 'var(--bulb)' }}>League is full</h2>
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ fontFamily: 'var(--body)', fontSize: '14px', color: 'var(--ink)' }}>
                <strong>{invite.league_name}</strong> is currently at capacity. You've been added to the waitlist — the commissioner will be notified.
              </p>
              <button className="btn ghost" onClick={() => setLocation('/')}>
                Return to Front Office
              </button>
            </div>
          </div>
        )}

        {/* Awaiting action */}
        {outcome === null && (
          <div className="panel" style={{ maxWidth: '480px' }}>
            <div className="panel-head">
              <h2>Request a Seat</h2>
              {invite.max_uses && (
                <span className="note">
                  {invite.max_uses - invite.uses} of {invite.max_uses} seats remaining
                </span>
              )}
            </div>
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {!isAuthenticated ? (
                <>
                  <p style={{ fontFamily: 'var(--body)', fontSize: '14px', color: 'var(--ink)' }}>
                    Sign in to claim your seat in <strong>{invite.league_name}</strong>.
                  </p>
                  <a
                    href={`/api/login?returnTo=${encodeURIComponent(window.location.pathname)}`}
                    className="btn"
                  >
                    Sign in to claim
                  </a>
                </>
              ) : (
                <>
                  <p style={{ fontFamily: 'var(--body)', fontSize: '14px', color: 'var(--ink)' }}>
                    You're signed in as <strong>{user.username || user.id}</strong>. Click below to request a seat in <strong>{invite.league_name}</strong>.
                  </p>
                  {claimError && (
                    <div style={{
                      background: '#FCF2F0', border: '1px solid #E5B8B1', borderRadius: '3px',
                      padding: '10px 14px', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--goal)'
                    }}>
                      {claimError}
                    </div>
                  )}
                  <button
                    className="btn"
                    onClick={handleClaim}
                    disabled={claim.isPending}
                  >
                    {claim.isPending ? 'Claiming…' : 'Claim a seat'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer>
        <div className="wrap">
          <span>Front Office · {invite.league_name}</span>
          <span>Commissioner invite link</span>
        </div>
      </footer>
    </>
  );
}
