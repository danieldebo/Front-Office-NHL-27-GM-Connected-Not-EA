BEGIN;

INSERT INTO schema_version (version, notes)
VALUES ('2.3.0', 'Replace server console-profile scraping with commissioner-attested identity verification')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE identity_verification_challenge
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES app_user(id);

ALTER TABLE identity_verification_evidence
  ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'legacy_profile_scrape',
  ADD COLUMN IF NOT EXISTS reviewer_user_id UUID REFERENCES app_user(id);

-- Evidence is append-only. Temporarily remove its mutation trigger solely to
-- label rows created by the retired scraper (including rows mislabeled by an
-- earlier partial 2.3 application), then restore the trigger in this transaction.
DROP TRIGGER IF EXISTS identity_verification_evidence_append_only
  ON identity_verification_evidence;
UPDATE identity_verification_evidence
   SET method = 'legacy_profile_scrape'
 WHERE reviewer_user_id IS NULL
   AND method IS DISTINCT FROM 'legacy_profile_scrape';
CREATE TRIGGER identity_verification_evidence_append_only
BEFORE UPDATE OR DELETE ON identity_verification_evidence
FOR EACH ROW EXECUTE FUNCTION reject_identity_verification_evidence_mutation();

ALTER TABLE identity_verification_evidence
  ALTER COLUMN method SET DEFAULT 'commissioner_attestation';

ALTER TABLE identity_verification_evidence
  DROP CONSTRAINT IF EXISTS identity_verification_evidence_method_check;
ALTER TABLE identity_verification_evidence
  ADD CONSTRAINT identity_verification_evidence_method_check
  CHECK (
    (method = 'legacy_profile_scrape' AND reviewer_user_id IS NULL)
    OR
    (method = 'commissioner_attestation' AND reviewer_user_id IS NOT NULL)
  );

COMMIT;