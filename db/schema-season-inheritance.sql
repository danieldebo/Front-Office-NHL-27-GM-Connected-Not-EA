-- ============================================================================
-- Front Office — season inheritance from league settings
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1),
--                                        migration-2.0.0-league-settings.sql
-- Schema version: 2.3.0
--
-- Build-queue prompt B: points system and tiebreaker order were season-only,
-- so a league had nothing to act as a default for them. Adds both to
-- league_settings_version, plus a per-league switch to turn inheritance off
-- entirely (Create Season then opens blank instead of prefilled).
--
-- Note: points_reg_loss is constrained to 0 here (a NEW column) per the
-- pre-build review (M2) — hockey never awards a point for a regulation
-- loss. season.points_reg_loss is left alone; it predates this delta and
-- changing an existing column's constraint is a separate decision.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.3.0', 'League settings: points system + tiebreakers, per-league inheritance switch');

ALTER TABLE league_settings_version
  ADD COLUMN IF NOT EXISTS points_win INT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS points_ot_loss INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS points_reg_loss INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tiebreakers JSONB NOT NULL DEFAULT '["points","row","wins","goal_diff","goals_for"]'::jsonb;

ALTER TABLE league_settings_version
  DROP CONSTRAINT IF EXISTS league_settings_version_points_reg_loss_check;
ALTER TABLE league_settings_version
  ADD CONSTRAINT league_settings_version_points_reg_loss_check CHECK (points_reg_loss = 0);

ALTER TABLE league
  ADD COLUMN IF NOT EXISTS use_settings_defaults BOOLEAN NOT NULL DEFAULT true;
