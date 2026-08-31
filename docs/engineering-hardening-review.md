# Engineering hardening review

## Scope and disposition

| Severity | Finding | Evidence | Disposition |
|---|---|---|---|
| Critical | Private league data was readable through direct league, season, and game IDs | League, competition, schedule, seats, rulebook, and availability GET routes | Central league-access policy now resolves the application principal, visibility, active membership, and delegated commissioner roles before data queries. Inaccessible resources return a non-enumerating 404. |
| High | Public projections reused private records and identifiers | Public league slug and open-directory queries | Public routes now require public visibility and expose explicit projections without owner IDs, public codes, or console identity details. |
| High | Authorization compared external subjects with application UUIDs or used owner-only checks | DQ, discovery, seats, settings, schedule, and management routes | Request identity is resolved once by the auth adapter; league permissions route through the shared access loader and `can()` policy. |
| High | Partial listing updates could reset omitted values | League listing update route | The OpenAPI contract now uses PATCH semantics; generated validation rejects malformed/empty requests, omission preserves values, and explicit null clears nullable values. |
| High | Migration CI asserted an obsolete enum contract | CI migration assertion after migration 2.5.0 | CI verifies canonical text columns and exact migration presence, replays migrations, and rejects unreviewed relation/column removals or type changes. |
| High | Readiness did not check the database or required schema | API health route | `/livez` checks process liveness only; `/readyz` and `/api/healthz` verify database access and required schema state, returning 503 without internal details when unavailable. |
| High | Vulnerable transitive dependencies could re-enter the lockfile | Dependency audit | Fixed versions are pinned by workspace overrides and CI rejects high-severity advisories. |
| Medium | Generated query keys and types were bypassed | Manage League and Schedule pages | Mutations use generated query-key helpers and generated payload/data types without `any` casts. |
| Medium | Custom click targets lacked native semantics | Listing switch and signup division controls | Controls now use native checkbox/radio semantics and focused accessibility tests. |

## Ownership boundaries

- OpenAPI owns request/response contracts, generated validators, clients, and query keys.
- Raw ordered SQL owns domain schema and migrations. Application build/start commands never apply production DDL.
- The auth adapter owns external-to-application identity resolution.
- `authz.ts` owns permission decisions; the league-access loader owns policy facts from the database.
- Public endpoints own purpose-built projections. They must not reuse private/member records.
- Background delivery owns provider retries; it must not weaken request or database transaction boundaries.

## Mandatory gates for future changes

### Schema

- Add one replay-safe, uniquely versioned migration.
- Run bootstrap, ordered migration, replay, and schema-diff safety checks.
- Review view/function dependencies before changing a referenced column type.
- Never add DDL to application build, start, health, or post-merge commands.

### API and authorization

- Change OpenAPI first, regenerate, and reject generated drift.
- Validate path, query, and body values with generated schemas.
- Resolve the application principal once and call the centralized policy.
- Test anonymous, outsider, departed member, GM, assistant, commissioner, and owner cases.
- Return public projections only from explicitly public routes.

### Frontend

- Use generated hooks, payload types, response types, and query keys.
- Invalidate every affected generated cache key after mutations.
- Preserve omission versus explicit-null semantics.
- Use native controls and test accessible names, roles, and keyboard behavior.

### Operations and security

- Keep liveness dependency-free and make readiness verify required dependencies and schema.
- Run dependency, static-analysis, and privacy scans before release.
- Require zero critical/high dependency findings.
- Verify typecheck, frontend tests, full API tests, builds, migration replay, and critical browser journeys.