# Front Office — Architecture & Engineering Standards

**Doc version:** 1.0
**Status:** Proposed
**Companion docs:** `front-office-v1-spec.md`, `front-office-data-model.md`, `schema.sql`

This document records *why* each choice was made, so a future maintainer (including future you)
can tell a deliberate decision from an accident. Decisions are indexed as ADRs in §11.

---

## 0. Sizing the problem honestly

Architecture should be proportional to load. The numbers here are small:

| Metric | Estimate at 100 active leagues |
|---|---|
| Games per season, per league | ~1,300 |
| Skater stat rows per season, per league | ~48,000 |
| Total rows after 3 seasons | low tens of millions |
| Peak concurrent users | hundreds, not thousands |
| Write pattern | bursty, human-paced, tiny payloads |
| Read pattern | read-heavy, highly cacheable |

This is a **single Postgres instance** problem. Anything that adds distributed-systems failure
modes — microservices, event brokers, sharding, a separate analytics warehouse — buys nothing
and costs a great deal in operational surface. The engineering risk here is correctness and
trust, not throughput, and the architecture should spend its complexity budget accordingly.

---

## 1. Application architecture

**Modular monolith.** One deployable, with enforced internal module boundaries:

```
/core        domain logic — pure, no I/O, no framework imports
  /standings   points, tiebreakers, streaks
  /cap         cap hits, legality, roster limits
  /schedule    generation, window assignment, availability overlap
  /txn         trade validity, approval rules, execution
/data        repositories, migrations, query layer
/api         HTTP surface — thin, no business logic
/web         UI
/jobs        scheduled work — window close, digests, data quality
/ingest      batch pipeline — screenshots, CSV, future partner feed
```

The rule that makes this worth doing: **`/core` is pure and dependency-free.** Standings and cap
legality are deterministic functions of an event list. They import nothing, touch no database,
and are testable in milliseconds. Every homebrew league tracker that eventually disagrees with
its own game log got there by scattering that arithmetic across request handlers.

**Stack.** TypeScript end to end, Postgres 15+, Next.js (App Router) on a managed host, Drizzle
as a SQL-first query layer. Rationale: one language across API and UI removes a whole class of
serialization bugs; Drizzle keeps the hand-authored DDL in `schema.sql` as the source of truth
rather than hiding it behind ORM abstractions; managed Postgres with branching gives per-PR
preview databases nearly free. A Rails or Django monolith would also be a defensible answer —
the modular boundaries matter more than the framework.

---

## 2. Data pipeline discipline

This is where the interesting engineering lives, and where the EA-readiness posture pays off.

### 2.1 Medallion layering

The ingest path follows the standard bronze/silver/gold pattern, which the schema already
implements under different names:

| Layer | Meaning | In this system |
|---|---|---|
| **Bronze** | Raw, immutable, exactly as received | `ingest_batch.raw_payload` + `payload_digest` |
| **Silver** | Validated, conformed, deduplicated, identity-resolved | `game_result`, `skater_game_stat`, `contract`, `transaction_event` |
| **Gold** | Serving layer, business-ready | `v_standings`, `v_cap_position`, `v_league_health` |

Never parse without landing the raw payload first. When a screenshot parses wrong or a partner
feed changes shape, the raw bytes are the only thing that lets you diagnose it, and the digest
is what lets you prove what arrived.

### 2.2 Idempotency

Every ingest is keyed by `(source, natural_key, payload_digest)`. Re-submitting an identical
payload is a no-op that returns the original result rather than a duplicate. This is not
optional: score submission happens on phones, on hotel wifi, immediately after a game, and
double-submission is the normal case, not the edge case.

Mutating HTTP endpoints accept an `Idempotency-Key` header (the Stripe-style convention) with a
24-hour replay window.

### 2.3 Validation and quarantine

