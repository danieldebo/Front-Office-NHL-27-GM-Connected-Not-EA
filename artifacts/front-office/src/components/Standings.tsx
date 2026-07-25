import { useGetStandings } from '@workspace/api-client-react';

export default function Standings({ seasonId }: { seasonId: string }) {
  const { data: standingsData, isLoading } = useGetStandings(seasonId);

  if (isLoading) {
    return (
      <section className="panel" id="standings">
        <div className="panel-head">
          <h2>Standings</h2>
          <span className="note">Loading...</span>
        </div>
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--steel)' }}>
           Loading standings...
        </div>
      </section>
    );
  }

  const rows = standingsData?.data || [];

  return (
    <section className="panel" id="standings">
      <div className="panel-head">
        <h2>League Standings</h2>
        <span className="note">
          {standingsData?.computed_at ? `Computed ${new Date(standingsData.computed_at).toLocaleDateString()}` : 'Live'}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th className="l" colSpan={2}>Club</th>
              <th>GP</th><th>W</th><th>L</th><th>OTL</th><th>PTS</th>
              <th className="hide-sm">ROW</th><th className="hide-sm">GF</th><th className="hide-sm">GA</th><th>DIFF</th>
              <th className="l">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const diff = row.DIFF ?? 0;
              const isPlayoffLine = i === 7; // after 8th place
              return (
                <tr key={row.team_season_id} className={`anim ${isPlayoffLine ? 'playoff-line' : ''}`} style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className="rank l">{row.rank ?? i + 1}</td>
                  <td className="l club">
                    {row.club_abbrev && <span className="abbr">{row.club_abbrev}</span>}
                    {row.franchise_name}
                    {row.gm_display_name && <span className="gm"> · @{row.gm_display_name}</span>}
                  </td>
                  <td>{row.GP}</td><td>{row.W}</td><td>{row.L}</td><td>{row.OTL}</td><td className="pts">{row.PTS}</td>
                  <td className="hide-sm">{row.ROW ?? 0}</td>
                  <td className="hide-sm">{row.GF ?? 0}</td>
                  <td className="hide-sm">{row.GA ?? 0}</td>
                  <td className={diff > 0 ? "pos" : diff < 0 ? "neg" : ""}>
                    {diff > 0 ? `+${diff}` : diff === 0 ? "0" : `−${Math.abs(diff)}`}
                  </td>
                  <td className="l">
                    {row.unconfirmed_games ? (
                      <span className="chip man">{row.unconfirmed_games} unconfirmed</span>
                    ) : (
                      <span className="chip conf">Confirmed</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} style={{ textAlign: 'center', padding: '30px' }}>No standings data available yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="legend">
        <span className="lbl">Source</span>
        <span className="chip conf">Confirmed</span><span className="txt">all reported results confirmed</span>
        <span className="chip man">Unconfirmed</span><span className="txt">awaiting opponent verification</span>
      </div>
    </section>
  );
}
