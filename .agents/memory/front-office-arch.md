---
name: Front Office architecture decisions
description: Key non-obvious decisions made during Checkpoint 1 of the Front Office build; must stay consistent across all future work.
---

## Auth adapter pattern
`artifacts/api-server/src/server/auth/index.ts` exports `getCurrentUser(req)`. Route handlers NEVER import Replit Auth directly. This decouples the auth provider so Discord OAuth can swap in Phase 2 without touching any route handler.

**Why:** Stated requirement in the build spec — auth provider is Phase 1-only.

**How to apply:** Any new route that needs the current user calls `getCurrentUser(req)` from `../server/auth`. Never import from `lib/replit-auth-web` or `openid-client` in route files.

## Raw SQL for Front Office domain tables
Drizzle ORM is used ONLY for the `sessions` and `users` auth tables (see `lib/db/src/schema/auth.ts`). All Front Office domain tables (`league`, `season`, `franchise`, `game`, `game_result`, etc.) use `pool.query()` with raw SQL.

**Why:** Drizzle push requires a TTY when other tables already exist — can't run non-interactively in Replit. Schema was applied directly via `executeSql` from `db/schema.sql`.

**How to apply:** New domain queries go via `pool` from `@workspace/db`. Use `executeSql` for any schema changes, not `drizzle push`.

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
Only Checkpoint 1 of `docs/PHASE_1_SCOPE.md` is built. Do not start Checkpoint 2.
