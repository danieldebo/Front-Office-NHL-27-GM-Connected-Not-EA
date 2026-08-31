---
name: Domain migration ledger
description: Rules for ordering and recording Front Office domain schema upgrades.
---

Every domain schema delta must have a unique semantic version, run transactionally, and record that exact version in `schema_version`. Migration completion must be checked by exact version, never by the maximum recorded version.

**Why:** Two unrelated historical deltas both claimed version 1.8.0. Applying one made the other look complete, leaving applicant location fields and views absent while newer schema versions were present.

**How to apply:** Give each new domain delta its own migration file and version row. Keep replay-safe SQL, preserve one-session advisory locking, and sort versions semantically before execution.

Production readiness must validate required schema structures, not `schema_version` rows.

**Why:** Replit Publish synchronizes database structure but does not promote migration-ledger data rows. A readiness probe that required a ledger row rejected an otherwise healthy production database. Publish also did not surface a view-definition-only privacy change in its schema diff.

**How to apply:** Run ordered migrations against development during post-merge setup. Check concrete tables, columns, and indexes in readiness. Enforce security predicates in application queries as well as views so stale production view bodies cannot expose data or block promotion.