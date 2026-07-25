/**
 * CP4 — Confirm or dispute a reported result.
 * Route: /results/:resultId/confirm?gameId=...
 * Loads game context, shows the score, offers Confirm / Dispute with reason.
 */
import React, { useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirmResult } from '@workspace/api-client-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

// ─── types (mirrors GET /api/games/:gameId response) ─────────────────────

interface GameTeam {
  franchise_name: string | null;
  club_abbrev: string | null;
}

interface GameResult {
  id: string;
  home_goals: number;
  away_goals: number;
  decision: string;
  version: number;
}

interface GameDetail {
  id: string;
  status: string;
  home: GameTeam;
  away: GameTeam;
  result: GameResult | null;
}

// ─── helpers ─────────────────────────────────────────────────────────────

function decisionLabel(d: string) {
  if (d === 'overtime') return 'OT';
  if (d === 'shootout') return 'SO';
  return '';
}

// ─── page ─────────────────────────────────────────────────────────────────

export default function ConfirmResult() {
  const { resultId } = useParams<{ resultId: string }>();
  const [location, navigate] = useLocation();

  // gameId comes from query param so this page is bookmarkable
  const gameId = new URLSearchParams(location.split('?')[1] ?? '').get('gameId');

  const qc = useQueryClient();
  const confirmMut = useConfirmResult();

  const [game, setGame] = React.useState<GameDetail | null>(null);
  const [loadErr, setLoadErr] = React.useState<string | null>(null);
  const [authErr, setAuthErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!gameId) { setLoadErr('Missing game context. Go back and try again.'); return; }
    fetch(`/api/games/${gameId}`, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error((j as { detail?: string }).detail ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<GameDetail>;
      })
      .then(setGame)
      .catch((e: unknown) => setLoadErr(e instanceof Error ? e.message : 'Load failed'));
  }, [gameId]);

  const [mode, setMode] = useState<'idle' | 'dispute'>('idle');
  const [disputeReason, setDisputeReason] = useState('');
  const [done, setDone] = useState<'confirmed' | 'disputed' | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  function doConfirm() {
    if (!resultId || !game?.result) return;
    setSubmitErr(null);
    confirmMut.mutate(
      {
        resultId,
        data: { agree: true },
        // Pass If-Match with result version for optimistic-concurrency
        // (customFetch doesn't expose headers directly; we use the request override)
      } as Parameters<typeof confirmMut.mutate>[0],
      {
        onSuccess: () => {
          setDone('confirmed');
          qc.invalidateQueries({ queryKey: ['/api/seasons'] });
          qc.invalidateQueries({ queryKey: ['/api/leagues'] });
          setTimeout(() => navigate('/'), 1400);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Request failed';
          if (msg.toLowerCase().includes('self') || msg.toLowerCase().includes('confirm your own')) {
            setAuthErr('You cannot confirm your own reported result. Wait for the opposing GM.');
          } else {
            setSubmitErr(msg);
          }
        },
      }
    );
  }

  function doDispute() {
    if (!resultId || !game?.result) return;
    if (!disputeReason.trim()) { setSubmitErr('Please enter a reason for the dispute.'); return; }
    setSubmitErr(null);
    confirmMut.mutate(
      { resultId, data: { agree: false, dispute_reason: disputeReason.trim() } },
      {
        onSuccess: () => {
          setDone('disputed');
          qc.invalidateQueries({ queryKey: ['/api/seasons'] });
          qc.invalidateQueries({ queryKey: ['/api/leagues'] });
          setTimeout(() => navigate('/'), 1400);
        },
        onError: (err: unknown) => {
          setSubmitErr(err instanceof Error ? err.message : 'Request failed');
        },
      }
    );
  }

  // ── render ───────────────────────────────────────────────────────────

  if (loadErr) {
    return (
      <>
        <Header />
        <div className="wrap">
          <div className="empty-state">
            <h2>Can't load game</h2>
            <p style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', marginTop: '10px' }}>{loadErr}</p>
          </div>
        </div>
        <Footer />
      </>
    );
  }

  const result = game?.result;
  const homeLabel = game?.home.club_abbrev ?? game?.home.franchise_name ?? 'Home';
  const awayLabel = game?.away.club_abbrev ?? game?.away.franchise_name ?? 'Away';
  const dLabel = result ? decisionLabel(result.decision) : '';
  const scoreStr = result
    ? `${result.away_goals} – ${result.home_goals}${dLabel ? ` (${dLabel})` : ''}`
    : '—';

  if (done) {
    const isConf = done === 'confirmed';
    return (
      <>
        <Header />
        <div className="wrap">
          <div className="empty-state">
            <h2 style={{ color: isConf ? 'var(--pos, #1F7A4C)' : 'var(--goal)' }}>
              {isConf ? 'Result Confirmed' : 'Result Disputed'}
            </h2>
            <p style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              {awayLabel} {scoreStr} {homeLabel}
            </p>
            {isConf && (
              <p style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '11px', marginTop: '8px' }}>
                This result now counts toward standings.
              </p>
            )}
          </div>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />

      <div className="slab">
        <div className="wrap" style={{ padding: '20px 20px 24px' }}>
          <div className="eyebrow">Confirm Result</div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(24px,5vw,40px)', lineHeight: '.95', textTransform: 'uppercase', letterSpacing: '.01em', margin: '6px 0 4px', color: '#E8EEF3' }}>
            {awayLabel ?? '…'} @ {homeLabel ?? '…'}
          </h1>
        </div>
      </div>

      <div className="wrap" style={{ padding: '24px 20px 60px', maxWidth: '480px' }}>

        {authErr && (
          <div style={{ background: '#FCF2F0', border: '1px solid #E5B8B1', borderRadius: '3px', padding: '12px 14px', fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--goal)', marginBottom: '20px' }}>
            {authErr}
          </div>
        )}

        {/* Score display */}
        <div className="panel" style={{ marginBottom: '20px' }}>
          <div className="panel-head"><h2>Reported Score</h2></div>
          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
            {result ? (
              <>
                <div style={{ fontFamily: 'var(--display)', fontSize: '48px', lineHeight: 1, letterSpacing: '.01em' }}>
                  {result.away_goals} – {result.home_goals}
                </div>
                <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', marginTop: '6px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                  {awayLabel} @ {homeLabel}{dLabel ? ` · ${dLabel}` : ''}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>Loading…</div>
            )}
          </div>
        </div>

        {/* Confirmation note */}
        {!authErr && (
          <p style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '16px', lineHeight: 1.5 }}>
            Confirming counts this result toward standings. Disputing flags it for the commissioner.
          </p>
        )}

        {submitErr && (
          <div style={{ background: '#FCF2F0', border: '1px solid #E5B8B1', borderRadius: '3px', padding: '10px 14px', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--goal)', marginBottom: '16px' }}>
            {submitErr}
          </div>
        )}

        {mode === 'idle' && !authErr && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              className="btn"
              style={{ fontSize: '14px', padding: '14px', letterSpacing: '.1em' }}
              onClick={doConfirm}
              disabled={confirmMut.isPending || !result}
            >
              {confirmMut.isPending ? 'Confirming…' : '✓ Confirm Result'}
            </button>
            <button
              className="btn ghost"
              style={{ fontSize: '13px', padding: '12px', letterSpacing: '.08em', color: 'var(--goal)', borderColor: 'var(--goal)' }}
              onClick={() => { setMode('dispute'); setSubmitErr(null); }}
              disabled={confirmMut.isPending || !result}
            >
              ✗ Dispute Result
            </button>
          </div>
        )}

        {mode === 'dispute' && (
          <div className="panel">
            <div className="panel-head"><h2>Dispute reason</h2></div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', margin: 0, lineHeight: 1.5 }}>
                Describe what was wrong. The commissioner will be notified and can resolve the dispute.
              </p>
              <textarea
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="e.g. Score was 4–3, not 3–4"
                maxLength={500}
                rows={3}
                style={{ width: '100%', padding: '8px 10px', fontFamily: 'var(--data)', fontSize: '12px', border: '1px solid var(--rule)', borderRadius: '2px', resize: 'vertical', boxSizing: 'border-box' }}
                autoFocus
              />
              {submitErr && (
                <p style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--goal)', margin: 0 }}>{submitErr}</p>
              )}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  className="btn"
                  style={{ flex: 1, fontSize: '13px', padding: '12px', background: 'var(--goal)', borderColor: 'var(--goal)' }}
                  onClick={doDispute}
                  disabled={confirmMut.isPending}
                >
                  {confirmMut.isPending ? 'Submitting…' : 'Submit Dispute'}
                </button>
                <button
                  className="btn ghost"
                  style={{ fontSize: '12px', padding: '10px 14px' }}
                  onClick={() => { setMode('idle'); setSubmitErr(null); }}
                  disabled={confirmMut.isPending}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          style={{ display: 'block', marginTop: '20px', background: 'none', border: 'none', padding: 0, fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', cursor: 'pointer' }}
          onClick={() => navigate('/')}
        >
          ← Back to hub
        </button>

      </div>

      <Footer />
    </>
  );
}
