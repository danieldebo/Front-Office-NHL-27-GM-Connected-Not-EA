-- ============================================================================
-- Front Office — add app_user.replit_id
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 2.12.0
--
-- clerkIdentityMiddleware.ts has looked up and upserted on app_user.replit_id
-- since before this build queue started (`ON CONFLICT (replit_id) DO UPDATE`,
-- `SELECT id FROM app_user WHERE replit_id = $1`) — the legacy domain identity
-- a Clerk session maps to. No db/*.sql file ever defined the column, so every
-- environment had to add it by hand before the app would authenticate at all.
-- This makes that permanent instead of a recurring manual step.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.12.0', 'Add the long-relied-on-but-never-defined app_user.replit_id column');

ALTER TABLE app_user
    ADD COLUMN IF NOT EXISTS replit_id TEXT UNIQUE;
