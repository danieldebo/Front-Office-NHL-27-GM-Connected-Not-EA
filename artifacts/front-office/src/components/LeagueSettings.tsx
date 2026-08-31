import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateLeagueSettingsVersion,
  useGetLeagueSettings,
  useListLeagueSettingsTemplates,
  useListLeagueSettingsHistory,
  useListSeasons,
  type LeagueSettingsInput,
  type LeagueSettingsTemplate,
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

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0 }}>
      <span style={{ fontFamily: 'var(--data)', fontSize: '10px', color: 'var(--steel)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</span>
      {children}
      <small style={{ color: 'var(--steel)', fontFamily: 'var(--data)', lineHeight: 1.4 }}>{hint}</small>
    </label>
  );
}

const list = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);
const objectNumber = (value: Record<string, unknown>, key: string, fallback: number) => {
  const candidate = value[key];
  return typeof candidate === 'number' ? candidate : fallback;
};
const objectBoolean = (value: Record<string, unknown>, key: string, fallback: boolean) => {
  const candidate = value[key];
  return typeof candidate === 'boolean' ? candidate : fallback;
};
const objectString = (value: Record<string, unknown>, key: string, fallback: string) => {
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : fallback;
};

export const balancedSettingsFallback: LeagueSettingsInput = {
  applied_template_id: 'balanced_standard',
  ea_league_id: null,
  platform: 'both',
  team_count: 32,
  roster_source: 'ea',
  schedule_format: 'round_robin',
  schedule_settings: { games_per_matchup: 2, week_duration_days: 7 },
  playoff_format: { teams: 16, series_length: 7, reseed: false },
  salary_cap_cents: 10_400_000_000,
  roster_min: 20,
  roster_max: 23,
  divisions: ['Atlantic', 'Metropolitan', 'Central', 'Pacific'],
  conferences: ['Eastern', 'Western'],
  rules_notes: '',
  slider_presets: { gameplay: 'competitive', contact: 'standard', fighting: 'standard' },
  require_verified_identities: false,
  points_win: 2,
  points_ot_loss: 1,
  points_reg_loss: 0,
  tiebreakers: ['points', 'rw', 'row', 'wins', 'diff', 'gf'],
  use_league_defaults: true,
  change_summary: 'Initial league settings',
};

export function settingsFromTemplate(
  template: LeagueSettingsTemplate,
  changeSummary = `Started from the ${template.name} template.`,
): LeagueSettingsInput {
  return {
    ...template.values,
    ea_league_id: null,
    applied_template_id: template.id,
    change_summary: changeSummary,
  };
}

export function TemplatePicker({
  templates,
  onApply,
  confirmApply = true,
}: {
  templates: LeagueSettingsTemplate[];
  onApply: (template: LeagueSettingsTemplate) => void;
  confirmApply?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(templates.find(template => template.id === 'balanced_standard')?.id ?? templates[0]?.id ?? '');
  const selected = templates.find(template => template.id === selectedId);

  useEffect(() => {
    if (!selected && templates[0]) setSelectedId(templates[0].id);
  }, [selected, templates]);

  if (!selected) return <p style={{ color: 'var(--steel)', margin: 0 }}>Loading settings templates…</p>;
  return (
    <section style={{ border: '1px solid var(--rule)', borderRadius: '3px', padding: '14px', background: '#FAFCFD' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '17px', textTransform: 'uppercase', marginBottom: '5px' }}>Start from a template</div>
      <p style={{ margin: '0 0 12px', color: 'var(--steel)', fontSize: '13px' }}>
        Preview a curated setup, then apply it to fill the sheet. Every field remains editable.
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {templates.map(template => (
          <button key={template.id} type="button" className={template.id === selected.id ? 'btn' : 'btn ghost'} aria-pressed={template.id === selected.id} onClick={() => setSelectedId(template.id)}>
            {template.name}
          </button>
        ))}
      </div>
      <div data-testid="settings-template-preview">
        <strong>{selected.name}</strong>
        <p style={{ margin: '4px 0 8px', fontSize: '13px' }}>{selected.description}</p>
        <ul style={{ margin: '0 0 12px', paddingLeft: '20px', color: 'var(--steel)', fontSize: '12px', lineHeight: 1.6 }}>
          {selected.differences.map(difference => <li key={difference}>{difference}</li>)}
        </ul>
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => {
          if (!confirmApply || window.confirm(`Apply the ${selected.name} template? This replaces the current form values, but nothing is saved until you submit.`)) onApply(selected);
        }}
      >
        Apply {selected.name}
      </button>
    </section>
  );
}

