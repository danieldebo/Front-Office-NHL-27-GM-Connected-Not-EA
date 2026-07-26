/**
 * LandingPage — shown at "/" for unauthenticated visitors.
 *
 * Four entry points:
 *   1. Commissioner Sign In  → triggers login()
 *   2. Browse Open Leagues   → /leagues/open
 *   3. Join with a Code      → /j/<code> on submit
 *   4. Join with Invite Link → static instructions
 */
import React from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';

export default function LandingPage() {
  const { login } = useAuth();
  const [codeInput, setCodeInput] = React.useState('');
  const [, navigate] = useLocation();

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = codeInput.trim().toUpperCase();
    if (code) navigate(`/j/${code}`);
  };

  return (
    <div className="landing">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="landing-hero">
        <div className="wrap">
          <div className="landing-eyebrow">NHL 27 · Connected Franchise</div>
          <h1 className="landing-title">Front Office</h1>
          <p className="landing-sub">
            The hub for serious GM leagues — standings, scheduling, sign-ups,
            and the tools commissioners need to run a tight ship.
          </p>
        </div>
        <div className="landing-rafter" aria-hidden="true" />
      </header>

      {/* ── Entry point cards ─────────────────────────────────────────────── */}
      <main className="wrap landing-cards-wrap">
        <div className="landing-cards">

          {/* 1. Commissioner Sign In */}
          <div className="lp-card lp-card--primary">
            <div className="lp-card-icon" aria-hidden="true">🏒</div>
            <div className="lp-card-body">
              <h2 className="lp-card-title">Commissioner / GM Sign In</h2>
              <p className="lp-card-desc">
                Access your league dashboard, manage your roster, report game results,
                and view standings.
              </p>
            </div>
            <div className="lp-card-foot">
              <button className="btn lp-signin-btn" onClick={login}>
                Sign In
              </button>
            </div>
          </div>

          {/* 2. Browse Open Leagues */}
          <div className="lp-card">
            <div className="lp-card-icon" aria-hidden="true">📋</div>
            <div className="lp-card-body">
              <h2 className="lp-card-title">Browse Open Leagues</h2>
              <p className="lp-card-desc">
                Explore recruiting leagues, filter by platform and skill level,
                and apply for an open GM seat.
              </p>
            </div>
            <div className="lp-card-foot">
              <Link href="/leagues/open" className="btn">
                View Open Leagues
              </Link>
            </div>
          </div>

          {/* 3. Join with a Code */}
          <div className="lp-card">
            <div className="lp-card-icon" aria-hidden="true">🔑</div>
            <div className="lp-card-body">
              <h2 className="lp-card-title">Have a League Code?</h2>
              <p className="lp-card-desc">
                Enter the short code your commissioner shared and go straight to
                their league page.
              </p>
            </div>
            <div className="lp-card-foot">
              <form className="lp-code-form" onSubmit={handleCodeSubmit}>
                <input
                  type="text"
                  className="lp-code-input"
                  placeholder="e.g. RUSTBELT"
                  value={codeInput}
                  onChange={e => setCodeInput(e.target.value)}
                  aria-label="League code"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={20}
                />
                <button
                  type="submit"
                  className="btn"
                  disabled={!codeInput.trim()}
                >
                  Go
                </button>
              </form>
            </div>
          </div>

          {/* 4. Join with Invite Link */}
          <div className="lp-card">
            <div className="lp-card-icon" aria-hidden="true">✉️</div>
            <div className="lp-card-body">
              <h2 className="lp-card-title">Got an Invite Link?</h2>
              <p className="lp-card-desc">
                Invite links work automatically — just click the link your
                commissioner sent you. No code needed.
              </p>
            </div>
            <div className="lp-card-foot lp-card-foot--muted">
              <span className="lp-invite-note">
                Links look like <code>/join/…</code> — click to claim your seat.
              </span>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
