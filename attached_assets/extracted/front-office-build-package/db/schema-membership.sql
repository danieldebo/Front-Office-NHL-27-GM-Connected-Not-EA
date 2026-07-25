-- ============================================================================
-- Front Office — membership & commissioner-email schema delta
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 1.2.0
-- Phase: 2 (build after Phase 1 is stable)
--
-- Adds four capabilities requested after the review:
--   1. An enforced seat limit per league
--   2. Commissioner self-signup (see spec addendum; no schema change beyond
--      the role already in member_role)
--   3. Commissioner-provisioned members — names, emails, logos — including
--      people who do not yet have an account
--   4. Per-member relationship tiers (friend / vip / stranger), PRIVATE to the
--      commissioner
--   5. An automatic weekly commissioner email built from an editable template
--
-- PRIVACY NOTE (carries the classification rules from docs/threat-model.md):
--   * A provisioned email is PII. It is entered by the commissioner, stored
--     minimized, never shown on a public page, never logged.
--   * A relationship tier is the COMMISSIONER'S private view of a member. It is
--     never shown to the member it describes, never public, never used to gate
--     gameplay. It is a mail-merge and courtesy hint, nothing more.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('1.2.0', 'Membership provisioning, seat limit, relationship tiers, commissioner weekly email');

-- ---------------------------------------------------------------------------
-- 1. Seat limit
-- ---------------------------------------------------------------------------
-- NHL 27 Connected Franchise caps at 32 human GMs. The limit is configurable
-- (a league may run 16 or 20), but it is enforced, not advisory.

ALTER TABLE season
    ADD COLUMN max_seats INT NOT NULL DEFAULT 32
        CHECK (max_seats BETWEEN 2 AND 32);

-- Enforce the cap at write time. A season can never hold more team_seasons than
-- its declared limit. Detective checks are not enough for a hard capacity rule.
CREATE OR REPLACE FUNCTION enforce_seat_limit() RETURNS TRIGGER AS $$
DECLARE
    current_seats INT;
    limit_seats   INT;
BEGIN
    SELECT max_seats INTO limit_seats FROM season WHERE id = NEW.season_id;
    SELECT COUNT(*) INTO current_seats
        FROM team_season WHERE season_id = NEW.season_id;
    IF current_seats >= limit_seats THEN
        RAISE EXCEPTION 'season % is full: % of % seats used',
            NEW.season_id, current_seats, limit_seats
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_seat_limit
    BEFORE INSERT ON team_season
    FOR EACH ROW EXECUTE FUNCTION enforce_seat_limit();

-- ---------------------------------------------------------------------------
-- 2. Relationship tier enum
-- ---------------------------------------------------------------------------
-- The commissioner's private read on each member. Ordered by familiarity, but
-- the order carries no privilege — it never gates anything.

CREATE TYPE relationship_tier AS ENUM ('friend', 'vip', 'stranger');

-- ---------------------------------------------------------------------------
-- 3. Provisioned members
-- ---------------------------------------------------------------------------
-- A commissioner adds everyone in the league up front — often before those
-- people have created accounts. A league_member is that provisioned identity.
-- When the person later signs up and claims their invite, user_id links; until
-- then it is NULL and the row stands on the commissioner-entered details.
--
-- This is intentionally NOT the same as league_membership (which links an
-- existing app_user to a league). league_member is the commissioner's roster;
-- claiming an invite creates the league_membership and links the two.

