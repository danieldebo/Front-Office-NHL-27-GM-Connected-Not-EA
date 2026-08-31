# Front Office — Pre-Build Review

**Review type:** Design & artifact review, pre-implementation
**Scope:** `schema.sql`, `schema-charity.sql`, `data-quality-checks.sql`,
`openapi.yaml`, `github-workflows-ci.yml`, the architecture and spec docs, and
the agent-handoff package
**Reviewer perspectives:** Data engineering, backend, API, security, SRE/platform,
QA, frontend/accessibility, product/compliance

---

## How to read this

Findings are rated by the cost of leaving them unfixed, not by how hard they are
to fix. A **Blocker** will produce wrong data or a breach; fix before the agent
starts. **High** will cost a painful refactor if found late. **Medium** is real
but safely deferrable with a written note. **Low/Nit** is polish.

The honest headline: the architecture is sound and the core discipline
(append-only facts, derived reads, provenance) is right. The problems are
concentrated in three places — **two subsystems the architecture describes but
the schema never actually implements**, a handful of **integrity gaps the
database should enforce but currently only detects after the fact**, and some
**standard hardening that is named in prose but has no artifact behind it.**
Those gaps matter more here than usual because the whole product promise is
"trustworthy record," and a promise enforced only by a nightly check is a
promise you will break at least once before the check runs.

---

## Blockers — fix before the agent writes code

### B1 · Idempotency is required everywhere but has nowhere to live
*(Backend, Data)*

`openapi.yaml` requires an `Idempotency-Key` on every mutation, `replit.md`
rule 9 makes it a hard rule, and `PHASE_1_SCOPE.md` Checkpoint 4 tests it. There
is no table to store keys or their responses. An agent will do one of three
things, all bad: invent a schema you didn't design, implement idempotency in
memory (useless across the restarts Replit does constantly), or quietly skip it
and let the test pass on a stub.

Idempotency that doesn't survive a process restart is not idempotency — and
mobile score submission, the exact case this protects, is *when* restarts bite.

**Fix:** add the table before handoff.

```sql
CREATE TABLE idempotency_key (
    key            TEXT NOT NULL,
    user_id        UUID NOT NULL REFERENCES app_user(id),
    request_digest TEXT NOT NULL,          -- sha256 of method+path+body
    response_status INT,
    response_body  JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',
    PRIMARY KEY (user_id, key)
);
-- Same key + different body = client bug. Return 422, never the cached response.
```

### B2 · The transactional outbox is a named guarantee with no table
*(Backend, SRE)*

`front-office-architecture.md` §4 makes the outbox the mechanism that prevents
announcing a trade that then rolled back. `schema.sql` has no outbox table. As
written, the guarantee is prose. An agent building Discord notifications in
Phase 2 will wire a direct API call inside the request path — the exact
anti-pattern the architecture forbids — because nothing in the schema tells it
otherwise.

**Fix:** land the table now even though it's used later, so the pattern is
present from the first notification.

```sql
CREATE TABLE outbox (
    id             BIGSERIAL PRIMARY KEY,
    topic          TEXT NOT NULL,
    payload        JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at   TIMESTAMPTZ,
    attempts       INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON outbox (next_attempt_at) WHERE processed_at IS NULL;
```

### B3 · Nothing at the database level stops two active GMs on one seat
*(Data, Backend)*

`gm_assignment` has only a **non-unique** partial index on active rows, and
`dq.check_gm_uniqueness` *detects* duplicates after they exist. Between the
double-write and the nightly check, two people legitimately control one
franchise and both can report results for it — a live integrity hole in the
one thing the product exists to get right. Detection is not prevention.

**Fix:** make it a constraint, not a report.

```sql
CREATE UNIQUE INDEX gm_assignment_one_active
    ON gm_assignment (team_season_id) WHERE ended_at IS NULL;
```

Same class of bug, same fix, in `team_season` — the `UNIQUE (season_id,
nhl_club_id)` allows two franchises to claim the same club only because it isn't
partial-aware of soft deletes; verify it holds once `deleted_at` exists on
related rows.

### B4 · `confirm` can't be made idempotent or race-safe as specified
*(API, Backend)*

