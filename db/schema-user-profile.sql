-- Development delta: canonical player profile identities and immutable history.
-- Idempotent so local databases may apply it repeatedly.

INSERT INTO schema_version (version, notes)
VALUES ('1.9.0', 'Canonical Xbox/PSN profile, systems played, identity snapshots, and append-only profile history')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE app_user
    ADD COLUMN IF NOT EXISTS xbox_gamertag TEXT,
    ADD COLUMN IF NOT EXISTS psn_online_id TEXT,
    ADD COLUMN IF NOT EXISTS systems_played TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS primary_identity TEXT;

-- Preserve the loose legacy identity while copying all values that can be
-- classified. The old columns intentionally remain available for unrecognised
-- historical values.
UPDATE app_user
SET xbox_gamertag = COALESCE(xbox_gamertag, platform_gamertag),
    systems_played = CASE
        WHEN NOT ('xbox' = ANY(systems_played)) THEN array_append(systems_played, 'xbox')
        ELSE systems_played
    END,
    primary_identity = COALESCE(primary_identity, 'xbox')
WHERE lower(platform::TEXT) = 'xbox'
  AND NULLIF(btrim(platform_gamertag), '') IS NOT NULL;

UPDATE app_user
SET psn_online_id = COALESCE(psn_online_id, platform_gamertag),
    systems_played = CASE
        WHEN NOT ('playstation' = ANY(systems_played)) THEN array_append(systems_played, 'playstation')
        ELSE systems_played
    END,
    primary_identity = COALESCE(primary_identity, 'playstation')
WHERE lower(platform::TEXT) IN ('psn', 'ps', 'playstation')
  AND NULLIF(btrim(platform_gamertag), '') IS NOT NULL;

