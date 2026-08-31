# Front Office — project context

> Replit Agent: read this file at the start of **every** task. It is the
> permanent contract for this project. Where a request in chat conflicts with a
> hard rule below, stop and say so rather than silently working around it.

---

## What this is

A platform that helps people run **NHL 27 Connected Franchise leagues** — up to
32 human GMs each. Leagues play inside the game; their schedule, standings,
contracts, trades, and franchise history live here and carry forward into NHL
28, 29, and beyond.

The customer is the **commissioner**. Everyone else joins because the
commissioner already did. Optimize every decision for reducing commissioner
labor.

The product's value is being the **trustworthy record**. Speed and features
matter less than being correct and auditable. A league that catches the app
disagreeing with its own game log will never trust it again.

---

## Stack (do not swap without asking)

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere, strict mode on, `noUncheckedIndexedAccess: true` |
| Frontend | React + Vite |
| Backend | Express 5 + TypeScript |
| Database | Replit PostgreSQL |
| Query layer | Drizzle ORM for local identity tables only; raw `pool.query()` for all domain tables |
| Validation | Zod v3 (not v4 — do not use `zod.uuid()`, `zod.email()`, `zod.url()`) |
| API contract | `lib/api-spec/openapi.yaml` → Orval codegen → typed React Query hooks + Zod validators |
| Testing | Vitest |
| Styling | Plain CSS with design tokens from `design/league-hub-mockup.html` |

**No Next.js, no Prisma, no Tailwind, no component library, no ORM migrations
that rewrite `db/schema.sql`.** The SQL file is the source of truth for the
schema; Drizzle types are generated to match it, never the other way around.

---

## Hard rules

These are not preferences. Violating any of them breaks the product's core
promise, and several are load-bearing for correctness.

### 1. Standings and cap are computed, never stored

There is no `points` column. There is no `cap_used` column. They are SQL views
(`v_standings`, `v_cap_position`) recomputed on read. Never add an endpoint,
field, or admin screen that edits a derived value. Correcting a game result must
be the only way the table changes.

### 2. Facts are append-only

`game_result`, `contract`, `transaction_event`, and `giving_event` are never
`UPDATE`d and never `DELETE`d. A correction inserts a new row and sets
`superseded_by` plus a `supersede_reason` on the old one. A reversed trade is a
new transaction pointing at the one it undoes.

Query active rows with `WHERE superseded_by IS NULL`.

### 3. Every fact carries provenance

`data_source`, `ingest_batch_id`, `confidence`, `reported_by`, `verified_by`.
Never insert a fact without them. Machine-parsed data (`ocr`) must never count
toward standings until a human confirms it.

### 4. Authorization is centralized

All permission checks go through one module: `artifacts/api-server/src/server/authz.ts`.
Never write an inline ownership check in a route handler. A GM writes only their
own team's data; a commissioner writes league-scoped data; nobody edits a
derived value.

### 5. No money movement, ever

No balances, no pooled funds, no payment processing, no card data, no processor
credentials, no raffles or anything with a chance element. The charity layer
records donation *receipts* issued elsewhere. Money is modeled in integer cents
and never moved. See `docs/charity-addendum.md` §4 — the absence of these tables
is the compliance posture.

### 6. Money is integer cents

`BIGINT` cents everywhere. Never floats, never dollars in the database.

### 7. Time is UTC, windows not clock times

`TIMESTAMPTZ` in UTC everywhere. Games have `window_opens_at` and
`window_closes_at`, not a single scheduled time — 32 adults across six time
zones cannot reliably meet at 8:15 PM. Store the user's IANA timezone and
convert at the edge.

### 8. Domain logic stays pure

Standings, cap legality, tiebreakers, and schedule generation live in
`artifacts/api-server/src/server/core/` as pure functions with **no database
access and no imports from Express or Drizzle**. Test them independently.

### 9. All auth flows through one adapter

Route handlers never import Clerk directly. They call `getCurrentUser(req)` from
`artifacts/api-server/src/server/auth/index.ts`. Clerk browser sessions use
same-origin cookies; never add browser bearer-token handling.

### 10. OpenAPI is the contract

`lib/api-spec/openapi.yaml` is written first, then `pnpm --filter @workspace/api-spec run codegen`
is run, then the generated hooks and Zod schemas are used. Never write parallel
types by hand. Never edit files under `lib/api-*/src/generated/`.

### 11. Idempotency is table-backed

Every mutating request that carries `Idempotency-Key` is handled by the
`idempotency_key` table. Not in-memory, not Redis — the table survives Replit
restarts and is the source of truth for replays.

### 12. Optimistic locking on results

Confirm, dispute, and supersede operations on `game_result` require an
`If-Match` header carrying `game_result.version`. A stale token returns 409
Conflict, never a silent overwrite.

### 13. Self-confirmation is forbidden

The same `app_user.id` that reported a result cannot confirm it. Enforced at
the route level, tested explicitly.

### 14. No RLS in Phase 1

Authorization is enforced entirely in `authz.ts`. RLS is deferred to Phase 2
with a dedicated non-owner app role. Do not half-implement RLS.

### 15. Zod v3 constraint — no `format: uuid/email/uri` in OpenAPI

