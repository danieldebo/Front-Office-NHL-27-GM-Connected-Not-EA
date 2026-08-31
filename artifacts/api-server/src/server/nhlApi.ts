/**
 * Client for the free, keyless public NHL API — docs/registry-sync-spec.md §1.
 *
 * Two hosts, both undocumented-but-stable community-mapped APIs: every
 * response is validated with Zod before it touches `player`, so an upstream
 * shape change quarantines the offending rows instead of corrupting data or
 * crashing the sync (registry-sync-spec.md §2 "Validation before write").
 *
 * IMPORTANT — not verified against the live API in this session: this
 * sandbox's egress policy blocks api.nhle.com and api-web.nhle.com outright
 * (organization policy, confirmed via a direct connectivity test), so the
 * response shapes below are built from the field names documented in
 * registry-sync-spec.md and widely-known community references for this API,
 * not from an actual captured response. Treat the Zod schemas as the
 * contract to verify against a real response the first time this runs
 * somewhere with network access, and expect to adjust field names if the
 * shape has drifted.
 */
import { z } from "zod";

const NHL_STATS_API_BASE = process.env["NHL_STATS_API_BASE"] ?? "https://api.nhle.com/stats/rest/en";
const NHL_WEB_API_BASE = process.env["NHL_WEB_API_BASE"] ?? "https://api-web.nhle.com/v1";
const MAX_RPS = Number(process.env["NHL_API_MAX_RPS"] ?? 4);
const MAX_RETRIES = Number(process.env["NHL_API_MAX_RETRIES"] ?? 4);

// ────────────────────────────────────────────── polite-guest rate limiting
// A single shared token bucket for the whole process — registry sync and
// stat-card refresh both draw from it, per registry-sync-spec.md §4
// ("Rate limit outbound... across the whole app, not per-request").

let tokens = MAX_RPS;
let lastRefill = Date.now();

async function takeToken(): Promise<void> {
  for (;;) {
    const now = Date.now();
    const elapsedSecs = (now - lastRefill) / 1000;
    tokens = Math.min(MAX_RPS, tokens + elapsedSecs * MAX_RPS);
    lastRefill = now;
    if (tokens >= 1) {
      tokens -= 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.ceil((1 - tokens) * (1000 / MAX_RPS))));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function politeFetch(url: string): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await takeToken();
    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(backoffMs(attempt));
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === MAX_RETRIES) return response;
      await sleep(backoffMs(attempt));
      continue;
    }
    return response;
  }
  throw new Error("unreachable");
}

function backoffMs(attempt: number): number {
  const base = 500 * 2 ** attempt;
  const jitter = Math.random() * base * 0.25;
  return base + jitter;
}

// ────────────────────────────────────────────── skater / goalie summaries

const SkaterSummaryRow = z.object({
  playerId: z.number(),
  skaterFullName: z.string().min(1),
  positionCode: z.string().min(1),
  shootsCatches: z.string().nullable().optional(),
  birthDate: z.string().nullable().optional(),
  birthCountryCode: z.string().nullable().optional(),
  teamAbbrevs: z.string().nullable().optional(), // may be comma-joined for a traded player
  sweaterNumber: z.number().nullable().optional(),
  gamesPlayed: z.number().optional(),
  goals: z.number().optional(),
  assists: z.number().optional(),
  points: z.number().optional(),
  plusMinus: z.number().optional(),
  penaltyMinutes: z.number().optional(),
  shots: z.number().optional(),
  timeOnIcePerGame: z.number().optional(),
});
export type SkaterSummaryRow = z.infer<typeof SkaterSummaryRow>;

const GoalieSummaryRow = z.object({
  playerId: z.number(),
  goalieFullName: z.string().min(1),
  shootsCatches: z.string().nullable().optional(),
  birthDate: z.string().nullable().optional(),
  birthCountryCode: z.string().nullable().optional(),
  teamAbbrevs: z.string().nullable().optional(),
  gamesPlayed: z.number().optional(),
  gamesStarted: z.number().optional(),
  wins: z.number().optional(),
  losses: z.number().optional(),
  otLosses: z.number().optional(),
  shutouts: z.number().optional(),
  savePct: z.number().optional(),
  goalsAgainstAverage: z.number().optional(),
  timeOnIce: z.number().optional(), // seconds
  goalsAgainst: z.number().optional(),
  saves: z.number().optional(),
});
export type GoalieSummaryRow = z.infer<typeof GoalieSummaryRow>;

const SummaryPage = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  total: z.number().optional(),
});

export interface PagedFetchResult<T> {
  rows: T[];
  quarantined: number;
}

async function pageSummary<T>(
  endpoint: "skater" | "goalie",
  seasonId: string,
  rowSchema: z.ZodType<T>,
): Promise<PagedFetchResult<T>> {
  const rows: T[] = [];
  let quarantined = 0;
  const limit = 100;
  for (let start = 0; ; start += limit) {
    const cayenneExp = encodeURIComponent(`seasonId=${seasonId} and gameTypeId=2`);
    const url = `${NHL_STATS_API_BASE}/${endpoint}/summary?limit=${limit}&start=${start}&cayenneExp=${cayenneExp}`;
    const response = await politeFetch(url);
    if (!response.ok) {
      throw new Error(`NHL stats API ${endpoint}/summary returned ${response.status} for season ${seasonId}`);
    }
    const parsed = SummaryPage.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(`NHL stats API ${endpoint}/summary response shape did not match: ${parsed.error.message}`);
    }
    for (const raw of parsed.data.data) {
      const row = rowSchema.safeParse(raw);
      if (row.success) rows.push(row.data);
      else quarantined++;
    }
    if (parsed.data.data.length < limit) break;
  }
  return { rows, quarantined };
}

export function fetchSkaterSummaries(seasonId: string): Promise<PagedFetchResult<SkaterSummaryRow>> {
  return pageSummary("skater", seasonId, SkaterSummaryRow);
}

export function fetchGoalieSummaries(seasonId: string): Promise<PagedFetchResult<GoalieSummaryRow>> {
  return pageSummary("goalie", seasonId, GoalieSummaryRow);
}

// ────────────────────────────────────────────── player landing (bio)

const PlayerLanding = z.object({
  playerId: z.number(),
  firstName: z.object({ default: z.string() }).optional(),
  lastName: z.object({ default: z.string() }).optional(),
  position: z.string().optional(),
  currentTeamAbbrev: z.string().nullable().optional(),
  sweaterNumber: z.number().nullable().optional(),
  birthDate: z.string().nullable().optional(),
  birthCountry: z.string().nullable().optional(),
});
export type PlayerLanding = z.infer<typeof PlayerLanding>;

export async function fetchPlayerLanding(nhlPlayerId: number): Promise<PlayerLanding | null> {
  const response = await politeFetch(`${NHL_WEB_API_BASE}/player/${nhlPlayerId}/landing`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`NHL web API player landing returned ${response.status} for player ${nhlPlayerId}`);
  const parsed = PlayerLanding.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

export function nhlSeasonId(endYear: number): string {
  return `${endYear - 1}${endYear}`;
}
