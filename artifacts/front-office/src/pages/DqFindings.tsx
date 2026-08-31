/**
 * DqFindings — commissioner-only data quality dashboard for a league.
 *
 * Three-section accordion: BLOCK → ALERT → WATCH.
 * Each finding shows the check name, parsed detail fields, age, and a
 * "Mark resolved" button that optimistically removes the row.
 */
import React, { useState } from 'react';
import { useParams } from 'wouter';
import {
  useListDqFindings,
  useResolveDqFinding,
  useGetLeague,
  type DqFinding,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import Header from '@/components/Header';

// ── Detail parser ─────────────────────────────────────────────────────────────

function parseDetail(detail: string): Record<string, string> {
  try {
    const parsed = JSON.parse(detail);
    if (typeof parsed === 'object' && parsed !== null) {
      return Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, String(v ?? '')]),
      );
    }
  } catch {
    /* not JSON */
  }
  return { raw: detail };
}

// ── Age formatter ─────────────────────────────────────────────────────────────

function age(checkedAt: string): string {
  const ms = Date.now() - new Date(checkedAt).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(ms / 86_400_000);
  return `${days}d ago`;
}

// ── FindingRow ────────────────────────────────────────────────────────────────

function FindingRow({
  finding,
  leagueId,
}: {
  finding: DqFinding;
  leagueId: string;
}) {
  const resolve = useResolveDqFinding();
  const queryClient = useQueryClient();
  const [resolving, setResolving] = useState(false);

  const detail = parseDetail(finding.detail);

  const handleResolve = async () => {
    setResolving(true);
    try {
      await resolve.mutateAsync({ leagueId, findingId: finding.id });
      await queryClient.invalidateQueries({ queryKey: [`/api/leagues/${leagueId}/dq-findings`] as any });
    } finally {
      setResolving(false);
    }
  };

  return (
    <div
      style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--rule)',
        display: 'flex',
        gap: '12px',
        alignItems: 'flex-start',
      }}
    >
      {/* Check name + detail */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontFamily: 'var(--data)',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--ice)',
            textTransform: 'uppercase',
            letterSpacing: '.08em',
            marginBottom: '6px',
          }}
        >
          {finding.check_name.replace(/_/g, ' ')}
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 16px',
          }}
        >
          {Object.entries(detail).map(([k, v]) =>
            v ? (
              <span
                key={k}
                style={{
                  fontFamily: 'var(--data)',
                  fontSize: '11px',
                  color: 'var(--steel)',
                }}
              >
                <span style={{ color: 'var(--crease)', marginRight: 3 }}>
                  {k}:
                </span>
                {v}
              </span>
            ) : null,
          )}
        </div>
      </div>

      {/* Age + resolve */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--data)',
            fontSize: '11px',
            color: 'var(--steel)',
          }}
        >
          {age(finding.checked_at)}
        </span>
        <button
          className="btn ghost"
          style={{ fontSize: '11px', padding: '3px 10px' }}
          onClick={handleResolve}
          disabled={resolving}
        >
          {resolving ? '…' : 'Mark resolved'}
        </button>
      </div>
    </div>
  );
}

// ── Section accordion ─────────────────────────────────────────────────────────

const SEVERITY_META = {
  BLOCK: {
    label: 'Block',
    description: 'Data is not trustworthy — must be fixed before standings are published.',
    color: '#e05252',
  },
  ALERT: {
    label: 'Alert',
    description: 'League behaviour issue — notify the commissioner and investigate.',
    color: '#e8a030',
  },
  WATCH: {
    label: 'Watch',
    description: 'Trend indicator — no immediate action required.',
    color: '#4a9eda',
  },
} as const;

