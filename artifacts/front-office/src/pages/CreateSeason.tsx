import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useParams, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListSeasonsQueryKey,
  getListSeatsQueryKey,
  useCreateSeason,
  useGetLeague,
  useGetLeagueSettings,
  useListLeagueSettingsTemplates,
  useListSeasons,
  type CreateSeasonInput,
  type LeagueSettingsTemplate,
} from '@workspace/api-client-react';
import Header from '@/components/Header';
import { activeSettingsFromResponse, TemplatePicker } from '@/components/LeagueSettings';

type OverrideKey = 'salary' | 'rosterMin' | 'rosterMax' | 'games' | 'points' | 'tiebreakers';
const ALL_OVERRIDES: OverrideKey[] = ['salary', 'rosterMin', 'rosterMax', 'games', 'points', 'tiebreakers'];

function SeasonField({
  label, inherited, overridden, onOverride, children,
}: {
  label: string; inherited: boolean; overridden: boolean; onOverride: (enabled: boolean) => void; children: React.ReactNode;
}) {
  return (
    <div style={{ padding: 12, border: `1px solid ${overridden ? 'var(--bulb)' : 'var(--rule)'}`, borderRadius: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 7 }}>
        <label style={labelStyle}>{label}</label>
        {overridden && <span className="chip man">Season override</span>}
      </div>
      {children}
      {inherited && (
        <label style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 7, fontFamily: 'var(--data)', fontSize: 10, color: 'var(--steel)' }}>
          <input type="checkbox" checked={overridden} onChange={event => onOverride(event.target.checked)} />
          {overridden ? 'Override for this season' : 'Inherited from league settings — override for this season'}
        </label>
      )}
    </div>
  );
}

