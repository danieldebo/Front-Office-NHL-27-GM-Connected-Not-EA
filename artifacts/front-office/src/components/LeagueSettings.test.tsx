import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeagueSettingsTemplate, LeagueSettingsVersion } from '@workspace/api-client-react';
import {
  activeSettingsFromResponse,
  balancedSettingsFallback,
  LeagueSettingsFields,
  LeagueSettingsHistoryView,
  LeagueSettingsSummary,
  TemplatePicker,
} from './LeagueSettings';

const settings: LeagueSettingsVersion = {
  id: 'settings-2',
  league_id: 'league-1',
  version: 2,
  changed_by: 'commissioner-1',
  changed_at: '2026-02-20T12:00:00.000Z',
  is_active: true,
  can_manage: true,
  ea_league_id: 'EA-123',
  platform: 'both',
  team_count: 16,
  roster_source: 'ea',
  schedule_format: 'double_round_robin',
  schedule_settings: { games_per_matchup: 2, week_duration_days: 5 },
  playoff_format: { teams: 8, series_length: 7 },
  salary_cap_cents: 50_000_00,
  roster_min: 18,
  roster_max: 23,
  divisions: ['North', 'South'],
  conferences: ['East', 'West'],
  rules_notes: 'Simulation rules apply.',
  slider_presets: { gameplay: 'competitive' },
  require_verified_identities: true,
  points_win: 2,
  points_ot_loss: 1,
  points_reg_loss: 0,
  tiebreakers: ['points', 'rw', 'row'],
  use_league_defaults: true,
  change_summary: 'Adopted five-day matchup windows.',
};

describe('league settings views', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows authoritative schedule and roster settings', () => {
    render(<LeagueSettingsSummary settings={settings} />);
    const summary = screen.getByTestId('league-settings-summary');
    expect(summary.textContent).toContain('double round robin · 2 games per matchup · 5 day weeks');
    expect(summary.textContent).toContain('18 min / 23 max');
    expect(summary.textContent).toContain('North, South');
    expect(summary.textContent).toContain('Verified identitiesRequired');
  });

  it('shows current and prior immutable version metadata', () => {
    const previous = {
      ...settings,
      id: 'settings-1',
      version: 1,
      is_active: false,
      changed_by: 'commissioner-2',
      change_summary: 'Initial settings.',
    };
    render(<LeagueSettingsHistoryView current={settings} history={[settings, previous]} />);
    expect(screen.getByText(/Current version 2/).parentElement?.textContent).toContain('commissioner-1');
    expect(screen.getByText(/Version 1/).parentElement?.textContent).toContain('commissioner-2');
    expect(screen.getByText('Initial settings.')).toBeTruthy();
  });

  it('previews a template and applies it only after confirmation', () => {
    const templates: LeagueSettingsTemplate[] = [
      {
        id: 'balanced_standard',
        name: 'Balanced / Standard',
        description: 'A familiar setup.',
        differences: ['Schedule: weekly', 'Roster: standard', 'Playoffs: 16 teams', 'Rules and gameplay: standard'],
        values: {
          platform: 'both', team_count: 32, roster_source: 'ea', schedule_format: 'round_robin',
          schedule_settings: { games_per_matchup: 1, week_duration_days: 7 },
          playoff_format: { teams: 16 }, salary_cap_cents: null, roster_min: 18, roster_max: 23,
          divisions: [], conferences: [], rules_notes: 'Standard rules.', slider_presets: { contact: 'standard' },
          require_verified_identities: false,
          points_win: 2, points_ot_loss: 1, points_reg_loss: 0,
          tiebreakers: ['points', 'rw', 'row'], use_league_defaults: true,
        },
      },
      {
        id: 'international_style',
        name: 'International-style',
        description: 'Tournament inspired.',
        differences: ['Schedule: compact', 'Roster: larger', 'Playoffs: single elimination', 'Rules and gameplay: fighting off'],
        values: {
          platform: 'both', team_count: 16, roster_source: 'ea', schedule_format: 'double_round_robin',
          schedule_settings: { games_per_matchup: 2, week_duration_days: 5 },
          playoff_format: { teams: 8 }, salary_cap_cents: null, roster_min: 20, roster_max: 25,
          divisions: [], conferences: [], rules_notes: 'International rules.', slider_presets: { fighting: 'off' },
          require_verified_identities: false,
          points_win: 3, points_ot_loss: 1, points_reg_loss: 0,
          tiebreakers: ['points', 'wins'], use_league_defaults: true,
        },
      },
    ];
    const onApply = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<TemplatePicker templates={templates} onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: 'International-style' }));
    expect(screen.getByTestId('settings-template-preview').textContent).toContain('fighting off');
    fireEvent.click(screen.getByRole('button', { name: 'Apply International-style' }));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply International-style' }));
    expect(onApply).toHaveBeenCalledWith(templates[1]);
  });

  it('normalizes the successful no-settings response and shows non-blocking warnings', () => {
    expect(activeSettingsFromResponse({ data: null })).toBeUndefined();
    const onChange = vi.fn();
    render(
      <LeagueSettingsFields
        value={{ ...balancedSettingsFallback, team_count: 10, divisions: ['A', 'B', 'C'], playoff_format: { teams: 16, series_length: 7, reseed: false } }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/not evenly divisible/i)).toBeTruthy();
    expect(screen.getByText(/playoff teams exceed/i)).toBeTruthy();
    expect(screen.queryByText(/JSON/i)).toBeNull();
  });
});