import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateLeagueSettingsVersion,
  useGetLeagueSettings,
  useListLeagueSettingsHistory,
  type LeagueSettingsInput,
  type LeagueSettingsVersion,
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
      {hint && <small style={{ color: 'var(--steel)', fontFamily: 'var(--data)', lineHeight: 1.4 }}>{hint}</small>}
    </label>
  );
}

const pretty = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
const list = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);
const emptySettings: LeagueSettingsInput = {
  ea_league_id: null,
  platform: 'both',
  team_count: 32,
  roster_source: 'manual',
  schedule_format: 'round_robin',
  schedule_settings: { games_per_matchup: 1, week_duration_days: 7 },
  playoff_format: {},
  salary_cap_cents: null,
  roster_min: null,
  roster_max: null,
  divisions: [],
  conferences: [],
  rules_notes: null,
  slider_presets: {},
  change_summary: '',
};
const settingNumber = (settings: LeagueSettingsVersion | undefined, key: string, fallback: number) => {
  const value = settings?.schedule_settings?.[key];
  return typeof value === 'number' ? value : fallback;
};

export function LeagueSettingsSummary({ settings }: { settings: LeagueSettingsVersion }) {
  const gamesPerMatchup = settingNumber(settings, 'games_per_matchup', 1);
  const weekDuration = settingNumber(settings, 'week_duration_days', 7);
  return (
    <div style={{ ...gridStyle, padding: '16px' }} data-testid="league-settings-summary">
      <div><strong>EA league ID</strong><br />{settings.ea_league_id || 'Not connected'}</div>
      <div><strong>Platform</strong><br />{settings.platform.toUpperCase()}</div>
      <div><strong>Teams</strong><br />{settings.team_count}</div>
      <div><strong>Roster source</strong><br />{settings.roster_source.replace('_', ' ')}</div>
      <div><strong>Schedule</strong><br />{settings.schedule_format.replaceAll('_', ' ')} · {gamesPerMatchup} game{gamesPerMatchup === 1 ? '' : 's'} per matchup · {weekDuration} day weeks</div>
      <div><strong>Salary cap</strong><br />{settings.salary_cap_cents == null ? 'None' : (settings.salary_cap_cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</div>
      <div><strong>Roster size</strong><br />{settings.roster_min ?? '—'} min / {settings.roster_max ?? '—'} max</div>
      <div><strong>Conferences</strong><br />{settings.conferences.join(', ') || 'None'}</div>
      <div><strong>Divisions</strong><br />{settings.divisions.join(', ') || 'None'}</div>
      <div><strong>Playoffs</strong><pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontSize: '11px' }}>{pretty(settings.playoff_format)}</pre></div>
      <div><strong>Slider presets</strong><pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontSize: '11px' }}>{pretty(settings.slider_presets)}</pre></div>
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
  const { data: current, isLoading, error } = useGetLeagueSettings(leagueId);
  const { data: historyData } = useListLeagueSettingsHistory(leagueId);
  const history = historyData?.data ?? [];
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LeagueSettingsInput>(emptySettings);
  const [scheduleJson, setScheduleJson] = useState('{}');
  const [gamesPerMatchup, setGamesPerMatchup] = useState(1);
  const [weekDurationDays, setWeekDurationDays] = useState(7);
  const [playoffJson, setPlayoffJson] = useState('{}');
  const [slidersJson, setSlidersJson] = useState('{}');
  const [divisions, setDivisions] = useState('');
  const [conferences, setConferences] = useState('');
  const [salaryDollars, setSalaryDollars] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const createVersion = useCreateLeagueSettingsVersion({
    request: { headers: { 'Idempotency-Key': idempotencyKey } },
  });

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
      change_summary: '',
    });
    setScheduleJson(pretty(current.schedule_settings));
    setGamesPerMatchup(settingNumber(current, 'games_per_matchup', 1));
    setWeekDurationDays(settingNumber(current, 'week_duration_days', 7));
    setPlayoffJson(pretty(current.playoff_format));
    setSlidersJson(pretty(current.slider_presets));
    setDivisions(current.divisions.join(', '));
    setConferences(current.conferences.join(', '));
    setSalaryDollars(current.salary_cap_cents == null ? '' : String(current.salary_cap_cents / 100));
  }, [current?.id]);

  const update = <K extends keyof LeagueSettingsInput>(key: K, value: LeagueSettingsInput[K]) => {
    setForm(previous => ({ ...previous, [key]: value }));
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    try {
      const scheduleSettings = {
        ...(JSON.parse(scheduleJson) as Record<string, unknown>),
        games_per_matchup: gamesPerMatchup,
        week_duration_days: weekDurationDays,
      };
      const playoffFormat = JSON.parse(playoffJson) as Record<string, unknown>;
      const sliderPresets = JSON.parse(slidersJson) as Record<string, unknown>;
      if (!form.change_summary.trim()) throw new Error('A change summary is required.');
      if (form.roster_min != null && form.roster_max != null && form.roster_min > form.roster_max) throw new Error('Roster minimum cannot exceed roster maximum.');
      const data: LeagueSettingsInput = {
        ...form,
        ea_league_id: form.ea_league_id?.trim() || null,
        salary_cap_cents: salaryDollars === '' ? null : Math.round(Number(salaryDollars) * 100),
        divisions: list(divisions),
        conferences: list(conferences),
        schedule_settings: scheduleSettings,
        playoff_format: playoffFormat,
        slider_presets: sliderPresets,
        rules_notes: form.rules_notes?.trim() || null,
        change_summary: form.change_summary.trim(),
      };
      if (data.salary_cap_cents != null && (!Number.isFinite(data.salary_cap_cents) || data.salary_cap_cents < 0)) throw new Error('Salary cap must be a positive amount.');
      createVersion.mutate({ leagueId, data }, {
        onSuccess: async () => {
          setMessage('New immutable settings version saved.');
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
  if ((error || !current) && !editable) return <div className="panel" style={{ padding: '20px', color: 'var(--goal)' }}>League settings are not available.</div>;
  const canEdit = editable && Boolean(current?.can_manage);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: canEdit ? 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' : '1fr', gap: '20px' }}>
      <div>
        {canEdit ? (
          <form className="panel" onSubmit={save}>
            <div className="panel-head"><h2>League Settings Editor</h2><span className="note">Creates version {(current?.version ?? 0) + 1}</span></div>
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={gridStyle}>
                <Field label="EA league ID"><input style={inputStyle} maxLength={100} value={form.ea_league_id ?? ''} onChange={e => update('ea_league_id', e.target.value)} /></Field>
                <Field label="Platform"><select style={inputStyle} value={form.platform} onChange={e => update('platform', e.target.value as LeagueSettingsInput['platform'])}><option value="psn">PSN</option><option value="xbox">Xbox</option><option value="both">Both</option></select></Field>
                <Field label="Team count"><input style={inputStyle} required type="number" min={3} max={32} value={form.team_count} onChange={e => update('team_count', Number(e.target.value))} /></Field>
                <Field label="Roster source"><select style={inputStyle} value={form.roster_source} onChange={e => update('roster_source', e.target.value as LeagueSettingsInput['roster_source'])}><option value="manual">Manual</option><option value="ea">EA</option><option value="csv_import">CSV import</option></select></Field>
                <Field label="Schedule format"><select style={inputStyle} value={form.schedule_format} onChange={e => update('schedule_format', e.target.value as LeagueSettingsInput['schedule_format'])}><option value="round_robin">Round robin</option><option value="double_round_robin">Double round robin</option><option value="custom">Custom</option></select></Field>
                <Field label="Games per matchup"><input style={inputStyle} required type="number" min={1} value={gamesPerMatchup} onChange={e => setGamesPerMatchup(Number(e.target.value))} /></Field>
                <Field label="Week duration (days)"><input style={inputStyle} required type="number" min={1} max={30} value={weekDurationDays} onChange={e => setWeekDurationDays(Number(e.target.value))} /></Field>
                <Field label="Salary cap (dollars)"><input style={inputStyle} type="number" min={0} step=".01" value={salaryDollars} onChange={e => setSalaryDollars(e.target.value)} placeholder="No cap" /></Field>
                <Field label="Roster minimum"><input style={inputStyle} type="number" min={1} value={form.roster_min ?? ''} onChange={e => update('roster_min', e.target.value ? Number(e.target.value) : null)} /></Field>
                <Field label="Roster maximum"><input style={inputStyle} type="number" min={1} value={form.roster_max ?? ''} onChange={e => update('roster_max', e.target.value ? Number(e.target.value) : null)} /></Field>
                <Field label="Conferences" hint="Comma-separated"><input style={inputStyle} value={conferences} onChange={e => setConferences(e.target.value)} /></Field>
                <Field label="Divisions" hint="Comma-separated"><input style={inputStyle} value={divisions} onChange={e => setDivisions(e.target.value)} /></Field>
              </div>
              <div style={gridStyle}>
                <Field label="Additional schedule settings (JSON)" hint="Games per matchup and week duration above override matching JSON keys."><textarea style={{ ...inputStyle, minHeight: '130px', resize: 'vertical' }} required value={scheduleJson} onChange={e => setScheduleJson(e.target.value)} /></Field>
                <Field label="Playoff format (JSON)"><textarea style={{ ...inputStyle, minHeight: '130px', resize: 'vertical' }} required value={playoffJson} onChange={e => setPlayoffJson(e.target.value)} /></Field>
                <Field label="Slider presets (JSON)"><textarea style={{ ...inputStyle, minHeight: '130px', resize: 'vertical' }} required value={slidersJson} onChange={e => setSlidersJson(e.target.value)} /></Field>
              </div>
              <Field label="Rules notes"><textarea style={{ ...inputStyle, minHeight: '90px', resize: 'vertical' }} value={form.rules_notes ?? ''} onChange={e => update('rules_notes', e.target.value)} /></Field>
              <Field label="Required change summary"><input style={inputStyle} required minLength={1} maxLength={500} value={form.change_summary} onChange={e => update('change_summary', e.target.value)} placeholder="Explain what changed and why" /></Field>
              {message && <div role="status" style={{ fontFamily: 'var(--data)', fontSize: '12px', color: message.startsWith('New') ? '#1F7A4C' : 'var(--goal)' }}>{message}</div>}
              <button className="btn" type="submit" disabled={createVersion.isPending} style={{ alignSelf: 'flex-start' }}>{createVersion.isPending ? 'Saving…' : 'Save New Version'}</button>
            </div>
          </form>
        ) : (
          <div className="panel">
            <div className="panel-head"><h2>Active League Settings</h2><span className="note">Version {current?.version}</span></div>
            {current && <LeagueSettingsSummary settings={current} />}
            {editable && current && !current.can_manage && (
              <div style={{ padding: '0 16px 16px', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '11px' }}>
                Settings are read-only for league members.
              </div>
            )}
          </div>
        )}
      </div>
      <aside className="panel" style={{ alignSelf: 'start' }}>
        <div className="panel-head"><h2>Version History</h2></div>
        <LeagueSettingsHistoryView current={current} history={history} />
      </aside>
    </div>
  );
}