export function LeagueSettingsFields({
  value,
  onChange,
  includeLeagueBasics = true,
  includeChangeSummary = true,
}: {
  value: LeagueSettingsInput;
  onChange: (value: LeagueSettingsInput) => void;
  includeLeagueBasics?: boolean;
  includeChangeSummary?: boolean;
}) {
  const update = <K extends keyof LeagueSettingsInput>(key: K, next: LeagueSettingsInput[K]) => onChange({ ...value, [key]: next });
  const schedule = value.schedule_settings;
  const playoffs = value.playoff_format;
  const sliders = value.slider_presets;
  const gamesPerMatchup = objectNumber(schedule, 'games_per_matchup', 2);
  const playoffTeams = objectNumber(playoffs, 'teams', 16);
  const divisionsWarning = value.divisions.length > 0 && value.team_count % value.divisions.length !== 0;
  const playoffWarning = playoffTeams > value.team_count;
  const salaryEnabled = value.salary_cap_cents != null;
  const pointSystem = value.points_win === 3 ? 'three_point' : 'traditional';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, border: '1px solid var(--rule)', background: '#FAFCFD' }}>
        <input type="checkbox" checked={value.use_league_defaults} onChange={event => update('use_league_defaults', event.target.checked)} />
        <span><strong>Use league defaults for new seasons</strong><small style={{ display: 'block', color: 'var(--steel)', marginTop: 3 }}>When off, commissioners choose a template and complete season settings each time.</small></span>
      </label>
      <div style={gridStyle}>
        {includeLeagueBasics && (
          <>
            <Field label="Platform" hint="Which consoles can join. NHL 27 supports full crossplay.">
              <select style={inputStyle} value={value.platform} onChange={event => update('platform', event.target.value as LeagueSettingsInput['platform'])}>
                <option value="xbox">Xbox</option><option value="psn">PlayStation</option><option value="both">Crossplay</option>
              </select>
            </Field>
            <Field label="Team count" hint="Connected Franchise supports 3 to 32 teams.">
              <input style={inputStyle} required type="number" min={3} max={32} placeholder="32" value={value.team_count} onChange={event => update('team_count', Number(event.target.value))} />
            </Field>
          </>
        )}
        <Field label="EA league ID" hint="Optional identifier for matching this league to EA data.">
          <input style={inputStyle} maxLength={100} placeholder="e.g. EA-12345" value={value.ea_league_id ?? ''} onChange={event => update('ea_league_id', event.target.value || null)} />
        </Field>
        <Field label="Conferences" hint="Comma-separated. Leave blank for a single-table league.">
          <input style={inputStyle} placeholder="Eastern, Western" value={value.conferences.join(', ')} onChange={event => update('conferences', list(event.target.value))} />
        </Field>
        <Field label="Divisions" hint="Comma-separated. Teams are split evenly across these.">
          <input style={inputStyle} placeholder="Atlantic, Metropolitan, Central, Pacific" value={value.divisions.join(', ')} onChange={event => update('divisions', list(event.target.value))} />
        </Field>
        <Field label="Roster source" hint="EA default uses the game roster. Custom supports commissioner-managed rosters.">
          <select style={inputStyle} value={value.roster_source} onChange={event => update('roster_source', event.target.value as LeagueSettingsInput['roster_source'])}>
            <option value="ea">EA default</option><option value="manual">Custom</option><option value="csv_import">CSV import</option>
          </select>
        </Field>
        <Field label="Roster minimum" hint="NHL active rosters carry 20–23 players.">
          <input style={inputStyle} required type="number" min={1} placeholder="20" value={value.roster_min ?? ''} onChange={event => update('roster_min', event.target.value ? Number(event.target.value) : null)} />
        </Field>
        <Field label="Roster maximum" hint="The largest active roster allowed for a team.">
          <input style={inputStyle} required type="number" min={1} placeholder="23" value={value.roster_max ?? ''} onChange={event => update('roster_max', event.target.value ? Number(event.target.value) : null)} />
        </Field>
      </div>

      <fieldset style={{ border: '1px solid var(--rule)', borderRadius: 3, padding: 14 }}>
        <legend style={{ fontFamily: 'var(--data)', fontSize: 10, color: 'var(--steel)', textTransform: 'uppercase' }}>Salary cap</legend>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <input type="checkbox" checked={salaryEnabled} onChange={event => update('salary_cap_cents', event.target.checked ? 10_400_000_000 : null)} />
          Enable salary cap
        </label>
        {salaryEnabled && <input aria-label="Salary cap amount" style={inputStyle} type="number" min={0} step={1} placeholder="104000000" value={(value.salary_cap_cents ?? 0) / 100} onChange={event => update('salary_cap_cents', Math.round(Number(event.target.value) * 100))} />}
        <small style={{ color: 'var(--steel)', fontFamily: 'var(--data)', lineHeight: 1.4 }}>2026–27 NHL upper limit is $104M. Turn off for an uncapped league.</small>
      </fieldset>

      <div style={gridStyle}>
        <Field label="Schedule format" hint="Choose the overall matchup structure for the season.">
          <select style={inputStyle} value={value.schedule_format} onChange={event => update('schedule_format', event.target.value as LeagueSettingsInput['schedule_format'])}>
            <option value="round_robin">Round robin</option><option value="double_round_robin">Double round robin</option><option value="custom">Custom</option>
          </select>
        </Field>
        <Field label="Games per matchup" hint="How many times each pair of teams plays per meeting.">
          <input style={inputStyle} required type="number" min={1} max={8} placeholder="2" value={gamesPerMatchup} onChange={event => update('schedule_settings', { ...schedule, games_per_matchup: Number(event.target.value) })} />
        </Field>
        <Field label="Week length" hint="How long a scheduling week runs before the next slate opens.">
          <input style={inputStyle} required type="number" min={1} max={31} placeholder="7" value={objectNumber(schedule, 'week_duration_days', 7)} onChange={event => update('schedule_settings', { ...schedule, week_duration_days: Number(event.target.value) })} />
        </Field>
        <Field label="Playoff teams" hint="Teams that qualify for the postseason.">
          <input style={inputStyle} required type="number" min={2} max={32} placeholder="16" value={playoffTeams} onChange={event => update('playoff_format', { ...playoffs, teams: Number(event.target.value) })} />
        </Field>
        <Field label="Series length" hint="Games per playoff series. 1 = single elimination.">
          <select style={inputStyle} value={objectNumber(playoffs, 'series_length', 7)} onChange={event => update('playoff_format', { ...playoffs, series_length: Number(event.target.value) })}>
            {[1, 3, 5, 7].map(length => <option key={length} value={length}>{length}</option>)}
          </select>
        </Field>
        <Field label="Reseed each round" hint="Re-rank surviving teams by seed after every round.">
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 36 }}>
            <input type="checkbox" checked={objectBoolean(playoffs, 'reseed', false)} onChange={event => update('playoff_format', { ...playoffs, reseed: event.target.checked })} /> Enable reseeding
          </span>
        </Field>
        <Field label="Gameplay preset" hint="Sets the overall pace and realism of gameplay.">
          <select style={inputStyle} value={objectString(sliders, 'gameplay', 'competitive')} onChange={event => update('slider_presets', { ...sliders, gameplay: event.target.value })}>
            <option value="simulation">Simulation</option><option value="competitive">Competitive</option><option value="arcade">Arcade</option>
          </select>
        </Field>
        <Field label="Contact" hint="Controls the expected level of body contact.">
          <select style={inputStyle} value={objectString(sliders, 'contact', 'standard')} onChange={event => update('slider_presets', { ...sliders, contact: event.target.value })}>
            <option value="reduced">Reduced</option><option value="standard">Standard</option><option value="heavy">Heavy</option>
          </select>
        </Field>
        <Field label="Fighting" hint="Controls how often fighting is allowed.">
          <select style={inputStyle} value={objectString(sliders, 'fighting', 'standard')} onChange={event => update('slider_presets', { ...sliders, fighting: event.target.value })}>
            <option value="off">Off</option><option value="standard">Standard</option><option value="heavy">Heavy</option>
          </select>
        </Field>
        <Field label="Verified identities" hint="Members must confirm a gamertag before claiming a seat.">
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 36 }}>
            <input type="checkbox" checked={value.require_verified_identities} onChange={event => update('require_verified_identities', event.target.checked)} data-testid="checkbox-require-verified-identities" /> Require verification
          </span>
        </Field>
        <Field label="Points system" hint="Default standings points awarded to new seasons.">
          <select
            style={inputStyle}
            value={pointSystem}
            onChange={event => onChange({
              ...value,
              points_win: event.target.value === 'three_point' ? 3 : 2,
              points_ot_loss: 1,
              points_reg_loss: 0,
            })}
          >
            <option value="traditional">2-1-0 (Traditional)</option>
            <option value="three_point">3-1-0 (Three-point win)</option>
          </select>
        </Field>
        <Field label="Tiebreaker order" hint="Comma-separated standings tiebreakers, first used first.">
          <input style={inputStyle} required placeholder="points, rw, row, wins, diff, gf" value={value.tiebreakers.join(', ')} onChange={event => update('tiebreakers', list(event.target.value))} />
        </Field>
      </div>

      {(divisionsWarning || playoffWarning) && (
        <div role="status" style={{ padding: '10px 12px', border: '1px solid #D7A72F', background: '#FFF8E5', color: '#705000', fontSize: 12 }}>
          {divisionsWarning && <div>Team count is not evenly divisible by the number of divisions.</div>}
          {playoffWarning && <div>Playoff teams exceed the current team count.</div>}
        </div>
      )}

      <Field label="Rules notes" hint="House rules the sliders cannot express.">
        <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} placeholder="Strict offsides, no fighting after the whistle…" value={value.rules_notes ?? ''} onChange={event => update('rules_notes', event.target.value || null)} />
      </Field>
      {includeChangeSummary && (
        <Field label="Required change summary" hint="Explain what this immutable version changes.">
          <input style={inputStyle} required minLength={1} maxLength={500} placeholder="Explain what changed and why" value={value.change_summary} onChange={event => update('change_summary', event.target.value)} />
        </Field>
      )}
    </div>
  );
}

