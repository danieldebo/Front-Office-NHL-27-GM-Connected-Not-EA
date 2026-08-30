import { Link } from 'wouter';
import { useListSeats } from '@workspace/api-client-react';

export default function Sidebar({ leagueId }: { leagueId?: string }) {
  const { data: seatsResponse, isLoading } = useListSeats(leagueId ?? '', {
    query: { enabled: Boolean(leagueId) } as any,
  });
  const seats = seatsResponse?.data ?? [];
  const openSeats = seats.filter(seat => !seat.gm);

  return (
    <aside>
      {/* CAP */}
      <section className="panel">
        <div className="panel-head"><h2>Your cap</h2><span className="note">Legal</span></div>
        <div className="cap-row"><span>Cap hit</span><span className="v">$81.4M</span></div>
        <div className="cap-row"><span>Space</span><span className="v" style={{ color: '#1F7A4C' }}>$7.1M</span></div>
        <div className="cap-row"><span>Roster</span><span className="v">22 / 23</span></div>
        <div className="cap-row" style={{ borderBottom: 0 }}><span>Expiring</span><span className="v">4</span></div>
        <div className="bar"><i style={{ width: '92%' }}></i></div>
      </section>

      {/* WIRE */}
      <section className="panel" id="wire">
        <div className="panel-head"><h2>Wire</h2><span className="note">Append-only</span></div>
        <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
          No transactions yet.
        </div>
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
    </aside>
  );
}
