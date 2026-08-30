import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateLeagueSettingsVersion,
  useGetLeagueSettings,
  useListLeagueSettingsHistory,
  useListLeagueSettingsTemplates,
  useListSeasons,
  type LeagueSettingsInput,
  type LeagueSettingsTemplate,
  type LeagueSettingsVersion,
  type NoLeagueSettingsYet,
} from '@workspace/api-client-react';

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 10px',
  border: '1px solid var(--rule)',
  borderRadius: '3px',
  fontFamily: 'var(--data)',
  fontSize: '12px',
  background: '#fff',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px',
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0 }}>
      <span style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</span>
      {children}
      {hint && <small style={{ color: 'var(--steel)', fontFamily: 'var(--body)', lineHeight: 1.4 }}>{hint}</small>}
    </label>
  );
}

export function hasSettings(value: LeagueSettingsVersion | NoLeagueSettingsYet | undefined): value is LeagueSettingsVersion {
  return Boolean(value && 'id' in value);
}

const pretty = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
const list = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);

type PlayoffFields = { teams: number; series_length: 1 | 3 | 5 | 7; reseed_each_round: boolean };
type SliderFields = { gameplay_preset: 'simulation' | 'competitive' | 'arcade'; contact: 'reduced' | 'standard' | 'heavy'; fighting: 'off' | 'standard' | 'heavy' };

const DEFAULT_TIEBREAKERS = ['points', 'row', 'wins', 'goal_diff', 'goals_for'];
const DEFAULT_PLAYOFF: PlayoffFields = { teams: 16, series_length: 7, reseed_each_round: false };
const DEFAULT_SLIDERS: SliderFields = { gameplay_preset: 'competitive', contact: 'standard', fighting: 'standard' };

const emptySettings: LeagueSettingsInput = {
  platform: 'crossplay',
  team_count: 32,
  roster_source: 'ea',
  schedule_format: 'round_robin',
  schedule_settings: { games_per_matchup: 2, week_duration_days: 7 },
  playoff_format: DEFAULT_PLAYOFF,
  salary_cap_cents: 10_400_000_000,
  roster_min: 20,
  roster_max: 23,
  divisions: ['Atlantic', 'Metropolitan', 'Central', 'Pacific'],
  conferences: ['Eastern', 'Western'],
  rules_notes: null,
  slider_presets: DEFAULT_SLIDERS,
  require_verified_identities: false,
  points_win: 2,
  points_ot_loss: 1,
  points_reg_loss: 0,
  tiebreakers: DEFAULT_TIEBREAKERS,
  change_summary: '',
};

const settingNumber = (settings: { schedule_settings?: Record<string, unknown> } | undefined, key: string, fallback: number) => {
  const value = settings?.schedule_settings?.[key];
  return typeof value === 'number' ? value : fallback;
};

function playoffFields(playoffFormat: Record<string, unknown> | undefined): PlayoffFields {
  const p = playoffFormat ?? {};
  return {
    teams: typeof p.teams === 'number' ? p.teams : DEFAULT_PLAYOFF.teams,
    series_length: [1, 3, 5, 7].includes(p.series_length as number) ? (p.series_length as PlayoffFields['series_length']) : DEFAULT_PLAYOFF.series_length,
    reseed_each_round: typeof p.reseed_each_round === 'boolean' ? p.reseed_each_round : DEFAULT_PLAYOFF.reseed_each_round,
  };
}

function sliderFields(sliderPresets: Record<string, unknown> | undefined): SliderFields {
  const s = sliderPresets ?? {};
  return {
    gameplay_preset: ['simulation', 'competitive', 'arcade'].includes(s.gameplay_preset as string) ? (s.gameplay_preset as SliderFields['gameplay_preset']) : DEFAULT_SLIDERS.gameplay_preset,
    contact: ['reduced', 'standard', 'heavy'].includes(s.contact as string) ? (s.contact as SliderFields['contact']) : DEFAULT_SLIDERS.contact,
    fighting: ['off', 'standard', 'heavy'].includes(s.fighting as string) ? (s.fighting as SliderFields['fighting']) : DEFAULT_SLIDERS.fighting,
  };
}

/** A JSON textarea with live parse validation, an inline error, and a Format
 * button — the escape hatch for extra keys beyond the structured fields
 * above it. Structured field values always win on save; this is additive. */