export default function CreateSeason() {
  const { id: leagueId } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createSeason = useCreateSeason();
  const { data: league } = useGetLeague(leagueId || '');
  const { data: settingsResponse } = useGetLeagueSettings(leagueId || '');
  const { data: templatesData } = useListLeagueSettingsTemplates();
  const { data: seasonsData } = useListSeasons(leagueId || '');
  const settings = activeSettingsFromResponse(settingsResponse);
  const initialized = useRef<string | null>(null);

  const nextOrdinal = Math.max(0, ...(seasonsData?.data ?? []).map(season => season.ordinal)) + 1;
  const [label, setLabel] = useState('');
  const [gameTitle, setGameTitle] = useState('Hockey 27');
  const [salaryDollars, setSalaryDollars] = useState('');
  const [rosterMin, setRosterMin] = useState('');
  const [rosterMax, setRosterMax] = useState('');
  const [games, setGames] = useState('');
  const [pointSystem, setPointSystem] = useState<'traditional' | 'three_point'>('traditional');
  const [tiebreakers, setTiebreakers] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Set<OverrideKey>>(new Set());

  useEffect(() => {
    if (!label && seasonsData) setLabel(`Season ${nextOrdinal}`);
  }, [label, nextOrdinal, seasonsData]);

  useEffect(() => {
    if (!settings || initialized.current === settings.id) return;
    initialized.current = settings.id;
    if (settings.use_league_defaults) {
      setSalaryDollars(settings.salary_cap_cents == null ? '' : String(settings.salary_cap_cents / 100));
      setRosterMin(settings.roster_min == null ? '' : String(settings.roster_min));
      setRosterMax(settings.roster_max == null ? '' : String(settings.roster_max));
      setGames(String(settings.schedule_settings.games_per_matchup ?? 2));
      setPointSystem(settings.points_win === 3 ? 'three_point' : 'traditional');
      setTiebreakers(settings.tiebreakers);
      setOverrides(new Set());
    } else {
      setSalaryDollars(''); setRosterMin(''); setRosterMax(''); setGames('');
      setTiebreakers([]); setOverrides(new Set(ALL_OVERRIDES));
    }
  }, [settings]);

  const inherited = Boolean(settings?.use_league_defaults);
  const isOverridden = (key: OverrideKey) => overrides.has(key);
  const toggleOverride = (key: OverrideKey, enabled: boolean) => setOverrides(previous => {
    const next = new Set(previous);
    if (enabled) next.add(key); else next.delete(key);
    return next;
  });
  const disabled = (key: OverrideKey) => inherited && !isOverridden(key);

  const applyTemplate = (template: LeagueSettingsTemplate) => {
    const values = template.values;
    setSalaryDollars(values.salary_cap_cents == null ? '' : String(values.salary_cap_cents / 100));
    setRosterMin(values.roster_min == null ? '' : String(values.roster_min));
    setRosterMax(values.roster_max == null ? '' : String(values.roster_max));
    setGames(String(values.schedule_settings.games_per_matchup ?? 2));
    setPointSystem(values.points_win === 3 ? 'three_point' : 'traditional');
    setTiebreakers(values.tiebreakers);
    setOverrides(new Set(ALL_OVERRIDES));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!leagueId || !settings) return;
    const data: CreateSeasonInput = { label, game_title: gameTitle };
    if (isOverridden('salary')) data.salary_cap_cents = salaryDollars === '' ? null : Math.round(Number(salaryDollars) * 100);
    if (isOverridden('rosterMin')) data.roster_min = Number(rosterMin);
    if (isOverridden('rosterMax')) data.roster_max = Number(rosterMax);
    if (isOverridden('games')) data.games_per_matchup = Number(games);
    if (isOverridden('points')) {
      data.points_win = pointSystem === 'three_point' ? 3 : 2;
      data.points_ot_loss = 1;
      data.points_reg_loss = 0;
    }
    if (isOverridden('tiebreakers')) data.tiebreakers = tiebreakers;
    createSeason.mutate({ leagueId, data }, {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListSeasonsQueryKey(leagueId) }),
          queryClient.invalidateQueries({ queryKey: getListSeatsQueryKey(leagueId) }),
        ]);
        setLocation(`/leagues/${leagueId}/manage`);
      },
    });
  };

  return (
    <>
      <Header league={league} />
      <div className="login-page">
        <div className="login-panel" style={{ width: '100%', maxWidth: 680, textAlign: 'left', padding: 30 }}>
          <h1 style={{ fontSize: 24 }}>Create Season</h1>
          <p>{inherited ? `Prefilled from league settings version ${settings?.version}.` : 'League defaults are off. Choose a template, then customize this season.'}</p>
          {!inherited && <TemplatePicker templates={templatesData?.data ?? []} confirmApply={false} onApply={applyTemplate} />}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div><label style={labelStyle}>Label</label><input required value={label} onChange={event => setLabel(event.target.value)} style={inputStyle} placeholder={`Season ${nextOrdinal}`} /></div>
              <div><label style={labelStyle}>Game Title</label><input required value={gameTitle} onChange={event => setGameTitle(event.target.value)} style={inputStyle} placeholder="Hockey 27" /></div>
            </div>
            <SeasonField label="Salary Cap ($)" inherited={inherited} overridden={isOverridden('salary')} onOverride={enabled => toggleOverride('salary', enabled)}>
              <input type="number" min={0} disabled={disabled('salary')} value={salaryDollars} onChange={event => setSalaryDollars(event.target.value)} style={inputStyle} placeholder="No cap" />
            </SeasonField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <SeasonField label="Min Roster" inherited={inherited} overridden={isOverridden('rosterMin')} onOverride={enabled => toggleOverride('rosterMin', enabled)}>
                <input required type="number" min={1} disabled={disabled('rosterMin')} value={rosterMin} onChange={event => setRosterMin(event.target.value)} style={inputStyle} />
              </SeasonField>
              <SeasonField label="Max Roster" inherited={inherited} overridden={isOverridden('rosterMax')} onOverride={enabled => toggleOverride('rosterMax', enabled)}>
                <input required type="number" min={1} disabled={disabled('rosterMax')} value={rosterMax} onChange={event => setRosterMax(event.target.value)} style={inputStyle} />
              </SeasonField>
            </div>
            <SeasonField label="Games per Matchup" inherited={inherited} overridden={isOverridden('games')} onOverride={enabled => toggleOverride('games', enabled)}>
              <input required type="number" min={1} max={8} disabled={disabled('games')} value={games} onChange={event => setGames(event.target.value)} style={inputStyle} />
            </SeasonField>
            <SeasonField label="Points System" inherited={inherited} overridden={isOverridden('points')} onOverride={enabled => toggleOverride('points', enabled)}>
              <select disabled={disabled('points')} value={pointSystem} onChange={event => setPointSystem(event.target.value as 'traditional' | 'three_point')} style={inputStyle}>
                <option value="traditional">2-1-0 (Traditional)</option><option value="three_point">3-1-0 (Three-point win)</option>
              </select>
            </SeasonField>
            <SeasonField label="Tiebreaker Order" inherited={inherited} overridden={isOverridden('tiebreakers')} onOverride={enabled => toggleOverride('tiebreakers', enabled)}>
              <input required disabled={disabled('tiebreakers')} value={tiebreakers.join(', ')} onChange={event => setTiebreakers(event.target.value.split(',').map(value => value.trim()).filter(Boolean))} style={inputStyle} placeholder="points, rw, row, wins, diff, gf" />
            </SeasonField>
            <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
              <button type="submit" className="btn" style={{ flex: 1, padding: 12 }} disabled={createSeason.isPending || !settings || (!inherited && tiebreakers.length === 0)}>
                {createSeason.isPending ? 'Creating…' : 'Create Season'}
              </button>
              <Link href={`/leagues/${leagueId}/manage`} className="btn ghost" style={{ padding: 12 }}>Cancel</Link>
            </div>
            {createSeason.isError && <p role="alert" style={{ margin: 0, color: 'var(--goal)', fontSize: 13 }}>{createSeason.error.message}</p>}
          </form>
        </div>
      </div>
    </>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontFamily: 'var(--data)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--steel)', marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--rule)', borderRadius: 3, fontFamily: 'var(--data)', fontSize: 13, background: '#fff', color: 'var(--ink)' };