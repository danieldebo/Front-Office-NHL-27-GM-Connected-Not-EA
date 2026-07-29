import { useState, FormEvent } from 'react';
import { useSearch, Link } from 'wouter';

export default function ResetPassword() {
  const search = useSearch();
  const token = new URLSearchParams(search).get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-card-head"><h1>Front Office</h1></div>
          <div className="login-card-body" style={{ textAlign: 'center' }}>
            <p className="login-error" style={{ marginBottom: '16px' }}>
              This reset link is missing or invalid.
            </p>
            <Link href="/forgot-password" className="login-toggle-btn">Request a new link</Link>
          </div>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setDone(true);
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? 'Failed to reset password. The link may have expired.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card-head">
          <h1>Front Office</h1>
          <p>NHL 27 Connected Franchise Hub</p>
        </div>

        <div className="login-card-body">
          {done ? (
            <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>✅</div>
              <p style={{ fontWeight: 600, fontSize: '15px', marginBottom: '8px' }}>Password updated</p>
              <p style={{ color: 'var(--steel)', fontSize: '13px', lineHeight: 1.6 }}>
                Your password has been changed. You can now sign in with your new password.
              </p>
              <Link
                href="/login"
                style={{
                  display: 'inline-block',
                  marginTop: '20px',
                  fontFamily: 'var(--data)',
                  fontSize: '12px',
                  color: 'var(--crease)',
                  textDecoration: 'underline',
                }}
              >
                Sign in
              </Link>
            </div>
          ) : (
            <>
              <p style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)', marginBottom: '20px', textAlign: 'center' }}>
                Choose a new password for your account.
              </p>
              <form onSubmit={handleSubmit} className="login-form">
                <div className="field">
                  <label htmlFor="rp-password">New password</label>
                  <input
                    id="rp-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    autoFocus
                  />
                </div>

                <div className="field">
                  <label htmlFor="rp-confirm">Confirm password</label>
                  <input
                    id="rp-confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                </div>

                {error && <p className="login-error">{error}</p>}

                <button
                  type="submit"
                  className="submit login-submit"
                  disabled={submitting}
                >
                  {submitting ? 'Saving…' : 'Set new password'}
                </button>
              </form>

              <p className="login-toggle">
                <Link href="/login" className="login-toggle-btn">Back to sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
