import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LeagueSettingsVersion } from '@workspace/api-client-react';
import { LeagueSettingsHistoryView, LeagueSettingsSummary } from './LeagueSettings';

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
  change_summary: 'Adopted five-day matchup windows.',
};

describe('league settings views', () => {
  afterEach(cleanup);

  it('shows authoritative schedule and roster settings', () => {
    render(<LeagueSettingsSummary settings={settings} />);
    const summary = screen.getByTestId('league-settings-summary');
    expect(summary.textContent).toContain('double round robin · 2 games per matchup · 5 day weeks');
    expect(summary.textContent).toContain('18 min / 23 max');
    expect(summary.textContent).toContain('North, South');
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
});