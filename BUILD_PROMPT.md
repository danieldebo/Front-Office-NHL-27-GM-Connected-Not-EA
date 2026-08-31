# Kickoff prompt (post-review)

This package was reviewed before any code was written. Several findings were
**already applied to `db/schema.sql` and `api/openapi.yaml`** — durable
idempotency, a transactional outbox, an active-GM uniqueness constraint, a
result-version concurrency token, write-time arithmetic constraints, and a
locked-down export endpoint. `docs/review-fixes.md` is the short list of what's
fixed and what's deferred; `front-office-review.md` is the full reasoning.

That changes the handoff. The prompt below is a little heavier than a blank-slate
kickoff because the foundation now carries the safety machinery that a naive
first pass would skip — and skipping it is exactly what the review was for.

The strategy is unchanged: **narrow the task, keep the constraints permanent.**
`replit.md` is read every turn and holds the fourteen hard rules. Paste only the
block below. Do not paste the whole package into the agent — an agent handed six
architecture docs and a review will try to build all four phases at once.

---

## Paste this

```
Read these three files first, in order, before doing anything:
  1. replit.md        — the permanent contract. Fourteen hard rules.
  2. docs/review-fixes.md — what a pre-build review already fixed in the schema
     and API. Do NOT revert any of it, and do NOT build the "deferred" items early.
  3. PHASE_1_SCOPE.md — the checkpoints. You are building Checkpoint 1 ONLY.

Then build Checkpoint 1 and stop. Do not start Checkpoint 2. Do not build
anything under "Out of scope" in replit.md.

Checkpoint 1 is the foundation, and it deliberately includes the safety
primitives the rest of the app leans on:

- Vite + React client and Express + TypeScript server running together. Strict
  mode with noUncheckedIndexedAccess. Zero `any`.
- Drizzle wired to Replit Postgres, with a bounded connection pool (Replit
  restarts exhaust unpooled connections).
- Apply db/schema.sql EXACTLY as written and generate Drizzle types from it. The
  SQL is the source of truth. Do not let the ORM rewrite it. Do not "improve" or
  "simplify" the schema — in particular, the version column on game_result, the
  idempotency_key and outbox tables, and the gm_assignment_one_active unique
  index are there on purpose (see docs/review-fixes.md). Leaving them out is a bug.
- An auth adapter at server/auth/index.ts exposing getCurrentUser(), backed by
  Replit Auth for now. Everything imports the adapter, never Replit Auth directly.
- server/errors.ts producing RFC 9457 problem+json, every response carrying a
  trace_id.
- server/authz.ts exposing can(user, action, resource). The ONLY place
  permission logic lives. No inline ownership checks in handlers, ever.
- Durable idempotency middleware backed by the idempotency_key table: a POST
  replaying the same Idempotency-Key returns the stored response; the same key
  with a different body returns 422. In-memory does not count — it must survive a
  restart.
- Rate-limit middleware (per-user, per-league) returning 429 with Retry-After.
- A health endpoint.

Before you write any code:
  a. Tell me your plan.
  b. Confirm db/schema.sql applies cleanly to Replit Postgres, and flag anything
     that won't (extensions, syntax, role assumptions).
  c. Tell me explicitly how you'll make idempotency durable across restarts.

Do not implement Postgres row-level security in this checkpoint. Replit's default
connection runs as the owner role and bypasses RLS, so it would be security
theater — enforce tenancy in server/authz.ts and we add RLS in Phase 2. This is
in docs/review-fixes.md; if you think you need RLS now, ask first.
```

---

## Then, one checkpoint at a time

After each is demoed and looks right:

```
Checkpoint 1 is approved. Re-read replit.md and docs/review-fixes.md, then build
Checkpoint 2 from PHASE_1_SCOPE.md — nothing beyond it.
```

Repeat through Checkpoint 6. Going one at a time isn't caution for its own sake:
Checkpoints 4 and 5 (results, confirmation, standings) are where the product
lives, and every hour of agent attention on premature features is an hour not
spent getting those exactly right. Checkpoint 4 in particular now carries the
version/If-Match concurrency work — the one place two humans race on the same
object — so give it room.

---

## Course corrections you will need

Agents drift toward the same mistakes on a schema like this. The first block is
generic; the second is specific to the review fixes and is where a well-meaning
agent will try to "help" by undoing hardening.

### General

