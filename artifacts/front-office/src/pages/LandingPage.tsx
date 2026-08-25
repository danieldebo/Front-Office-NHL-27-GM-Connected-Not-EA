/**
 * LandingPage — shown at "/" for unauthenticated visitors.
 * Design: "Stadium" — dark arena hero with ice-rink decoration.
 *
 * Sections:
 *   1. Hero (full-viewport, dark, ice circles, two CTAs)
 *   2. Features belt (6 platform features)
 *   3. Entry cards (Sign In · Browse · Code · Invite)
 *   4. Footer
 */
import React from 'react';
import { Link, useLocation } from 'wouter';

const FEATURES = [
  { icon: '📊', title: 'Live Standings',           desc: 'Real-time NHL-style standings with GP, W, L, OTL, PTS, and tiebreakers.' },
  { icon: '📅', title: 'Auto-Balanced Scheduling', desc: 'Generates a fair home/away schedule for the whole season instantly.' },
  { icon: '📋', title: 'GM Sign-Ups',              desc: 'Application flow with commissioner review and integrated waitlist management.' },
  { icon: '🛠️', title: 'Commissioner Tools',       desc: 'Decline notes, reorder waitlists, audit logs, and data-quality dashboards.' },
  { icon: '🔗', title: 'Invite System',            desc: 'One-click invite links with automated expiry and revocation controls.' },
  { icon: '🌐', title: 'Open Directory',           desc: 'Public browse page for fans to find and apply to recruiting leagues.' },
];

export default function LandingPage() {
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
      <section className="landing-hero">
        {/* Ice rink decoration */}
        <div className="landing-hero-bg" aria-hidden="true">
          <div className="landing-ice-outer" />
          <div className="landing-ice-inner" />
          <div className="landing-ice-line" />
          <div className="landing-ice-glow" />
        </div>

        {/* Top-left wordmark */}
        <div className="landing-wordmark">
          <div className="landing-crest">FO</div>
          <div className="landing-brand">Front Office</div>
          <div className="landing-brand-sep" aria-hidden="true" />
          <div className="landing-badge">NHL 27 · Connected Franchise</div>
        </div>

        {/* Centered headline + CTAs */}
        <div className="landing-center">
          <div className="landing-eyebrow">NHL 27 · Connected Franchise</div>
          <h1 className="landing-title">Front Office</h1>
          <p className="landing-sub">
            The hub for serious GM leagues — standings, scheduling, sign-ups,
            and the tools commissioners need to run a tight ship.
          </p>
          <div className="landing-ctas">
            <Link href="/sign-in" className="landing-cta-primary">
              Sign In
            </Link>
            <Link href="/leagues/open" className="landing-cta-outline">
              Browse Open Leagues
            </Link>
          </div>
        </div>

        {/* Scroll cue */}
        <div className="landing-scroll-hint" aria-hidden="true">↓ SCROLL</div>
      </section>

      {/* ── Features Belt ─────────────────────────────────────────────────── */}
      <section className="landing-features">
        <div className="landing-section-label">Why Front Office</div>
        <div className="landing-features-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="landing-feat">
              <div className="landing-feat-icon" aria-hidden="true">{f.icon}</div>
              <h3 className="landing-feat-title">{f.title}</h3>
              <p className="landing-feat-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Entry Cards ───────────────────────────────────────────────────── */}
      <section className="landing-entry">
        <div className="landing-section-label landing-section-label--dark">Get Started</div>
        <div className="landing-entry-grid">

          {/* 1. Sign In */}
          <div className="lp-card lp-card--primary">
            <div className="lp-card-body">
              <h2 className="lp-card-title">Commissioner / GM Sign In</h2>
              <p className="lp-card-desc">
                Manage your active leagues, review applications, and update schedules.
              </p>
            </div>
            <div className="lp-card-foot">
              <Link href="/sign-in" className="btn">Sign In</Link>
            </div>
          </div>

          {/* 2. Browse */}
          <div className="lp-card">
            <div className="lp-card-body">
              <h2 className="lp-card-title">Browse Open Leagues</h2>
              <p className="lp-card-desc">
                Looking for a team? Browse leagues that are currently recruiting GMs.
              </p>
            </div>
            <div className="lp-card-foot">
              <Link href="/leagues/open" className="btn">View Open Leagues</Link>
            </div>
          </div>

          {/* 3. Code */}
          <div className="lp-card">
            <div className="lp-card-body">
              <h2 className="lp-card-title">Have a League Code?</h2>
              <p className="lp-card-desc">
                Enter your league's short code to jump directly to its public page.
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
                <button type="submit" className="btn" disabled={!codeInput.trim()}>Go</button>
              </form>
            </div>
          </div>

          {/* 4. Invite */}
          <div className="lp-card">
            <div className="lp-card-body">
              <h2 className="lp-card-title">Got an Invite Link?</h2>
              <p className="lp-card-desc">
                Invite links automatically redirect to the sign-up page for the target
                league. Sign in first, then click the link from your commissioner.
              </p>
            </div>
            <div className="lp-card-foot lp-card-foot--muted">
              <span className="lp-invite-note">
                Links look like <code>/join/…</code> — click to claim your seat.
              </span>
            </div>
          </div>

        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <span className="landing-footer-text">© 2026 Front Office</span>
      </footer>

    </div>
  );
}
