import { useGetMyLeagues, useGetLeagueHub, League } from '@workspace/api-client-react';
import { Link } from 'wouter';
import Header from '@/components/Header';
import LeagueSlab from '@/components/LeagueSlab';
import MyWeek from '@/components/MyWeek';
import Standings from '@/components/Standings';
import Sidebar from '@/components/Sidebar';
import { useSetupChecklist } from '@/hooks/useSetupChecklist';
import { useActiveLeagueId } from '@/components/LeagueSwitcher';

function LeagueDashboard({ league }: { league: League }) {
  const { data: hub, isLoading } = useGetLeagueHub(league.id);
  const setup = useSetupChecklist(league.id);

  return (
    <>
      <LeagueSlab hub={hub} isLoading={isLoading} setup={setup.isLoading ? undefined : setup} />
      <div className="wrap">
        <div className="cols">
          <main>
            <MyWeek games={hub?.my_games_this_week || []} isLoading={isLoading} />
            {hub?.active_season_id ? (
              <Standings seasonId={hub.active_season_id} />
            ) : (
              <section className="panel" id="standings">
                <div className="panel-head"><h2>Standings</h2></div>
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--steel)' }}>No active season.</div>
              </section>
            )}
          </main>
          <Sidebar leagueId={league.id} />
        </div>
      </div>
    </>
  );
}

export default function Hub() {
  const { data: leaguesResponse, isLoading } = useGetMyLeagues();
  const leagues = leaguesResponse?.data || [];

  const storedLeagueId = useActiveLeagueId();
  const activeLeague = leagues.find((l) => l.id === storedLeagueId) ?? leagues[0];

  if (isLoading) return <div className="loading-screen">Loading Front Office...</div>;

  return (
    <>
      <Header league={activeLeague} />
      {activeLeague ? (
        <LeagueDashboard league={activeLeague} />
      ) : (
        <div className="wrap">
          <div className="empty-state">
            <h2>Welcome to Front Office</h2>
            <p style={{color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '.1em'}}>You aren't in any leagues yet.</p>
            <div style={{ marginTop: '20px' }}>
              <Link href="/leagues/new" className="btn">Create League</Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
