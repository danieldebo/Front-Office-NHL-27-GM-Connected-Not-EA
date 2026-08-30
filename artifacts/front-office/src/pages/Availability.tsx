/**
 * Availability page — /leagues/:id/availability
 *
 * Each GM declares which day-of-week + time-block combinations work for them.
 * The server uses this to surface overlapping windows for each matchup.
 *
 * Design: 4-row × 7-column grid (blocks × days). Toggle cells to mark
 * availability. Timezone selector at the top.
 */
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'wouter';
import {
  useGetLeague,
  useGetMyAvailability,
  useGetMyProfile,
  useSetAvailability,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import Header from '@/components/Header';

// ─────────────────────────────────────── types

type Block = 'morning' | 'afternoon' | 'evening' | 'night';
const BLOCKS: Block[] = ['morning', 'afternoon', 'evening', 'night'];
const BLOCK_LABELS: Record<Block, { label: string; sub: string; hours: string }> = {
  morning:   { label: 'Morning',   sub: 'Early',   hours: '6am – noon' },
  afternoon: { label: 'Afternoon', sub: 'Day',      hours: 'noon – 6pm' },
  evening:   { label: 'Evening',   sub: 'Prime',    hours: '6pm – 10pm' },
  night:     { label: 'Night',     sub: 'Late',     hours: '10pm – 2am' },
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Common IANA timezones to show in the selector
const COMMON_TZ = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Edmonton',
  'America/Winnipeg',
  'America/Halifax',
  'America/St_Johns',
  'Europe/London',
  'Europe/Paris',
  'Europe/Helsinki',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
];

/** Get the user's current timezone. */
function localTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

// Key for a slot: `${dow}-${block}`
type SlotKey = string;
const slotKey = (dow: number, block: Block): SlotKey => `${dow}-${block}`;
const parseKey = (k: SlotKey) => {
  const [dow, block] = k.split('-');
  return { dow: parseInt(dow ?? '0', 10), block: block as Block };
};

// ─────────────────────────────────────── component
export default function Availability() {
  const { id: leagueId } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: league, isLoading: leagueLoading } = useGetLeague(leagueId ?? '');
  const { data: saved, isLoading: savedLoading } = useGetMyAvailability(leagueId ?? '');
  const { data: profile } = useGetMyProfile();

  const [timezone, setTimezone] = useState<string>(localTz());
  const [timezoneFromProfile, setTimezoneFromProfile] = useState(false);
  const [selected, setSelected] = useState<Set<SlotKey>>(new Set());
  const [saved2, setSaved2] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAvail = useSetAvailability();

  // A timezone the GM already saved availability under wins — it's an explicit
  // choice made in this exact context. Absent that, prefer the profile's IANA
  // timezone (what the rest of the app treats as authoritative) over the
  // browser's ambient guess, which silently drifts from a VPN, travel, or an
  // OS clock set wrong.
  useEffect(() => {
    const data = saved as any;
    if (data?.timezone) {
      setTimezone(data.timezone);
      setTimezoneFromProfile(false);
    } else if (profile?.timezone) {
      setTimezone(profile.timezone);
      setTimezoneFromProfile(true);
    }
    if (Array.isArray(data?.slots)) {
      setSelected(new Set(data.slots.map((s: { dow: number; block: Block }) => slotKey(s.dow, s.block))));
    }
  }, [saved, profile]);

  const toggleSlot = (dow: number, block: Block) => {
    const k = slotKey(dow, block);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    setSaved2(false);
  };

  const handleSave = () => {
    setError(null);
    setSaved2(false);
    const slots = Array.from(selected).map(parseKey);

    setAvail.mutate(
      {
        leagueId: leagueId ?? '',
        data: { timezone, slots },
      },
      {
        onSuccess: () => {
          setSaved2(true);
          qc.invalidateQueries({ queryKey: ['/api/leagues', leagueId, 'availability', 'me'] as any });
        },
        onError: (err: unknown) => {
          setError(err instanceof Error ? err.message : 'Failed to save availability');
        },
      }
    );
  };

  const selectedCount = selected.size;

  if (leagueLoading) return <div className="loading-screen">Loading…</div>;
  if (!league)       return <div className="loading-screen">League not found.</div>;

  return (
    <>
      <Header league={league} />
      <div className="slab">
        <div className="wrap" style={{ padding: '30px 20px', display: 'block' }}>
          <div className="eyebrow">
            <Link href="/" style={{ color: 'var(--bulb)', textDecoration: 'none' }}>
              ← Back to Hub
            </Link>
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '42px', marginTop: '8px', textTransform: 'uppercase', letterSpacing: '.02em' }}>
            My Availability
          </h1>
          <p className="slab-sub" style={{ color: '#9FB1BF', fontFamily: 'var(--data)', fontSize: '12px', letterSpacing: '.08em', textTransform: 'uppercase', marginTop: '4px' }}>
            {league.name} · When are you free to play?
          </p>
        </div>
      </div>

      <div className="wrap" style={{ paddingTop: '28px', paddingBottom: '60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: '24px', alignItems: 'start' }}>

          {/* ── Grid ── */}
          <div>
            {/* Timezone selector */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontFamily: 'var(--data)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--steel)', display: 'block', marginBottom: '6px' }}>
                Your Timezone {timezoneFromProfile && <span style={{ color: 'var(--crease)', textTransform: 'none', letterSpacing: 0 }}>(from your profile)</span>}
              </label>
              <select
                value={timezone}
                onChange={e => { setTimezone(e.target.value); setTimezoneFromProfile(false); setSaved2(false); }}
                style={{ fontFamily: 'var(--data)', fontSize: '13px', padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: '3px', background: 'var(--paper)', color: 'var(--ink)', width: '100%', maxWidth: '320px' }}
              >
                {/* Make sure current TZ is always listed */}
                {!COMMON_TZ.includes(timezone) && (
                  <option value={timezone}>{timezone}</option>
                )}
                {COMMON_TZ.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>

            {/* Availability grid */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '480px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '100px', padding: '8px 0', textAlign: 'left', fontFamily: 'var(--data)', fontSize: '10px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--steel)' }}>
                      Block
                    </th>
                    {DAYS.map((day, dow) => (
                      <th key={dow} style={{ padding: '8px 4px', textAlign: 'center', fontFamily: 'var(--data)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--steel)' }}>
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {BLOCKS.map((block, bi) => {
                    const info = BLOCK_LABELS[block];
                    return (
                      <tr key={block} style={{ borderTop: '1px solid var(--rule)' }}>
                        <td style={{ padding: '10px 0', verticalAlign: 'middle' }}>
                          <div style={{ fontFamily: 'var(--data)', fontSize: '12px', fontWeight: 600, color: 'var(--ink)' }}>
                            {info.label}
                          </div>
                          <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', marginTop: '2px' }}>
                            {info.hours}
                          </div>
                        </td>
                        {DAYS.map((_, dow) => {
                          const k = slotKey(dow, block);
                          const on = selected.has(k);
                          return (
                            <td key={dow} style={{ padding: '8px 4px', textAlign: 'center' }}>
                              <button
                                onClick={() => toggleSlot(dow, block)}
                                aria-label={`${on ? 'Remove' : 'Add'} ${DAYS[dow]} ${info.label}`}
                                style={{
                                  width: '36px',
                                  height: '36px',
                                  borderRadius: '4px',
                                  border: on ? '2px solid var(--crease)' : '1px solid var(--rule)',
                                  background: on ? 'var(--crease)' : 'var(--paper)',
                                  cursor: 'pointer',
                                  transition: 'all 0.1s',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  margin: '0 auto',
                                }}
                              >
                                {on && (
                                  <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
                                    <path d="M1.5 5L5.5 9L12.5 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Quick select row */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
              <button
                className="btn ghost"
                onClick={() => {
                  const weeknights = new Set<SlotKey>();
                  [1,2,3,4,5].forEach(dow => {
                    weeknights.add(slotKey(dow, 'evening'));
                    weeknights.add(slotKey(dow, 'night'));
                  });
                  setSelected(weeknights);
                  setSaved2(false);
                }}
                style={{ fontSize: '11px', padding: '5px 12px' }}
              >
                Weeknight Evenings
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  const wknd = new Set<SlotKey>();
                  [0,6].forEach(dow => BLOCKS.forEach(b => wknd.add(slotKey(dow, b))));
                  [1,2,3,4,5].forEach(dow => wknd.add(slotKey(dow, 'evening')));
                  setSelected(wknd);
                  setSaved2(false);
                }}
                style={{ fontSize: '11px', padding: '5px 12px' }}
              >
                Evenings + Weekends
              </button>
              <button
                className="btn ghost"
                onClick={() => { setSelected(new Set()); setSaved2(false); }}
                style={{ fontSize: '11px', padding: '5px 12px', color: 'var(--goal)', borderColor: 'var(--goal)' }}
              >
                Clear All
              </button>
            </div>
          </div>

          {/* ── Sidebar ── */}
          <div style={{ position: 'sticky', top: '20px' }}>
            <div className="panel">
              <div className="panel-head">
                <h2>Summary</h2>
              </div>
              <div style={{ padding: '16px' }}>
                <div style={{ fontFamily: 'var(--data)', fontSize: '12px', color: 'var(--steel)', marginBottom: '12px' }}>
                  <strong style={{ fontFamily: 'var(--display)', fontSize: '28px', color: 'var(--ink)', display: 'block', lineHeight: 1 }}>
                    {selectedCount}
                  </strong>
                  availability window{selectedCount !== 1 ? 's' : ''} selected
                </div>

                {selectedCount === 0 && (
                  <div style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', lineHeight: 1.6 }}>
                    No windows selected. Your opponents won't be able to see overlap times for your games.
                  </div>
                )}

                {selectedCount > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    {BLOCKS.map(block => {
                      const days = DAYS.filter((_, dow) => selected.has(slotKey(dow, block)));
                      if (days.length === 0) return null;
                      return (
                        <div key={block} style={{ marginBottom: '8px' }}>
                          <div style={{ fontFamily: 'var(--data)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--steel)' }}>
                            {BLOCK_LABELS[block].label} ({BLOCK_LABELS[block].hours})
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--ink)', marginTop: '2px' }}>
                            {days.join(', ')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', marginBottom: '12px', lineHeight: 1.6 }}>
                  Timezone: <strong style={{ color: 'var(--ink)' }}>{timezone}</strong>
                </div>

                {error && (
                  <div style={{ background: '#FCF2F0', border: '1px solid #E5B8B1', borderRadius: '3px', padding: '8px 12px', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--goal)', marginBottom: '12px' }}>
                    {error}
                  </div>
                )}

                {saved2 && (
                  <div style={{ background: '#F1F8F4', border: '1px solid #B7D9C6', borderRadius: '3px', padding: '8px 12px', fontFamily: 'var(--data)', fontSize: '11px', color: '#1F7A4C', marginBottom: '12px' }}>
                    Availability saved!
                  </div>
                )}

                <button
                  className="btn"
                  onClick={handleSave}
                  disabled={setAvail.isPending}
                  style={{ width: '100%' }}
                >
                  {setAvail.isPending ? 'Saving…' : 'Save Availability'}
                </button>
              </div>
            </div>

            <div className="panel" style={{ marginTop: '16px' }}>
              <div className="panel-head">
                <h2>How it works</h2>
              </div>
              <div style={{ padding: '14px 16px', fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)', lineHeight: 1.7 }}>
                <p style={{ margin: '0 0 10px' }}>
                  When you and your opponent both have availability set, the Hub shows overlapping windows so you can plan your game.
                </p>
                <p style={{ margin: 0 }}>
                  Times are converted to each GM's local timezone automatically.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
