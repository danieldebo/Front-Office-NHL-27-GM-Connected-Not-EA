BEGIN;

INSERT INTO schema_version (version, notes)
VALUES ('2.4.0', 'Record curated template provenance on immutable league settings versions')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE league_settings_version
  ADD COLUMN IF NOT EXISTS applied_template_id TEXT;

ALTER TABLE league_settings_version
  DROP CONSTRAINT IF EXISTS league_settings_version_applied_template_id_check;
ALTER TABLE league_settings_version
  ADD CONSTRAINT league_settings_version_applied_template_id_check
  CHECK (
    applied_template_id IS NULL
    OR applied_template_id IN (
      'balanced_standard',
      'international_style',
      'maximum_fighting_contact'
    )
  );

COMMIT;