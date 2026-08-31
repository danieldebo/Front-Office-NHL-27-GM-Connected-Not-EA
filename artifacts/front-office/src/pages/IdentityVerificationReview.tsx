import { useEffect, useState } from 'react';
import { useRoute } from 'wouter';
import Header from '@/components/Header';

type Review = {
  challenge_id: string;
  display_name: string;
  platform: 'xbox' | 'playstation';
  gamertag: string;
  code: string;
  profile_url: string;
  expires_at: string;
  submitted_at: string | null;
  completed_at: string | null;
  superseded_at: string | null;
  status: string;
};

function detail(value: unknown, fallback: string): string {
  return value && typeof value === 'object' && 'detail' in value && typeof value.detail === 'string'
    ? value.detail : fallback;
}

export default function IdentityVerificationReview() {
  const [, params] = useRoute('/identity-verifications/review/:challengeId');
  const challengeId = params?.challengeId;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [seen, setSeen] = useState(false);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    if (!challengeId) return;
    fetch(`${base}/api/identity-verifications/review/${challengeId}`, { credentials: 'include' })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(detail(body, 'Unable to load this review.'));
        setReview(body as Review);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load this review.'))
      .finally(() => setLoading(false));
  }, [base, challengeId]);

  const approve = async () => {
    if (!challengeId || !seen) return;
    setApproving(true);
    setError('');
    try {
      const response = await fetch(`${base}/api/identity-verifications/review/${challengeId}/approve`, {
        method: 'POST', credentials: 'include',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(detail(body, 'Unable to approve this review.'));
      setReview(current => current ? { ...current, status: 'commissioner_verified', completed_at: new Date().toISOString() } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to approve this review.');
    } finally {
      setApproving(false);
    }
  };

  return <><Header /><main className="wrap profile-page">
    <section className="panel profile-panel">
      <div className="panel-head"><h1>Identity verification review</h1></div>
      {loading && <p role="status">Loading review…</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {review && <div>
        <p>Review <strong>{review.display_name}</strong>’s {review.platform === 'xbox' ? 'Xbox' : 'PlayStation'} identity.</p>
        <p><strong>Gamertag:</strong> {review.gamertag}<br /><strong>Code:</strong> <code>{review.code}</code></p>
        <p><a href={review.profile_url} target="_blank" rel="noreferrer">Open official profile</a> in your own signed-in browser. Confirm the exact code appears on this gamertag.</p>
        {review.status === 'pending_commissioner_review' ? <>
          <label className="field-help"><input type="checkbox" checked={seen} onChange={event => setSeen(event.target.checked)} /> I saw this exact code on the official profile for this gamertag.</label>
          <p><button className="btn" type="button" disabled={!seen || approving} onClick={approve}>{approving ? 'Approving…' : 'Approve commissioner attestation'}</button></p>
        </> : <p role="status">{review.status === 'commissioner_verified' ? 'This identity is Commissioner-verified.' : `This challenge cannot be approved: ${review.status.replaceAll('_', ' ')}.`}</p>}
      </div>}
    </section>
  </main></>;
}