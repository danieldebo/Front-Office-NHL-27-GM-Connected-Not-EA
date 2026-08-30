-- ============================================================================
-- Front Office — league settings identity & verification delta
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1),
--                                        schema-platform.sql (>= 1.5.0),
--                                        migration-2.0.0-league-settings.sql
-- Schema version: 2.2.0
--
-- Two fixes needed for the League Settings editor (build-queue prompt A):
--
-- 1. league_settings_version.platform was added (2.0.0) with a DIFFERENT,
--    older vocabulary ('psn','xbox','both') than league.platform (1.5.0:
--    'xbox','playstation','crossplay'). Editing "Platform" from the settings
--    editor should update the one canonical field — league.platform — that
--    discovery/eligibility already reads, not a second, differently-worded
--    copy.
--
--    league_settings_version is append-only (a BEFORE UPDATE trigger refuses
--    any UPDATE), so historical rows that already used 'psn'/'both' cannot be
--    remapped in place — and should not be: they accurately record what was
--    chosen at the time. Widen the CHECK to accept both vocabularies rather
--    than rewrite history. The application only ever WRITES the new
--    ('xbox','playstation','crossplay') vocabulary from this version forward.
--
-- 2. require_verified_identities didn't exist at all — "Members must confirm
--    gamertag before claiming a seat" from the original spec was never built.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.2.0', 'League settings: accept the canonical platform vocabulary, add require_verified_identities');

ALTER TABLE league_settings_version DROP CONSTRAINT IF EXISTS league_settings_version_platform_check;
ALTER TABLE league_settings_version
  ADD CONSTRAINT league_settings_version_platform_check
  CHECK (platform IN ('psn', 'xbox', 'both', 'playstation', 'crossplay'));
ALTER TABLE league_settings_version ALTER COLUMN platform SET DEFAULT 'crossplay';

ALTER TABLE league_settings_version
  ADD COLUMN IF NOT EXISTS require_verified_identities BOOLEAN NOT NULL DEFAULT false;
