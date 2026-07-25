-- ============================================================================
-- Front Office — location & country schema delta
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1),
--                                        schema-discovery.sql (>= 1.4.0)
-- Schema version: 1.8.0
-- Phase: 3 (discovery/intake — sign-up captures these)
--
-- Everyone who signs up provides a location and a country. Both surface, with
-- the applicant's skill level, wherever a commissioner evaluates a seat — the
-- waitlist and the applicant list especially.
--
-- PRIVACY (docs/threat-model.md):
--   * country_code is coarse and low-sensitivity — fine to show on applicant and
--     waitlist views a commissioner sees.
--   * `location` is a self-entered free-text region (e.g. "Chicago, IL" or
--     "Ontario"). It is a fixed self-description a person chooses to share for
--     matchmaking — NOT real-time whereabouts. Keep it region-level; it appears
--     to commissioners evaluating fit, never on a public page and never in logs.
--   * These help leagues gauge time-zone overlap and regional fit; they never
--     gate anyone automatically.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('1.8.0', 'User location + country; surfaced on waitlist and applicant views');

-- ---------------------------------------------------------------------------
-- User fields
-- ---------------------------------------------------------------------------
-- app_user already has `country_code` (CHAR(2), ISO 3166) and `timezone` from
-- schema.sql. This adds the self-entered region label and makes country part of
-- the sign-up contract.

ALTER TABLE app_user
    ADD COLUMN location TEXT;         -- self-entered region, e.g. 'Chicago, IL'

-- Per-application copies, so a sign-up records what the applicant stated AT THE
-- TIME (their profile can change later; the application shouldn't silently drift).
ALTER TABLE league_signup
    ADD COLUMN country_code CHAR(2),  -- ISO 3166-1 alpha-2
    ADD COLUMN location     TEXT;

-- Sign-up now requires country. Enforced in the app + a soft check here; kept as
-- a CHECK rather than NOT NULL so existing rows (pre-delta) don't block the
-- migration, and the app guarantees it going forward.
ALTER TABLE league_signup
    ADD CONSTRAINT signup_country_format
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');

-- ---------------------------------------------------------------------------
-- Rebuild the applicant + waitlist views to include location, country, skill
-- ---------------------------------------------------------------------------
-- The requirement: when someone joins a waitlist, list their location and
-- country ALONGSIDE their skill level. Skill here is the SELF-REPORTED ranked
-- division (player-visible) — NOT the hidden admin rating, which stays isolated
-- behind admin-scoped code (rule 18) and is never joined into these views.

DROP VIEW IF EXISTS v_league_applicants;
CREATE VIEW v_league_applicants AS
SELECT
    su.league_id,
    su.user_id,
    u.display_name,
    su.stated_division            AS skill_division,   -- self-reported skill
    COALESCE(su.country_code, u.country_code) AS country_code,
    COALESCE(su.location, u.location)         AS location,
    COALESCE(su.timezone, u.timezone)         AS timezone,
    su.platform,
    su.message,
    su.preferred_club,
    su.created_at,
    w.status                      AS waitlist_status,
    w.position                    AS waitlist_position
FROM league_signup su
JOIN app_user u ON u.id = su.user_id
LEFT JOIN waitlist_entry w ON w.signup_id = su.id;

-- A dedicated waitlist view: the queue for a league with each entry's skill,
-- location, and country in one place, ordered by position. This is what the
-- commissioner's waitlist screen reads.
CREATE VIEW v_waitlist AS
SELECT
    w.league_id,
    w.position,
    w.status,
    w.user_id,
    u.display_name,
    su.stated_division            AS skill_division,   -- self-reported skill
    COALESCE(su.country_code, u.country_code) AS country_code,
    COALESCE(su.location, u.location)         AS location,
    COALESCE(su.timezone, u.timezone)         AS timezone,
    su.platform,
    w.joined_at,
    w.invited_at,
    w.invite_expires_at
FROM waitlist_entry w
JOIN app_user u ON u.id = w.user_id
LEFT JOIN league_signup su ON su.id = w.signup_id
WHERE w.status IN ('waiting','invited')
ORDER BY w.league_id, w.position;

-- ---------------------------------------------------------------------------
-- Open-leagues page: expose country spread as a soft matchmaking hint
-- ---------------------------------------------------------------------------
-- (Optional, non-identifying) — helps a prospect gauge whether a league's crowd
-- overlaps their region/time zone. Aggregate only; never individual locations.
-- The v_open_leagues view already carries timezone_focus from league_listing;
-- no change needed here beyond noting locations feed the commissioner's own
-- read of applicant fit, not the public directory.

-- ---------------------------------------------------------------------------
-- Data quality
-- ---------------------------------------------------------------------------

-- Ensure the dq schema exists (may not have been created by earlier migrations
-- if data-quality-checks.sql was not applied before this delta).
CREATE SCHEMA IF NOT EXISTS dq;

-- ALERT: a sign-up missing a country (the app should require it going forward).
CREATE OR REPLACE VIEW dq.check_signup_missing_country AS
SELECT id AS signup_id, league_id, user_id, created_at
FROM league_signup
WHERE country_code IS NULL;

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
-- * `location` is region-level self-description, never live location. Do not add
--   precise coordinates, and never derive location from an IP silently — the
--   person types what they want to share. (docs/threat-model.md: real-time
--   location is never-store; a chosen region label is not that.)
-- * skill_division in these views is the self-reported ranked_division. The
--   hidden admin_skill_rating is NEVER joined here — it reaches only the one
--   admin-scoped endpoint. Keeping them apart is deliberate (rule 18).
-- * Country + location + skill appear together on the waitlist and applicant
--   screens so a commissioner can gauge fit and time-zone overlap at a glance.
-- ============================================================================