UPDATE app_user SET timezone = 'UTC' WHERE timezone IS NULL OR btrim(timezone) = '';
ALTER TABLE app_user ALTER COLUMN timezone SET DEFAULT 'UTC';
ALTER TABLE app_user ALTER COLUMN timezone SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_user_systems_played_valid') THEN
        ALTER TABLE app_user ADD CONSTRAINT app_user_systems_played_valid
            CHECK (systems_played <@ ARRAY['xbox', 'playstation']::TEXT[]);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_user_primary_identity_valid') THEN
        ALTER TABLE app_user ADD CONSTRAINT app_user_primary_identity_valid
            CHECK (primary_identity IS NULL OR primary_identity IN ('xbox', 'playstation'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_user_primary_identity_present') THEN
        ALTER TABLE app_user ADD CONSTRAINT app_user_primary_identity_present CHECK (
            primary_identity IS NULL
            OR (primary_identity = 'xbox' AND NULLIF(btrim(xbox_gamertag), '') IS NOT NULL
                AND 'xbox' = ANY(systems_played))
            OR (primary_identity = 'playstation' AND NULLIF(btrim(psn_online_id), '') IS NOT NULL
                AND 'playstation' = ANY(systems_played))
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_user_profile_history (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES app_user(id),
    display_name        TEXT NOT NULL,
    timezone            TEXT NOT NULL,
    xbox_gamertag       TEXT,
    psn_online_id       TEXT,
    systems_played      TEXT[] NOT NULL,
    primary_identity    TEXT,
    changed_by          UUID REFERENCES app_user(id),
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_user_profile_history_user_recorded
    ON app_user_profile_history (user_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION reject_app_user_profile_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'app_user_profile_history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS app_user_profile_history_append_only ON app_user_profile_history;
CREATE TRIGGER app_user_profile_history_append_only
BEFORE UPDATE OR DELETE ON app_user_profile_history
FOR EACH ROW EXECUTE FUNCTION reject_app_user_profile_history_mutation();

INSERT INTO app_user_profile_history
    (user_id, display_name, timezone, xbox_gamertag, psn_online_id,
     systems_played, primary_identity, changed_by)
SELECT u.id, u.display_name, u.timezone, u.xbox_gamertag, u.psn_online_id,
       u.systems_played, u.primary_identity, u.id
FROM app_user u
WHERE NOT EXISTS (
    SELECT 1 FROM app_user_profile_history h WHERE h.user_id = u.id
);

ALTER TABLE league_signup
    ADD COLUMN IF NOT EXISTS platform_gamertag TEXT,
    ADD COLUMN IF NOT EXISTS xbox_gamertag TEXT,
    ADD COLUMN IF NOT EXISTS psn_online_id TEXT,
    ADD COLUMN IF NOT EXISTS primary_identity TEXT,
    ADD COLUMN IF NOT EXISTS systems_played TEXT[];

ALTER TABLE waitlist_entry
    ADD COLUMN IF NOT EXISTS platform TEXT,
    ADD COLUMN IF NOT EXISTS platform_gamertag TEXT,
    ADD COLUMN IF NOT EXISTS xbox_gamertag TEXT,
    ADD COLUMN IF NOT EXISTS psn_online_id TEXT,
    ADD COLUMN IF NOT EXISTS primary_identity TEXT,
    ADD COLUMN IF NOT EXISTS systems_played TEXT[];

-- Backfill application snapshots without overwriting any evidence an applicant
-- already supplied. `platform` and `platform_gamertag` retain unknown legacy
-- values even when they cannot be normalized to Xbox or PlayStation.
UPDATE league_signup s
SET platform_gamertag = COALESCE(s.platform_gamertag, u.platform_gamertag),
    xbox_gamertag = COALESCE(
        s.xbox_gamertag, u.xbox_gamertag,
        CASE WHEN lower(s.platform::text) = 'xbox' THEN s.platform_gamertag END,
        CASE WHEN lower(u.platform::text) = 'xbox' THEN u.platform_gamertag END
    ),
    psn_online_id = COALESCE(
        s.psn_online_id, u.psn_online_id,
        CASE WHEN lower(s.platform::text) IN ('psn', 'ps', 'playstation') THEN s.platform_gamertag END,
        CASE WHEN lower(u.platform::text) IN ('psn', 'ps', 'playstation') THEN u.platform_gamertag END
    ),
    systems_played = COALESCE(s.systems_played, u.systems_played),
    primary_identity = COALESCE(
        s.primary_identity, u.primary_identity,
        CASE WHEN lower(s.platform::text) = 'xbox' THEN 'xbox' END,
        CASE WHEN lower(s.platform::text) IN ('psn', 'ps', 'playstation') THEN 'playstation' END,
        CASE WHEN lower(u.platform::text) = 'xbox' THEN 'xbox' END,
        CASE WHEN lower(u.platform::text) IN ('psn', 'ps', 'playstation') THEN 'playstation' END
    )
FROM app_user u
WHERE u.id = s.user_id;

WITH waitlist_source AS (
    SELECT w2.id, s.platform AS signup_platform, s.platform_gamertag AS signup_gamertag,
           s.xbox_gamertag AS signup_xbox_gamertag,
           s.psn_online_id AS signup_psn_online_id,
           s.systems_played AS signup_systems_played,
           s.primary_identity AS signup_primary_identity
    FROM waitlist_entry w2
    LEFT JOIN league_signup s ON s.id = w2.signup_id
)
UPDATE waitlist_entry w
SET platform = COALESCE(w.platform, s.signup_platform::text, u.platform::text),
    platform_gamertag = COALESCE(w.platform_gamertag, s.signup_gamertag, u.platform_gamertag),
    xbox_gamertag = COALESCE(w.xbox_gamertag, s.signup_xbox_gamertag, u.xbox_gamertag),
    psn_online_id = COALESCE(w.psn_online_id, s.signup_psn_online_id, u.psn_online_id),
    systems_played = COALESCE(w.systems_played, s.signup_systems_played, u.systems_played),
    primary_identity = COALESCE(w.primary_identity, s.signup_primary_identity, u.primary_identity)
FROM app_user u, waitlist_source s
WHERE u.id = w.user_id AND s.id = w.id;