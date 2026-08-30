-- ============================================================================
-- Front Office — Xbox identity verification schema delta
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 2.1.0
--
-- app_user.xbox_gamertag is self-reported free text with no check against the
-- real account. This delta adds a table for a REAL verification: the
-- commissioner-facing OAuth flow (Microsoft consumer login -> Xbox Live token
-- exchange) proves a user controls a given Xbox Live account and returns its
-- gamertag and XUID directly from Microsoft, not from what the user typed.
--
-- No public PlayStation equivalent exists (Sony's real identity API requires
-- licensed-developer / PS5 DevNet status) — this delta is Xbox-only by design,
-- not an oversight. PSN identity stays self-reported / commissioner-attested.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.1.0', 'Xbox Live identity verification (xbox_link)');

-- One verified Xbox Live account per app_user. UNIQUE on xuid means the
-- database — not application code — refuses two different app_users from
-- both claiming the same real Xbox account.
CREATE TABLE xbox_link (
    user_id                  UUID PRIMARY KEY REFERENCES app_user(id),
    xuid                     TEXT NOT NULL UNIQUE,
    gamertag                 TEXT NOT NULL,
    linked_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_verified_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- AES-256-GCM ciphertext (iv:authTag:ciphertext, base64) of the Microsoft
    -- refresh token, used only to silently re-check the gamertag hasn't
    -- changed. Never store the raw token.
    refresh_token_ciphertext TEXT,
    refresh_token_expires_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Data quality
-- ---------------------------------------------------------------------------
-- ALERT: a verified Xbox link whose gamertag has drifted from the self-reported
-- profile field — the periodic re-check updates xbox_link.gamertag but a stale
-- app_user.xbox_gamertag would silently mislead anyone still reading that column.
CREATE OR REPLACE VIEW dq.check_xbox_gamertag_drift AS
SELECT xl.user_id, xl.gamertag AS verified_gamertag, au.xbox_gamertag AS profile_gamertag
FROM xbox_link xl
JOIN app_user au ON au.id = xl.user_id
WHERE au.xbox_gamertag IS DISTINCT FROM xl.gamertag;