Orval 8.22 generates `zod.uuid()` / `zod.email()` / `zod.url()` from those
formats — Zod v4 APIs that don't exist in v3. Use only `format: date-time` and
`format: date`. See `lib/api-spec/patch-api-zod-index.mjs` for the COLLIDING_NAMES
patch that must run after every codegen.

### 16. `app_user` is provisioned for Clerk identities

The Clerk identity middleware preserves a migrated account's legacy subject
from `sessionClaims.userId` and uses it as the domain bridge. It provisions a
new `app_user` row for new Clerk accounts when their email is available.
Domain routes look up `app_user.id` by that bridge; if provisioning breaks,
every domain query silently returns nothing.

---

## Replit-specific implementation notes

- **Connection pool**: bounded at `max: 10` (`@workspace/db`) — Replit restarts exhaust unpooled connections fast.
- **Port**: read from `process.env.PORT`; never hardcode. Vite config uses it too.
- **Drizzle push**: requires a TTY when other tables exist — can't run non-interactively. Apply schema changes with `executeSql` from the CodeExecution sandbox.
- **Auth adapter**: `artifacts/api-server/src/server/auth/index.ts` — the sole route-level identity bridge. Keep Clerk server-side and use cookies in the web app.
- **Idempotency column**: DB column is `request_digest` (not `body_hash`). Middleware resolves `app_user.id` by `replit_id` before the DB lookup.
- **Codegen patch**: `lib/api-spec/patch-api-zod-index.mjs` maintains `COLLIDING_NAMES`. Add every new body schema name when adding new OpenAPI operations, or expect TS2308 "only refers to a type" errors.

---

## Reference docs

| File | When to read it |
|---|---|
| `PHASE_1_SCOPE.md` | Before any build turn — what's in scope and the checkpoint order |
| `docs/front-office-v1-spec.md` | Full product spec — the why behind each feature |
| `docs/front-office-data-model.md` | Entity relationships — before touching the schema |
| `docs/front-office-architecture.md` | System design decisions |
| `docs/review-fixes.md` | Pre-build review — lists what's already been fixed |
| `docs/threat-model.md` | Any security or data-exposure decision |
| `docs/membership-addendum.md` | Membership, invites, join requests. Phase 2 |
| `docs/keeper-addendum.md` | Keeper leagues. Phase 2 |
| `docs/registry-sync-spec.md` | NHL registry sync and stat-card refresh. Phase 2 |
| `docs/charity-addendum.md` | Charity/giving layer. Phase 3 |
| `docs/discovery-addendum.md` | Open leagues, sign-up, ranked division, hidden rating, waitlist, footer. Phase 3 |
| `design/league-hub-mockup.html` | Visual reference — open in browser |
| `design/open-leagues-mockup.html` | Open leagues UI reference. Phase 3 |
| `design/team-admin-keepers-mockup.html` | Team admin / keeper UI reference. Phase 2 |
| `db/schema.sql` | Full Postgres schema source of truth |
| `db/schema-platform.sql` | Platform type enum delta (CP2) |
| `db/schema-membership.sql` | Membership tables delta. Phase 2 |
| `db/schema-keepers.sql` | Keeper tables delta. Phase 2 |
| `db/schema-discovery.sql` | Discovery/marketplace tables delta. Phase 3 |
| `db/data-quality-checks.sql` | DQ stored procedures — apply in CP6 |
| `api/openapi.yaml` | External/partner API spec reference |

---

## Out of scope — do not build these

Building any of these is a bug, not initiative:

- Payment processing, dues collection, prize pools, raffles
- Screenshot parsing / OCR (Phase 4, needs a labeled eval set first)
- A GM marketplace (Phase 3)
- The charity layer (Phase 3)
- Draft rooms (season 2 onward)
- Real-time websockets — polling is fine for a page checked twice a day
- Native mobile apps
- Microservices, message queues, caching tiers, a separate analytics store
- A custom design system beyond tokens and a dozen primitives
- Any EA or NHL trademark in the branding

---

## Conventions

- **Phone-first.** The primary device is a phone on a couch right after a game
  ends. Score entry must work one-handed in under ten seconds.
- **Accessibility is not optional.** WCAG 2.2 AA. Data tables get real
  `<caption>` and `scope`. Goal differential is never signalled by color alone.
  Visible keyboard focus. Respect `prefers-reduced-motion`.
- **Copy is plain and active.** "Report score", not "Submit". The button that
  says "Confirm" produces a message that says "Confirmed."
- **Empty states are invitations**, not apologies. Errors say what happened and
  what to do about it.
- **No secrets in code.** Everything through Replit Secrets. See `.env.example`.

---

## When you are unsure

Ask rather than guess, specifically when:

- A change would require storing a derived value
- A change would require updating or deleting an existing fact row
- A feature would touch money
- A requirement conflicts with `lib/api-spec/openapi.yaml`
- Something in `PHASE_1_SCOPE.md` seems to contradict a hard rule above

Everything else: build it, test it, show it.

---

## User preferences

- Plain CSS with design tokens — no Tailwind
- No component library (no shadcn, no MUI, no Chakra)
- TypeScript strict mode always on, `noUncheckedIndexedAccess: true`
- Raw SQL for complex domain queries; Drizzle ORM only for auth tables
- Zod v3 — never `zod.uuid()`, `zod.email()`, `zod.url()`
