import { describe, expect, it } from "vitest";
import {
  LEAGUE_SETTINGS_TEMPLATES,
  templateChangeSummary,
  validateSettings,
} from "../league-settings.js";

const valid = {
  team_count: 16,
  schedule_format: "round_robin",
  schedule_settings: { games_per_matchup: 2 },
  playoff_format: { teams: 8 },
  roster_min: 20,
  roster_max: 23,
  divisions: ["East", "West"],
  conferences: ["National"],
  points_win: 2,
  points_ot_loss: 1,
  points_reg_loss: 0,
  tiebreakers: ["points", "rw", "row", "wins", "diff", "gf"],
};

describe("league settings validation", () => {
  it("keeps every curated template complete and valid", () => {
    expect(LEAGUE_SETTINGS_TEMPLATES.map(template => template.id)).toEqual([
      "balanced_standard",
      "international_style",
      "maximum_fighting_contact",
    ]);
    for (const template of LEAGUE_SETTINGS_TEMPLATES) {
      expect(validateSettings(template.values)).toBeNull();
      expect(template.differences).toHaveLength(4);
    }
    expect(LEAGUE_SETTINGS_TEMPLATES[0].values).toMatchObject({
      salary_cap_cents: 10_400_000_000,
      roster_min: 20,
    });
    expect(LEAGUE_SETTINGS_TEMPLATES[2].values).toMatchObject({
      salary_cap_cents: 10_400_000_000,
      roster_min: 20,
    });
  });

  it("rejects stale template identifiers and records valid choices in the summary", () => {
    expect(templateChangeSummary("retired_template", "New setup")).toEqual({
      error: "The selected settings template is no longer available.",
    });
    expect(templateChangeSummary("international_style", "Shorter season")).toEqual({
      changeSummary: "Applied International-style template — Shorter season",
    });
  });

  it("keeps the persisted template change summary within the contract limit", () => {
    expect(templateChangeSummary("balanced_standard", "x".repeat(500))).toEqual({
      error: "The change summary is too long after adding the applied template name.",
    });
  });

  it("accepts a complete valid operational configuration", () => {
    expect(validateSettings(valid)).toBeNull();
  });

  it("rejects a custom schedule without a bounded games-per-matchup", () => {
    expect(validateSettings({
      ...valid,
      schedule_format: "custom",
      schedule_settings: { games_per_matchup: 0 },
    })).toMatch(/games_per_matchup/);
  });

  it("warns in the client rather than rejecting playoff counts above team count", () => {
    expect(validateSettings({
      ...valid,
      playoff_format: { teams: 17 },
    })).toBeNull();
  });

  it("rejects roster rules that exceed their bounds", () => {
    expect(validateSettings({
      ...valid,
      roster_min: 24,
      roster_max: 23,
    })).toMatch(/roster_min/);
  });

  it("rejects duplicate organization names", () => {
    expect(validateSettings({
      ...valid,
      divisions: ["East", "East"],
    })).toMatch(/divisions/);
  });

  it("rejects fractional values for integer-backed rules", () => {
    expect(validateSettings({ ...valid, team_count: 16.5 })).toMatch(/team_count/);
    expect(validateSettings({ ...valid, salary_cap_cents: 1000.25 })).toMatch(/salary_cap_cents/);
    expect(validateSettings({ ...valid, roster_min: 18.5 })).toMatch(/roster_min/);
    expect(validateSettings({ ...valid, roster_max: 23.5 })).toMatch(/roster_max/);
  });
});