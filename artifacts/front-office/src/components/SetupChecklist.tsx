import { useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { useSetupChecklist } from '@/hooks/useSetupChecklist';

function dismissKey(userId: string | null | undefined, leagueId: string): string {
  return `fo_setup_dismissed_${userId ?? 'anon'}_${leagueId}`;
}

export default function SetupChecklist({ leagueId }: { leagueId: string }) {
  const { userId } = useAuth();
  const { isLoading, steps, doneCount, total, complete } = useSetupChecklist(leagueId);
  const key = dismissKey(userId, leagueId);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });

  if (isLoading) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(key, '1');
    } catch {
      // Per-viewer convenience only — fine to lose across a cleared browser.
    }
  };

  if (complete && dismissed) return null;

  if (complete) {
    return (
      <div className="panel" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <span className="chip conf">✓</span>
        <span style={{ fontFamily: 'var(--data)', fontSize: '12px', fontWeight: 600 }}>Setup complete</span>
        <button type="button" className="btn ghost" style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: '11px' }} onClick={dismiss}>
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginBottom: '24px' }} data-testid="setup-checklist">
      <div className="panel-head">
        <h2>League setup</h2>
        <span className="note">{doneCount} of {total}</span>
      </div>
      <div className="bar" style={{ margin: '0 16px 4px' }}>
        <i style={{ width: `${(doneCount / total) * 100}%` }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {steps.map(step => (
          <div
            key={step.key}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
              borderBottom: '1px solid var(--rule)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 700,
                background: step.done ? '#1F7A4C' : 'var(--ice)',
                color: step.done ? '#fff' : 'var(--steel)',
                border: step.done ? 'none' : '1px solid var(--rule)',
              }}
            >
              {step.done ? '✓' : ''}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '13.5px' }}>{step.title}</div>
              <div style={{ color: 'var(--steel)', fontSize: '12px' }}>
                {step.blockedReason ? `Needs step: ${step.blockedReason}` : step.why}
              </div>
            </div>
            {step.done ? (
              <span className="chip conf" style={{ flexShrink: 0 }}>Done</span>
            ) : step.blockedReason ? (
              <span
                className="btn ghost"
                style={{ flexShrink: 0, opacity: 0.5, cursor: 'not-allowed', fontSize: '11px' }}
                title={step.blockedReason}
              >
                {step.blockedReason}
              </span>
            ) : (
              <Link href={step.href} className="btn" style={{ flexShrink: 0, fontSize: '11px', padding: '6px 12px' }}>
                {step.title}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
