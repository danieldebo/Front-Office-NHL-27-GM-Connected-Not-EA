-- ============================================================================
-- Front Office — record commissioner notes when declining applicants
-- Target: PostgreSQL 15+
-- Depends on: db/schema-discovery.sql (>= 1.4.0)
-- Schema version: 1.8.0
--
-- Forward-only migration. The nullable note stays on the waitlist entry after
-- the related sign-up is removed, preserving the commissioner's audit trail.
-- ============================================================================

BEGIN;

ALTER TABLE waitlist_entry
    ADD COLUMN IF NOT EXISTS decline_note TEXT;

INSERT INTO schema_version (version, notes)
VALUES ('1.8.0', 'Store an optional commissioner note when declining an applicant')
ON CONFLICT (version) DO NOTHING;

COMMIT;