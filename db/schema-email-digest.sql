-- ============================================================================
-- Front Office — weekly commissioner email digest settings
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1), schema-membership.sql
-- Schema version: 2.9.0
--
-- The digest itself is delivered through the existing outbox (topic
-- 'email.digest', drained by outboxWorker.ts) — same plumbing built for
-- Discord posts in Prompt F, not a new delivery mechanism. This delta only
-- adds the settings a commissioner edits and the per-member unsubscribe
-- state / send-log dedup key.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.9.0', 'Weekly digest settings on league, per-membership unsubscribe, send-log dedup table');

ALTER TABLE league
    ADD COLUMN digest_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN digest_day_of_week  INT NOT NULL DEFAULT 1 CHECK (digest_day_of_week BETWEEN 0 AND 6),
    ADD COLUMN digest_hour_local   INT NOT NULL DEFAULT 9 CHECK (digest_hour_local BETWEEN 0 AND 23),
    ADD COLUMN digest_timezone     TEXT NOT NULL DEFAULT 'UTC',
    ADD COLUMN digest_template_md  TEXT;

ALTER TABLE league_membership
    ADD COLUMN digest_unsubscribed_at TIMESTAMPTZ,
    ADD COLUMN digest_unsub_token     UUID NOT NULL DEFAULT gen_random_uuid();

-- One row per league per calendar date (in the league's own timezone) that a
-- digest was actually sent for — the scheduler's dedup key so a tick that
-- runs more than once inside the target hour never double-sends.
CREATE TABLE league_digest_send_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id     UUID NOT NULL REFERENCES league(id),
    sent_for_date DATE NOT NULL,
    recipients    INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (league_id, sent_for_date)
);
