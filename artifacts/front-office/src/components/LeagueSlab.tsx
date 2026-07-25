import { LeagueHub } from '@workspace/api-client-react';
import Countdown from './Countdown';

export default function LeagueSlab({ hub, isLoading }: { hub?: LeagueHub, isLoading: boolean }) {
  if (isLoading) {
    return (
      <section className="slab">
        <div className="wrap" style={{ minHeight: '200px' }}></div>
      </section>
    );
  }

  if (!hub) return null;

  return (
    <section className="slab">
      <div className="wrap">
        <div>
          <div className="eyebrow">{hub.active_season_label || 'Offseason'}</div>
          <h1>{hub.games_scheduled ? 'Games pending' : 'All clear'}</h1>
          <p className="sub">
            {hub.games_scheduled ? `${hub.games_scheduled} games scheduled this week across the league.` : 'No action required right now.'}
          </p>
          <Countdown closesAt={new Date(Date.now() + 86400000 * 3).toISOString()} />
        </div>

        <div className="slab-right">
          <div className="stat-cell">
            <div className="k">{hub.games_on_time_pct !== undefined && hub.games_on_time_pct !== null ? `${Math.round(hub.games_on_time_pct * 100)}%` : '--'}</div>
            <div className="l">Games on time</div>
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
