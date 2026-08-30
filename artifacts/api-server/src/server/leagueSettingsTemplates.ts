/**
 * League settings templates — starting points for the settings editor and
 * Create League's collapsed settings step. Platform and team count are
 * deliberately NOT part of a template: they are league-identity facts chosen
 * independently, not operational preferences.
 */

export type LeagueSettingsTemplateFields = {
  roster_source: "manual" | "ea" | "csv_import";
  schedule_format: "round_robin" | "double_round_robin" | "custom";
  schedule_settings: { games_per_matchup: number; week_duration_days: number };
  playoff_format: { teams: number; series_length: 1 | 3 | 5 | 7; reseed_each_round: boolean };
  salary_cap_cents: number | null;
  roster_min: number | null;
  roster_max: number | null;
  divisions: string[];
  conferences: string[];
  rules_notes: string | null;
  slider_presets: {
    gameplay_preset: "simulation" | "competitive" | "arcade";
    contact: "reduced" | "standard" | "heavy";
    fighting: "off" | "standard" | "heavy";
  };
  require_verified_identities: boolean;
  points_win: number;
  points_ot_loss: number;
  points_reg_loss: 0;
  tiebreakers: string[];
  auto_approve_trades: boolean;
  cap_enforcement: "block" | "warn" | "off";
  waiver_window_hours: number;
};

export type LeagueSettingsTemplate = {
  id: string;
  name: string;
  description: string;
  fields: LeagueSettingsTemplateFields;
};

// 2026-27 NHL upper limit.
export const CURRENT_SALARY_CAP_CENTS = 10_400_000_000;

export const LEAGUE_SETTINGS_TEMPLATES: LeagueSettingsTemplate[] = [
  {
    id: "balanced_standard",
    name: "Balanced standard",
    description: "The default for most leagues — capped, standard physicality, a full 16-team playoff bracket.",
    fields: {
      roster_source: "ea",
      // double_round_robin, not round_robin: games_per_matchup=2 below is a
      // home-and-away pair, and validateSettings() (league-settings.ts)
      // requires round_robin to carry games_per_matchup=1 — this template
      // previously combined 'round_robin' with games_per_matchup=2, which
      // is internally inconsistent and made every league seeded from it
      // unable to ever save a settings edit (discovered via prompt C's
      // transactions test exercising a real settings-version save).
      schedule_format: "double_round_robin",
      schedule_settings: { games_per_matchup: 2, week_duration_days: 7 },
      playoff_format: { teams: 16, series_length: 7, reseed_each_round: false },
      salary_cap_cents: CURRENT_SALARY_CAP_CENTS,
      roster_min: 20,
      roster_max: 23,
      divisions: ["Atlantic", "Metropolitan", "Central", "Pacific"],
      conferences: ["Eastern", "Western"],
      rules_notes: null,
      slider_presets: { gameplay_preset: "competitive", contact: "standard", fighting: "standard" },
      require_verified_identities: false,
      points_win: 2,
      points_ot_loss: 1,
      points_reg_loss: 0,
      tiebreakers: ["points", "row", "wins", "goal_diff", "goals_for"],
      auto_approve_trades: false,
      cap_enforcement: "warn",
      waiver_window_hours: 24,
    },
  },
  {
    id: "competitive_hardcore",
    name: "Competitive / hardcore",
    description: "A tighter playoff field, simulation sliders, heavy contact, and verified identities required to claim a seat.",
    fields: {
      roster_source: "ea",
      schedule_format: "double_round_robin",
      schedule_settings: { games_per_matchup: 2, week_duration_days: 7 },
      playoff_format: { teams: 8, series_length: 7, reseed_each_round: true },
      salary_cap_cents: CURRENT_SALARY_CAP_CENTS,
      roster_min: 20,
      roster_max: 23,
      divisions: ["Atlantic", "Metropolitan", "Central", "Pacific"],
      conferences: ["Eastern", "Western"],
      rules_notes: null,
      slider_presets: { gameplay_preset: "simulation", contact: "heavy", fighting: "heavy" },
      require_verified_identities: true,
      points_win: 2,
      points_ot_loss: 1,
      points_reg_loss: 0,
      tiebreakers: ["points", "row", "wins", "goal_diff", "goals_for"],
      auto_approve_trades: false,
      cap_enforcement: "warn",
      waiver_window_hours: 24,
    },
  },
  {
    id: "casual_uncapped",
    name: "Casual / uncapped",
    description: "No salary cap, lighter contact, single round robin — built for a laid-back season with friends.",
    fields: {
      roster_source: "manual",
      schedule_format: "round_robin",
      schedule_settings: { games_per_matchup: 1, week_duration_days: 7 },
      playoff_format: { teams: 16, series_length: 3, reseed_each_round: false },
      salary_cap_cents: null,
      roster_min: 20,
      roster_max: 23,
      divisions: ["Atlantic", "Metropolitan", "Central", "Pacific"],
      conferences: ["Eastern", "Western"],
      rules_notes: null,
      slider_presets: { gameplay_preset: "arcade", contact: "reduced", fighting: "off" },
      require_verified_identities: false,
      points_win: 2,
      points_ot_loss: 1,
      points_reg_loss: 0,
      tiebreakers: ["points", "row", "wins", "goal_diff", "goals_for"],
      auto_approve_trades: false,
      cap_enforcement: "warn",
      waiver_window_hours: 24,
    },
  },
];

export const DEFAULT_LEAGUE_SETTINGS_TEMPLATE_ID = "balanced_standard";

export function getTemplate(id: string | undefined): LeagueSettingsTemplate {
  return (
    LEAGUE_SETTINGS_TEMPLATES.find((t) => t.id === id) ??
    LEAGUE_SETTINGS_TEMPLATES.find((t) => t.id === DEFAULT_LEAGUE_SETTINGS_TEMPLATE_ID)!
  );
}
