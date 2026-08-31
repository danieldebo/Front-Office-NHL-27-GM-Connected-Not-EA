/**
 * Box score CSV parsing + a heuristic guard against season-total imports.
 *
 * There is no OCR service wired into this repo (no vendor credentials, no
 * sandboxed image-processing dependency), so a "screenshot" upload is never
 * machine-parsed here — it is stored as evidence and a human (the reviewing
 * commissioner) types in the confirmed score when approving it. Only CSV
 * uploads go through parseBoxScoreCsv below.
 *
 * Expected CSV shape (header required, order doesn't matter):
 *   player_name, team, goals, assists
 * `team` must be exactly "home" or "away" (matching the game's own home/away
 * side, not a club name — the uploader doesn't necessarily know club abbrevs).
 */

export class BoxScoreParseError extends Error {}

export interface BoxScoreRow {
  player_name: string;
  team: "home" | "away";
  goals: number;
  assists: number;
}

export interface ParsedBoxScore {
  rows: BoxScoreRow[];
  homeGoals: number;
  awayGoals: number;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

// A per-game guard: any of these signals means the upload looks like it
// carries season aggregates rather than one game's box score. This is a
// heuristic, not a DB constraint — it runs before a row ever reaches the
// pending queue, so a season-shaped CSV is refused outright (never queued).
const SEASON_SHAPED_COLUMNS = ["gp", "games_played", "season", "season_id", "gp_played"];
const MAX_PLAUSIBLE_SINGLE_GAME_GOALS = 10;
const MAX_PLAUSIBLE_SINGLE_GAME_ASSISTS = 15;
const MAX_PLAUSIBLE_ROW_COUNT = 40; // ~2 full rosters; more implies multiple games concatenated

export function parseBoxScoreCsv(csvText: string): ParsedBoxScore {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new BoxScoreParseError("CSV must have a header row and at least one player row");
  }

  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const seasonShapedColumn = header.find((h) => SEASON_SHAPED_COLUMNS.includes(h));
  if (seasonShapedColumn) {
    throw new BoxScoreParseError(
      `This looks like a season-totals export (found a "${seasonShapedColumn}" column) — upload a single game's box score instead`
    );
  }

  const nameIdx = header.indexOf("player_name");
  const teamIdx = header.indexOf("team");
  const goalsIdx = header.indexOf("goals");
  const assistsIdx = header.indexOf("assists");
  if (nameIdx === -1 || teamIdx === -1 || goalsIdx === -1) {
    throw new BoxScoreParseError("CSV header must include player_name, team, and goals columns");
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_PLAUSIBLE_ROW_COUNT) {
    throw new BoxScoreParseError(
      `This looks like it spans more than one game (${dataLines.length} player rows) — upload one game at a time`
    );
  }

  const rows: BoxScoreRow[] = [];
  for (const line of dataLines) {
    const fields = splitCsvLine(line);
    const player_name = fields[nameIdx]?.trim();
    const teamRaw = fields[teamIdx]?.trim().toLowerCase();
    const goals = Number(fields[goalsIdx]);
    const assists = assistsIdx === -1 ? 0 : Number(fields[assistsIdx] ?? 0);

    if (!player_name) {
      throw new BoxScoreParseError("Every row must have a player_name");
    }
    if (teamRaw !== "home" && teamRaw !== "away") {
      throw new BoxScoreParseError(`team must be "home" or "away" (got "${fields[teamIdx]}")`);
    }
    if (!Number.isInteger(goals) || goals < 0) {
      throw new BoxScoreParseError(`Invalid goals value for ${player_name}`);
    }
    if (!Number.isInteger(assists) || assists < 0) {
      throw new BoxScoreParseError(`Invalid assists value for ${player_name}`);
    }
    if (goals > MAX_PLAUSIBLE_SINGLE_GAME_GOALS || assists > MAX_PLAUSIBLE_SINGLE_GAME_ASSISTS) {
      throw new BoxScoreParseError(
        `${player_name}'s line (${goals}G ${assists}A) is implausible for a single game — this looks like a season total`
      );
    }

    rows.push({ player_name, team: teamRaw, goals, assists });
  }

  if (rows.length === 0) {
    throw new BoxScoreParseError("No player rows found");
  }

  const homeGoals = rows.filter((r) => r.team === "home").reduce((sum, r) => sum + r.goals, 0);
  const awayGoals = rows.filter((r) => r.team === "away").reduce((sum, r) => sum + r.goals, 0);

  return { rows, homeGoals, awayGoals };
}
