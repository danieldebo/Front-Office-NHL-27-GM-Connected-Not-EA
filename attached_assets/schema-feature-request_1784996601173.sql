-- ============================================================================
-- Front Office — feature request schema delta
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 1.6.0
-- Phase: any (small, standalone; ships with the footer, Checkpoint 20)
--
-- Backs the "Feature Request" button in the persistent footer. A visitor —
-- signed in or not — submits an email and a message. That's the whole feature.
--
-- PRIVACY: the submitted email is PII (docs/threat-model.md). It is captured for
-- follow-up only: never public, never logged in full, never added to the weekly
-- email audience or any marketing list. A feature request is not a newsletter
-- opt-in.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('1.6.0', 'Feature request capture from the footer modal');

CREATE TYPE feature_request_status AS ENUM
    ('new', 'reviewing', 'planned', 'shipped', 'declined', 'spam');

CREATE TABLE feature_request (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Links to the submitter if they were signed in; NULL for anonymous.
    user_id        UUID REFERENCES app_user(id),
    -- Contact email entered in the modal. PII — capture-for-followup only.
    email          CITEXT,
    -- The request text.
    body           TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
    -- Lightweight triage.
    status         feature_request_status NOT NULL DEFAULT 'new',
    admin_note     TEXT,                          -- internal, never shown to submitter
    -- Abuse controls: where it came from, for rate-limiting and spam triage.
    -- Store a hash of the IP, never the raw IP (minimization).
    source_ip_hash TEXT,
    user_agent     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON feature_request (status, created_at DESC);
CREATE INDEX ON feature_request (user_id) WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Notes for the build
-- ---------------------------------------------------------------------------
-- * The submit endpoint is PUBLIC (anonymous allowed) but rate-limited per IP
--   and per session, and gated by the same upload/abuse hygiene as any public
--   write — this is an unauthenticated write surface, so treat it as hostile:
--   length-cap the body (enforced above), strip HTML, and run it through spam
--   heuristics before it lands as 'new'.
-- * Email is OPTIONAL. A submitter who doesn't want follow-up can leave it blank
--   and still send the request.
-- * This table is admin-only to read. No public or member-facing view selects
--   from it — the modal only ever WRITES.
-- * A confirmation is shown in the UI ("thanks, we got it"); no auto-reply email
--   is sent, so a captured address is never used to message someone who didn't
--   ask to be messaged.
-- ============================================================================