export function LeagueSettingsSummary({ settings }: { settings: LeagueSettingsVersion }) {
  const games = objectNumber(settings.schedule_settings, 'games_per_matchup', 2);
  const week = objectNumber(settings.schedule_settings, 'week_duration_days', 7);
  return (
    <div style={{ ...gridStyle, padding: '16px' }} data-testid="league-settings-summary">
      <div><strong>Platform</strong><br />{settings.platform === 'both' ? 'CROSSPLAY' : settings.platform.toUpperCase()}</div>
      <div><strong>Teams</strong><br />{settings.team_count}</div>
      <div><strong>Roster source</strong><br />{settings.roster_source.replace('_', ' ')}</div>
      <div><strong>Verified identities</strong><br />{settings.require_verified_identities ? 'Required' : 'Not required'}</div>
      <div><strong>Schedule</strong><br />{settings.schedule_format.replaceAll('_', ' ')} · {games} game{games === 1 ? '' : 's'} per matchup · {week} day weeks</div>
      <div><strong>Salary cap</strong><br />{settings.salary_cap_cents == null ? 'None' : (settings.salary_cap_cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</div>
      <div><strong>Roster size</strong><br />{settings.roster_min ?? '—'} min / {settings.roster_max ?? '—'} max</div>
      <div><strong>Conferences</strong><br />{settings.conferences.join(', ') || 'None'}</div>
      <div><strong>Divisions</strong><br />{settings.divisions.join(', ') || 'None'}</div>
      <div style={{ gridColumn: '1 / -1' }}><strong>Rules notes</strong><br />{settings.rules_notes || 'None'}</div>
    </div>
  );
}

export function LeagueSettingsHistoryView({ current, history }: { current?: LeagueSettingsVersion; history: LeagueSettingsVersion[] }) {
  if (!current && history.length === 0) return <div style={{ padding: '16px', color: 'var(--steel)' }}>No settings versions yet.</div>;
  const prior = history.filter(version => version.id !== current?.id && !version.is_active);
  return (
    <>
      {current && <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', fontFamily: 'var(--data)', fontSize: '11px' }}><strong>Current version {current.version}</strong> · {new Date(current.changed_at).toLocaleString()} · by {current.changed_by}<div style={{ marginTop: 4, color: 'var(--steel)' }}>{current.change_summary}</div></div>}
      {prior.map(version => <div key={version.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', fontFamily: 'var(--data)', fontSize: '11px' }}><strong>Version {version.version}</strong> · {new Date(version.changed_at).toLocaleString()} · by {version.changed_by}<div style={{ marginTop: 4, color: 'var(--steel)' }}>{version.change_summary}</div></div>)}
      {current && prior.length === 0 && <div style={{ padding: '12px 16px', color: 'var(--steel)' }}>No prior versions.</div>}
    </>
  );
}

export function activeSettingsFromResponse(response: LeagueSettingsVersion | { data: null } | undefined): LeagueSettingsVersion | undefined {
  return response && !('data' in response) ? response : undefined;
}

export default function LeagueSettings({ leagueId, editable = false }: { leagueId: string; editable?: boolean }) {
  const { data: response, isLoading, error } = useGetLeagueSettings(leagueId);
  const { data: templatesData } = useListLeagueSettingsTemplates();
  const { data: historyData } = useListLeagueSettingsHistory(leagueId);
  const { data: seasonsData } = useListSeasons(leagueId);
  const current = activeSettingsFromResponse(response);
  const history = historyData?.data ?? [];
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LeagueSettingsInput>(balancedSettingsFallback);
  const [message, setMessage] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const initializedFor = useRef<string | null>(null);
  const createVersion = useCreateLeagueSettingsVersion({ request: { headers: { 'Idempotency-Key': idempotencyKey } } });
  const templates = templatesData?.data ?? [];
  const activeSeason = seasonsData?.data.find(season => season.is_active);

  useEffect(() => {
    const key = current?.id ?? (response && 'data' in response ? 'empty' : null);
    if (!key || initializedFor.current === key) return;
    if (current) setForm({ ...current, change_summary: '', apply_to_active_season: false });
    else {
      const balanced = templates.find(template => template.id === 'balanced_standard');
      setForm(balanced ? settingsFromTemplate(balanced) : balancedSettingsFallback);
    }
    initializedFor.current = key;
  }, [current, response, templates]);

  const canEdit = editable && (!current || current.can_manage);
  const heading = current ? 'League Settings Editor' : 'Create League Settings';
  const statusColor = useMemo(() => message?.startsWith('New') ? '#1F7A4C' : 'var(--goal)', [message]);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (form.roster_min != null && form.roster_max != null && form.roster_min > form.roster_max) {
      setMessage('Roster minimum cannot exceed roster maximum.');
      return;
    }
    createVersion.mutate({ leagueId, data: { ...form, change_summary: form.change_summary.trim() } }, {
      onSuccess: async () => {
        setMessage('New immutable settings version saved.');
        setIdempotencyKey(crypto.randomUUID());
        const affected = ['settings', 'history', 'seats', 'seasons', 'schedule', 'weeks', 'games'];
        await queryClient.invalidateQueries({ predicate: query => affected.some(term => JSON.stringify(query.queryKey).includes(term)) });
      },
      onError: mutationError => setMessage(mutationError instanceof Error ? mutationError.message : 'Unable to save settings.'),
    });
  };

  if (isLoading) return <div style={{ padding: 30, textAlign: 'center' }}>Loading league settings…</div>;
  if (error) return <div className="panel" style={{ padding: 20, color: 'var(--goal)' }}>League settings are not available.</div>;
  if (!current && !editable) return <div className="panel" style={{ padding: 20, color: 'var(--steel)' }}>No league settings have been created yet.</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: canEdit ? 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))' : '1fr', gap: 20 }}>
      <div>
        {canEdit ? (
          <form className="panel" onSubmit={save}>
            <div className="panel-head"><h2>{heading}</h2><span className="note">Creates version {(current?.version ?? 0) + 1}</span></div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {!current && <div style={{ padding: '10px 12px', background: '#EEF5FB', border: '1px solid #B9D1E6', fontSize: 13 }}>No active settings exist yet. Start from a template, review the fields, and save version 1.</div>}
              <TemplatePicker templates={templates} onApply={template => { setForm(settingsFromTemplate(template)); setMessage(`${template.name} values applied. Review or adjust them before saving.`); }} />
              <LeagueSettingsFields value={form} onChange={setForm} />
              {current && activeSeason && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 12, border: '1px solid #D7A72F', background: '#FFF8E5' }}>
                  <input type="checkbox" checked={Boolean(form.apply_to_active_season)} onChange={event => setForm(previous => ({ ...previous, apply_to_active_season: event.target.checked }))} />
                  <span><strong>Applies to new seasons. Also apply to {activeSeason.label || `Season ${activeSeason.ordinal}`}?</strong><small style={{ display: 'block', marginTop: 3 }}>This explicitly updates the running season snapshot.</small></span>
                </label>
              )}
              {message && <div role="status" style={{ fontFamily: 'var(--data)', fontSize: 12, color: statusColor }}>{message}</div>}
              <button className="btn" type="submit" disabled={createVersion.isPending} style={{ alignSelf: 'flex-start' }}>{createVersion.isPending ? 'Saving…' : `Save Version ${(current?.version ?? 0) + 1}`}</button>
            </div>
          </form>
        ) : (
          <div className="panel">
            <div className="panel-head"><h2>Active League Settings</h2><span className="note">Version {current?.version}</span></div>
            {current && <LeagueSettingsSummary settings={current} />}
            {editable && current && !current.can_manage && <div style={{ padding: '0 16px 16px', color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: 11 }}>Settings are read-only for league members.</div>}
          </div>
        )}
      </div>
      <aside className="panel" style={{ alignSelf: 'start' }}><div className="panel-head"><h2>Version History</h2></div><LeagueSettingsHistoryView current={current} history={history} /></aside>
    </div>
  );
}