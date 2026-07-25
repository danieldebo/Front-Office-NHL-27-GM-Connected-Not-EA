-- ============================================================================
-- Front Office — feature request schema delta
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 1.6.0
-- Phase: 3 (user feedback — no auth required to submit)
--
-- Collects anonymous or identified feature ideas. Source IP is hashed before
-- storage so no raw IP is ever persisted. Email is optional and kept separate
-- from the body to prevent accidental logging. The body is capped at 4000 chars.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('1.6.0', 'Feature request inbox — public submission, hashed IP, capped body');

CREATE TABLE feature_request (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Optional contact email. Nullable; never logged in full.
    email           TEXT,
    -- The idea body. 4000-char cap matches the UI counter.
    body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    -- SHA-256 of the submitter's IP for rate-limiting / abuse review.
    -- Never the raw IP.
    source_ip_hash  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for time-based listing and IP-hash abuse queries.
CREATE INDEX ON feature_request (created_at DESC);
CREATE INDEX ON feature_request (source_ip_hash) WHERE source_ip_hash IS NOT NULL;
-- ============================================================================
