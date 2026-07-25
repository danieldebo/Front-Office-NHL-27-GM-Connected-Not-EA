import { Game } from '@workspace/api-client-react';
import { useReportResult, useConfirmResult } from '@workspace/api-client-react';

export default function MyWeek({ games, isLoading }: { games: Game[], isLoading: boolean }) {
  const reportMut = useReportResult();
  const confirmMut = useConfirmResult();

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Your week</h2>
        <span className="note">Window closes Sun 11:59 PM CT</span>
      </div>
      {isLoading ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--steel)', fontSize: '13px' }}>
          Loading...
        </div>
      ) : games.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--steel)', fontSize: '13px' }}>
          No games scheduled for you this week.
        </div>
      ) : (
        games.map((game, i) => {
          const home = game.home.club_abbrev || game.home.franchise_name || 'Home';
          const away = game.away.club_abbrev || game.away.franchise_name || 'Away';
          
          return (
            <div key={game.id} className="matchup anim" style={{ animationDelay: `${i * 0.04}s` }}>
              <span className="mu-teams">{away} @ {home}</span>
              <span className="mu-when">
                {game.status === 'scheduled' && (game.window_closes_at ? `Unplayed · Window closes ${new Date(game.window_closes_at).toLocaleDateString()}` : 'Unplayed · schedule pending')}
                {game.status === 'in_window' && 'Unplayed · ready to play'}
                {game.status === 'reported' && (
                  <><span className="score">{game.result?.away_goals}–{game.result?.home_goals} {game.result?.decision === 'overtime' ? 'OT' : ''}</span> <span className="hide-sm">· awaiting confirmation</span></>
                )}
                {game.status === 'confirmed' && (
                   <><span className="score">{game.result?.away_goals}–{game.result?.home_goals}</span> <span className="hide-sm">· confirmed</span></>
                )}
              </span>
              {game.status === 'reported' && <span className="chip man">Reported</span>}
              {game.status === 'confirmed' && <span className="chip conf">Confirmed</span>}
              
              {(game.status === 'scheduled' || game.status === 'in_window') && (
                <button 
                  className="btn" 
                  onClick={() => alert('TODO: wire up report result mutation')}
                  disabled={reportMut.isPending}
                >
                  Report
                </button>
              )}
              {game.status === 'reported' && (
                <button 
                  className="btn ghost" 
                  onClick={() => alert('TODO: wire up confirm result mutation')}
                  disabled={confirmMut.isPending}
                >
                  Confirm
                </button>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
