/**
 * CP4 — Score entry page. Phone-first, one-handed, under ten seconds.
 * Route: /games/:gameId/report
 */
import React, { useId, useRef, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useReportResult, ResultInputDecision } from '@workspace/api-client-react';
import Header from '@/components/Header';
import { gmIdentityLabel } from '@/components/gmIdentity';

// ─── data shape from GET /api/games/:gameId ───────────────────────────────

interface GameTeam {
  team_season_id: string;
  franchise_id: string;
  franchise_name: string | null;
  club_abbrev: string | null;
  goals: number | null;
  gm_display_name?: string | null;
  gm_primary_identity?: string | null;
  gm_platform?: string | null;
  gm_gamertag?: string | null;
}

interface GameResult {
  id: string;
  home_goals: number;
  away_goals: number;
  decision: string;
  version: number;
  data_source: string;
}

interface GameDetail {
  id: string;
  season_id: string;
  status: string;
  home: GameTeam;
  away: GameTeam;
  result: GameResult | null;
}

// ─── goal stepper ─────────────────────────────────────────────────────────

function GoalStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="goal-stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-row">
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`Decrease ${label} goals`}
        >
          −
        </button>
        <span className="stepper-val" aria-live="polite" aria-atomic>
          {value}
        </span>
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onChange(value + 1)}
          aria-label={`Increase ${label} goals`}
        >
          +
        </button>
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────