Schema-on-write with a shared validation contract (Zod at the edge, JSON Schema for the public
API, both generated from one source). Invalid rows go to a quarantine table with the failure
reason — **a bad row never fails the whole batch, and a bad row is never silently dropped.**
Both failure modes destroy trust in a system whose entire value proposition is being the
trustworthy record.

### 2.4 Dimensional modeling

`franchise`, `player`, and `contract` are effectively **Slowly Changing Dimension Type 2** —
change is captured by writing a new row and closing the old one (`superseded_by`, `ended_at`),
never by mutation. Naming it correctly matters: any data engineer reading `schema.sql`
recognizes the pattern immediately and knows how to query it.

`game_result` and `transaction_event` are an **append-only event log**; the views are the read
models. That is CQRS in its useful, boring form — no separate write store, no eventual
consistency, just a discipline about where numbers come from.

### 2.5 Replay and backfill

Because facts are append-only and read models are derived, the entire serving layer can be
rebuilt from the event log at any time. That property is doing several jobs at once:

- **Disaster recovery** — rebuild, don't restore-and-pray
- **Schema evolution** — change how standings are computed, recompute all history
- **Late-arriving data** — a result confirmed three weeks late corrects the table automatically
- **Partner reconciliation** — the EA-feed procedure in the data model doc is just a replay with
  a higher-authority source

### 2.6 Data quality as code

Assertions run on a schedule and after every ingest batch (see `data-quality-checks.sql`):
freshness, uniqueness, referential integrity, and business invariants (`GP = W + L + OTL`,
`PTS = 2W + OTL`, no team faces itself, no negative goals, every confirmed game has exactly one
active result). Failures page the commissioner, not you — most are league behavior, not bugs.

---

## 3. API design

- **Two surfaces.** Typed RPC internally between web and server for velocity; a small,
  **OpenAPI 3.1**-documented REST surface for exports, imports, and any future partner. The
  public surface is deliberately narrow — it is a contract you have to keep.
- **Versioning.** `/v1/` in the path. Additive changes only within a major version. Deprecations
  announce with a `Sunset` header (RFC 8594) and a minimum 90-day window.
- **Errors.** `application/problem+json` per **RFC 9457** — machine-readable `type`, human
  `detail`, and a `trace_id` on every response so a support conversation starts with an ID
  instead of a screenshot.
- **Pagination.** Cursor-based, never offset. Offset pagination over an append-only wire feed
  silently skips rows as new ones arrive.
- **Caching.** `ETag`/`If-None-Match` on public league pages; cache tags invalidated on result
  confirmation. Public pages are the acquisition channel and should be nearly free to serve.

---

## 4. Concurrency and correctness

Three real bug classes, each with a standard fix:

1. **Concurrent cap-legal trades.** Two trades that are each legal in isolation can be illegal
   together. Fix: execute inside a transaction that takes `SELECT … FOR UPDATE` on every
   participating `team_season` row, in a deterministic sort order to avoid deadlock, and
   re-checks legality inside the lock.
2. **Lost updates on concurrent edits.** Optimistic concurrency — clients send the version they
   read (`If-Match`), a mismatch returns 409 with the current state. Never last-write-wins on
   anything a human argues about.
3. **Side effects on rolled-back writes.** A Discord post announcing a trade that then failed is
   worse than no post. Fix: the **transactional outbox** — side effects are rows written in the
   same transaction as the business change, drained by a worker with at-least-once delivery and
   idempotent handlers.

---

## 5. Frontend

- **Server-rendered public pages.** Every public league page must be crawlable, linkable, and
  fast — it is the growth loop. Incremental regeneration with tag-based invalidation on result
  confirmation.
- **Performance budget.** LCP under 2.5s, INP under 200ms, CLS under 0.1 on a mid-range Android
  over 4G. The primary device is a phone on a couch, not a desktop.
- **Offline-tolerant score entry.** Optimistic UI, mutation queued with an idempotency key,
  reconciled on reconnect. The submit action must survive a dead elevator.
