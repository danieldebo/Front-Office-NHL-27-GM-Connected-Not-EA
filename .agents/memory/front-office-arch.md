---
name: Front Office architecture decisions
description: Key non-obvious decisions made during Checkpoint 1 of the Front Office build; must stay consistent across all future work.
---

## Auth adapter pattern
`artifacts/api-server/src/server/auth/index.ts` exports `getCurrentUser(req)`. Route handlers never import Clerk directly; a middleware derives the identity from Clerk’s session claims.

**Why:** Domain tables identify people through the legacy subject held in `app_user.replit_id`, while Clerk has its own native user ID. Migrated users retain the legacy subject in `sessionClaims.userId`.

**How to apply:** Any route needing the current user calls `getCurrentUser(req)` from `../server/auth`. Use `sessionClaims.userId` as the domain bridge, falling back to Clerk’s native ID only for a new account. Web requests use Clerk session cookies only—never add browser bearer tokens.

Authorization resources store `app_user.id` UUIDs, so permission checks must compare them with the authenticated user’s resolved domain UUID rather than the Clerk/legacy external subject.

**Why:** Comparing a league owner UUID with the external auth subject makes valid commissioners receive 403 responses even though authentication succeeded.

## Raw SQL for Front Office domain tables
Drizzle ORM is used ONLY for the `sessions` and `users` auth tables (see `lib/db/src/schema/auth.ts`). All Front Office domain tables (`league`, `season`, `franchise`, `game`, `game_result`, etc.) use `pool.query()` with raw SQL.

**Why:** Drizzle push requires a TTY when other tables already exist — can't run non-interactively in Replit. Schema was applied directly via `executeSql` from `db/schema.sql`.

**How to apply:** New domain queries go via `pool` from `@workspace/db`. Use `executeSql` for any schema changes, not `drizzle push`.

## Required reference data must be provisioned by domain transactions

Do not assume development seed rows will be present in production. Any reference rows required to complete a user-facing write must be ensured idempotently inside that write’s transaction, while preserving historical rows.

**Why:** Production had the season schema but not the club catalog seed data, so season creation returned success while producing zero franchise seats.

**How to apply:** Validate the required key set rather than total table cardinality, because historical reference rows may legitimately remain.

## Orval codegen patch (ListGamesParams TS2308)
`lib/api-spec/patch-api-zod-index.mjs` must run after every Orval codegen. Orval v8.22 emits both a Zod const AND a TypeScript type named `ListGamesParams` (when an operation has both path + query params), causing TS2308 re-export collision. The patch rewrites `lib/api-zod/src/index.ts` with explicit `export type {}` lines that exclude `ListGamesParams`.

**Why:** The codegen script in `lib/api-spec/package.json` already runs this patch automatically. Only relevant if someone bypasses the script or upgrades Orval.

## Zod v3 constraint — no format: uuid/email/uri in OpenAPI
The workspace uses Zod `^3.25.76`. Orval 8.22 generates `zod.uuid()` / `zod.email()` / `zod.url()` which are Zod v4 APIs. All `format: uuid`, `format: email`, `format: uri` fields were removed from `lib/api-spec/openapi.yaml`. Only `format: date-time` and `format: date` are kept.

**Why:** Using those formats causes runtime Zod errors on every validated request.

**How to apply:** Never add `format: uuid`, `format: email`, or `format: uri` to the OpenAPI spec unless the workspace upgrades to Zod v4.

## Authorization sole point
All permission checks go through `artifacts/api-server/src/server/authz.ts → can(user, action, resource)`. Never inline authz logic in route handlers.

## Idempotency — DB-backed
The `idempotency_key` table is used (not in-memory). Survives Replit restarts. Applied via `idempotencyMiddleware` from `artifacts/api-server/src/middlewares/idempotency.ts`.