function AdvancedJsonField({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const parseError = useMemo(() => {
    try {
      JSON.parse(value || '{}');
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid JSON';
    }
  }, [value]);

  return (
    <details open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary style={{ cursor: 'pointer', fontFamily: 'var(--data)', fontSize: '10.5px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
        Advanced (raw JSON) — {label}
      </summary>
      <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <small style={{ color: 'var(--steel)', fontFamily: 'var(--body)' }}>
          Extra keys only — the fields above already control teams, series length, gameplay preset, etc. and take priority over anything set here.
        </small>
        <textarea
          style={{ ...inputStyle, minHeight: '110px', resize: 'vertical', borderColor: parseError ? 'var(--goal)' : 'var(--rule)' }}
          value={value}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
        />
        {parseError && <span style={{ color: 'var(--goal)', fontFamily: 'var(--data)', fontSize: '11px' }}>{parseError}</span>}
        <button
          type="button"
          className="btn ghost"
          style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: '10px' }}
          disabled={Boolean(parseError)}
          onClick={() => onChange(pretty(JSON.parse(value || '{}')))}
        >
          Format
        </button>
      </div>
    </details>
  );
}

export function LeagueSettingsSummary({ settings }: { settings: LeagueSettingsVersion }) {
  const gamesPerMatchup = settingNumber(settings, 'games_per_matchup', 1);
  const weekDuration = settingNumber(settings, 'week_duration_days', 7);
  const playoff = playoffFields(settings.playoff_format);
  const sliders = sliderFields(settings.slider_presets);
  return (
    <div style={{ ...gridStyle, padding: '16px' }} data-testid="league-settings-summary">
      <div><strong>Platform</strong><br />{settings.platform === 'crossplay' ? 'Crossplay' : settings.platform === 'xbox' ? 'Xbox' : 'PlayStation'}</div>
      <div><strong>Teams</strong><br />{settings.team_count}</div>
      <div><strong>Roster source</strong><br />{settings.roster_source.replace('_', ' ')}</div>
      <div><strong>Schedule</strong><br />{settings.schedule_format.replaceAll('_', ' ')} · {gamesPerMatchup} game{gamesPerMatchup === 1 ? '' : 's'} per matchup · {weekDuration} day weeks</div>
      <div><strong>Salary cap</strong><br />{settings.salary_cap_cents == null ? 'None' : (settings.salary_cap_cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</div>
      <div><strong>Roster size</strong><br />{settings.roster_min ?? '—'} min / {settings.roster_max ?? '—'} max</div>
      <div><strong>Conferences</strong><br />{settings.conferences.join(', ') || 'None'}</div>
      <div><strong>Divisions</strong><br />{settings.divisions.join(', ') || 'None'}</div>
      <div><strong>Playoffs</strong><br />{playoff.teams} teams · best-of-{playoff.series_length}{playoff.reseed_each_round ? ' · reseeds each round' : ''}</div>
      <div><strong>Gameplay</strong><br />{sliders.gameplay_preset} · contact {sliders.contact} · fighting {sliders.fighting}</div>
      <div><strong>Verified identities</strong><br />{settings.require_verified_identities ? 'Required to claim a seat' : 'Not required'}</div>
      <div><strong>Points</strong><br />{settings.points_win ?? 2}-{settings.points_ot_loss ?? 1}-{settings.points_reg_loss ?? 0} (win-OT loss-reg. loss)</div>
      <div><strong>Tiebreakers</strong><br />{(settings.tiebreakers ?? DEFAULT_TIEBREAKERS).map(t => t.toUpperCase()).join(' › ')}</div>
      <div style={{ gridColumn: '1 / -1' }}><strong>Rules notes</strong><br />{settings.rules_notes || 'None'}</div>
    </div>
  );
}

export function LeagueSettingsHistoryView({
  current,
  history,
}: {
  current?: LeagueSettingsVersion;
  history: LeagueSettingsVersion[];
}) {
  if (!current && history.length === 0) return <div style={{ padding: '16px', color: 'var(--steel)' }}>No settings versions yet.</div>;
  const prior = history.filter(version => version.id !== current?.id && !version.is_active);
  return (
    <>
      {current && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', fontFamily: 'var(--data)', fontSize: '11px' }}>
          <strong>Current version {current.version}</strong> · {new Date(current.changed_at).toLocaleString()} · by {current.changed_by}
          <div style={{ marginTop: '4px', color: 'var(--steel)' }}>{current.change_summary}</div>
        </div>
      )}
      {prior.map(version => (
        <div key={version.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', fontFamily: 'var(--data)', fontSize: '11px' }}>
          <strong>Version {version.version}</strong> · {new Date(version.changed_at).toLocaleString()} · by {version.changed_by}
          <div style={{ marginTop: '4px', color: 'var(--steel)' }}>{version.change_summary}</div>
        </div>
      ))}
      {current && prior.length === 0 && <div style={{ padding: '12px 16px', color: 'var(--steel)' }}>No prior versions.</div>}
    </>
  );
}

export default function LeagueSettings({
  leagueId,
  editable = false,
}: {
  leagueId: string;
  editable?: boolean;
}) {
  const { data: settingsResponse, isLoading } = useGetLeagueSettings(leagueId);
  const current = hasSettings(settingsResponse) ? settingsResponse : undefined;
  const canManage = editable && Boolean(settingsResponse?.can_manage);
  const { data: templatesData } = useListLeagueSettingsTemplates({ query: { enabled: canManage && !current } as any });
  const templates: LeagueSettingsTemplate[] = templatesData?.data ?? [];
  const { data: historyData } = useListLeagueSettingsHistory(leagueId);
  const history = historyData?.data ?? [];
  const { data: seasonsData } = useListSeasons(leagueId, { query: { enabled: canManage } as any });
  const activeSeason = (seasonsData?.data ?? []).find(s => s.is_active);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LeagueSettingsInput>(emptySettings);
  const [scheduleJson, setScheduleJson] = useState('{}');
  const [gamesPerMatchup, setGamesPerMatchup] = useState(2);
  const [weekDurationDays, setWeekDurationDays] = useState(7);
  const [playoff, setPlayoff] = useState<PlayoffFields>(DEFAULT_PLAYOFF);
  const [playoffJson, setPlayoffJson] = useState('{}');
  const [sliders, setSliders] = useState<SliderFields>(DEFAULT_SLIDERS);
  const [slidersJson, setSlidersJson] = useState('{}');
  const [divisions, setDivisions] = useState('');
  const [conferences, setConferences] = useState('');
  const [salaryEnabled, setSalaryEnabled] = useState(true);
  const [salaryDollars, setSalaryDollars] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [applyToActiveSeason, setApplyToActiveSeason] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const createVersion = useCreateLeagueSettingsVersion({
    request: { headers: { 'Idempotency-Key': idempotencyKey } },
  });

  const applyTemplate = (template: LeagueSettingsTemplate) => {
    const f = template.fields;
    setForm(previous => ({
      ...previous,
      roster_source: f.roster_source,
      schedule_format: f.schedule_format,
      salary_cap_cents: f.salary_cap_cents ?? null,
      roster_min: f.roster_min ?? null,
      roster_max: f.roster_max ?? null,
      rules_notes: f.rules_notes ?? null,
      require_verified_identities: f.require_verified_identities ?? false,
      points_win: f.points_win ?? 2,
      points_ot_loss: f.points_ot_loss ?? 1,
      points_reg_loss: 0,
      tiebreakers: f.tiebreakers ?? DEFAULT_TIEBREAKERS,
    }));
    setGamesPerMatchup(settingNumber({ schedule_settings: f.schedule_settings }, 'games_per_matchup', 2));
    setWeekDurationDays(settingNumber({ schedule_settings: f.schedule_settings }, 'week_duration_days', 7));
    setPlayoff(playoffFields(f.playoff_format as Record<string, unknown>));
    setSliders(sliderFields(f.slider_presets as Record<string, unknown>));
    setDivisions(f.divisions.join(', '));
    setConferences(f.conferences.join(', '));
    setSalaryEnabled(f.salary_cap_cents != null);
    setSalaryDollars(f.salary_cap_cents == null ? '' : String(f.salary_cap_cents / 100));
    setScheduleJson('{}');
    setPlayoffJson('{}');
    setSlidersJson('{}');
  };

  // Seed the create-mode form from the default template once templates load,
  // and whenever the picker selection changes.
  useEffect(() => {
    if (current || templates.length === 0) return;
    const template = templates.find(t => t.id === selectedTemplateId) ?? templates[0]!;
    if (!selectedTemplateId) setSelectedTemplateId(template.id);
    applyTemplate(template);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, templates, selectedTemplateId]);

  useEffect(() => {
    if (!current) return;
    setForm({
      ea_league_id: current.ea_league_id ?? null,
      platform: current.platform,
      team_count: current.team_count,
      roster_source: current.roster_source,
      schedule_format: current.schedule_format,
      schedule_settings: current.schedule_settings,
      playoff_format: current.playoff_format,
      salary_cap_cents: current.salary_cap_cents ?? null,
      roster_min: current.roster_min ?? null,
      roster_max: current.roster_max ?? null,
      divisions: current.divisions,
      conferences: current.conferences,
      rules_notes: current.rules_notes ?? null,
      slider_presets: current.slider_presets,
      require_verified_identities: current.require_verified_identities ?? false,
      points_win: current.points_win ?? 2,
      points_ot_loss: current.points_ot_loss ?? 1,
      points_reg_loss: 0,
      tiebreakers: current.tiebreakers ?? DEFAULT_TIEBREAKERS,
      change_summary: '',
    });
    setScheduleJson('{}');
    setGamesPerMatchup(settingNumber(current, 'games_per_matchup', 1));
    setWeekDurationDays(settingNumber(current, 'week_duration_days', 7));
    setPlayoff(playoffFields(current.playoff_format as Record<string, unknown>));
    setPlayoffJson('{}');
    setSliders(sliderFields(current.slider_presets as Record<string, unknown>));
    setSlidersJson('{}');
    setDivisions(current.divisions.join(', '));
    setConferences(current.conferences.join(', '));
    setSalaryEnabled(current.salary_cap_cents != null);
    setSalaryDollars(current.salary_cap_cents == null ? '' : String(current.salary_cap_cents / 100));
  }, [current?.id]);

  const update = <K extends keyof LeagueSettingsInput>(key: K, value: LeagueSettingsInput[K]) => {
    setForm(previous => ({ ...previous, [key]: value }));
  };

  // Non-blocking heads-up only — the prompt is explicit that this never blocks a save.
  const divisionWarning = (() => {
    const divisionCount = list(divisions).length;
    if (divisionCount === 0) return null;
    return form.team_count % divisionCount !== 0
      ? `${form.team_count} teams doesn't divide evenly across ${divisionCount} divisions.`
      : null;
  })();
  const playoffWarning = playoff.teams > form.team_count
    ? `${playoff.teams} playoff teams is more than the ${form.team_count} teams in the league.`
    : null;

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    try {
      const scheduleSettings = {
        ...(JSON.parse(scheduleJson || '{}') as Record<string, unknown>),
        games_per_matchup: gamesPerMatchup,
        week_duration_days: weekDurationDays,
      };
      const playoffFormat = { ...(JSON.parse(playoffJson || '{}') as Record<string, unknown>), ...playoff };
      const sliderPresets = { ...(JSON.parse(slidersJson || '{}') as Record<string, unknown>), ...sliders };
      if (!form.change_summary.trim()) throw new Error('A change summary is required.');
      if (form.roster_min != null && form.roster_max != null && form.roster_min > form.roster_max) throw new Error('Roster minimum cannot exceed roster maximum.');
      const data: LeagueSettingsInput = {
        ...form,
        ea_league_id: form.ea_league_id?.trim() || null,
        salary_cap_cents: salaryEnabled ? Math.round(Number(salaryDollars || '0') * 100) : null,
        divisions: list(divisions),
        conferences: list(conferences),
        schedule_settings: scheduleSettings,
        playoff_format: playoffFormat,
        slider_presets: sliderPresets,
        rules_notes: form.rules_notes?.trim() || null,
        change_summary: form.change_summary.trim(),
      };
      if (data.salary_cap_cents != null && (!Number.isFinite(data.salary_cap_cents) || data.salary_cap_cents < 0)) throw new Error('Salary cap must be a positive amount.');
      createVersion.mutate({ leagueId, data: { ...data, apply_to_active_season: applyToActiveSeason } }, {
        onSuccess: async (saved) => {
          const appliedSeasonId = (saved as { applied_to_active_season_id?: string | null }).applied_to_active_season_id;
          const appliedNote = appliedSeasonId
            ? ` Also applied to ${activeSeason?.label ?? 'the active season'}.`
            : '';
          setMessage((current ? 'New immutable settings version saved.' : 'League settings created.') + appliedNote);
          setIdempotencyKey(crypto.randomUUID());
          const affected = ['settings', 'history', 'seats', 'seasons', 'schedule', 'weeks', 'games'];
          await queryClient.invalidateQueries({
            predicate: query => affected.some(term => JSON.stringify(query.queryKey).includes(term)),
          });
        },
        onError: mutationError => setMessage(mutationError instanceof Error ? mutationError.message : 'Unable to save settings.'),
      });
    } catch (parseError) {
      setMessage(parseError instanceof Error ? parseError.message : 'Settings JSON is invalid.');
    }
  };

  if (isLoading) return <div style={{ padding: '30px', textAlign: 'center' }}>Loading league settings…</div>;
  if (!editable && !current) return <div className="panel" style={{ padding: '20px', color: 'var(--goal)' }}>League settings are not available.</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: canManage ? 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' : '1fr', gap: '20px' }}>
      <div>
        {canManage ? (
          <form className="panel" onSubmit={save}>
            <div className="panel-head">
              <h2>{current ? 'League Settings Editor' : 'Create League Settings'}</h2>
              <span className="note">{current ? `Creates version ${current.version + 1}` : 'This league has no settings yet'}</span>
            </div>
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {!current && templates.length > 0 && (
                <Field label="Start from a template" hint="Every field below stays editable — this just fills in sensible defaults.">
                  <select
                    style={inputStyle}
                    value={selectedTemplateId}
                    onChange={e => {
                      setSelectedTemplateId(e.target.value);
                      const template = templates.find(t => t.id === e.target.value);
                      if (template) applyTemplate(template);
                    }}
                  >
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <small style={{ color: 'var(--steel)' }}>
                    {templates.find(t => t.id === selectedTemplateId)?.description}
                  </small>
                </Field>
              )}
              <div style={gridStyle}>
                <Field label="Team count" hint="Connected Franchise supports 3 to 32 teams.">
                  <input style={inputStyle} required type="number" min={3} max={32} value={form.team_count} onChange={e => update('team_count', Number(e.target.value))} />
                </Field>
                <Field label="Roster source" hint="Custom lets GMs upload their own rosters for approval.">
                  <select style={inputStyle} value={form.roster_source} onChange={e => update('roster_source', e.target.value as LeagueSettingsInput['roster_source'])}>
                    <option value="ea">EA default</option>
                    <option value="manual">Manual</option>
                    <option value="csv_import">Custom (CSV import)</option>
                  </select>
                </Field>
                <Field label="Schedule format">
                  <select style={inputStyle} value={form.schedule_format} onChange={e => update('schedule_format', e.target.value as LeagueSettingsInput['schedule_format'])}>
                    <option value="round_robin">Round robin</option>
                    <option value="double_round_robin">Double round robin</option>
                    <option value="custom">Custom</option>
                  </select>
                </Field>
                <Field label="Games per matchup" hint="How many times each pair of teams plays per meeting.">
                  <input style={inputStyle} required type="number" min={1} max={8} value={gamesPerMatchup} onChange={e => setGamesPerMatchup(Number(e.target.value))} />
                </Field>
                <Field label="Week length (days)" hint="How long a scheduling week runs before the next slate opens.">
                  <input style={inputStyle} required type="number" min={1} max={31} value={weekDurationDays} onChange={e => setWeekDurationDays(Number(e.target.value))} />
                </Field>
                <Field label="Conferences" hint="Comma-separated. Leave blank for a single-table league.">
                  <input style={inputStyle} placeholder="Eastern, Western" value={conferences} onChange={e => setConferences(e.target.value)} />
                </Field>
                <Field label="Divisions" hint="Comma-separated. Teams are split evenly across these.">
                  <input style={inputStyle} placeholder="Atlantic, Metropolitan, Central, Pacific" value={divisions} onChange={e => setDivisions(e.target.value)} />
                  {divisionWarning && <small style={{ color: 'var(--bulb-2, #b56a15)' }}>⚠ {divisionWarning}</small>}
                </Field>
              </div>

              <div style={gridStyle}>
                <Field label="Salary cap">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--body)', fontSize: '13px', color: 'var(--ink)' }}>
                    <input type="checkbox" checked={salaryEnabled} onChange={e => setSalaryEnabled(e.target.checked)} />
                    Salary cap on
                  </label>
                </Field>
                {salaryEnabled && (
                  <Field label="Salary cap (dollars)" hint="2026-27 NHL upper limit is $104M.">
                    <input style={inputStyle} type="number" min={0} step=".01" value={salaryDollars} onChange={e => setSalaryDollars(e.target.value)} placeholder="104,000,000" />
                  </Field>
                )}
                <Field label="Roster minimum" hint="NHL active rosters carry 20-23 players.">
                  <input style={inputStyle} type="number" min={1} value={form.roster_min ?? ''} onChange={e => update('roster_min', e.target.value ? Number(e.target.value) : null)} placeholder="20" />
                </Field>
                <Field label="Roster maximum">
                  <input style={inputStyle} type="number" min={1} value={form.roster_max ?? ''} onChange={e => update('roster_max', e.target.value ? Number(e.target.value) : null)} placeholder="23" />
                </Field>
              </div>

              <div style={gridStyle}>
                <Field label="Playoff teams" hint="Teams that qualify for the postseason.">
                  <input style={inputStyle} type="number" min={2} max={form.team_count} value={playoff.teams} onChange={e => setPlayoff(p => ({ ...p, teams: Number(e.target.value) }))} />
                  {playoffWarning && <small style={{ color: 'var(--bulb-2, #b56a15)' }}>⚠ {playoffWarning}</small>}
                </Field>
                <Field label="Series length" hint="Games per playoff series. 1 = single elimination.">
                  <select style={inputStyle} value={playoff.series_length} onChange={e => setPlayoff(p => ({ ...p, series_length: Number(e.target.value) as PlayoffFields['series_length'] }))}>
                    <option value={1}>1</option>
                    <option value={3}>3</option>
                    <option value={5}>5</option>
                    <option value={7}>7</option>
                  </select>
                </Field>
                <Field label="Reseed each round" hint="Re-rank surviving teams by seed after every round.">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--body)', fontSize: '13px' }}>
                    <input type="checkbox" checked={playoff.reseed_each_round} onChange={e => setPlayoff(p => ({ ...p, reseed_each_round: e.target.checked }))} />
                    On
                  </label>
                </Field>
              </div>

              <div style={gridStyle}>
                <Field label="Gameplay preset">
                  <select style={inputStyle} value={sliders.gameplay_preset} onChange={e => setSliders(s => ({ ...s, gameplay_preset: e.target.value as SliderFields['gameplay_preset'] }))}>
                    <option value="simulation">Simulation</option>
                    <option value="competitive">Competitive</option>
                    <option value="arcade">Arcade</option>
                  </select>
                </Field>
                <Field label="Contact">
                  <select style={inputStyle} value={sliders.contact} onChange={e => setSliders(s => ({ ...s, contact: e.target.value as SliderFields['contact'] }))}>
                    <option value="reduced">Reduced</option>
                    <option value="standard">Standard</option>
                    <option value="heavy">Heavy</option>
                  </select>
                </Field>
                <Field label="Fighting">
                  <select style={inputStyle} value={sliders.fighting} onChange={e => setSliders(s => ({ ...s, fighting: e.target.value as SliderFields['fighting'] }))}>
                    <option value="off">Off</option>
                    <option value="standard">Standard</option>
                    <option value="heavy">Heavy</option>
                  </select>
                </Field>
              </div>

              <Field label="Require verified identities" hint="Members must confirm their gamertag before claiming a seat.">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--body)', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={form.require_verified_identities ?? false}
                    onChange={e => update('require_verified_identities', e.target.checked)}
                  />
                  Required to claim a seat
                </label>
              </Field>

              <Field label="Rules notes" hint="House rules the sliders cannot express.">
                <textarea
                  style={{ ...inputStyle, minHeight: '90px', resize: 'vertical' }}
                  value={form.rules_notes ?? ''}
                  onChange={e => update('rules_notes', e.target.value)}
                  placeholder="Strict offsides, no fighting after the whistle..."
                />
              </Field>

              <div style={gridStyle}>
                <Field label="Points for a win" hint="League default. New seasons inherit this unless overridden.">
                  <input style={inputStyle} type="number" min={0} value={form.points_win ?? 2} onChange={e => update('points_win', Number(e.target.value))} />
                </Field>
                <Field label="Points for an OT/SO loss">
                  <input style={inputStyle} type="number" min={0} value={form.points_ot_loss ?? 1} onChange={e => update('points_ot_loss', Number(e.target.value))} />
                </Field>
                <Field label="Points for a regulation loss" hint="Always 0 — hockey does not award points for a regulation loss.">
                  <input style={inputStyle} type="number" value={0} disabled />
                </Field>
              </div>

              <Field label="Tiebreaker order" hint="Drag to reorder. League default for new seasons.">
                <div style={{ border: '1px solid var(--rule)', borderRadius: '3px', background: '#fff' }}>
                  {(form.tiebreakers ?? DEFAULT_TIEBREAKERS).map((tb, idx) => (
                    <div
                      key={tb}
                      draggable
                      onDragStart={e => e.dataTransfer.setData('index', idx.toString())}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        const dragIndex = parseInt(e.dataTransfer.getData('index'), 10);
                        const next = [...(form.tiebreakers ?? DEFAULT_TIEBREAKERS)];
                        const [dragged] = next.splice(dragIndex, 1);
                        next.splice(idx, 0, dragged!);
                        update('tiebreakers', next);
                      }}
                      style={{
                        padding: '7px 10px',
                        borderBottom: idx < (form.tiebreakers ?? []).length - 1 ? '1px solid var(--rule)' : 'none',
                        fontFamily: 'var(--data)',
                        fontSize: '11.5px',
                        cursor: 'grab',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <span style={{ color: 'var(--steel)' }}>⋮</span>
                      <span style={{ fontWeight: 600 }}>{idx + 1}.</span>
                      {tb.toUpperCase()}
                    </div>
                  ))}
                </div>
              </Field>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--rule)', paddingTop: '14px' }}>
                <AdvancedJsonField label="schedule settings" value={scheduleJson} onChange={setScheduleJson} />
                <AdvancedJsonField label="playoff format" value={playoffJson} onChange={setPlayoffJson} />
                <AdvancedJsonField label="gameplay sliders" value={slidersJson} onChange={setSlidersJson} />
              </div>

              {current && activeSeason && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontFamily: 'var(--body)', fontSize: '13px', border: '1px solid var(--rule)', borderRadius: '3px', padding: '10px' }}>
                  <input type="checkbox" checked={applyToActiveSeason} onChange={e => setApplyToActiveSeason(e.target.checked)} style={{ marginTop: '2px' }} />
                  <span>
                    Applies to new seasons. Also apply the points system and tiebreaker order to <strong>{activeSeason.label}</strong> (currently in progress)?
                    <br />
                    <small style={{ color: 'var(--steel)' }}>Salary cap, roster limits, and games per matchup for that season stay as originally set.</small>
                  </span>
                </label>
              )}

              <Field label="Required change summary">
                <input style={inputStyle} required minLength={1} maxLength={500} value={form.change_summary} onChange={e => update('change_summary', e.target.value)} placeholder="Explain what changed and why" />
              </Field>
              {message && <div role="status" style={{ fontFamily: 'var(--data)', fontSize: '12px', color: message.startsWith('New') || message.includes('created') ? '#1F7A4C' : 'var(--goal)' }}>{message}</div>}
              <button className="btn" type="submit" disabled={createVersion.isPending} style={{ alignSelf: 'flex-start' }}>
                {createVersion.isPending ? 'Saving…' : current ? 'Save New Version' : 'Create League Settings'}
              </button>
            </div>
          </form>
        ) : (
          <div className="panel">
            <div className="panel-head"><h2>Active League Settings</h2><span className="note">{current ? `Version ${current.version}` : 'Not set up yet'}</span></div>
            {current ? <LeagueSettingsSummary settings={current} /> : (
              <div style={{ padding: '20px', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px' }}>
                The commissioner hasn't set up league settings yet.
              </div>
            )}
            {editable && current && !current.can_manage && (
              <div style={{ padding: '0 16px 16px', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '11px' }}>
                Settings are read-only for league members.
              </div>
            )}
          </div>
        )}
      </div>
      {canManage && (
        <aside className="panel" style={{ alignSelf: 'start' }}>
          <div className="panel-head"><h2>Version History</h2></div>
          <LeagueSettingsHistoryView current={current} history={history} />
        </aside>
      )}
    </div>
  );
}
