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
| Language | TypeScript everywhere, strict mode on |
| Frontend | React + Vite |
| Backend | Express + TypeScript |
| Database | Replit PostgreSQL |
| Query layer | Drizzle ORM, SQL-first |
| Validation | Zod, shared between client and server |
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

All permission checks go through one module: `server/authz.ts`. Never write an
inline ownership check in a route handler. A GM writes only their own team's
data; a commissioner writes league-scoped data; nobody edits a derived value.

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
`server/core/` as pure functions with **no database access and no imports from
Express**. They take data in and return data out. This is what makes correctness
testable in milliseconds. If you find yourself computing points inside a route
handler, stop and move it.

### 9. Mutations are idempotent

Accept an `Idempotency-Key` header on every POST. Replaying the same key within
24 hours returns the original response. Score submission happens on phones with
bad wifi — retries are the normal case, not an edge case.

### 10. Errors follow RFC 9457

`application/problem+json` with `type`, `title`, `status`, `detail`, and a
`trace_id` on every error response.

### 11. State transitions use optimistic concurrency

Facts are immutable, but a result's *status* (`reported` → `confirmed` /
`disputed`) is a lifecycle field. `game_result.version` is the concurrency
token: return it as the `ETag`, require `If-Match` on confirm/dispute/supersede,
and return 409 on a mismatch. Two GMs racing confirm-and-dispute must never
resolve last-write-wins on the object the whole platform exists to make
unarguable.

### 12. Uploads are hostile until re-encoded

The logo/asset upload path: allowlist `image/png image/jpeg image/webp` only,
cap size (start at 2 MB), **re-encode server-side** (this strips EXIF and
neutralizes an SVG-with-script), verify the content type server-side, and never
serve a user upload from the app's own origin. An SVG logo is a stored-XSS
vector; treat every upload as an attack until it's been through the encoder.

### 13. PII never enters logs, never leaves without scope

Email, gamertag, country, and timezone are PII (see `docs/threat-model.md`).
Logs may carry `user_id` and entity IDs, never PII. `visibility: public`
promotes *standings* to public; it never promotes the *member roster*. The
export endpoint carries PII and is owner/commissioner-only regardless of league
visibility.

### 14. Every mutation is rate-limited

Per-user and per-league limits on writes; per-token limits on export and ingest.
Return 429 with `Retry-After`. Score submission is exempt from aggressive
limits (it's the core loop) but still bounded.

### 15. Relationship tiers are commissioner-private

`relationship_tier` (friend / vip / stranger) on `league_member` is the
commissioner's private read on a member. It is exposed ONLY through
commissioner-scoped endpoints, never on a public or member-facing view, and is
never shown to the member it describes. It never gates gameplay — it's a
courtesy/mail-merge hint, not a privilege level. The platform never infers or
suggests a tier; only the commissioner sets it. See `docs/membership-addendum.md`.

### 16. League email honors opt-out and never ships unconfirmed scores

The weekly commissioner email composes from derived views (confirmed data only),
sends through the outbox (never inline), is idempotent per league per week, and
carries a working unsubscribe that flips `email_opt_in`. A provisioned member
email is PII (rule 13). Templates resolve an allowlist of merge tokens only —
never arbitrary expressions.

---

## Repository layout

```
/client              React + Vite
  /pages             route-level views
  /components        shared UI
  /lib               api client, formatters
/server
  /core              PURE domain logic — no I/O, no express imports
    standings.ts     points, tiebreakers, streaks
    cap.ts           cap hits, roster legality
    schedule.ts      balanced generation, window assignment
    txn.ts           trade validity and execution rules
  /routes            thin HTTP handlers, no business logic
  /db                drizzle client, query helpers
  authz.ts           ALL permission checks
  errors.ts          RFC 9457 problem responses
/shared              Zod schemas used by both sides
/db                  schema.sql, schema-charity.sql, data-quality-checks.sql
/api                 openapi.yaml — the published contract
/docs                specs and architecture decisions
/design              visual reference mockup
/ci                  GitHub Actions — NOT for Replit, ignore for now
/tests
```

---

## Reference material

| File | Read it when |
|---|---|
| `PHASE_1_SCOPE.md` | Always. This is what you are building now |
| `db/schema.sql` | Any data work. This is the schema source of truth |
| `api/openapi.yaml` | Building endpoints. Match paths and shapes exactly |
| `design/league-hub-mockup.html` | Any UI work. Take the tokens and type from here |
| `docs/front-office-v1-spec.md` | Scope questions, what is in and out |
| `docs/front-office-data-model.md` | Why the schema is shaped this way |
| `docs/front-office-architecture.md` | Engineering standards, decision log |
| `docs/charity-addendum.md` | Anything touching giving. Phase 3 |
| `docs/membership-addendum.md` | Seats, member provisioning, tiers, weekly email. Phase 2 |
| `docs/threat-model.md` | Any security or data-exposure decision. Data classes live here |
| `docs/review-fixes.md` | The pre-build review and what was already fixed in the schema/API |

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
- **Small commits with real messages.** State what changed and why.

---

## When you are unsure

Ask rather than guess, specifically when:

- A change would require storing a derived value
- A change would require updating or deleting an existing fact row
- A feature would touch money
- A requirement conflicts with `api/openapi.yaml`
- Something in `PHASE_1_SCOPE.md` seems to contradict a hard rule above

Everything else: build it, test it, show it.
