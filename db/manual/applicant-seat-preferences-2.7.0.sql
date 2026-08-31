-- ============================================================================
-- Front Office — structured applicant franchise-seat preferences
-- Target: PostgreSQL 15+
-- Depends on: db/schema.sql and db/schema-discovery.sql
-- Schema version: 2.7.0
--
-- MANUAL HANDOFF: apply this migration before deploying the application code.
-- This file intentionally lives outside db/migration-*.sql so the automated
-- domain migration runner cannot apply it.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS applicant_team_season_preference (
    league_id          UUID NOT NULL REFERENCES league(id) ON DELETE CASCADE,
    applicant_user_id  UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    team_season_id     UUID NOT NULL REFERENCES team_season(id) ON DELETE CASCADE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (league_id, applicant_user_id, team_season_id)
);

CREATE INDEX IF NOT EXISTS applicant_team_season_preference_team_idx
    ON applicant_team_season_preference (team_season_id, applicant_user_id);

COMMENT ON TABLE applicant_team_season_preference IS
    'Structured franchise-seat willingness for current league applicants and waitlist entrants.';

INSERT INTO schema_version (version, notes)
VALUES ('2.7.0', 'Normalized applicant-to-team-season franchise seat preferences')
ON CONFLICT (version) DO NOTHING;

COMMIT;