- **Design tokens.** The palette, type scale, and chip/table primitives from the mockup become
  tokens, not per-page CSS. The provenance chip in particular is a reusable primitive because it
  appears anywhere a number appears.
- **Accessibility: WCAG 2.2 AA.** Data tables get real `<caption>` and `scope` attributes;
  goal differential is never communicated by color alone; keyboard focus is always visible;
  motion respects `prefers-reduced-motion`. Sports data tables are exactly the content screen
  readers handle worst when built carelessly.

---

## 6. Platform and delivery

- **Trunk-based development.** Short-lived branches, PR required, CI gate on lint, typecheck,
  unit, integration, and a migration dry-run.
- **Forward-only migrations, expand/contract.** Add the new column, backfill, switch reads,
  *then* drop the old one — across separate deploys. A destructive migration in a single deploy
  is how you lose a league's season.
- **Environments.** Ephemeral preview (branch DB per PR) → staging seeded with an anonymized
  clone → production. Never test against production data.
- **Feature flags** for phased rollout, especially screenshot ingest, which should go to three
  friendly leagues before it goes to a hundred.
- **Backups.** Point-in-time recovery, plus a weekly logical export **through the public export
  contract**. Dogfooding the export path means it is always known-working on the day a partner
  asks for it — and a restore drill is scheduled quarterly, because an untested backup is a
  rumor.
- **SLOs.** 99.9% availability on read paths, p95 API latency under 300ms, ingest freshness
  under 60s. Alert on error-budget burn rate, not on raw error counts.

---

## 7. Observability

- **OpenTelemetry** for traces, metrics, and structured logs, correlated by trace ID. One
  vendor-neutral instrumentation layer so the backend choice stays reversible.
- **RED metrics** (rate, errors, duration) per endpoint; USE metrics on the database.
- **Business metrics are first-class**, and matter more here than infrastructure metrics:
  games confirmed within window, median time-to-confirm, ghost rate, median time-to-fill an open
  seat, disputes per 100 games. These are the numbers that predict whether leagues survive, and
  survival is the product.
- **Every user-visible error carries a trace ID.** Support starts with an identifier.

---

## 8. Security, privacy, and multi-tenancy

- **Tenancy.** Shared schema, `league_id` on every scoped table, enforced by **Postgres
  row-level security** rather than application `WHERE` clauses. Authorization enforced at the
  data layer cannot be forgotten in a new endpoint — this is the single highest-leverage
  security decision in the system.
- **Authn.** OAuth via Discord. The audience already lives there, it removes password storage
  entirely, and it makes league invite flows nearly frictionless. Email as fallback.
- **Authz model.** Role per league (`owner`, `commissioner`, `assistant`, `gm`, `spectator`) plus
  ownership checks — a GM writes only their own team's data; a commissioner writes league-scoped
  data; nobody edits a derived value.
- **Baseline.** OWASP ASVS Level 2 as the checklist. Rate limiting per user and per league,
  CSRF protection, signed short-lived upload URLs for screenshots, EXIF stripped on upload,
  content-type verified server-side.
- **PII minimization.** You store an email, a gamertag, and a time zone. Nothing more, ever.
- **Deletion.** A person can be erased; a league's history cannot. On a deletion request, the
  user record is purged and their participation is **pseudonymized in place** — the franchise
  keeps its record, the games keep their scores, the name becomes "Former GM." This is the
  standard resolution of the tension between erasure rights and other people's legitimate
  records, and the deletion policy should say so plainly.
- **Moderation.** User-uploaded league names, logos, and franchise names need a report path and a
  takedown mechanism from day one. Also: use no EA or NHL marks in platform branding.

---

## 9. Testing

The pyramid, weighted toward where the risk actually is:

- **Unit (heavy).** `/core` is pure functions, so standings, cap, tiebreakers, and trade
  validity get exhaustive coverage. Add **property-based tests** — for any random sequence of
  results, `GP = W + L + OTL`, `PTS = 2W + OTL`, and league-wide `GF = GA` must hold. These
  invariants catch entire bug classes that example-based tests miss.
