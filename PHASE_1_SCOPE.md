# Phase 1 — Build Scope

**Goal:** replace the spreadsheet. A commissioner can create a league, fill 32
seats, generate a schedule, and have results turn into standings that nobody
argues about.

**Deadline pressure is real.** NHL 27 launches in September and leagues form in
the two weeks around launch. A league that starts its season in a Google Sheet
will not migrate mid-season. Everything below ships before then; everything else
waits.

**Not in Phase 1:** trades, cap ledger, charity, marketplace, screenshot
parsing, drafts. Those are Phases 2–4 and building them now delays the only
thing with a date on it.

---

## Checkpoints

Build in this order. Each checkpoint is independently demoable — stop and show
before moving on.

---

### Checkpoint 1 — Foundation

**Build**
- Vite + React client, Express + TypeScript server, Drizzle wired to Replit Postgres
- Apply `db/schema.sql` verbatim; generate Drizzle types from it
- Auth: Replit Auth behind an adapter module `server/auth/index.ts` exposing
  `getCurrentUser()`. Discord OAuth swaps in later without touching callers
- `server/errors.ts` producing RFC 9457 problem responses with a `trace_id`
- `server/authz.ts` with `can(user, action, resource)` — every check goes here
- **Idempotency middleware** backed by the `idempotency_key` table: on any POST
  carrying `Idempotency-Key`, replay returns the stored response; same key with
  a different body returns 422
- **A rate-limit middleware** (per-user, per-league) returning 429 + `Retry-After`
- **A connection pool** with a bounded size — Replit restarts exhaust unpooled
  connections fast
- Health endpoint

**Acceptance**
- `npm run dev` serves client and API together
- Schema applies cleanly from empty; `v_standings` and `v_cap_position` exist;
  `idempotency_key` and `outbox` tables exist
- An unauthenticated request to a protected route returns a `problem+json` 401
  with a `trace_id`
- The same POST with the same `Idempotency-Key` twice creates one row and
  returns the same response both times
- Zero `any` types; strict mode passes with `noUncheckedIndexedAccess: true`

---

### Checkpoint 2 — Leagues, seasons, seats

**Build**
- Create a league: name, slug, visibility, two brand colors, logo upload,
  **platform type (Xbox / PlayStation / Crossplay)** — required at creation,
  defaults to Crossplay. Applies `db/schema-platform.sql`
- Create a season: game title, salary cap, roster min/max, points system
  (default 2/1/0), tiebreaker order
- 32 franchises generated on season creation, each mapped to an NHL club
- Seat management: invite link, join request, commissioner approval, assign a GM
  to a `team_season`, revoke a seat
- GM replacement writes a **new** `gm_assignment` and closes the old one. The
  franchise record is untouched
- Rulebook as markdown with versioned revisions and a visible changelog

**Acceptance**
- A commissioner creates a league and season in under two minutes
- The league's platform type is set at creation and shown on its pages; a
  PlayStation GM assigned to an Xbox-only league is flagged (crossplay accepts both)
- Replacing a GM mid-season leaves the franchise's record and history intact,
  and both GMs' assignment rows are visible with start and end times
- A GM cannot modify another team's seat — proven by a test, not an assumption
- Editing the rulebook creates a new revision; the previous one is still
  readable

---

### Checkpoint 3 — Schedule and availability

**Build**
- `server/core/schedule.ts` — **pure function**. Given divisions,
  games-per-opponent, and a season length, return a balanced schedule with
  every team playing the same number of games, home/away balanced
- Assign each game to a weekly **window** (`window_opens_at` /
  `window_closes_at`), not a clock time
- Per-GM availability grid: day-of-week plus rough time block, stored against
  the user's IANA timezone
- For each matchup, surface overlapping availability between the two GMs
- Commissioner can shift a window, postpone a game, or force-resolve at close
  per league policy — every action writes to `audit_log` with a reason

**Acceptance**
- A generated 32-team schedule passes: every team has equal games played, no
  team faces itself, home/away is balanced within one
- Two GMs in different time zones see the same overlap suggestion, each rendered
  in their own local time
- Window close with no result moves the game per policy and leaves an audit
  entry stating why

---

### Checkpoint 4 — Results and confirmation

This is the heart of the product. Get it exactly right.

