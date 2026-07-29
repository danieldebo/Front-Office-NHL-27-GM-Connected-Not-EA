import { useState, FormEvent } from 'react';
import { Link } from 'wouter';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok || res.status === 404) {
        // Always show the confirmation to avoid leaking whether the address exists
        setDone(true);
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? 'Something went wrong. Please try again.');
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
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>📬</div>
              <p style={{ fontWeight: 600, fontSize: '15px', marginBottom: '8px' }}>Check your inbox</p>
              <p style={{ color: 'var(--steel)', fontSize: '13px', lineHeight: 1.6 }}>
                If <strong>{email}</strong> is registered, you'll receive a reset link within a minute.
                Check your spam folder if it doesn't arrive.
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
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <p style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)', marginBottom: '20px', textAlign: 'center' }}>
                Enter your email and we'll send a reset link.
              </p>
              <form onSubmit={handleSubmit} className="login-form">
                <div className="field">
                  <label htmlFor="fp-email">Email</label>
                  <input
                    id="fp-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    autoFocus
                  />
                </div>

                {error && <p className="login-error">{error}</p>}

                <button
                  type="submit"
                  className="submit login-submit"
                  disabled={submitting}
                >
                  {submitting ? 'Sending…' : 'Send reset link'}
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
