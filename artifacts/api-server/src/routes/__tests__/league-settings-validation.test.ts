import { describe, expect, it } from "vitest";
import { validateSettings } from "../league-settings.js";

const valid = {
  team_count: 16,
  schedule_format: "round_robin",
  schedule_settings: {},
  playoff_format: { teams: 8 },
  roster_min: 18,
  roster_max: 23,
  divisions: ["East", "West"],
  conferences: ["National"],
};

describe("league settings validation", () => {
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

  it("rejects playoff and roster rules that exceed their bounds", () => {
    expect(validateSettings({
      ...valid,
      playoff_format: { teams: 17 },
    })).toMatch(/playoff_format/);
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