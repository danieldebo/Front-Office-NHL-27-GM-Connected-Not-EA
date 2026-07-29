import { useState, FormEvent } from 'react';
import { useAuth } from '@workspace/replit-auth-web';
import { useLocation } from 'wouter';

type Mode = 'login' | 'register';

function postLoginRedirect(setLocation: (to: string) => void) {
  const returnPath = sessionStorage.getItem('fo_return_path');
  if (returnPath) {
    sessionStorage.removeItem('fo_return_path');
    setLocation(returnPath);
  } else {
    setLocation('/');
  }
}

export default function Login() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) return <div className="loading-screen">Authenticating…</div>;

  if (isAuthenticated) {
    postLoginRedirect(setLocation);
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === 'register' && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        postLoginRedirect(setLocation);
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(
          body.error ??
            (mode === 'login' ? 'Invalid email or password.' : 'Registration failed. Please try again.')
        );
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword('');
    setConfirm('');
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Header */}
        <div className="login-card-head">
          <h1>Front Office</h1>
          <p>NHL 27 Connected Franchise Hub</p>
        </div>

        {/* Social sign-in */}
        <div className="login-card-body">
          <p className="login-section-label">Sign in with</p>
          <div className="login-social-row">
            <a href="/api/auth/google" className="login-social-btn">
              <GoogleIcon />
              Google
            </a>
            <a href="/api/auth/microsoft" className="login-social-btn">
              <MicrosoftIcon />
              Microsoft
            </a>
            <a href="/api/auth/discord" className="login-social-btn">
              <DiscordIcon />
              Discord
            </a>
          </div>

          {/* Divider */}
          <div className="login-divider">
            <span>or email</span>
          </div>

          {/* Email/password form */}
          <form onSubmit={handleSubmit} className="login-form">
            <div className="field">
              <label htmlFor="lf-email">Email</label>
              <input
                id="lf-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>

            <div className="field">
              <label htmlFor="lf-password">Password</label>
              <input
                id="lf-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="••••••••"
              />
            </div>

            {mode === 'register' && (
              <div className="field">
                <label htmlFor="lf-confirm">Confirm Password</label>
                <input
                  id="lf-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </div>
            )}

            {error && <p className="login-error">{error}</p>}

            <button type="submit" className="submit login-submit" disabled={submitting}>
              {submitting
                ? mode === 'login'
                  ? 'Signing in…'
                  : 'Creating account…'
                : mode === 'login'
                  ? 'Sign In'
                  : 'Create Account'}
            </button>
          </form>

          {/* Mode toggle */}
          <p className="login-toggle">
            {mode === 'login' ? (
              <>
                New here?{' '}
                <button type="button" className="login-toggle-btn" onClick={() => switchMode('register')}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Have an account?{' '}
                <button type="button" className="login-toggle-btn" onClick={() => switchMode('login')}>
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        {/* PSN note */}
        <div className="login-psn-note">
          PlayStation player? Sign in with any method above, then add your PSN gamertag from your profile.
        </div>
      </div>
    </div>
  );
}

/* ── Inline SVG icons ──────────────────────────────────────────────────────── */

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="10" height="10" fill="#F35325"/>
      <rect x="13" y="1" width="10" height="10" fill="#81BC06"/>
      <rect x="1" y="13" width="10" height="10" fill="#05A6F0"/>
      <rect x="13" y="13" width="10" height="10" fill="#FFBA08"/>
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="#5865F2">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  );
}