## Design tokens
From `design/league-hub-mockup.html`: fonts Anton (display), IBM Plex Mono (data), Public Sans (body). Colors: `--ice` (#EDF1F4), `--slab` (#16202A), `--slab-2` (#1E2C39), `--steel` (#5C6B78), `--bulb` (#F2A93B), `--crease` (#2F6FB5), `--goal` (#B33A2B), `--rule` (#D3DBE2), `--ink` (#0E1620), `--paper` (#FFFFFF). No Tailwind, no component library.

## Checkpoint scope
Checkpoints 1, 2, and 3 are complete. CP4+ not yet started.

## app_user identity bridge

`app_user.replit_id` is the domain’s stable external-identity bridge and must remain unique. The Clerk identity middleware provisions a row for a new account when an email claim is available.

**Why:** `app_user` (domain table, id = UUID) is distinct from authentication identity. All domain routes need the UUID via this bridge; without provisioning, domain queries silently return nothing.

## CP3: Orval COLLIDING_NAMES — must add ALL new body schemas
The patch script `lib/api-spec/patch-api-zod-index.mjs` maintains `COLLIDING_NAMES`. Any schema that Orval generates as BOTH a Zod const in `generated/api.ts` AND as a TypeScript type in `generated/types/` must be added here. Body schemas (e.g. `GenerateScheduleBody`, `ShiftWindowBody`) always collide. Symptom: "only refers to a type, but is being used as a value" in route files.

## CP3: idempotency_key uses request_digest, not body_hash
The DB column is `request_digest` (not `body_hash`). The middleware SELECT must query `request_digest`. User UUID (`app_user.id`) is looked up by `replit_id` before the SELECT so the (user_id, key) PK is properly scoped.

## CP3: counts_toward_standings column added to game_result
Added via migration v1.1.0. `competition.ts` INSERTs `FALSE` on report; set to `TRUE` on confirm. Force-resolve synthetic results use `TRUE`. The `v_active_result` view uses game status to determine standings inclusion independently.

## CP3: pure functions in server/core/
`server/core/schedule.ts` — circle-method round-robin, no DB/Express imports. `server/core/availability.ts` — IANA timezone overlap using `Intl.DateTimeFormat`. Both are pure and independently testable. New actions in authz: `schedule:generate`, `game:manage`.

## CP3: Season hook naming
The hook for listing a league's seasons is `useListSeasons(leagueId)` from `@workspace/api-client-react`, not `useGetLeagueSeasons`.

## CP4: Supersede FK — INSERT before UPDATE
`game_result.superseded_by` is a self-referencing FK with no DEFERRABLE. When correcting a result: pre-generate the new ID with `SELECT gen_random_uuid()`, INSERT the new result with that ID first, then UPDATE the old row's `superseded_by` to point at it. Reversed order violates the FK constraint.

## CP4: GET /games/:gameId — raw route, not in OpenAPI
Added `GET /api/games/:gameId` to `competition.ts` as a plain Express route (not in `lib/api-spec/openapi.yaml` and not codegen'd). Frontend loads it with a raw `fetch` + `useQuery`. Use this pattern when a read endpoint is needed quickly without the codegen overhead. Add to OpenAPI when building CP5 game-detail view.

## CP4: ConfirmResult gets gameId from URL query param
Route is `/results/:resultId/confirm?gameId=...`. The gameId is passed as a search param so the page can load game context without being in the React Router state. wouter doesn't pass navigation state natively.

## CP5: standings pure function — `server/core/standings.ts`
`computeStandings(games, config)` — takes an array of `GameRecord` and returns sorted `StandingsEntry[]`. OT wins count toward ROW; SO wins do not. CP6 property-based tests should use this function rather than calling the DB.

## CP5: provenance chip — single `provenance` field from API
`GET /seasons/:seasonId/standings` now returns `provenance: 'confirmed' | 'manual' | 'ocr' | 'reconciled' | 'dispute'` per row. Chip class mapping: `conf`/`man`/`ocr`/`ea`/`dispute`. The SQL computes it in one combined query (UNION ALL home+away sides, BOOL_OR for dispute, MAX src_rank for data_source).

## CP5: public `/l/:slug` route
`GET /api/l/:slug` (no auth) returns `{ league, season, standings }`. Mounted in `leagues.ts`. Frontend at `/l/:slug` renders `LeaguePublic.tsx` using `useGetPublicLeague(slug)` — generated hook in api-client-react. Route has **no AuthGate** in App.tsx.

## CP5: hub `my_games_this_week` now includes results
League hub SQL query LEFT JOINs `game_result` so `my_games_this_week` entries carry the `result` object. Before this fix, MyWeek showed no scores for reported games.

## CP5: LeagueSlab h1 is personalized
`slabCopy(hub)` derives the hero h1 from `my_games_this_week` counts: disputed → "A result is disputed.", pending → "You owe N game(s).", reported → "Awaiting confirmation.", else → "All clear."

## CP4: Idempotency key on report — stable per session
`ReportResult.tsx` generates the idempotency key once with `useRef(crypto.randomUUID())` — same key if the component re-renders, new key on fresh mount. If the user navigates away and back, they get a new key (which is correct — new submission intent).

## Seasons bind to immutable operational settings

Each season must retain the exact league settings version active when the season is created. Later settings edits apply to future seasons and must not retroactively alter seat counts, cap/roster rules, or schedule generation for an existing season.

**Why:** Reading the league's mutable active-settings pointer during season operations can make an established season internally inconsistent after an unrelated settings edit.

**How to apply:** Resolve seat, roster, cap, and scheduling rules through the season's immutable settings-version binding. Treat null rules as intentional; never fall back to legacy request fields. Backfills must create one preserved snapshot per historical season, not bind all history to one active/default version.