**Build**
- Score entry: home goals, away goals, decision (regulation / OT / SO).
  **Phone-first, one-handed, under ten seconds.** Optional box score behind a
  toggle, off by default
- Submitted result is `manual`, does not count toward standings
- Opposing GM confirms → provenance becomes `confirmed`, result counts
- Opposing GM disputes → game status `disputed`, commissioner is notified,
  nothing silently changes
- Correction flow: a new result row that sets `superseded_by` and a required
  `supersede_reason` on the old one. **No in-place edits, ever**
- Idempotency-Key on submission; replay returns the original result
- **Confirm/dispute/supersede require `If-Match` against `game_result.version`.**
  A stale token returns 409, not a silent overwrite. This is the one place two
  humans race on the same object — get it right
- Optimistic UI with a queued mutation so submission survives a dead elevator

**Acceptance**
- Submitting the same score twice with the same idempotency key creates one row
- A confirmed result appears in standings; an unconfirmed one does not
- A correction leaves both rows in the database, the old one superseded with a
  stated reason, and standings reflect only the new one
- Self-confirmation (same user reports and confirms) is rejected
- Score entry is usable one-handed on a 375px viewport

---

### Checkpoint 5 — Standings and the league hub

**Build**
- `server/core/standings.ts` — **pure function**. Takes a list of results and
  season config, returns a sorted table applying the configured tiebreakers.
  No database access inside it
- Read standings through `v_standings`; the pure function is what tests and
  tiebreakers run against
- League hub page rebuilt in React from `design/league-hub-mockup.html`: the
  scoreboard slab, "your week", the standings ledger, and the **provenance chip
  on every row**
- Public league page at `/l/{slug}` — readable without an account, meta tags for
  link previews. This is the acquisition channel
- An `unconfirmed_games` count shown per team so nobody wonders why the math
  looks off

**Acceptance**
- Correcting a result three weeks late updates the standings with no manual step
- Every standings row shows where its data came from
- The public page loads for a signed-out visitor and looks like the mockup
- Lighthouse accessibility ≥ 95 on the hub page
- Standings render correctly at 375px

---

### Checkpoint 6 — Trust and correctness harness

Do not skip this. It is what makes the platform defensible.

**Build**
- Apply `db/data-quality-checks.sql`
- A commissioner-facing screen listing open findings by severity
- Seed script generating a deterministic 32-team season with known-correct
  standings, committed to the repo as a fixture
- Unit tests on `server/core/` with a **95% line coverage floor**
- Property-based tests asserting, for any random sequence of results:
  `GP = W + L + OTL`, `PTS = W·win + OTL·otl + L·loss`, and league-wide
  `GF = GA`
- Authorization tests proving a GM **cannot** write another team's data

**Acceptance**
- `CALL dq.run_all()` against the seeded season returns zero BLOCK findings
- Property tests pass across at least 1,000 generated cases
- The golden fixture's computed standings match the committed expected output
  exactly
- All authorization tests pass

---

## Definition of done for Phase 1

A commissioner who has never seen the app can, in one sitting:

1. Create a league and a season
2. Invite 31 people and fill the seats
3. Generate a balanced schedule
4. Have GMs report and confirm results from their phones
5. Watch standings update with no manual arithmetic
6. Correct a bad score and watch everything downstream fix itself
7. Share a public page that makes the league look real

If a commissioner still needs a spreadsheet alongside it, Phase 1 is not done.

---

## Known implementation snags on Replit

Flagging these up front so they do not become mysteries:

**Row-level security.** The architecture calls for Postgres RLS, but Replit's
default connection typically runs as the owner role, which **bypasses RLS
entirely**. For Phase 1, enforce authorization in `server/authz.ts` and write
the tests that prove it. Add RLS in Phase 2 with a dedicated non-owner app role
and `SET LOCAL app.user_id` per transaction. Do not half-implement RLS and
assume it is protecting you — that is worse than not having it.

**Server rendering.** The public league page benefits from SSR for previews and
search. Vite alone renders client-side. Phase 1 is fine with client rendering
plus proper meta tags; revisit prerendering in Phase 3 when the marketplace
makes discovery matter.

**CI.** `ci/github-workflows-ci.yml` is for when this repo moves to GitHub.
Ignore it on Replit. Run tests locally with `npm test`.

**Playwright.** Heavy on Replit. Phase 1 uses Vitest only; add end-to-end
coverage when the repo moves to CI.
