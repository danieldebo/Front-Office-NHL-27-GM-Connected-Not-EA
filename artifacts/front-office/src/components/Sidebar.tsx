import { useState } from 'react';
import { Link } from 'wouter';
import {
  useListSeats,
  useGetMyProfile,
  useGetCapPosition,
  useListWireTransactions,
  useGetMyCalendarFeed,
} from '@workspace/api-client-react';

function money(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 1 });
}

export default function Sidebar({ leagueId }: { leagueId?: string }) {
  const { data: seatsResponse, isLoading } = useListSeats(leagueId ?? '', {
    query: { enabled: Boolean(leagueId) } as any,
  });
  const seats = seatsResponse?.data ?? [];
  const openSeats = seats.filter(seat => !seat.gm);

  const { data: profile } = useGetMyProfile();
  const myTeam = seats.find(s => s.gm?.user_id === profile?.id);
  const { data: cap, isLoading: capLoading } = useGetCapPosition(myTeam?.team_season_id ?? '', {
    query: { enabled: Boolean(myTeam) } as any,
  });

  const { data: wireResponse, isLoading: wireLoading } = useListWireTransactions(leagueId ?? '', { limit: 5 }, {
    query: { enabled: Boolean(leagueId) } as any,
  });
  const wire = wireResponse?.data ?? [];

  const capPct = cap?.salary_cap_cents ? Math.min(100, Math.round((cap.cap_used_cents / cap.salary_cap_cents) * 100)) : 0;

  const [wantsFeed, setWantsFeed] = useState(false);
  const { data: myFeed } = useGetMyCalendarFeed(leagueId ?? '', {
    query: { enabled: Boolean(leagueId) && wantsFeed } as any,
  });

  return (
    <aside>
      {/* CAP */}
      {myTeam && (
        <section className="panel">
          <div className="panel-head"><h2>Your cap</h2><span className="note">{cap?.is_illegal ? 'Illegal' : 'Legal'}</span></div>
          {capLoading || !cap ? (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>Loading…</div>
          ) : (
            <>
              <div className="cap-row"><span>Cap hit</span><span className="v">{money(cap.cap_used_cents)}</span></div>
              <div className="cap-row"><span>Space</span><span className="v" style={{ color: cap.is_illegal ? 'var(--goal, #b3261e)' : '#1F7A4C' }}>{money(cap.cap_space_cents)}</span></div>
              <div className="cap-row" style={{ borderBottom: 0 }}><span>Roster</span><span className="v">{cap.roster_count}</span></div>
              {cap.salary_cap_cents != null && <div className="bar"><i style={{ width: `${capPct}%` }}></i></div>}
            </>
          )}
        </section>
      )}

      {/* WIRE */}
      <section className="panel" id="wire">
        <div className="panel-head"><h2>Wire</h2><span className="note">Append-only</span></div>
        {wireLoading ? (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>Loading…</div>
        ) : wire.length === 0 ? (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
            No transactions yet.
          </div>
        ) : (
          wire.map(entry => (
            <div className="matchup" key={entry.id}>
              <span className="mu-teams">{entry.summary}</span>
              <span className="mu-when">{entry.type.replace('_', ' ')}</span>
            </div>
          ))
        )}
      </section>

      {/* SEATS */}
      <section className="panel">
        <div className="panel-head">
          <h2>Open seats</h2>
          <span className="note">{isLoading ? '…' : `${openSeats.length} available`}</span>
        </div>
        {isLoading ? (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
            Loading…
          </div>
        ) : openSeats.length === 0 ? (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
            No open seats.
          </div>
        ) : (
          openSeats.slice(0, 5).map(seat => (
            <div className="matchup" key={seat.team_season_id}>
              <span className="mu-teams">{seat.club_abbrev || seat.franchise_name}</span>
              <span className="mu-when">
                {seat.seat_status === 'pending' ? 'Pending' : 'No GM assigned'}
              </span>
              {leagueId && (
                <Link href={`/leagues/${leagueId}/manage`} className="btn ghost">Review</Link>
              )}
            </div>
          ))
        )}
      </section>

      {/* CALENDAR */}
      {leagueId && (
        <section className="panel">
          <div className="panel-head"><h2>My Calendar</h2></div>
          <div style={{ padding: '14px 16px' }}>
            {!wantsFeed ? (
              <button className="btn ghost" style={{ fontSize: '11px' }} onClick={() => setWantsFeed(true)}>
                Get my calendar feed
              </button>
            ) : myFeed ? (
              <input
                readOnly
                value={myFeed.ics_url}
                onFocus={(e) => e.target.select()}
                style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: '3px', fontFamily: 'var(--data)', fontSize: '11px' }}
              />
            ) : (
              <span style={{ fontFamily: 'var(--data)', fontSize: '11px', color: 'var(--steel)' }}>Loading…</span>
            )}
          </div>
        </section>
      )}
    </aside>
  );
}
