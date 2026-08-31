BEGIN;

INSERT INTO schema_version (version, notes)
VALUES ('2.2.0', 'Xbox and PlayStation ownership verification with optional league eligibility enforcement')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS xbox_identity_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS playstation_identity_verified_at TIMESTAMPTZ;

ALTER TABLE league_settings_version
  ADD COLUMN IF NOT EXISTS require_verified_identities BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS identity_verification_challenge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id),
  platform TEXT NOT NULL CHECK (platform IN ('xbox', 'playstation')),
  gamertag TEXT NOT NULL,
  code TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  superseded_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS identity_verification_challenge_current
  ON identity_verification_challenge (user_id, platform, created_at DESC);

CREATE TABLE IF NOT EXISTS identity_verification_evidence (
  id BIGSERIAL PRIMARY KEY,
  challenge_id UUID NOT NULL REFERENCES identity_verification_challenge(id),
  user_id UUID NOT NULL REFERENCES app_user(id),
  platform TEXT NOT NULL CHECK (platform IN ('xbox', 'playstation')),
  gamertag TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  response_status INT,
  response_sha256 TEXT,
  code_found BOOLEAN NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('verified', 'code_not_found', 'fetch_failed'))
);
CREATE INDEX IF NOT EXISTS identity_verification_evidence_user
  ON identity_verification_evidence (user_id, platform, fetched_at DESC);

CREATE OR REPLACE FUNCTION reject_identity_verification_evidence_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identity_verification_evidence is append-only';
END;
$$;
DROP TRIGGER IF EXISTS identity_verification_evidence_append_only
  ON identity_verification_evidence;
CREATE TRIGGER identity_verification_evidence_append_only
BEFORE UPDATE OR DELETE ON identity_verification_evidence
FOR EACH ROW EXECUTE FUNCTION reject_identity_verification_evidence_mutation();

COMMIT;