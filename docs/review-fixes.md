# Review fixes — already applied

A full pre-build review ran against this package. The findings and the reasoning
are in `front-office-review.md` (repo root, for humans). This file is the short
version for the build agent: **what is already fixed in the artifacts** so you
don't "helpfully" undo it, and **what is deferred** so you don't build it early.

## Already fixed in `db/schema.sql` — do not revert

- **Active-GM uniqueness (B3):** `gm_assignment_one_active` is a UNIQUE partial
  index. At most one active GM per seat, enforced by the database. Do not
  replace it with an application check.
- **Idempotency + outbox (B1/B2):** `idempotency_key` and `outbox` tables exist.
  Use them — durable idempotency, and the outbox for every side effect. Never do
  a Discord/webhook call inline in a request.
- **Result concurrency (B4):** `game_result.version` exists. It is the ETag /
  If-Match token for status transitions. Do not remove it thinking append-only
  makes it redundant — it guards the mutable *status*, not the immutable facts.
- **Write-time arithmetic (H1):** goalie `SA = SV + GA`, shutout ⇔ `GA = 0`, and
  "regulation can't tie / OT-SO decided by one goal" are `CHECK` constraints, not
  just nightly checks. Leave them. The DQ suite keeps the same checks as
  defense-in-depth; that redundancy is intentional.

## Already fixed in `api/openapi.yaml` — build to this

- **Export scoping (H4):** `/seasons/{id}/export` is owner/commissioner-only and
  carries PII. The async manifest URL is signed, expiring, single-use. Enforce
  it; do not expose export to spectators or on public pages.
- **Rate limiting:** 429 + `Retry-After` is specified. Wire it.
- **Outbound webhook signing (M5):** HMAC-SHA256 + timestamp on every outbound
  webhook. Implement when you build the outbox drainer.

## Deferred with intent — do not build early

- **Postgres RLS (H2 tenancy):** Replit's default connection runs as owner and
  bypasses RLS, so RLS in Phase 1 would be security theater. Enforce tenancy in
  `server/authz.ts` now; RLS lands Phase 2 with a non-owner role. See
  `docs/threat-model.md`.
- **Upload hardening (H3):** the allowlist + re-encode + size-cap rules are in
  `replit.md` rule 12. Apply them when Checkpoint 2 builds logo upload — but no
  upload feature exists before then.
- **Schedule algorithm (H5):** Checkpoint 3 names the circle method. Use it;
  don't improvise a generator that only passes the golden fixture.
- **Cap-trade locking (H6):** Phase 2 concern (no trades in Phase 1). When you
  get there, lock at the level the cap invariant is computed, not just the
  `team_season` row.

## Accepted as-is (Medium/Low)

Enum-vs-reference-table (M1), multi-currency (M3 — single-currency USD for v1,
constrain it), `updated_at` on mutable rows (M4 — add it, cheap), and the
JSON-key casing nit (L4) are noted and fine to handle inline as you touch those
areas. Don't make a project of them.
