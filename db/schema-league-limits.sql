-- ============================================================================
-- Front Office — per-user league membership limits
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 2.17.0
--
-- A user may belong to (create + join, combined) at most 10 leagues at once.
-- Of those, the first 5 they create are unrestricted (subject to a 4-hour
-- cooldown between creations, enforced in application code against
-- league.created_at — no new column needed for that). Creating a 6th-10th
-- league requires this flag, which defaults off and is flipped by hand
-- (there is no in-app admin role) when a user asks for more.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.17.0', 'app_user.extra_leagues_approved — manual admin gate for a user''s 6th-10th league');

ALTER TABLE app_user
    ADD COLUMN extra_leagues_approved BOOLEAN NOT NULL DEFAULT FALSE;
