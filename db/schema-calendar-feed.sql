-- ============================================================================
-- Front Office — per-league and per-GM read-only calendar (.ics) feed tokens
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 2.10.0
--
-- gm_user_id NULL means the whole-league feed (commissioner-only to mint);
-- a non-null gm_user_id is that member's personal feed, scoped to their own
-- team's games. Revoking never deletes or edits a row in place — it closes
-- the old one (revoked_at) and a new token is issued as a fresh row, so a
-- leaked-then-revoked token's history stays visible, same convention as
-- commissioner_invite.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.10.0', 'Calendar feed tokens: per-league and per-GM, revocable');

CREATE TABLE calendar_feed_token (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id   UUID NOT NULL REFERENCES league(id),
    gm_user_id  UUID REFERENCES app_user(id),
    token       TEXT UNIQUE NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON calendar_feed_token (token) WHERE revoked_at IS NULL;
-- At most one live token per (league, scope) — a partial unique index rather
-- than a table-wide one so revoked history can pile up freely.
CREATE UNIQUE INDEX calendar_feed_token_live_league
    ON calendar_feed_token (league_id)
    WHERE gm_user_id IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX calendar_feed_token_live_gm
    ON calendar_feed_token (league_id, gm_user_id)
    WHERE gm_user_id IS NOT NULL AND revoked_at IS NULL;
