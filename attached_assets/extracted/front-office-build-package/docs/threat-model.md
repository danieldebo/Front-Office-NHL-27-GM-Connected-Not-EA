# Front Office — Threat Model & Data Classification

**Doc version:** 1.0
**Why this exists:** the pre-build review flagged that the package had no threat
model and no data-classification pass — the absence is what let an export
PII-leak (H4) sit in the design unnoticed. This page is the one-time cost that
catches that whole class of issue by design instead of by review. Read it before
Phase 2.

---

## 1. Data classification

Every field the platform stores falls into one of four classes. The class
dictates who may read it, whether it may leave the system, and whether it may be
logged.

| Class | Definition | Examples | Rules |
|---|---|---|---|
| **Public** | Safe on a signed-out page | Franchise name, standings, schedule, wire, receipted impact totals | Cacheable, indexable, exportable by anyone |
| **Internal** | League-scoped, not secret | Cap position, rulebook, availability grid, committed (unfulfilled) giving | Readable by league members; never on a public page; never logged in full |
| **PII** | Identifies a person | Email, gamertag, country, IANA timezone, Discord ID | Minimized, access-controlled, export-restricted (H4), never in logs, erasable |
| **Never-store** | Must not exist in this DB | Card numbers, bank details, processor tokens, government IDs, real-time location | No table, ever. Absence is the control |

The load-bearing rule: **`visibility: public` promotes standings to Public. It
never promotes the member roster.** A public league page shows the game, not the
people's contact handles. The export endpoint carries PII and is therefore
owner/commissioner-only regardless of league visibility.

**Logging rule:** structured logs may contain entity IDs (UUIDs) and Internal
data, never PII. A `user_id` is fine; an email is not. The `trace_id` on every
error is the join key that lets support find a person without the log holding
their identity.

---

## 2. Trust boundaries

```
              ┌─────────────────────────────────────────────┐
  Public      │  Signed-out visitor                          │  Public data only
  internet    │  → public league pages, standings            │
              └───────────────────┬─────────────────────────┘
                                  │ HTTPS
              ┌───────────────────▼─────────────────────────┐
  Authn'd     │  GM / Commissioner / Spectator (Discord)     │  Role + ownership
  users       │  → report, confirm, manage own team          │  via server/authz.ts
              └───────────────────┬─────────────────────────┘
                                  │
              ┌───────────────────▼─────────────────────────┐
  App tier    │  Express — thin handlers, no business logic  │
              │  /core is pure; authz centralized            │
              └──────┬───────────────────────────┬──────────┘
                     │                            │
        ┌────────────▼──────────┐    ┌────────────▼───────────────┐
  Data  │  Postgres (tenant-     │    │  Outbox → worker → Discord  │  outbound,
  tier  │  scoped by league_id)  │    │  & signed webhooks          │  signed
        └────────────────────────┘    └─────────────────────────────┘
                     ▲                            ▲
        ┌────────────┴──────────┐    ┌────────────┴───────────────┐
  Ext   │  CauseFully receipts   │    │  Partner export (scoped    │  inbound &
        │  (signed webhook in)   │    │  API key, per league)       │  outbound
        └────────────────────────┘    └─────────────────────────────┘
```

Every arrow crossing a boundary is a place to authenticate, authorize, and
validate. The multi-tenant boundary (one league's data must never reach another)
is the sharpest one and is enforced at the data layer, not in handlers.

---

## 3. STRIDE sketch

A per-category pass over the boundaries above. Only material threats listed.

### Spoofing
- **Forged inbound receipt** inflates a franchise's public impact. → Verify the
  CauseFully HMAC signature; `signature_verified` gates the public view; a
  blocking DQ check refuses unverified receipts on banners.
- **Forged outbound webhook** to a consumer. → Sign every outbound webhook
  (M5); consumers verify HMAC + timestamp.
- **Session/OAuth token theft.** → Short-lived tokens, refresh rotation,
  `SameSite` cookies, no tokens in URLs or logs.

### Tampering
- **Editing a result to change standings.** → Facts are append-only; corrections
  supersede with a stated reason; `version`/If-Match blocks silent overwrite
  (B4); `audit_log` records every change.
- **Two active GMs both writing for one seat.** → Unique partial index (B3),
  not just a nightly check.
- **Concurrent cap-legal moves committing an illegal roster.** → Lock at the
  level the invariant is computed (H6): serializable txn or advisory lock keyed
  on `team_season_id`.

### Repudiation
- **"I never confirmed that / the commish changed my score."** → Every fact
  carries `reported_by`/`verified_by`; supersedes carry reasons; `audit_log` is
  append-only. The entire product is a non-repudiation record.

### Information disclosure
- **Export as a PII dump (H4).** → Owner/commissioner scope only; signed,
  expiring, single-use manifest; per-token rate limit; every export logged.
- **Cross-tenant read** — league A sees league B. → `league_id` on every scoped
  table; centralized authz now, Postgres RLS with a non-owner role in Phase 2.
- **Stored XSS via SVG logo upload (H3).** → Allowlist raster types, re-encode
  server-side, never serve user uploads from the app origin.
- **PII in logs.** → Classification rule §1; a CI check on the log schema.

### Denial of service
- **Decompression-bomb or huge upload.** → Size cap + server-side re-encode
  (H3).
- **Unbounded export / ingest.** → Rate limits, async with a bounded manifest,
  batch size cap.
- **Connection exhaustion on Replit restarts.** → A pooler with sane limits
  (L6).

### Elevation of privilege
- **GM acting as commissioner.** → Role + ownership check in `server/authz.ts`,
  tested explicitly (a GM *cannot* write another team's data).
- **Partner key reaching write endpoints.** → Partner keys are scoped to data
  exchange and specific leagues; they cannot reach result reporting.

---

## 4. What is deliberately not defended (accepted risk)

Naming these keeps the model honest:

- **A GM lies about a score their opponent also confirms.** Two-party collusion
  is out of scope; the platform records agreement, it doesn't referee reality.
- **A commissioner runs their league unfairly.** Enforcement is configuration,
  not arbitration — the platform records what they do and never decides for
  them. A league unhappy with its commissioner is a social problem.
- **Console-level cheating inside NHL 27 itself.** Outside the trust boundary
  entirely.

---

## 5. Pre-Phase-2 checklist

- [ ] Every new table's fields tagged with a class from §1
- [ ] No PII field reachable through a `visibility: public` code path
- [ ] Log schema check in CI rejects PII fields (M-level, but do it now)
- [ ] Outbound webhook signing implemented and documented
- [ ] Upload path: allowlist + re-encode + size cap live
- [ ] RLS enabled with a dedicated non-owner app role
- [ ] Export access + audit logging verified by test
