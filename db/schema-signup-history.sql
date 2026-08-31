-- ============================================================================
-- Front Office — keep a permanent record of applicant decisions
-- Target: PostgreSQL 15+  |  Depends on: schema-discovery.sql (>= 1.4.0)
-- Schema version: 2.13.0
--
-- accept/decline on an open-leagues sign-up (discovery.ts) used to hard-DELETE
-- the league_signup row once decided — a commissioner had no way to look back
-- at who they'd turned down or why. This makes league_signup append-only-ish
-- like everything else in this schema: a decision is a status transition with
-- who/when/why, never a deletion. join_request (seats.ts) already worked this
-- way; this brings the discovery-intake path in line with it.
--
-- The old blanket UNIQUE (league_id, user_id) assumed at most one signup ever
-- existed per applicant; now that resolved rows stick around, it's replaced
-- with a partial index so a previously-declined applicant can apply again.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.13.0', 'league_signup keeps a permanent accept/decline history instead of being deleted on decision');

ALTER TABLE league_signup
    ADD COLUMN status       TEXT NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'accepted', 'declined')),
    ADD COLUMN decided_by   UUID REFERENCES app_user(id),
    ADD COLUMN decided_at   TIMESTAMPTZ,
    ADD COLUMN decision_note TEXT,
    ADD CONSTRAINT league_signup_decision_recorded
        CHECK (status = 'pending' OR decided_at IS NOT NULL);

ALTER TABLE league_signup DROP CONSTRAINT league_signup_league_id_user_id_key;
CREATE UNIQUE INDEX league_signup_one_pending_per_user
    ON league_signup (league_id, user_id)
    WHERE status = 'pending';
