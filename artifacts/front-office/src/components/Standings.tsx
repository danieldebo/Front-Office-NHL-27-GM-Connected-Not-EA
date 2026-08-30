import { useGetStandings, StandingsRow } from '@workspace/api-client-react';
import { gmIdentityLabel } from '@/components/gmIdentity';

type IdentityStandingsRow = StandingsRow & {
  gm_primary_identity?: string | null;
  gm_platform?: string | null;
  gm_gamertag?: string | null;
};

type ProvenanceChip = 'conf' | 'man' | 'ocr' | 'ea' | 'dispute';

function provenanceChip(row: StandingsRow): { cls: ProvenanceChip; label: string } | null {
  if ((row.GP ?? 0) === 0 && !row.provenance) return null; // no games played — nothing to attribute a source to
  const p = row.provenance ?? (row.unconfirmed_games ? 'manual' : 'confirmed');
  switch (p) {
    case 'dispute':    return { cls: 'dispute', label: 'Disputed' };
    case 'manual':     return { cls: 'man',     label: `${row.unconfirmed_games ?? 1} unconfirmed` };
    case 'ocr':        return { cls: 'ocr',     label: 'Screenshot' };
    case 'reconciled': return { cls: 'ea',      label: 'Reconciled' };
    default:           return { cls: 'conf',    label: 'Confirmed' };
  }
}

function StandingsTable({
  rows,
  computedAt,
}: {
  rows: StandingsRow[];
  computedAt?: string | null;
}) {
  // v_standings returns one row per team_season regardless of whether any
  // game has been played — an empty season is 32 rows of zeroes, not zero
  // rows. The real "nothing to show yet" signal is no confirmed games
  // anywhere, not an empty array.
  const hasAnyGamePlayed = rows.some(row => (row.GP ?? 0) > 0);

  return (
    <section className="panel" id="standings">
      <div className="panel-head">
        <h2>Standings</h2>
        <span className="note">
          {computedAt
            ? `Computed from confirmed results · ${new Date(computedAt).toLocaleDateString()}`
            : 'Live'}
        </span>
      </div>
      {!hasAnyGamePlayed ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--steel)' }}>
          No standings data yet — games need to be confirmed.
        </div>
      ) : (
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th className="l" colSpan={2}>Club</th>
              <th>GP</th><th>W</th><th>L</th><th>OTL</th><th>PTS</th>
              <th className="hide-sm">ROW</th>
              <th className="hide-sm">GF</th>
              <th className="hide-sm">GA</th>
              <th>DIFF</th>
              <th className="l">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const identityRow = row as IdentityStandingsRow;
              const diff = row.DIFF ?? 0;
              // 8th place is the playoff cutline (top-8 format)
              const isPlayoffLine = i === 7;
              const chip = provenanceChip(row);

              return (
                <tr
                  key={row.team_season_id}
                  className={`anim ${isPlayoffLine ? 'playoff-line' : ''}`}
                  style={{ animationDelay: `${i * 0.03}s` }}
                >
                  <td className="rank l">{row.rank ?? i + 1}</td>
                  <td className="l club">
                    {row.club_abbrev && (
                      <span className="abbr">{row.club_abbrev}</span>
                    )}
                    {row.franchise_name}
                    {row.gm_display_name && (
                      <span className="gm"> · @{row.gm_display_name}{gmIdentityLabel(identityRow) ? ` · ${gmIdentityLabel(identityRow)}` : ''}</span>
                    )}
                    {!row.gm_display_name && gmIdentityLabel(identityRow) && (
                      <span className="gm"> · {gmIdentityLabel(identityRow)}</span>
                    )}
                  </td>
                  <td>{row.GP}</td>
                  <td>{row.W}</td>
                  <td>{row.L}</td>
                  <td>{row.OTL}</td>
                  <td className="pts">{row.PTS}</td>
                  <td className="hide-sm">{row.ROW ?? 0}</td>
                  <td className="hide-sm">{row.GF ?? 0}</td>
                  <td className="hide-sm">{row.GA ?? 0}</td>
                  <td className={diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}>
                    {diff > 0 ? `+${diff}` : diff === 0 ? '±0' : `−${Math.abs(diff)}`}
                  </td>
                  <td className="l">
                    {chip && <span className={`chip ${chip.cls}`}>{chip.label}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      <div className="legend">
        <span className="lbl">Source</span>
        <span className="chip conf">Confirmed</span>
        <span className="txt">both GMs agreed</span>
        <span className="chip man">Unconfirmed</span>
        <span className="txt">awaiting verification</span>
        <span className="chip ocr">Screenshot</span>
        <span className="txt">OCR-parsed</span>
        <span className="chip ea">Reconciled</span>
        <span className="txt">partner feed</span>
        <span className="chip dispute">Disputed</span>
        <span className="txt">under review</span>
      </div>
    </section>
  );
}

// Fetching wrapper — used by the authenticated Hub page
export default function Standings({ seasonId }: { seasonId: string }) {
  const { data, isLoading } = useGetStandings(seasonId);

  if (isLoading) {
    return (
      <section className="panel" id="standings">
        <div className="panel-head">
          <h2>Standings</h2>
          <span className="note">Loading…</span>
        </div>
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--steel)' }}>
          Loading standings…
        </div>
      </section>
    );
  }

  return (
    <StandingsTable
      rows={data?.data ?? []}
      computedAt={data?.computed_at}
    />
  );
}

// Pre-fetched variant — used by the public league page
export { StandingsTable };