function Section({
  severity,
  findings,
  leagueId,
}: {
  severity: 'BLOCK' | 'ALERT' | 'WATCH';
  findings: DqFinding[];
  leagueId: string;
}) {
  const [open, setOpen] = useState(severity === 'BLOCK' || findings.length > 0);
  const meta = SEVERITY_META[severity];

  return (
    <div
      style={{
        border: `1px solid var(--rule)`,
        borderRadius: 6,
        marginBottom: 12,
        overflow: 'hidden',
      }}
    >
      {/* Section header */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          background: 'var(--surface)',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--data)',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color: meta.color,
            minWidth: 44,
          }}
        >
          {meta.label}
        </span>
        <span
          style={{
            fontFamily: 'var(--data)',
            fontSize: '11px',
            color: 'var(--steel)',
            flex: 1,
          }}
        >
          {meta.description}
        </span>
        <span
          style={{
            fontFamily: 'var(--data)',
            fontSize: '12px',
            fontWeight: 600,
            color: findings.length > 0 ? meta.color : 'var(--steel)',
            minWidth: 20,
            textAlign: 'right',
          }}
        >
          {findings.length}
        </span>
        <span
          style={{
            color: 'var(--steel)',
            fontSize: 14,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform .15s',
          }}
        >
          ▶
        </span>
      </button>

      {/* Finding rows */}
      {open && findings.length === 0 && (
        <div
          style={{
            padding: '14px 16px',
            fontFamily: 'var(--data)',
            fontSize: '12px',
            color: 'var(--steel)',
          }}
        >
          No open {meta.label.toLowerCase()} findings. ✓
        </div>
      )}
      {open &&
        findings.map((f) => (
          <FindingRow key={f.id} finding={f} leagueId={leagueId} />
        ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DqFindings() {
  const { id: leagueId = '' } = useParams<{ id: string }>();
  const [showResolved, setShowResolved] = useState(false);

  const { isLoaded, isSignedIn } = useAuth();
  const { data: league, isLoading: leagueLoading } = useGetLeague(leagueId);
  const { data: findingsResp, isLoading: findingsLoading, refetch } =
    useListDqFindings(leagueId, { resolved: showResolved });

  if (!isLoaded || leagueLoading) {
    return <div className="loading-screen">Loading…</div>;
  }

  if (!isSignedIn || !league) {
    return (
      <div className="empty-state">
        <h2>Unauthorized</h2>
        <p style={{ color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
          You are not the commissioner of this league.
        </p>
      </div>
    );
  }

  const findings = findingsResp?.data ?? [];
  const blocks = findings.filter((f) => f.severity === 'BLOCK');
  const alerts = findings.filter((f) => f.severity === 'ALERT');
  const watches = findings.filter((f) => f.severity === 'WATCH');

  return (
    <>
      <Header league={league} />
      <div className="slab">
        <div className="wrap" style={{ padding: '30px 20px', display: 'block' }}>
          <div className="eyebrow">Commissioner Desk · {league.name}</div>
          <h1 style={{ fontSize: '36px', marginTop: '5px' }}>Data Quality</h1>
          <p
            style={{
              color: 'var(--steel)',
              fontFamily: 'var(--data)',
              fontSize: '12px',
              marginTop: '6px',
            }}
          >
            Open findings from the last DQ run. Resolve items after investigation.
          </p>
        </div>
      </div>

      <div className="wrap" style={{ paddingTop: '20px', paddingBottom: '60px' }}>
        {/* Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <button
            className={`btn ${showResolved ? '' : 'ghost'}`}
            onClick={() => { setShowResolved((v) => !v); }}
            style={{ fontSize: '12px' }}
          >
            {showResolved ? 'Showing resolved' : 'Show open'}
          </button>
          <button
            className="btn ghost"
            onClick={() => refetch()}
            style={{ fontSize: '12px' }}
          >
            ↻ Refresh
          </button>
          {findingsLoading && (
            <span
              style={{
                fontFamily: 'var(--data)',
                fontSize: '11px',
                color: 'var(--steel)',
              }}
            >
              Loading…
            </span>
          )}
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--data)',
              fontSize: '11px',
              color: 'var(--steel)',
            }}
          >
            {findingsResp?.total ?? 0} total · {findingsLoading ? '…' : findings.length} shown
          </span>
        </div>

        {/* Accordion sections */}
        <Section severity="BLOCK" findings={blocks} leagueId={leagueId} />
        <Section severity="ALERT" findings={alerts} leagueId={leagueId} />
        <Section severity="WATCH" findings={watches} leagueId={leagueId} />
      </div>
    </>
  );
}