`POST /results/{resultId}/confirm` takes `If-Match` in the spec, but
`GameResult` never defines an `ETag`/version the client could send, and there's
no version column on `game_result`. Two GMs tapping "confirm" and "dispute" near
-simultaneously, or one double-tapping on bad wifi, resolve last-write-wins on
the exact object the platform is supposed to make unarguable.

**Fix:** add a `version INT NOT NULL DEFAULT 1` (or use `xmin`) on mutable-status
rows, surface it as the `ETag`, and require `If-Match` on state transitions.
Note this doesn't contradict append-only: the *facts* are immutable, but a
result's `status` and `verified_by` are lifecycle fields and need optimistic
concurrency.

---

## High — fix in Phase 1, expensive to retrofit

### H1 · Box-score integrity is checked but not constrained
*(Data)*

`check_boxscore_reconciles` and `check_goalie_arithmetic` are good, but they run
after the fact. The database will happily store a skater with 9 goals in a 2–1
game until the next `dq.run_all()`. For arithmetic that can *never* legitimately
be violated, prefer a constraint or a trigger at write time over a detective
control. Detective controls are for cross-row invariants SQL constraints can't
express (league-wide GF=GA); single-row arithmetic (SA = SV + GA) should be a
`CHECK`.

```sql
ALTER TABLE goalie_game_stat
  ADD CONSTRAINT saves_reconcile CHECK (shots_against = saves + goals_against);
```

Add the matching `CHECK (goals_against = 0) ⇒ shutout` relationship, and a
`CHECK` that a `regulation` decision can't have equal goals — that one is
currently *only* in the DQ layer.

### H2 · Soft-delete is a stated pattern applied inconsistently
*(Data, Backend)*

`deleted_at` exists on `league`, `franchise`, `player`, `app_user` — but the
views and foreign keys don't systematically exclude soft-deleted rows. `player`
has `deleted_at`, yet `v_standings` and the stat joins never filter it. A
deleted player still resolves in a box score; a soft-deleted league's seasons
are still queryable through `season`. Soft delete that isn't filtered everywhere
is worse than hard delete, because it looks handled.

**Fix:** decide the rule explicitly — either RLS/views filter `deleted_at IS
NULL` uniformly, or drop `deleted_at` from tables that don't truly need it.
Document which. Half-applied is the failure mode.

### H3 · No rate-limit, request-size, or upload-validation artifact
*(Security, Backend)*

The architecture names rate limiting, signed upload URLs, and EXIF stripping.
None appear in any buildable artifact — not the OpenAPI, not the schema, not a
middleware note the agent will act on. Left implicit, they won't be built. The
logo-upload path in Checkpoint 2 is a direct file-upload endpoint with, as
specified, no content-type allowlist, no size cap, and no image re-encoding —
a standard vector for stored XSS (SVG with script) and decompression-bomb DoS.

**Fix:** add to `replit.md` as hard rules with concrete numbers, and specify in
the upload endpoint: allowlist `image/png image/jpeg image/webp`, cap at a fixed
size, re-encode server-side (which strips EXIF and neutralizes SVG), never trust
the client-sent content-type.

### H4 · Export endpoint is an unbounded data-exfiltration surface
*(Security, API, SRE)*

`GET /seasons/{seasonId}/export` returns an entire season — every user's handle,
gamertag, and country. Scoping is `oauth2: [export:read]` OR `partnerApiKey`,
but nothing in the artifacts defines *who* legitimately holds `export:read` for
a given league, whether a spectator can call it, or a per-token rate limit. A
public league's export is a tidy PII dump of 32 people. The `202 + manifest_url`
async path returns a URL with no stated expiry, signing, or auth on the
fetch — a classic unauthenticated-object leak.

**Fix:** restrict `export:read` to the league's own commissioner/owner and
scoped partners; make the manifest URL short-lived, signed, and single-use;
rate-limit exports per token; log every export to `audit_log`.

### H5 · Round-robin schedule feasibility is asserted, not guaranteed
*(Backend, Product)*

