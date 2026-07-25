-- ============================================================================
-- Front Office — league platform type schema delta
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 1.5.0
-- Phase: 1 (Checkpoint 2 — league creation). Small, foundational, do it early.
--
-- Makes "what platform is this league" a first-class, enforced choice the
-- commissioner sets at league creation: Xbox, PlayStation, or Crossplay.
--
-- Why this is its own delta and lands in Phase 1: platform is league IDENTITY,
-- not a Phase-3 discovery afterthought. Earlier docs (discovery, membership)
-- carried a loose TEXT `platform` field; this replaces that with a real enum so
-- discovery filtering, sign-up matching, and marketplace ranking all speak the
-- same vocabulary instead of comparing free-text 'psn' vs 'PSN' vs 'ps'.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('1.5.0', 'League platform type enum: xbox / playstation / crossplay');

-- ---------------------------------------------------------------------------
-- The enum
-- ---------------------------------------------------------------------------
-- Three league types. Crossplay means the league mixes both consoles — a real
-- NHL matchmaking mode, not a fallback. It is a distinct choice, not "either".

CREATE TYPE platform_type AS ENUM ('xbox', 'playstation', 'crossplay');

-- Player/console identity for an individual user (distinct from the league type
-- above — a person is on one console; a crossplay league accepts both). Kept
-- separate so a crossplay league can still know which console each GM is on.
CREATE TYPE console_type AS ENUM ('xbox', 'playstation');

-- ---------------------------------------------------------------------------
-- League identity
-- ---------------------------------------------------------------------------
-- Set at creation, required. This is who the league IS. Defaults to crossplay
-- (the most inclusive) so a commissioner who skips the choice gets the widest
-- eligible pool rather than accidentally excluding half of them.

ALTER TABLE league
    ADD COLUMN platform platform_type NOT NULL DEFAULT 'crossplay';

-- ---------------------------------------------------------------------------
-- Reconcile the loose TEXT fields introduced by earlier deltas
-- ---------------------------------------------------------------------------
-- schema-discovery.sql and schema-membership.sql carried TEXT `platform`
-- columns with comments like 'psn' | 'xbox' | 'both'. If those deltas have
-- already been applied, migrate them to the enum; if this delta runs first,
-- the guards below are harmless no-ops.

DO $$
BEGIN
    -- app_user.platform (TEXT 'psn'|'xbox') -> console_type
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='app_user' AND column_name='platform'
                 AND data_type <> 'USER-DEFINED') THEN
        ALTER TABLE app_user
            ALTER COLUMN platform TYPE console_type
            USING (CASE lower(platform)
                       WHEN 'psn' THEN 'playstation'
                       WHEN 'ps'  THEN 'playstation'
                       WHEN 'playstation' THEN 'playstation'
                       WHEN 'xbox' THEN 'xbox'
                       ELSE NULL END)::console_type;
    END IF;

    -- league_listing.platform (TEXT) -> platform_type, if discovery delta ran
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='league_listing' AND column_name='platform'
                 AND data_type <> 'USER-DEFINED') THEN
        ALTER TABLE league_listing
            ALTER COLUMN platform TYPE platform_type
            USING (CASE lower(platform)
                       WHEN 'both' THEN 'crossplay'
                       WHEN 'psn'  THEN 'playstation'
                       WHEN 'ps'   THEN 'playstation'
                       WHEN 'playstation' THEN 'playstation'
                       WHEN 'xbox' THEN 'xbox'
                       WHEN 'crossplay' THEN 'crossplay'
                       ELSE 'crossplay' END)::platform_type;
    END IF;

    -- league_signup.platform (TEXT) -> console_type (an applicant is on one console)
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='league_signup' AND column_name='platform'
                 AND data_type <> 'USER-DEFINED') THEN
        ALTER TABLE league_signup
            ALTER COLUMN platform TYPE console_type
            USING (CASE lower(platform)
                       WHEN 'psn' THEN 'playstation'
                       WHEN 'ps'  THEN 'playstation'
                       WHEN 'playstation' THEN 'playstation'
                       WHEN 'xbox' THEN 'xbox'
                       ELSE NULL END)::console_type;
    END IF;
END $$;

-- Keep the listing's platform in step with the league's identity by default.
-- The listing may still narrow (a crossplay league advertising specifically to
-- Xbox players for a season) but defaults to the league's own type.
ALTER TABLE league_listing
    ALTER COLUMN platform SET DEFAULT 'crossplay';

-- ---------------------------------------------------------------------------
-- Eligibility helper
-- ---------------------------------------------------------------------------
-- Can a given console play in a given league type? Crossplay accepts both;
-- a single-console league accepts only its own. Used to validate a sign-up and
-- to filter the open-leagues page to leagues a prospect can actually join.

CREATE OR REPLACE FUNCTION console_eligible(lp platform_type, c console_type)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lp = 'crossplay'
        OR (lp = 'xbox'        AND c = 'xbox')
        OR (lp = 'playstation' AND c = 'playstation');
$$;

-- ---------------------------------------------------------------------------
-- Data quality
-- ---------------------------------------------------------------------------

-- ALERT: a GM whose console can't play in the league type they're assigned to.
-- Only meaningful for single-console leagues; crossplay never trips it. Catches
-- a mis-provisioned member (a PlayStation GM placed in an Xbox-only league).
CREATE OR REPLACE VIEW dq.check_platform_mismatch AS
SELECT ga.user_id, ga.team_season_id, l.platform AS league_platform, u.platform AS user_console
FROM gm_assignment ga
JOIN team_season ts ON ts.id = ga.team_season_id
JOIN season s ON s.id = ts.season_id
JOIN league l ON l.id = s.league_id
JOIN app_user u ON u.id = ga.user_id
WHERE ga.ended_at IS NULL
  AND u.platform IS NOT NULL
  AND NOT console_eligible(l.platform, u.platform);

-- ---------------------------------------------------------------------------
-- Note
-- ---------------------------------------------------------------------------
-- Platform is deliberately on `league` (identity), not `season` — "this is an
-- Xbox league" is stable across game years. If a league genuinely switched
-- platforms between seasons it would effectively be a new league; that's rare
-- enough not to model as per-season state.
-- ============================================================================
