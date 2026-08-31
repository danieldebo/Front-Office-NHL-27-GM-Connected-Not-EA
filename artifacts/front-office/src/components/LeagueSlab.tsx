import { LeagueHub } from '@workspace/api-client-react';
import Countdown from './Countdown';

function slabCopy(hub: LeagueHub): { eyebrow: string; h1: string; sub: string } {
  const myGames = hub.my_games_this_week ?? [];
  const pending  = myGames.filter(g => g.status === 'scheduled' || g.status === 'in_window');
  const disputed = myGames.filter(g => g.status === 'disputed');
  const reported = myGames.filter(g => g.status === 'reported');

  const label = hub.active_season_label ?? 'Offseason';

  // Find the soonest closing window for the eyebrow
  const soonestClose = myGames
    .map(g => g.window_closes_at)
    .filter(Boolean)
    .sort()[0];
  const eyebrow = soonestClose
    ? `${label} · Window closes ${new Date(soonestClose).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`
    : label;

  if (disputed.length > 0) {
    return {
      eyebrow,
      h1: disputed.length === 1 ? 'A result\nis disputed.' : `${disputed.length} results\nare disputed.`,
      sub: 'The commissioner will review and resolve the dispute.',
    };
  }

  if (pending.length > 0) {
    const n = pending.length;
    return {
      eyebrow,
      h1: n === 1 ? 'You owe\none game.' : `You owe\n${n} games.`,
      sub: pending.length === 1
        ? 'Schedule and play your remaining game before the window closes.'
        : `Schedule and play all ${n} remaining games before the window closes.`,
    };
  }

  if (reported.length > 0) {
    return {
      eyebrow,
      h1: 'Awaiting\nconfirmation.',
      sub: reported.length === 1
        ? 'Your opponent needs to confirm the reported result.'
        : `${reported.length} results are waiting on your opponents.`,
    };
  }

  // No action needed
  if (!hub.active_season_id) {
    return { eyebrow: 'Offseason', h1: 'No active\nseason.', sub: 'The commissioner will open the next season soon.' };
  }

  return {
    eyebrow,
    h1: 'All clear.',
    sub: 'No action required this week. Nice work.',
  };
}

export default function LeagueSlab({
  hub,
  isLoading,
}: {
  hub?: LeagueHub;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <section className="slab">
        <div className="wrap" style={{ minHeight: '220px' }} />
      </section>
    );
  }

  if (!hub) return null;

  const copy = slabCopy(hub);

  // Find the soonest window close for the countdown
  const soonestClose = (hub.my_games_this_week ?? [])
    .map(g => g.window_closes_at)
    .filter(Boolean)
    .sort()[0];

  return (
    <section className="slab">
      <div className="wrap">
        <div>
          <div className="eyebrow">{copy.eyebrow}</div>
          <h1 style={{ whiteSpace: 'pre-line' }}>{copy.h1}</h1>
          <p className="sub">{copy.sub}</p>
          {soonestClose && <Countdown closesAt={soonestClose} />}
        </div>

        <div className="slab-right">
          <div className="stat-cell">
            <div className="k">
              {hub.games_on_time_pct !== undefined && hub.games_on_time_pct !== null
                ? `${Math.round(hub.games_on_time_pct * 100)}%`
                : '—'}
            </div>
            <div className="l">On time</div>
          </div>
          <div className={`stat-cell ${hub.open_seats && hub.open_seats > 0 ? 'alert' : ''}`}>
            <div className="k">{hub.open_seats ?? 0}</div>
            <div className="l">Open seats</div>
          </div>
          <div className="stat-cell">
            <div className="k">{hub.active_gms ?? 0}</div>
            <div className="l">Active GMs</div>
          </div>
        </div>
      </div>
    </section>
  );
}