`PHASE_1_SCOPE.md` Checkpoint 3 asks for a balanced schedule where "every team
plays the same number of games." With 32 teams and real-world division sizes
that don't divide evenly, a naive generator either can't balance home/away or
produces an odd fixture count. The acceptance test ("home/away balanced within
one") is satisfiable, but the pure function needs a known-correct algorithm
(circle method for round-robin, with a documented rule for uneven groups), or
the agent will improvise one that passes the golden fixture and fails on a
league with a non-standard division layout.

**Fix:** specify the algorithm in the checkpoint, not just the acceptance
criteria. Name the circle method and state the tie-handling rule.

### H6 · Cap legality has a check-to-execute race the lock note doesn't fully close
*(Backend, Data)*

§4 of the architecture correctly calls for `SELECT … FOR UPDATE` on participating
`team_season` rows during a trade. But cap legality is computed from
`v_cap_position`, a view over `contract` — locking `team_season` rows does *not*
lock the `contract` rows the view aggregates. Two concurrent signings on the same
team can each read legal, lock different rows, and commit to an illegal roster.

**Fix:** lock at the level the invariant is computed — either
`SELECT … FOR UPDATE` on the team's `contract` rows, or a serializable
transaction with a retry loop, or an advisory lock keyed on `team_season_id` for
any roster-mutating operation. State which; "lock the team_season row" as
written is insufficient.

---

## Medium — deferrable with a written note

### M1 · Enum-as-schema will fight you within a season
*(Data)*

`game_status`, `txn_type`, `txn_status` are Postgres `ENUM`s. Adding a value
requires `ALTER TYPE`, which historically couldn't run in a transaction and
still can't be *removed* without a table rewrite. For status vocabularies that
will grow (you'll want `voided_by_commissioner`, `admin_adjusted`, etc.), a
reference table with an FK is more evolvable and lets you attach metadata
(display label, is-terminal). Keep enums for truly fixed sets (`game_decision`
is three values forever); reconsider them for lifecycle states.

### M2 · `points_reg_loss` is modeled but semantically dead
*(Data, Product)*

The schema carries `points_reg_loss` and the standings math multiplies by it,
but hockey has no points for a regulation loss (it's always 0). Modeling it
invites a league to set it to a nonzero value and produce standings no hockey
fan recognizes. Either constrain it (`CHECK (points_reg_loss = 0)`), or if the
intent was configurable exotic scoring, document that explicitly so it reads as
a feature and not a bug.

### M3 · Multi-currency is half-modeled
*(Data, Product)*

`donation_receipt` has a `currency` column; `pledge`, `giving_event`, and every
`_cents` field assume USD. Cross-border leagues are explicitly a target (the
marketplace filters by timezone across countries). Either commit to
single-currency for v1 with a documented constraint, or carry currency
consistently. A `SUM(amount_cents)` across mixed currencies in `v_league_impact`
is a silently wrong number — the worst kind on a page whose entire purpose is
trust.

### M4 · No `updated_at` / change tracking on mutable dimension rows
*(Data, SRE)*

Append-only facts don't need it, but `league`, `season`, `league_giving_config`,
and `app_user` are mutable and have only `created_at`. Debugging "when did this
league's cap change" requires `audit_log` spelunking. A standard `updated_at`
touched by trigger is cheap and expected.

### M5 · Webhook delivery has no signing spec on the *outbound* side
*(Security, API)*

Inbound receipts from CauseFully require `signature_verified`. The webhooks
*Front Office sends* (`resultConfirmed`, etc.) define an envelope but no signing
scheme (HMAC over the body with a per-subscriber secret, timestamp to prevent
replay). Consumers can't verify authenticity. Standard and expected for any
webhook producer.

### M6 · CI security scanning misses two standard gates
*(Security, Platform)*

The pipeline has CodeQL, secret scan, and `npm audit` — good. Missing:
**IaC/container scanning** (if anything is containerized) and, more importantly,
**a SBOM step** (`syft`/CycloneDX) plus dependency *review* on PRs. `npm audit`
catches known CVEs but not a newly-introduced malicious transitive dep. Also:
`npm audit --audit-level=high` will fail builds on unrelated upstream advisories
with no fix available — teams routinely need an allowlist mechanism or this
becomes the flaky gate everyone learns to ignore.

### M7 · The `dq.run_all()` runner uses dynamic SQL with interpolated names
*(Security — low real risk, bad pattern)*

The runner builds `INSERT … SELECT FROM dq.check_%I` via `format()`. The `%I` is
correctly identifier-quoted and the inputs are a hardcoded `VALUES` list, so
it's *safe as written* — but it models a pattern (string-built SQL from a
name list) that's one careless edit from injection, and it silently no-ops if a
check view is renamed. Prefer generating this list at build time, or at minimum
assert every named check view exists before the loop.

---

## Low / Nits

- **L1 (API):** cursor pagination is specified but the cursor's encoding/opacity
  contract isn't. State that it's an opaque base64 token and that clients must
  not construct one, or someone will parse it.
- **L2 (Data):** `NUMERIC(4,3)` for confidence caps at 9.999; fine for 0–1 but
  `NUMERIC(3,3)`… actually can't hold 1.000. `NUMERIC(4,3)` is correct — keep it,
  but the `CHECK (confidence BETWEEN 0 AND 1)` should be `<= 1`, verify the
  boundary is inclusive as intended.
- **L3 (Frontend):** the mockup hardcodes club abbreviations and colors; ensure
  the token extraction doesn't bake the *sample data's* palette into components.
- **L4 (API):** `SkaterStat` uses `plus_minus` (snake) beside `G`, `A`, `PIM`
  (abbrev caps). Inconsistent casing in one object; pick one convention for JSON
  keys or SDK codegen will look ragged.
- **L5 (Docs):** `replit.md` says "no `any` types" and "strict mode" — add
  `"noUncheckedIndexedAccess": true` explicitly, since agents treat base `strict`
  as sufficient and array access is where their type safety usually leaks.
- **L6 (SRE):** no mention of connection pooling. Replit + serverless-ish
  restarts + Postgres = connection exhaustion without a pooler (PgBouncer or the
  driver's pool with sane limits). Name it before the first load test surprises you.

---

## Cross-cutting observations

**The strongest part** is the data model's core discipline. Append-only facts
with derived reads is the correct spine for a system whose product *is* its
audit trail, and the provenance model genuinely does double as the integration
story. Don't let any fix above erode that spine — several "simplifications" an
agent might suggest (a cached `points` column "for performance," an in-place
status update "to keep it simple") are the exact regressions the architecture
was built to prevent. The `replit.md` course-correction table already anticipates
the first; add the second.

**The recurring weakness** is a gap between *detective* and *preventive*
controls. The DQ suite is excellent and unusually thorough — but it's used in
several places where a database constraint belongs (B3, H1, part of H6). The
principle: **if a violation can never be legitimate, the database should refuse
it, not report it.** Reserve the DQ suite for cross-row and cross-time
invariants that constraints genuinely can't express. This single reframing
resolves B3, H1, and tightens the trust story considerably.

**The most likely real-world incident**, ranked, is H4 (export PII leak) — it's
the highest-severity, lowest-effort-to-exploit item, needs no auth mistake by a
user, and hits data belonging to people who never consented to a given
commissioner exporting them. If you fix one thing on a plane with no wifi, fix
that one.

**A discipline that's underweight:** there's no threat model and no data
-classification pass anywhere in the package. For a system holding PII across a
multi-tenant boundary with an export feature and a (future) money-adjacent
layer, a one-page STRIDE sketch and a table classifying each field
(public / internal / PII / never-store) would catch H4-class issues by design
rather than by review. Worth doing before Phase 2.

---

## Priority fix list

| # | Finding | Discipline | Effort |
|---|---|---|---|
| 1 | **H4** Export PII scoping + signed manifest | Security/API | S |
| 2 | **B3** Unique constraint on active GM seat | Data | XS |
| 3 | **B1** Idempotency key table | Backend/Data | S |
| 4 | **B4** Version/ETag on result status transitions | API/Backend | S |
| 5 | **B2** Outbox table | Backend | XS |
| 6 | **H1** Single-row arithmetic as CHECKs | Data | S |
| 7 | **H6** Lock at the level the cap invariant is computed | Backend | M |
| 8 | **H3** Upload validation + rate-limit as hard rules | Security | S |
| 9 | **H2** Decide and apply the soft-delete rule uniformly | Data | M |
| 10 | **H5** Specify the schedule algorithm, not just its test | Backend | S |

Everything Medium and below can ship as written with a note in the relevant doc,
provided the note exists before the agent reads past it.
