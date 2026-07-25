# Front Office

Management platform for NHL 27 Connected Franchise leagues. Up to 32 human GMs can track standings, report game results, confirm scores, and manage their franchise from a single hub.

## Architecture

- **Frontend**: React + Vite (TypeScript strict), plain CSS with design tokens, no Tailwind, no component library
- **Backend**: Express 5 + TypeScript, Drizzle ORM for auth tables, raw SQL for Front Office domain tables
- **Auth**: Replit Auth (OIDC/PKCE) — Discord OAuth swaps in Phase 2 without touching callers
- **Database**: Replit Postgres — auth tables managed by Drizzle, Front Office schema applied via `db/schema.sql`
- **API contract**: `lib/api-spec/openapi.yaml` is the single source of truth; codegen produces typed React Query hooks and Zod validators
- **Idempotency**: `idempotency_key` DB table (durable — not in-memory, survives Replit restarts)
- **Authorization**: `artifacts/api-server/src/server/authz.ts` — the SOLE location for permission checks

## Build rules (immutable contract — 16 hard rules)

1. TypeScript strict everywhere. No `any`, no `@ts-ignore`.
2. `lib/api-spec/openapi.yaml` is the single source of truth for the API surface. Write the spec first, run codegen, use the generated hooks and Zod schemas — never write parallel types by hand.
3. `db/schema.sql` is the source of truth for the database schema. Apply via psql/executeSql, not `drizzle push` for Front Office tables. Auth tables (sessions, users) are managed by Drizzle.
4. All permission checks go through `artifacts/api-server/src/server/authz.ts → can()`. Never inline authz logic in route handlers.
5. All auth logic is accessed through `artifacts/api-server/src/server/auth/index.ts → getCurrentUser(req)`. Route handlers never import from Replit Auth directly.
6. Idempotency is enforced by the `idempotency_key` table, not in-memory state.
7. Error responses follow RFC 9457 (`application/problem+json`) via `artifacts/api-server/src/server/errors.ts`.
8. Rate limiting: per-user (60/min) and per-league (300/min) via `rateLimiter.ts`.
9. No RLS in Phase 1. Authorization enforced at the application layer only.
10. `db/schema-membership.sql` and `attached_assets/membership-addendum_*.md` are Phase 2 — do not build them.
11. Connection pool is bounded at `max: 10` to survive Replit restarts.
12. Design tokens come from `design/league-hub-mockup.html`: fonts Anton / IBM Plex Mono / Public Sans, colors --ice / --slab / --bulb / --crease / --goal etc. No Tailwind, no component library.
13. After any OpenAPI spec change, run `pnpm --filter @workspace/api-spec run codegen` before using generated types.
14. Generated files (`lib/api-*/src/generated/`) are never edited by hand.
15. `lib/api-spec/patch-api-zod-index.mjs` runs post-Orval to exclude `ListGamesParams` from the types barrel (TS2308 workaround — see comment in that file for details).
16. Checkpoint scope: only Checkpoint 1 of `docs/PHASE_1_SCOPE.md` is built. Stop before Checkpoint 2.

## Reference docs

- `docs/PHASE_1_SCOPE.md` — six checkpoints; only #1 is in scope now
- `docs/front-office-v1-spec.md` — full product specification
- `docs/front-office-data-model.md` — entity relationships
- `docs/review-fixes.md` — pre-build review, lists what's already fixed
- `design/league-hub-mockup.html` — visual reference (open in browser)
- `db/schema.sql` — full Postgres schema v1.0.1

## User preferences

- Plain CSS with design tokens — no Tailwind
- No component library (no shadcn, no MUI, no Chakra)
- TypeScript strict mode always on
- Raw SQL for complex domain queries; Drizzle ORM only for auth tables