CREATE TABLE league_member (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id         UUID NOT NULL REFERENCES league(id),
    -- Links once the person signs up and claims their invite. NULL until then.
    user_id           UUID REFERENCES app_user(id),
    -- Commissioner-entered details. display_name is required; email is PII and
    -- optional (some commissioners coordinate entirely over Discord).
    display_name      TEXT NOT NULL,
    email             CITEXT,                         -- PII: minimized, never logged/public
    logo_url          TEXT,                           -- member/team avatar, re-encoded on upload
    gamertag          TEXT,
    -- The commissioner's private relationship read. Never shown to the member,
    -- never public. Defaults to 'stranger' so nothing is assumed.
    relationship_tier relationship_tier NOT NULL DEFAULT 'stranger',
    -- Invite lifecycle.
    invite_token      TEXT UNIQUE,                    -- single-use, rotated on claim
    invited_at        TIMESTAMPTZ,
    claimed_at        TIMESTAMPTZ,
    -- Contact preference for the member-facing side of the weekly email.
    email_opt_in      BOOLEAN NOT NULL DEFAULT true,
    added_by          UUID NOT NULL REFERENCES app_user(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    -- One provisioned row per person per league, whether or not linked yet.
    UNIQUE (league_id, email),
    UNIQUE (league_id, user_id)
);
CREATE INDEX ON league_member (league_id) WHERE deleted_at IS NULL;
CREATE INDEX ON league_member (user_id) WHERE user_id IS NOT NULL;

-- A provisioned member can be tied to the seat they run, so the commissioner's
-- roster and the franchise structure line up. Optional — a member may exist
-- before seats are assigned.
ALTER TABLE gm_assignment
    ADD COLUMN league_member_id UUID REFERENCES league_member(id);

-- ---------------------------------------------------------------------------
-- 4. Commissioner weekly email
-- ---------------------------------------------------------------------------
-- An automatic weekly digest the commissioner can edit. The TEMPLATE is stored
-- and versioned (bylaws-style); each SEND is recorded for auditability and to
-- prevent double-sends. The platform composes from confirmed data only — the
-- same rule as standings — so a digest never reports unconfirmed scores as fact.

-- Editable template, one active per league. Versioned so an edit never destroys
-- the previous wording.
CREATE TABLE email_template (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id      UUID NOT NULL REFERENCES league(id),
    kind           TEXT NOT NULL DEFAULT 'weekly_commissioner',
    version        INT NOT NULL DEFAULT 1,
    subject        TEXT NOT NULL,
    -- Body with mail-merge tokens resolved at send time, e.g.
    -- {{league_name}} {{week_number}} {{standings_top5}} {{games_due}}
    -- {{open_seats}} {{recent_transactions}} {{member_first_name}}.
    -- Tokens are an allowlist (see spec addendum); anything else renders literally.
    body_md        TEXT NOT NULL,
    -- Delivery schedule in the league's timezone.
    send_dow       TEXT NOT NULL DEFAULT 'MO',        -- SU..SA
    send_hour      INT  NOT NULL DEFAULT 9 CHECK (send_hour BETWEEN 0 AND 23),
    timezone       TEXT NOT NULL DEFAULT 'UTC',       -- IANA
    is_active       BOOLEAN NOT NULL DEFAULT true,
    edited_by      UUID REFERENCES app_user(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (league_id, kind, version)
);
CREATE UNIQUE INDEX email_template_one_active
    ON email_template (league_id, kind) WHERE is_active;

-- One row per actual send. Idempotent on (league, kind, period) so a retry or a
-- double-tick of the scheduler cannot mail the league twice.
CREATE TABLE email_send (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id         UUID NOT NULL REFERENCES league(id),
    template_id       UUID NOT NULL REFERENCES email_template(id),
    kind              TEXT NOT NULL DEFAULT 'weekly_commissioner',
    -- The week this send covers, as an ISO date (the Monday of the period).
    period_start      DATE NOT NULL,
    scheduled_for     TIMESTAMPTZ NOT NULL,
    -- Lifecycle: queued -> preview_ready -> sent | skipped | failed
    status            TEXT NOT NULL DEFAULT 'queued',
    recipient_count   INT,
    rendered_subject  TEXT,
    rendered_body     TEXT,                           -- snapshot of what went out
    provider_ref      TEXT,                           -- ESP message/batch id
    sent_at           TIMESTAMPTZ,
    error             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Idempotency: one send per league per kind per week, full stop.
    UNIQUE (league_id, kind, period_start)
);
CREATE INDEX ON email_send (status, scheduled_for) WHERE status = 'queued';

-- Optional: let the commissioner preview-and-approve before send, or leave it
-- fully automatic. A NULL approver with auto_send=true means "just send it."
ALTER TABLE email_template
    ADD COLUMN require_approval BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 5. Derived helper view — audience for a league's weekly email
-- ---------------------------------------------------------------------------
-- Opted-in, non-deleted members with a usable email. The send job reads this;
-- it never assembles recipients ad hoc, so opt-out is honored in exactly one
-- place.

CREATE VIEW v_email_audience AS
SELECT
    lm.league_id,
    lm.id AS league_member_id,
    lm.display_name,
    lm.email,
    lm.relationship_tier,
    split_part(lm.display_name, ' ', 1) AS first_name
FROM league_member lm
WHERE lm.deleted_at IS NULL
  AND lm.email_opt_in
  AND lm.email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Data quality additions (extend dq schema)
-- ---------------------------------------------------------------------------

-- BLOCK: a season must never exceed its seat limit (trigger should prevent it;
-- this catches a limit lowered below current occupancy).
CREATE OR REPLACE VIEW dq.check_seat_limit AS
SELECT s.id AS season_id, s.max_seats, COUNT(ts.id) AS seats_used
FROM season s
JOIN team_season ts ON ts.season_id = s.id
GROUP BY s.id, s.max_seats
HAVING COUNT(ts.id) > s.max_seats;

-- BLOCK: exactly one active template per league per kind.
CREATE OR REPLACE VIEW dq.check_template_cardinality AS
SELECT league_id, kind, COUNT(*) AS active_templates
FROM email_template
WHERE is_active
GROUP BY league_id, kind
HAVING COUNT(*) <> 1;

-- ALERT: a weekly send that was scheduled but is overdue and still queued.
CREATE OR REPLACE VIEW dq.check_stuck_email AS
SELECT id AS email_send_id, league_id, scheduled_for, now() - scheduled_for AS overdue_by
FROM email_send
WHERE status = 'queued' AND scheduled_for < now() - INTERVAL '2 hours';

-- ---------------------------------------------------------------------------
-- Structural notes
-- ---------------------------------------------------------------------------
-- relationship_tier lives ONLY on league_member and is exposed ONLY through
-- commissioner-scoped endpoints. There is deliberately no public view that
-- selects it. See docs/membership-addendum.md for the access rules.
--
-- email is PII: docs/threat-model.md classifies it, replit.md rule 13 keeps it
-- out of logs and public pages, and v_email_audience is the only path that
-- reads it for delivery.
-- ============================================================================