| Symptom | Correction to paste |
|---|---|
| A `points`, `wins`, or `cap_used` column appears | `Standings and cap are computed views, never stored columns. Remove it and read from v_standings / v_cap_position. replit.md rule 1.` |
| A route does `UPDATE game_result` | `Facts are append-only. A correction inserts a new row and sets superseded_by + supersede_reason. replit.md rule 2.` |
| Ownership checks appear inline in handlers | `All permission logic goes through server/authz.ts. Move it and add a test proving a GM cannot write another team's data.` |
| Standings math lands in a route handler | `server/core/ is pure — no DB, no express imports. Move the calculation there and unit test it.` |
| Tailwind or a component library appears | `Plain CSS with tokens from design/league-hub-mockup.html. No Tailwind, no component library.` |
| It starts on trades, charity, or OCR | `Out of scope for Phase 1. Re-read the "do not build" list in replit.md.` |
| Money as a float or in dollars | `Integer cents, BIGINT, everywhere.` |

### Review-fix specific — the agent is undoing hardening

| Symptom | Correction to paste |
|---|---|
| It drops or ignores `game_result.version` as "redundant with append-only" | `Keep version. Append-only makes the FACTS immutable; version guards the mutable status (confirmed/disputed) against racing GMs. It's the ETag/If-Match token. replit.md rule 11, review finding B4.` |
| Idempotency implemented in a Map / in memory | `Idempotency must be durable — use the idempotency_key table. Replit restarts wipe memory, and mobile retry is exactly when that bites. review finding B1.` |
| A Discord/webhook call sits inline in a request handler | `Side effects go through the outbox table, drained by a worker. Never inline — a rolled-back transaction must not have already posted. review finding B2.` |
| It replaces the `gm_assignment_one_active` index with an app-level check | `That's a database uniqueness constraint on purpose. An app check leaves a race window where two GMs control one seat. Keep the index. review finding B3.` |
| It removes the goalie/regulation CHECK constraints | `Those are write-time constraints for arithmetic that can never legitimately be violated. Keep them; the DQ suite duplicates them as defense-in-depth on purpose. review finding H1.` |
| Export endpoint readable by spectators or on a public page | `Export carries PII and is owner/commissioner-only regardless of league visibility. replit.md rule 13, review finding H4.` |
| Logo upload accepts any file / trusts client content-type | `Allowlist png/jpeg/webp, re-encode server-side, cap size, verify type server-side. An SVG upload is stored XSS. replit.md rule 12, review finding H3.` |
| It implements RLS on the default (owner) connection | `Replit's owner connection bypasses RLS — that's security theater. Enforce authz in server/authz.ts now; RLS is Phase 2 with a non-owner role. review finding H2.` |
| PII (email, gamertag) shows up in a log line | `Logs carry user_id and entity IDs, never PII. replit.md rule 13, docs/threat-model.md.` |

### Membership & email specific (Phase 2 — `docs/membership-addendum.md`)

| Symptom | Correction to paste |
|---|---|
| Seat limit enforced only in app code | `max_seats is enforced by a database trigger — two concurrent assignments could otherwise both take the last seat. Keep the trigger; surface its error as a clean 409.` |
| `relationship_tier` appears on a public or member-facing response | `Tier is commissioner-private. It's never shown to the member it describes and never public. Expose it only through commissioner-scoped endpoints. replit.md rule 15.` |
| It tries to infer or auto-suggest a tier | `The commissioner sets tiers; the platform never guesses. An inferred tier turns a courtesy hint into surveillance. Default is stranger, set by no one.` |
| A provisioned member email shows in a log or public page | `Email is PII entered by the commissioner. Never logged, never public, read only through v_email_audience. replit.md rules 13 and 16.` |
| The weekly email is sent inline from a request/handler | `Send through the outbox, drained by a worker. Idempotent per league per week via email_send. A double-tick must not mail twice. replit.md rule 16.` |
| Template renders arbitrary expressions / interpolates freely | `Allowlisted merge tokens only. Unknown {{tokens}} render literally. Arbitrary evaluation is template injection.` |
| The digest includes an unconfirmed score as a final result | `Compose from derived views only — confirmed data. {{games_due}} is the nudge that gets confirmations; never report an unconfirmed score as fact.` |
| Email sent from the app server directly | `Use an ESP with SPF/DKIM/DMARC on the sending domain, and a working unsubscribe that flips email_opt_in. Bare-server mail lands in spam and is not CAN-SPAM/CASL compliant.` |

### Keeper & registry specific (Phase 2 — `docs/keeper-addendum.md`)

