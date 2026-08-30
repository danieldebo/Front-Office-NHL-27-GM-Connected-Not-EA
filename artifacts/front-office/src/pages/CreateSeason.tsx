import React, { useState } from 'react';
import { useLocation, useParams, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListSeasonsQueryKey,
  getListSeatsQueryKey,
  useCreateSeason,
  useGetLeague,
  useGetLeagueSettings,
} from '@workspace/api-client-react';
import Header from '@/components/Header';
import { hasSettings } from '@/components/LeagueSettings';

const DEFAULT_TIEBREAKERS = ['points', 'row', 'wins', 'goal_diff', 'goals_for'];

export default function CreateSeason() {
  const { id: leagueId } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createSeason = useCreateSeason();
  const { data: league } = useGetLeague(leagueId || '');
  const { data: settingsResponse, isLoading: settingsLoading } = useGetLeagueSettings(leagueId || '');
  const settings = hasSettings(settingsResponse) ? settingsResponse : undefined;

  const [label, setLabel] = useState('Season 1');
  const [gameTitle, setGameTitle] = useState('Hockey 27');

  const [overrideCap, setOverrideCap] = useState(false);
  const [salaryCapStr, setSalaryCapStr] = useState('');

  const [overrideRoster, setOverrideRoster] = useState(false);
  const [rosterMin, setRosterMin] = useState('20');
  const [rosterMax, setRosterMax] = useState('23');

  const [overrideGames, setOverrideGames] = useState(false);
  const [gamesPerMatchup, setGamesPerMatchup] = useState('2');

  const [overridePoints, setOverridePoints] = useState(false);
  const [pointSystem, setPointSystem] = useState<'traditional' | 'three_point'>('traditional');

  const [overrideTiebreakers, setOverrideTiebreakers] = useState(false);
  const [tiebreakers, setTiebreakers] = useState(DEFAULT_TIEBREAKERS);

  const inheritedTiebreakers = settings?.tiebreakers ?? DEFAULT_TIEBREAKERS;
  const inheritedCap = settings?.salary_cap_cents;
  const inheritedRosterMin = settings?.roster_min;
  const inheritedRosterMax = settings?.roster_max;
  const inheritedGames = settings
    ? (settings.schedule_format === 'double_round_robin' ? 2 :
       settings.schedule_format === 'round_robin' ? 1 :
       Number((settings.schedule_settings as { games_per_matchup?: number })?.games_per_matchup ?? 1))
    : undefined;
  const inheritedPoints = settings?.points_win ?? 2;

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('index', index.toString());
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    const dragIndex = parseInt(e.dataTransfer.getData('index'), 10);
    const newTb = [...tiebreakers];
    const [dragged] = newTb.splice(dragIndex, 1);
    newTb.splice(dropIndex, 0, dragged);
    setTiebreakers(newTb);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leagueId) return;

    createSeason.mutate({
      leagueId,
      data: {
        label,
        game_title: gameTitle,
        ...(overrideCap
          ? { salary_cap_cents: salaryCapStr ? Math.floor(parseFloat(salaryCapStr) * 100) : null }
          : {}),
        ...(overrideRoster
          ? { roster_min: parseInt(rosterMin, 10) || null, roster_max: parseInt(rosterMax, 10) || null }
          : {}),
        ...(overrideGames ? { games_per_matchup: parseInt(gamesPerMatchup, 10) || 1 } : {}),
        ...(overridePoints
          ? {
              points_win: pointSystem === 'three_point' ? 3 : 2,
              points_ot_loss: 1,
              points_reg_loss: 0,
            }
          : {}),
        ...(overrideTiebreakers ? { tiebreakers } : {}),
      },
    }, {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListSeasonsQueryKey(leagueId) }),
          queryClient.invalidateQueries({ queryKey: getListSeatsQueryKey(leagueId) }),
        ]);
        setLocation(`/leagues/${leagueId}/manage`);
      }
    });
  };

  return (
    <>
      <Header league={league} />
      <div className="login-page">
        <div className="login-panel" style={{ width: '100%', maxWidth: '560px', textAlign: 'left', padding: '30px' }}>
        <h1 style={{ fontSize: '24px' }}>Create Season</h1>
        <p>
          Start a new campaign for your league. Cap, roster limits, schedule length, points,
          and tiebreakers come from the league's settings unless you override them below.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Label</label>
              <input
                required
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                style={inputStyle}
                placeholder="Season 1"
              />
            </div>
            <div>
              <label style={labelStyle}>Game Title</label>
              <input
                required
                type="text"
                value={gameTitle}
                onChange={e => setGameTitle(e.target.value)}
                style={inputStyle}
                placeholder="Hockey 27"
              />
            </div>
          </div>

          <OverrideField
            label="Salary Cap"
            inherited={
              settingsLoading ? 'Loading…' :
              inheritedCap == null ? 'No cap' :
              `$${(inheritedCap / 100).toLocaleString()}`
            }
            checked={overrideCap}
            onToggle={setOverrideCap}
          >
            <input
              type="number"
              step="0.01"
              value={salaryCapStr}
              onChange={e => setSalaryCapStr(e.target.value)}
              style={inputStyle}
              placeholder="None"
            />
          </OverrideField>

          <OverrideField
            label="Roster Size"
            inherited={
              settingsLoading ? 'Loading…' :
              (inheritedRosterMin == null && inheritedRosterMax == null) ? 'No limit' :
              `${inheritedRosterMin ?? '—'}–${inheritedRosterMax ?? '—'}`
            }
            checked={overrideRoster}
            onToggle={setOverrideRoster}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={labelStyle}>Min Roster</label>
                <input type="number" value={rosterMin} onChange={e => setRosterMin(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Max Roster</label>
                <input type="number" value={rosterMax} onChange={e => setRosterMax(e.target.value)} style={inputStyle} />
              </div>
            </div>
          </OverrideField>

          <OverrideField
            label="Games per Matchup"
            inherited={settingsLoading ? 'Loading…' : String(inheritedGames ?? 1)}
            checked={overrideGames}
            onToggle={setOverrideGames}
          >
            <input
              required
              type="number"
              value={gamesPerMatchup}
              onChange={e => setGamesPerMatchup(e.target.value)}
              style={inputStyle}
              min="1"
            />
          </OverrideField>

          <OverrideField
            label="Points System"
            inherited={settingsLoading ? 'Loading…' : inheritedPoints === 3 ? '3-2-1-0 (IIHF Standard)' : '2-1-0 (Traditional)'}
            checked={overridePoints}
            onToggle={setOverridePoints}
          >
            <select
              value={pointSystem}
              onChange={e => setPointSystem(e.target.value as 'traditional' | 'three_point')}
              style={inputStyle}
            >
              <option value="traditional">2-1-0 (Traditional)</option>
              <option value="three_point">3-2-1-0 (IIHF Standard)</option>
            </select>
          </OverrideField>

          <OverrideField
            label="Tiebreaker Order"
            inherited={settingsLoading ? 'Loading…' : inheritedTiebreakers.map(t => t.toUpperCase()).join(' › ')}
            checked={overrideTiebreakers}
            onToggle={(checked) => {
              setOverrideTiebreakers(checked);
              if (checked) setTiebreakers(inheritedTiebreakers);
            }}
          >
            <div style={{ border: '1px solid var(--rule)', borderRadius: '3px', background: '#FAFCFD' }}>
              {tiebreakers.map((tb, idx) => (
                <div
                  key={tb}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, idx)}
                  style={{
                    padding: '8px 12px',
                    borderBottom: idx < tiebreakers.length - 1 ? '1px solid var(--rule)' : 'none',
                    fontFamily: 'var(--data)',
                    fontSize: '12px',
                    cursor: 'grab',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    backgroundColor: 'var(--paper)'
                  }}
                >
                  <span style={{ color: 'var(--steel)' }}>⋮</span>
                  <span style={{ fontWeight: 600 }}>{idx + 1}.</span>
                  {tb.toUpperCase()}
                </div>
              ))}
            </div>
          </OverrideField>

          <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
            <button
              type="submit"
              className="btn"
              style={{ flex: 1, padding: '12px' }}
              disabled={createSeason.isPending}
            >
              {createSeason.isPending ? 'Creating...' : 'Create Season'}
            </button>
            <Link href={`/leagues/${leagueId}/manage`} className="btn ghost" style={{ padding: '12px' }}>
              Cancel
            </Link>
          </div>
          {createSeason.isError && (
            <p role="alert" style={{ margin: 0, color: 'var(--goal)', fontSize: '13px' }}>
              {createSeason.error.message}
            </p>
          )}
        </form>
        </div>
      </div>
    </>
  );
}

function OverrideField({
  label,
  inherited,
  checked,
  onToggle,
  children,
}: {
  label: string;
  inherited: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--steel)', cursor: 'pointer' }}>
          <input type="checkbox" checked={checked} onChange={e => onToggle(e.target.checked)} />
          Override for this season
        </label>
      </div>
      {checked ? (
        children
      ) : (
        <div style={{ ...inputStyle, background: 'var(--fog, #F2F5F7)', color: 'var(--steel)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>{inherited}</span>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', border: '1px solid var(--rule)', borderRadius: '3px', padding: '1px 6px' }}>
            Inherited
          </span>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--data)',
  fontSize: '11px',
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: 'var(--steel)',
  marginBottom: '6px'
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontFamily: 'var(--body)',
  fontSize: '14px',
  border: '1px solid var(--rule)',
  borderRadius: '3px',
  background: '#FAFCFD',
  color: 'var(--ink)'
};
