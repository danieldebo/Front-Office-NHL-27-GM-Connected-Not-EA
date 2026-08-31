import { Link } from 'wouter';
import type { OpenSeatDetail, Transaction } from '@workspace/api-client-react';

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function transactionLabel(type: Transaction['type']) {
  return type.replaceAll('_', ' ');
}

function seatDescription(seat: OpenSeatDetail) {
  const state = seat.state === 'never_filled'
    ? 'Never filled'
    : seat.state === 'inactive'
      ? 'Inactive'
      : 'Vacated';
  const applicants = `${seat.applicant_count} applicant${seat.applicant_count === 1 ? '' : 's'}`;
  return `${state} · ${applicants}`;
}

export default function Sidebar({
  leagueId,
  wire,
  openSeats,
  isLoading,
  isError,
}: {
  leagueId: string;
  wire: Transaction[];
  openSeats: OpenSeatDetail[];
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <aside>
      <section className="panel" id="wire">
        <div className="panel-head"><h2>Wire</h2><span className="note">Append-only</span></div>
        {isLoading ? (
          <div className="hub-activity-empty">Loading transactions…</div>
        ) : isError ? (
          <div className="hub-activity-empty">Transactions could not be loaded.</div>
        ) : wire.length === 0 ? (
          <div className="hub-activity-empty">No transactions yet.</div>
        ) : wire.map((transaction, index) => (
          <div className="wire-item anim" style={{ animationDelay: `${index * 0.03}s` }} key={transaction.id}>
            <div className="wire-head">
              <span className={`wire-type ${transaction.type}`}>{transactionLabel(transaction.type)}</span>
              <span className="wire-time">{relativeTime(transaction.proposed_at)}</span>
            </div>
            <div className="wire-body">{transaction.summary}</div>
            <div className="wire-foot">
              {transaction.status.replaceAll('_', ' ')}
              {' · '}
              {transaction.approved_by
                ? `Approved by ${transaction.approved_by}`
                : transaction.provenance === 'commissioner'
                  ? 'Commissioner entry'
                  : 'GM entry'}
              {' · '}
              {transaction.cap_checked ? 'Cap checked' : 'Cap check pending'}
            </div>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Open seats</h2>
          <span className="note">{isLoading ? 'Loading' : `${openSeats.length} available`}</span>
        </div>
        {isLoading ? (
          <div className="hub-activity-empty">Loading open seats…</div>
        ) : isError ? (
          <div className="hub-activity-empty">Open seats could not be loaded.</div>
        ) : openSeats.length === 0 ? (
          <div className="hub-activity-empty">No open seats.</div>
        ) : openSeats.map((seat) => (
          <div className="matchup" key={seat.team_season_id}>
            <span className="mu-teams">{seat.franchise_name || 'Unnamed franchise'}</span>
            <span className="mu-when">{seatDescription(seat)}</span>
            <Link
              href={`/leagues/${leagueId}/manage?tab=applicants&seat=${seat.team_season_id}`}
              className="btn ghost"
            >
              Review
            </Link>
          </div>
        ))}
      </section>
    </aside>
  );
}