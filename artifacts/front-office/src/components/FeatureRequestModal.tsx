/**
 * FeatureRequestModal — accessible modal for submitting feature ideas.
 * Opens from the footer's "💡 Feature request" button.
 * POSTs to /api/feature-requests on submit.
 */
import React, { useEffect, useRef, useState } from 'react';

interface Props {
  onClose: () => void;
}

type State = 'idle' | 'submitting' | 'success' | 'error';

const MAX_BODY = 4000;

export default function FeatureRequestModal({ onClose }: Props) {
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLInputElement>(null);

  // Focus first input on open
  useEffect(() => {
    firstFocusRef.current?.focus();
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Trap focus inside the modal
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const focusables = overlay.querySelectorAll<HTMLElement>(
      'button, input, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    overlay.addEventListener('keydown', trap);
    return () => overlay.removeEventListener('keydown', trap);
  }, [state]); // re-run when state changes (success swaps out controls)

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      setErrorMsg('Please describe your idea before submitting.');
      return;
    }
    setState('submitting');
    setErrorMsg('');

    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/feature-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email || undefined, body }),
      });

      if (res.status === 429) {
        setErrorMsg("You've sent a few ideas recently. Give it a bit and try again.");
        setState('error');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg((data as { detail?: string }).detail ?? 'Something went wrong. Please try again.');
        setState('error');
        return;
      }
      setState('success');
    } catch {
      setErrorMsg('Network error. Please try again.');
      setState('error');
    }
  };

  return (
    <div
      className="fr-overlay open"
      ref={overlayRef}
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fr-title"
    >
      <div className="fr-card">
        {state === 'success' ? (
          <div className="fr-thanks">
            <div className="fr-check">✓</div>
            <h3>Thanks — got it.</h3>
            <p>Your idea is on the list. No spam, no auto-reply.</p>
            <button className="fr-send" onClick={onClose} autoFocus>Close</button>
          </div>
        ) : (
          <>
            <div className="fr-head">
              <h3 id="fr-title">Feature request</h3>
              <button
                className="fr-close"
                aria-label="Close"
                onClick={onClose}
                type="button"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="fr-body">
                <p className="fr-intro">
                  Got an idea for Front Office? Tell me what would make running your league easier.
                </p>
                <div className="fr-field">
                  <label htmlFor="fr-email">
                    Email <span className="opt">(optional — only if you want a reply)</span>
                  </label>
                  <input
                    id="fr-email"
                    ref={firstFocusRef}
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    maxLength={254}
                  />
                </div>
                <div className="fr-field">
                  <label htmlFor="fr-msg">Your idea</label>
                  <textarea
                    id="fr-msg"
                    rows={4}
                    maxLength={MAX_BODY}
                    placeholder="I'd love to be able to…"
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    required
                  />
                  <div className="fr-count">
                    <span>{body.length}</span> / {MAX_BODY}
                  </div>
                </div>
                {(state === 'error' || errorMsg) && (
                  <p style={{ color: 'var(--goal)', fontFamily: 'var(--data)', fontSize: 11, margin: '0 0 10px' }}>
                    {errorMsg}
                  </p>
                )}
              </div>
              <div className="fr-foot">
                <button
                  type="button"
                  className="fr-cancel"
                  onClick={onClose}
                  disabled={state === 'submitting'}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="fr-send"
                  disabled={state === 'submitting' || body.trim().length === 0}
                >
                  {state === 'submitting' ? 'Sending…' : 'Send it'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
