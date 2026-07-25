---
name: Commissioner links schema notes
description: Non-obvious constraints when applying or extending the commissioner-links schema (v1.7.0)
---

## dq schema must be pre-created

The `dq` schema (for data-quality views) does not exist by default in the dev database. Any migration that creates `dq.*` views must `CREATE SCHEMA IF NOT EXISTS dq` first in the same DDL batch; otherwise the migration fails at the view creation step.

**Why:** The schema was not included in the base `schema.sql` — only the `public` schema is provisioned automatically.

**How to apply:** Lead every migration that touches `dq.*` with `CREATE SCHEMA IF NOT EXISTS dq;` at the top of the script.

## FOR UPDATE is not supported on views

`v_invite_usable` is a plain view (not a materialized view). `SELECT ... FOR UPDATE` against it fails at runtime. Lock the base table (`commissioner_invite`) directly in transactions that need row-level locking.

**Why:** PostgreSQL only permits `FOR UPDATE` on real tables or updatable views with a single base table and no aggregates. `v_invite_usable` passes the latter condition in theory but practice showed the runtime error.

**How to apply:** In `POST /join/:token/claim`, the transaction queries `commissioner_invite` with `FOR UPDATE` directly and replicates the `usable` computation inline as a SQL expression.

## Tables / objects added in v1.7.0

- `league.public_code` — UNIQUE TEXT, regex `^[A-Z0-9]{5,12}$`
- `commissioner_invite` — one active row per league (enforced by partial unique index `commissioner_invite_one_active`)
- `commissioner_invite_claim` — one claim per (invite_id, user_id)
- `v_invite_usable` — computed usability view (active + not expired + not exhausted)
- `dq.check_invite_cardinality`, `dq.check_invite_exhausted`, `dq.check_invite_use_drift` — data quality views
