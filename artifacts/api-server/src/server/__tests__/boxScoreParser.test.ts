import { describe, it, expect } from "vitest";
import { parseBoxScoreCsv, BoxScoreParseError } from "../boxScoreParser";

describe("parseBoxScoreCsv", () => {
  it("parses a valid single-game CSV", () => {
    const csv = [
      "player_name,team,goals,assists",
      "Sidney Crosby,home,2,1",
      "Connor McDavid,away,1,2",
      "Evgeni Malkin,home,0,1",
    ].join("\n");

    const result = parseBoxScoreCsv(csv);
    expect(result.rows).toHaveLength(3);
    expect(result.homeGoals).toBe(2);
    expect(result.awayGoals).toBe(1);
  });

  it("rejects a CSV with fewer than a header + one row", () => {
    expect(() => parseBoxScoreCsv("player_name,team,goals")).toThrow(BoxScoreParseError);
  });

  it("rejects a CSV missing required columns", () => {
    const csv = ["player_name,goals", "Sidney Crosby,2"].join("\n");
    expect(() => parseBoxScoreCsv(csv)).toThrow(/must include/);
  });

  it("rejects a season-totals export via a gp column", () => {
    const csv = [
      "player_name,team,goals,assists,gp",
      "Sidney Crosby,home,40,60,82",
    ].join("\n");
    expect(() => parseBoxScoreCsv(csv)).toThrow(/season-totals/);
  });

  it("rejects implausible single-game stat lines", () => {
    const csv = [
      "player_name,team,goals,assists",
      "Sidney Crosby,home,40,60",
    ].join("\n");
    expect(() => parseBoxScoreCsv(csv)).toThrow(/implausible/);
  });

  it("rejects CSVs spanning more than ~2 rosters worth of rows", () => {
    const rows = Array.from({ length: 41 }, (_, i) => `Player ${i},home,1,0`);
    const csv = ["player_name,team,goals,assists", ...rows].join("\n");
    expect(() => parseBoxScoreCsv(csv)).toThrow(/more than one game/);
  });

  it("rejects an invalid team value", () => {
    const csv = ["player_name,team,goals,assists", "Sidney Crosby,visitor,2,1"].join("\n");
    expect(() => parseBoxScoreCsv(csv)).toThrow(/home.*away/);
  });

  it("handles quoted fields with embedded commas", () => {
    const csv = [
      "player_name,team,goals,assists",
      '"Crosby, Sidney",home,1,0',
    ].join("\n");
    const result = parseBoxScoreCsv(csv);
    expect(result.rows[0]!.player_name).toBe("Crosby, Sidney");
  });
});