- **Golden fixtures.** One deterministic, seeded, fully-simulated 32-team season checked into
  the repo with known-correct standings. Any change to the calculators is diffed against it.
- **Integration (moderate).** API against a real Postgres in a container, including RLS policy
  tests — verify that a GM *cannot* write another team's data, as an explicit test, not an
  assumption.
- **Contract tests.** Requests and responses validated against the OpenAPI schema in CI, so the
  published contract cannot drift from the implementation.
- **E2E (thin).** Playwright on three flows only: create a league, submit and confirm a score,
  propose and execute a trade. Those three are the product.
- **Migration tests.** Every migration runs forward against a production-shaped snapshot in CI.

---

## 10. The screenshot ingest is an ML pipeline, not a feature

When v2 lands, treat it with ML engineering discipline rather than as a prompt call:

- **Labeled evaluation set first** — a few hundred real post-game screenshots across both
  consoles, resolutions, and HDR settings, versioned alongside the code.
- **Per-field precision and recall targets**, not an overall accuracy number. Getting the score
  right matters far more than getting blocked shots right, and the metrics should say so.
- **Confidence thresholds with mandatory human confirmation.** Parsed rows land as `ocr`
  source and never count toward standings until a human confirms them. This is already enforced
  by the schema's authority ranking.
- **Regression gate.** Any model or prompt change re-runs the eval set; a drop in score-field
  precision blocks the deploy.
- **Cost ceiling per parse**, monitored, with graceful fallback to manual entry.

---

## 11. Decision log

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| 1 | Modular monolith | Microservices | Load is trivial; distributed failure modes buy nothing |
| 2 | Postgres only | Separate warehouse / OLAP store | Tens of millions of rows is not warehouse scale |
| 3 | Pure, I/O-free `/core` | Logic in handlers | Makes correctness testable in milliseconds |
| 4 | Append-only + derived views | Stored, editable standings | Corrections propagate; disputes become auditable |
| 5 | SCD Type 2 on dimensions | In-place updates | History is the product |
| 6 | Raw payload landing before parse | Parse-on-arrival | Cannot diagnose or reconcile what you did not keep |
| 7 | Idempotency keys on all mutations | Best-effort dedupe | Mobile submission is inherently retried |
| 8 | Postgres RLS for tenancy | Application-level filters | Cannot be forgotten in a new endpoint |
| 9 | Discord OAuth | Password auth | Audience is already there; no credential storage |
| 10 | Transactional outbox | Direct side-effect calls | No announcements for rolled-back transactions |
| 11 | OpenAPI 3.1 public surface | Ad-hoc endpoints | The export contract is the partner story |
| 12 | RFC 9457 problem details | Custom error shapes | Free tooling, and support starts with a trace ID |
| 13 | Pseudonymize on erasure | Hard delete | Reconciles erasure rights with other users' records |
| 14 | Weekly logical export as backup | PITR alone | Dogfoods the export path; keeps it always working |
| 15 | Human confirmation on all OCR | Auto-commit above threshold | Trust is the product; a wrong auto-committed score costs more than the labor saved |

---

## 12. What to deliberately *not* build

Efficiency is mostly a function of what you refuse to build. Explicitly out:

- A message broker, a queue service, or a separate worker fleet — Postgres-backed jobs are
  sufficient at this scale and have one fewer failure domain
- A microservice boundary of any kind before there is a second team
- A caching tier — Postgres plus HTTP caching covers it
- A mobile app — responsive web, installable as a PWA
- Real-time websockets — polling on a page people check twice a day is fine
- A custom design system — tokens and a dozen primitives, no more
- Payment processing of league funds

Each of these has a clear trigger for revisiting; none of those triggers is "it would be
interesting to build."

---

## 13. Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-22 | Initial architecture and standards |
