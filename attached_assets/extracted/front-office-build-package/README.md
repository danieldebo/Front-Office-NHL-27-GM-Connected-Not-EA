# Front Office — build package (reviewed)

A platform for running NHL 27 Connected Franchise leagues. Leagues play in the
game; their schedule, standings, contracts, trades, and history live here and
carry forward across game years.

This package was reviewed before any code was written. Blocker and
high-severity findings were applied to the schema and API; the rest are noted
for the agent. See `front-office-review.md` for the full review and
`docs/review-fixes.md` for the short "what's fixed / what's deferred" list.

## Start here

1. Upload this whole folder to a new Replit project
2. Add a Replit PostgreSQL database
3. Copy `.env.example` into Replit Secrets and fill it in
4. Open `BUILD_PROMPT.md` and paste the kickoff block into the Agent

Then work one checkpoint at a time through `PHASE_1_SCOPE.md`.

## What's in here

| Path | What it is |
|---|---|
| `replit.md` | Permanent project context. The Agent reads this every turn. 14 hard rules |
| `BUILD_PROMPT.md` | Post-review kickoff prompt + course corrections |
| `PHASE_1_SCOPE.md` | Six checkpoints with acceptance criteria |
| `front-office-review.md` | The full pre-build review, for humans |
| `db/schema.sql` | Schema source of truth (review fixes applied). ORM conforms to this |
| `db/schema-charity.sql` | Charity layer extension (Phase 3) |
| `db/schema-membership.sql` | Membership, seats, tiers, weekly email (Phase 2) |
| `db/data-quality-checks.sql` | 26 assertions across integrity, invariants, provenance |
| `api/openapi.yaml` | The published API contract (review fixes applied) |
| `design/league-hub-mockup.html` | Visual reference. Take tokens and type from here |
| `docs/review-fixes.md` | What the review fixed vs deferred — the agent reads this |
| `docs/threat-model.md` | Trust boundaries, STRIDE, data classification |
| `docs/front-office-v1-spec.md` | Product spec, scope in/out |
| `docs/front-office-data-model.md` | Why the schema is shaped this way |
| `docs/front-office-architecture.md` | Engineering standards, decision log |
| `docs/charity-addendum.md` | Giving layer. Phase 3 |
| `docs/membership-addendum.md` | Seats, provisioning, tiers, weekly email. Phase 2 |
| `ci/` | GitHub Actions. Not for Replit — turn on after moving to GitHub |

## The three ideas everything else follows from

**Persistence is the product.** NHL 27's Connected Franchise doesn't carry
history across game years. A league with four seasons of records, banners, and a
trade ledger on this platform cannot leave.

**Derived, never stored.** Standings and cap are SQL views recomputed on read.
Correcting a result corrects everything downstream automatically. There is no
`points` column for anyone to edit.

**Provenance on every fact.** Every number knows whether it was typed by one
person, agreed by two, parsed by a machine, or reconciled against an
authoritative source. Four columns that look like overhead in month one and
become the entire integration story in year two.