| Symptom | Correction to paste |
|---|---|
| Keeper limit enforced only in app code | `keepers_per_team is enforced by a database trigger, like the seat limit. Two concurrent adds could otherwise both take the last slot. Keep the trigger; surface as 409.` |
| Re-keeping a player resets its original date | `first_marked_at is set once and carried forward by the inherit_keeper_origin trigger. Tenure is the point of tracking it. Don't reset on re-designation. keeper-addendum §3.` |
| Keeper entry blocked unless a registry match is found | `Manual entry is first-class. A prospect with no NHL history must be keepable. is_manual player, empty external_ids, no card until matched. rule 17.` |
| NHL stat-card numbers mixed into standings or shown unlabelled | `NHL reference stats are a different universe from league game data. Label "NHL stats as of {date}", never blend into standings. rule 17.` |
| Stat card fetched on every page view | `Cache in player_stat_card with stale_after; refresh on staleness, batch the sync, back off. Don't hammer the free NHL API. keeper-addendum §5.` |
| A failed NHL fetch shows a spinner forever or a made-up line | `Show cached-with-date or "unavailable". Never a hang, never a fabricated stat line. rule 17.` |
| The EXCLUDE constraint or trigram index fails to create | `schema-keepers.sql needs the btree_gist and pg_trgm extensions — they're in the file. Confirm Replit Postgres allows them; if not, tell me before working around it.` |

### Discovery, ranking & waitlist specific (Phase 3 — `docs/discovery-addendum.md`)

| Symptom | Correction to paste |
|---|---|
| The admin skill rating is a column on app_user or appears in a user-facing view | `Keep admin_skill_rating a standalone table reachable only through one admin-scoped endpoint. On app_user or in an applicant view, it leaks. rule 18.` |
| The rated user can see their own rating anywhere | `The subject must never retrieve their rating by any route — profile, API, applicant status, error payload. Add a test from the subject's session proving it. rule 18.` |
| The platform auto-rejects or auto-ranks by division or rating | `Both are advisory to a human. The platform never auto-rejects or auto-sorts by either. A human commissioner decides. rules 18 and discovery §7.` |
| Ranked division is imposed/computed instead of self-picked | `ranked_division is self-reported and player-editable — a matchmaking-style bracket the player chooses, not a judgment. Only the hidden rating is admin-set.` |
| Private data (emails, ratings) on the open-leagues page | `v_open_leagues is signed-out territory and carries nothing private. Serve only that view to the public page.` |
| The tip footer routes money through the platform | `The Venmo footer is a plain external link — the platform processes nothing. That's what keeps rule 5 intact. Never a payment integration. rule 19.` |
| Footer is per-page instead of global | `Put it in the root layout so it's on every page, public and authenticated. rule 19.` |
| Platform stored as free text ('psn', 'ps', 'PSN') | `League platform is the platform_type enum (xbox/playstation/crossplay) from schema-platform.sql. Don't reintroduce free-text platform strings — discovery filtering depends on one vocabulary.` |
| A single-console league silently accepts the other console | `Use console_eligible(league.platform, user.console). Crossplay accepts both; a single-console league accepts only its own. A mismatch is flagged by dq.check_platform_mismatch.` |
| Waitlist reordering rewrites joined_at or corrupts positions | `Position is a sparse-integer queue with a deferred unique constraint; reorder by position, never by faking timestamps. discovery §4.` |

---

## What to hand it later

Once Phase 1 is stable and demoed to a real commissioner:

- **Phase 2** — transaction wire, cap ledger, approval workflow, audit trail,
  the membership work (seat limits, member provisioning, relationship tiers, the
  weekly commissioner email — `docs/membership-addendum.md` +
  `db/schema-membership.sql`, Checkpoints 7–9), the keeper system (keeper limits,
  team + commissioner keeper entry, tenure tracking, the NHL player registry and
  1/3/5-year stat cards — `docs/keeper-addendum.md` + `db/schema-keepers.sql`,
  Checkpoints 10–12), AND the deferred hardening: Postgres RLS with a non-owner
  role, and cap-trade locking at the level the invariant is computed (review
  finding H6). Point the agent at `api/openapi.yaml` for endpoint shapes and
  `docs/threat-model.md` for the tenancy work.
- **Phase 3** — GM marketplace, league health score, franchise history, the
  discovery/intake work (open-leagues page, sign-up, self-reported ranked
  division, the private admin rating, waitlist, and the persistent creator footer
  — `docs/discovery-addendum.md` + `db/schema-discovery.sql`, Checkpoints 13–16),
  and the charity layer (`docs/charity-addendum.md` + `db/schema-charity.sql`).
- **Phase 4** — screenshot ingest, CSV import, export API hardening. Needs a
  labeled evaluation set built before any code.

Move the repo to GitHub before Phase 2 and turn on `ci/github-workflows-ci.yml`.
Its migration-safety and breaking-API-change gates matter more once real leagues
have real seasons that can't be regenerated. Run `docs/threat-model.md`'s
pre-Phase-2 checklist before you start Phase 2.
