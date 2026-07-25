/**
 * My Week — shows a GM's games in the current window.
 * Report / Confirm / Dispute buttons navigate to dedicated pages.
 */
import { useLocation } from 'wouter';
import { Game } from '@workspace/api-client-react';

function statusChip(status: string) {
  switch (status) {
    case 'reported':  return <span className="chip man">Reported</span>;
    case 'confirmed': return <span className="chip conf">Confirmed</span>;
    case 'disputed':  return <span className="chip ea" style={{ background: '#B33A2B', color: '#fff' }}>Disputed</span>;
    case 'forfeited': return <span className="chip ea">Forfeited</span>;
    default:          return null;
  }
}

export default function MyWeek({ games, isLoading }: { games: Game[]; isLoading: boolean }) {
  const [, navigate] = useLocation();

  return (
    <section className="panel" aria-label="Your week">
      <div className="panel-head">
        <h2>Your week</h2>
      </div>

      {isLoading ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--steel)', fontSize: '13px' }}>
          Loading…
        </div>
      ) : games.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--steel)', fontSize: '13px' }}>
          No games scheduled for you this week.
        </div>
      ) : (
        games.map((game, i) => {
          const home = game.home.club_abbrev ?? game.home.franchise_name ?? 'Home';
          const away = game.away.club_abbrev ?? game.away.franchise_name ?? 'Away';
          const result = game.result;

          const scoreStr = result
            ? `${result.away_goals}–${result.home_goals}${
                result.decision === 'overtime' ? ' OT'
                : result.decision === 'shootout' ? ' SO'
                : ''
              }`
            : null;

          return (
            <div
              key={game.id}
              className="matchup anim"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <span className="mu-teams">{away} @ {home}</span>

              <span className="mu-when">
                {(game.status === 'scheduled' || game.status === 'in_window') && (
                  game.window_closes_at
                    ? `Window closes ${new Date(game.window_closes_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                    : 'Schedule pending'
                )}
                {game.status === 'reported' && scoreStr && (
                  <><span className="score">{scoreStr}</span> <span className="hide-sm">· awaiting confirmation</span></>
                )}
                {game.status === 'confirmed' && scoreStr && (
                  <><span className="score">{scoreStr}</span> <span className="hide-sm">· confirmed</span></>
                )}
                {game.status === 'disputed' && scoreStr && (
                  <><span className="score">{scoreStr}</span> <span className="hide-sm">· disputed</span></>
                )}
              </span>

              {statusChip(game.status)}

              {/* Report: navigate to the score entry page */}
              {(game.status === 'scheduled' || game.status === 'in_window') && (
                <button
                  className="btn"
                  onClick={() => navigate(`/games/${game.id}/report`)}
                  style={{ flexShrink: 0 }}
                >
                  Report
                </button>
              )}

              {/* Correct: only on reported/disputed; reporter can submit a correction */}
              {(game.status === 'reported' || game.status === 'disputed') && result && (
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  {/* Confirm — opposing GM */}
                  {game.status === 'reported' && (
                    <button
                      className="btn ghost"
                      onClick={() => navigate(`/results/${result.id}/confirm?gameId=${game.id}`)}
                    >
                      Confirm
                    </button>
                  )}
                  {/* Correct — either GM can submit a correction */}
                  <button
                    className="btn ghost"
                    style={{ fontSize: '11px', padding: '6px 10px' }}
                    onClick={() => navigate(`/games/${game.id}/report`)}
                    title="Submit a correction"
                  >
                    Correct
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
