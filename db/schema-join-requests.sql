-- ============================================================================
-- Front Office — join_request + invite_link schema
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 2.15.0
--
-- src/routes/seats.ts has queried these two tables since before this file
-- existed — invite creation, join-request review, and the /invites/:token/join
-- claim flow all run against them — but no db/*.sql file ever created them.
-- Same failure mode as the missing app_user.replit_id column and
-- schema-location.sql found earlier: whatever database this feature was built
-- and demoed against had these tables hand-patched in, and that never made it
-- back into a committed migration. Against a database built from db/*.sql
-- alone, every seats-review.test.ts test has been silently skipping
-- (schemaReady checks information_schema for join_request and finds nothing).
--
-- Distinct from commissioner_invite (schema-commissioner-links.sql): that is
-- the single reusable per-league link surfaced on the Links tab. invite_link
-- here is the (possibly multiple, individually revocable) link a commissioner
-- generates from the Players tab, and join_request is the pending review queue
-- a claim against one of those links creates.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.15.0', 'join_request + invite_link — the Players-tab join-request review queue seats.ts always relied on, never committed as a migration');

CREATE TABLE invite_link (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id   UUID NOT NULL REFERENCES league(id),
    -- Opaque, unguessable token in the URL: /join/{token}.
    token       TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
    created_by  UUID REFERENCES app_user(id),
    max_uses    INT CHECK (max_uses IS NULL OR max_uses > 0),
    use_count   INT NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);
CREATE INDEX ON invite_link (league_id) WHERE revoked_at IS NULL;

CREATE TABLE join_request (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id      UUID NOT NULL REFERENCES league(id),
    user_id        UUID NOT NULL REFERENCES app_user(id),
    invite_link_id UUID REFERENCES invite_link(id),
    status         TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by    UUID REFERENCES app_user(id),
    reviewed_at    TIMESTAMPTZ,
    note           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- /invites/:token/join returns the existing row regardless of its status
    -- rather than erroring, so a user only ever has one join_request per
    -- league for the lifetime of the row.
    UNIQUE (league_id, user_id)
);
CREATE INDEX ON join_request (league_id, created_at);