export default function ReportResult() {
  const { gameId } = useParams<{ gameId: string }>();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const idempotencyKey = useRef(crypto.randomUUID());

  // Load game detail
  const [game, setGame] = React.useState<GameDetail | null>(null);
  const [loadErr, setLoadErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!gameId) return;
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

  // Form state
  const [homeGoals, setHomeGoals] = useState(0);
  const [awayGoals, setAwayGoals] = useState(0);
  const [decision, setDecision] = useState<ResultInputDecision>('regulation');
  const [showBoxScore, setShowBoxScore] = useState(false);
  const [supersedeReason, setSupersedeReason] = useState('');
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const reportMut = useReportResult();

  const isCorrection = game?.result != null;
  const homeLabel = game?.home.club_abbrev ?? game?.home.franchise_name ?? 'Home';
  const awayLabel = game?.away.club_abbrev ?? game?.away.franchise_name ?? 'Away';
  const homeIdentity = game?.home ? gmIdentityLabel(game.home) : null;
  const awayIdentity = game?.away ? gmIdentityLabel(game.away) : null;

  // Shootout: goals must differ by exactly 1 after SOG
  const decisionOk =
    decision === 'regulation' ||
    (decision === 'overtime' && homeGoals !== awayGoals) ||
    (decision === 'shootout' && Math.abs(homeGoals - awayGoals) === 1);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gameId) return;
    if (!decisionOk) {
      setSubmitErr(
        decision === 'overtime'
          ? 'Overtime must end with different scores.'
          : 'Shootout must be decided by exactly 1 goal.'
      );
      return;
    }
    if (isCorrection && !supersedeReason.trim()) {
      setSubmitErr('A reason is required when correcting an existing result.');
      return;
    }
    setSubmitErr(null);

    reportMut.mutate(
      {
        gameId,
        data: {
          home_goals: homeGoals,
          away_goals: awayGoals,
          decision,
          supersede_result_id: isCorrection ? game!.result!.id : null,
          supersede_reason: isCorrection ? supersedeReason.trim() : null,
        },
      },
      {
        onSuccess: () => {
          setSubmitted(true);
          // Bust the games cache so standings + hub refresh
          qc.invalidateQueries({ queryKey: ['/api/seasons'] });
          qc.invalidateQueries({ queryKey: ['/api/leagues'] });
          // Short delay, then go back home
          setTimeout(() => navigate('/'), 1200);
        },
        onError: (err: unknown) => {
          setSubmitErr(err instanceof Error ? err.message : 'Submission failed. Try again.');
        },
      }
    );
  }

  // ── render ────────────────────────────────────────────────────────────

  if (loadErr) {
    return (
      <>
        <Header />
        <div className="wrap">
          <div className="empty-state">
            <h2>Game not found</h2>
            <p style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              {loadErr}
            </p>
          </div>
        </div>
      </>
    );
  }

  if (submitted) {
    return (
      <>
        <Header />
        <div className="wrap">
          <div className="empty-state">
            <h2 style={{ color: 'var(--pos, #1F7A4C)' }}>Score Reported</h2>
            <p style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              {awayLabel} {awayGoals} – {homeGoals} {homeLabel}
              {decision !== 'regulation' ? ` (${decision === 'overtime' ? 'OT' : 'SO'})` : ''}
            </p>
            <p style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '11px', marginTop: '8px' }}>
              Awaiting confirmation from the opposing GM.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />

      {/* slab */}
      <div className="slab">
        <div className="wrap" style={{ padding: '20px 20px 24px' }}>
          <div className="eyebrow">{isCorrection ? 'Correct Result' : 'Report Score'}</div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(24px,5vw,40px)', lineHeight: '.95', textTransform: 'uppercase', letterSpacing: '.01em', margin: '6px 0 4px', color: '#E8EEF3' }}>
            {awayLabel ?? '…'} @ {homeLabel ?? '…'}
          </h1>
            {(awayIdentity || homeIdentity) && (
              <p className="game-gm-identities" data-testid="text-game-gm-identities">
                {game?.away.gm_display_name ?? 'Away GM'}{awayIdentity ? ` · ${awayIdentity}` : ''}
                <span aria-hidden="true"> — </span>
                {game?.home.gm_display_name ?? 'Home GM'}{homeIdentity ? ` · ${homeIdentity}` : ''}
              </p>
            )}
          {game?.status && (
            <p style={{ color: '#9FB1BF', fontFamily: 'var(--data)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              Week {(game as { week_number?: number }).week_number ?? '—'} · {game.status}
            </p>
          )}
        </div>
      </div>

      <div className="wrap" style={{ padding: '24px 20px 60px', maxWidth: '480px' }}>

        {/* correction notice */}
        {isCorrection && (
          <div style={{ background: '#FDF7EA', border: '1px solid #EBD3A1', borderRadius: '3px', padding: '10px 14px', marginBottom: '20px', fontFamily: 'var(--data)', fontSize: '12px', color: '#6b4e12' }}>
            <strong>Correcting existing result:</strong>{' '}
            {game.result!.away_goals} – {game.result!.home_goals}
            {game.result!.decision !== 'regulation' ? ` (${game.result!.decision === 'overtime' ? 'OT' : 'SO'})` : ''}
            . The old result will be preserved with a supersede note.
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* score steppers */}
          <div className="panel">
            <div className="panel-head"><h2>Score</h2></div>
            <div style={{ padding: '20px 16px', display: 'flex', gap: '0', justifyContent: 'space-around', alignItems: 'center' }}>
              <GoalStepper label={awayLabel ?? 'Away'} value={awayGoals} onChange={setAwayGoals} />
              <span style={{ fontFamily: 'var(--display)', fontSize: '28px', color: 'var(--steel)' }}>@</span>
              <GoalStepper label={homeLabel ?? 'Home'} value={homeGoals} onChange={setHomeGoals} />
            </div>
          </div>

          {/* decision */}
          <div className="panel">
            <div className="panel-head"><h2>Decided in</h2></div>
            <div style={{ padding: '16px', display: 'flex', gap: '8px' }}>
              {(['regulation', 'overtime', 'shootout'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`btn${decision === d ? '' : ' ghost'}`}
                  style={{ flex: 1, fontSize: '12px', padding: '10px 4px' }}
                  onClick={() => setDecision(d)}
                >
                  {d === 'regulation' ? 'REG' : d === 'overtime' ? 'OT' : 'SO'}
                </button>
              ))}
            </div>
            {!decisionOk && (
              <p style={{ margin: '0 16px 12px', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--goal)' }}>
                {decision === 'overtime'
                  ? 'Overtime results must have different goal totals.'
                  : 'Shootout results must differ by exactly 1 goal.'}
              </p>
            )}
          </div>

          {/* optional box score */}
          <div>
            <button
              type="button"
              style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--crease)', cursor: 'pointer', letterSpacing: '.06em', textTransform: 'uppercase' }}
              onClick={() => setShowBoxScore((p) => !p)}
            >
              {showBoxScore ? '▲ Hide' : '▼ Add'} box score (optional)
            </button>
            {showBoxScore && (
              <div className="panel" style={{ marginTop: '10px' }}>
                <div style={{ padding: '14px 16px' }}>
                  <p style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', margin: 0 }}>
                    Box score entry coming in a future update. Submit the final score for now.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* supersede reason (correction only) */}
          {isCorrection && (
            <div className="panel">
              <div className="panel-head"><h2>Reason for correction</h2></div>
              <div style={{ padding: '14px 16px' }}>
                <textarea
                  value={supersedeReason}
                  onChange={(e) => setSupersedeReason(e.target.value)}
                  placeholder="e.g. Wrong OT decision selected"
                  maxLength={500}
                  required
                  style={{ width: '100%', minHeight: '72px', padding: '8px 10px', fontFamily: 'var(--data)', fontSize: '12px', border: '1px solid var(--rule)', borderRadius: '2px', resize: 'vertical', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          )}

          {/* error */}
          {submitErr && (
            <div style={{ background: '#FCF2F0', border: '1px solid #E5B8B1', borderRadius: '3px', padding: '10px 14px', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--goal)' }}>
              {submitErr}
            </div>
          )}

          {/* submit */}
          <button
            type="submit"
            className="btn"
            disabled={reportMut.isPending || !decisionOk}
            style={{ fontSize: '14px', padding: '14px', letterSpacing: '.1em' }}
          >
            {reportMut.isPending
              ? 'Submitting…'
              : isCorrection
              ? 'Submit Correction'
              : 'Report Score'}
          </button>

          <button
            type="button"
            style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', cursor: 'pointer' }}
            onClick={() => navigate('/')}
          >
            Cancel
          </button>

        </form>
      </div>


      <style>{`
        .goal-stepper { display: flex; flex-direction: column; align-items: center; gap: 10px; flex: 1; }
        .stepper-label { font-family: var(--data); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--steel); }
        .stepper-row { display: flex; align-items: center; gap: 0; }
        .stepper-btn {
          width: 52px; height: 52px; background: var(--ice); border: 1px solid var(--rule);
          font-size: 24px; font-family: var(--data); color: var(--ink); cursor: pointer;
          border-radius: 3px; display: grid; place-items: center; touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .stepper-btn:active { background: var(--rule); }
        .stepper-val { width: 56px; text-align: center; font-family: var(--display); font-size: 44px; line-height: 1; }
      `}</style>
    </>
  );
}
