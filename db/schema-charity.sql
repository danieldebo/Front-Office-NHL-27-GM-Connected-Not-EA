-- ============================================================================
-- Front Office — charity layer schema extension
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.0)
-- Schema version: 1.1.0
--
-- CORE RULE, enforced structurally throughout this file:
--   Front Office RECORDS giving. It never MOVES money.
--   No balances, no pooled funds, no payout logic, no processor credentials.
--   The only monetary facts here are (a) a pledge someone declared and
--   (b) a receipt an external processor confirmed.
--
-- Giving reuses the provenance model exactly as game results do:
--   a user CLAIM is low authority; a processor RECEIPT supersedes it.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('1.1.0', 'Charity layer: causes, pledges, giving events, receipts');

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE pledge_basis AS ENUM (
    'per_goal',         -- amount x goals scored (confirmed results only)
    'per_win',
    'per_point',
    'flat_season',
    'accountability'    -- triggered by a missed window; see §3.3 of the addendum
);

CREATE TYPE giving_status AS ENUM (
    'committed',        -- computed and owed; PRIVATE to the GM and commissioner
    'prompted',         -- donor sent to the giving platform
    'receipted',        -- external receipt confirmed; the only PUBLIC state
    'waived',           -- commissioner waived it
    'expired'           -- never fulfilled; ages out without public shaming
);

-- Authority ranking for monetary facts, mirroring data_source_authority.
-- A processor receipt outranks anything a human asserted.
CREATE TABLE giving_authority (
    claim_type TEXT PRIMARY KEY,
    rank       INT NOT NULL,
    notes      TEXT
);
INSERT INTO giving_authority (claim_type, rank, notes) VALUES
    ('self_reported', 10, 'A GM says they donated. Never shown publicly on its own.'),
    ('computed',      20, 'Derived by the platform from confirmed results and a declared pledge.'),
    ('receipted',     90, 'Confirmed by the external giving platform. The only public-facing truth.');

-- ---------------------------------------------------------------------------
-- Causes
-- ---------------------------------------------------------------------------

-- A local reference to a cause that lives in the giving platform. Vetting,
-- tax status, and payment handling are entirely the platform's responsibility;
-- this table exists so a franchise can point at one.
CREATE TABLE cause (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name      TEXT NOT NULL,
    summary           TEXT,
    logo_url          TEXT,
    -- e.g. { "causefully": "cause_8f21" }. Never a bank or processor identifier.
    external_ids      JSONB NOT NULL DEFAULT '{}'::jsonb,
    vetted_at         TIMESTAMPTZ,
    vetted_source     TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (external_ids <> '{}'::jsonb)   -- must map to a real upstream cause
);

-- Attached to FRANCHISE, not team_season, so the cause persists across seasons
-- and across GMs — the same continuity property as banners and records.
-- SCD Type 2: changing a cause closes the old row and opens a new one.
CREATE TABLE franchise_cause (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    franchise_id    UUID NOT NULL REFERENCES franchise(id),
    cause_id        UUID NOT NULL REFERENCES cause(id),
    adopted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ,
    adopted_by      UUID REFERENCES app_user(id),
    end_reason      TEXT
);
CREATE UNIQUE INDEX franchise_cause_active_idx
    ON franchise_cause (franchise_id) WHERE ended_at IS NULL;

-- Opt-in per league, per season. A league that declines never sees any of this.
CREATE TABLE league_giving_config (
    season_id                 UUID PRIMARY KEY REFERENCES season(id),
    enabled                   BOOLEAN NOT NULL DEFAULT false,
    accountability_cents      BIGINT CHECK (accountability_cents >= 0),
    accountability_enabled    BOOLEAN NOT NULL DEFAULT false,
    champions_choice_enabled  BOOLEAN NOT NULL DEFAULT false,
    per_gm_season_cap_cents   BIGINT CHECK (per_gm_season_cap_cents > 0),
    configured_by             UUID REFERENCES app_user(id),
    configured_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Pledges
-- ---------------------------------------------------------------------------

-- Declared up front, with a mandatory ceiling. Nobody should wake up owing
-- four hundred dollars because their first line caught fire in March.
CREATE TABLE pledge (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id          UUID NOT NULL REFERENCES season(id),
    team_season_id     UUID NOT NULL REFERENCES team_season(id),
    user_id            UUID NOT NULL REFERENCES app_user(id),
    cause_id           UUID NOT NULL REFERENCES cause(id),
    basis              pledge_basis NOT NULL,
    rate_cents         BIGINT NOT NULL CHECK (rate_cents > 0),
    cap_cents          BIGINT NOT NULL CHECK (cap_cents > 0),
    declared_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    withdrawn_at       TIMESTAMPTZ,
    CHECK (cap_cents >= rate_cents)
);
CREATE INDEX ON pledge (season_id, team_season_id) WHERE withdrawn_at IS NULL;

-- ---------------------------------------------------------------------------
-- Giving events — append-only, same discipline as the transaction wire
-- ---------------------------------------------------------------------------

-- One row per obligation the platform computed or a GM declared. Amounts here
-- are DERIVED or DECLARED, never charged. Nothing in this table causes money
-- to move; it produces a prompt a human acts on.
CREATE TABLE giving_event (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id            UUID NOT NULL REFERENCES season(id),
    team_season_id       UUID NOT NULL REFERENCES team_season(id),
    user_id              UUID NOT NULL REFERENCES app_user(id),
    cause_id             UUID NOT NULL REFERENCES cause(id),
    pledge_id            UUID REFERENCES pledge(id),
    -- What triggered it, for auditability and for the season recap.
    trigger_game_id      UUID REFERENCES game(id),
    basis                pledge_basis NOT NULL,
    quantity             INT,                      -- goals, wins, or missed windows
    amount_cents         BIGINT NOT NULL CHECK (amount_cents > 0),
    status               giving_status NOT NULL DEFAULT 'committed',
    claim_type           TEXT NOT NULL DEFAULT 'computed' REFERENCES giving_authority(claim_type),
    computed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    prompted_at          TIMESTAMPTZ,
    resolved_at          TIMESTAMPTZ,
    -- Corrections supersede; a reversed result must be able to reverse the
    -- obligation it generated, visibly.
    superseded_by        UUID REFERENCES giving_event(id),
    supersede_reason     TEXT,
    CHECK (superseded_by IS NULL OR supersede_reason IS NOT NULL)
);
CREATE INDEX ON giving_event (season_id, status) WHERE superseded_by IS NULL;
CREATE INDEX ON giving_event (user_id, status) WHERE superseded_by IS NULL;

-- The only public-facing monetary truth. Written ONLY from a verified webhook
-- from the giving platform — never from a user action, never from platform
-- inference. No card data, no account numbers, no processor tokens.
CREATE TABLE donation_receipt (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    giving_event_id       UUID REFERENCES giving_event(id),
    cause_id              UUID NOT NULL REFERENCES cause(id),
    user_id               UUID REFERENCES app_user(id),
    amount_cents          BIGINT NOT NULL CHECK (amount_cents > 0),
    currency              CHAR(3) NOT NULL DEFAULT 'USD',
    -- Opaque identifier issued by the giving platform. This is the entire
    -- footprint of the payment system inside this database.
    external_receipt_id   TEXT NOT NULL,
    external_platform     TEXT NOT NULL,
    received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    webhook_event_id      UUID,                    -- for at-least-once dedupe
    signature_verified    BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (external_platform, external_receipt_id)
);
CREATE INDEX ON donation_receipt (cause_id, received_at DESC);

-- Champion's choice: the prize is a DECISION, not a pot. No funds are held,
-- pooled, or distributed — the champion nominates a cause, and the league's
-- members give to it directly.
CREATE TABLE champions_choice (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id        UUID NOT NULL REFERENCES season(id) UNIQUE,
    franchise_id     UUID NOT NULL REFERENCES franchise(id),
    chosen_cause_id  UUID NOT NULL REFERENCES cause(id),
    chosen_by        UUID NOT NULL REFERENCES app_user(id),
    chosen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    note             TEXT
);

-- ---------------------------------------------------------------------------
-- Derived views
-- ---------------------------------------------------------------------------

-- PUBLIC. Receipted only. Committed amounts never appear here, because a
-- pledge that was never fulfilled is worse for the league than no pledge.
CREATE VIEW v_franchise_impact AS
SELECT
    f.id AS franchise_id,
    f.league_id,
    COALESCE(SUM(dr.amount_cents), 0) AS receipted_cents,
    COUNT(DISTINCT dr.id)             AS donation_count,
    COUNT(DISTINCT dr.cause_id)       AS causes_supported,
    MIN(dr.received_at)               AS giving_since
FROM franchise f
LEFT JOIN team_season ts ON ts.franchise_id = f.id
LEFT JOIN giving_event ge ON ge.team_season_id = ts.id AND ge.superseded_by IS NULL
LEFT JOIN donation_receipt dr ON dr.giving_event_id = ge.id AND dr.signature_verified
GROUP BY f.id, f.league_id;

-- PUBLIC. League-wide impact banner.
CREATE VIEW v_league_impact AS
SELECT
    league_id,
    SUM(receipted_cents) AS receipted_cents,
    SUM(donation_count)  AS donation_count,
    MIN(giving_since)    AS giving_since
FROM v_franchise_impact
GROUP BY league_id;

-- PRIVATE. Visible only to the GM who owes it and to the commissioner.
-- Deliberately a separate view from the public ones so that a careless join
-- cannot leak committed-but-unfulfilled amounts onto a public page.
CREATE VIEW v_giving_commitments AS
SELECT
    ge.user_id,
    ge.season_id,
    ge.team_season_id,
    SUM(ge.amount_cents) FILTER (WHERE ge.status = 'committed')  AS committed_cents,
    SUM(ge.amount_cents) FILTER (WHERE ge.status = 'receipted')  AS fulfilled_cents,
    MIN(ge.computed_at)  FILTER (WHERE ge.status = 'committed')  AS oldest_commitment_at
FROM giving_event ge
WHERE ge.superseded_by IS NULL
GROUP BY ge.user_id, ge.season_id, ge.team_season_id;

-- ---------------------------------------------------------------------------
-- Data quality assertions (extends dq schema from data-quality-checks.sql)
-- ---------------------------------------------------------------------------

-- BLOCK: public totals may never exceed what a processor actually confirmed.
-- An unverified webhook must never reach a banner.
CREATE OR REPLACE VIEW dq.check_unverified_receipt_counted AS
SELECT id AS receipt_id, external_platform, external_receipt_id, amount_cents
FROM donation_receipt
WHERE NOT signature_verified;

-- BLOCK: obligations must derive from CONFIRMED results only. Counting an
-- unconfirmed or screenshot-parsed game would inflate giving numbers, which is
-- worse than reporting none.
CREATE OR REPLACE VIEW dq.check_giving_from_unconfirmed AS
SELECT ge.id AS giving_event_id, ge.trigger_game_id, g.status
FROM giving_event ge
JOIN game g ON g.id = ge.trigger_game_id
WHERE ge.superseded_by IS NULL
  AND ge.basis <> 'accountability'
  AND g.status <> 'confirmed';

-- BLOCK: a pledge ceiling is a promise. Nobody exceeds their declared cap.
CREATE OR REPLACE VIEW dq.check_pledge_cap_exceeded AS
SELECT p.id AS pledge_id, p.user_id, p.cap_cents, SUM(ge.amount_cents) AS computed_cents
FROM pledge p
JOIN giving_event ge ON ge.pledge_id = p.id AND ge.superseded_by IS NULL
GROUP BY p.id, p.user_id, p.cap_cents
HAVING SUM(ge.amount_cents) > p.cap_cents;

-- BLOCK: no giving activity in a league that did not opt in.
CREATE OR REPLACE VIEW dq.check_giving_without_optin AS
SELECT ge.id AS giving_event_id, ge.season_id
FROM giving_event ge
LEFT JOIN league_giving_config c ON c.season_id = ge.season_id
WHERE c.season_id IS NULL OR NOT c.enabled;

-- ALERT (private, to the GM only — never a public flag): commitments unfulfilled
-- after 30 days. The point is a reminder, not a scarlet letter.
CREATE OR REPLACE VIEW dq.check_stale_commitments AS
SELECT user_id, season_id, committed_cents, oldest_commitment_at
FROM v_giving_commitments
WHERE committed_cents > 0
  AND oldest_commitment_at < now() - INTERVAL '30 days';

-- ALERT: a superseded result whose giving obligation was never superseded with
-- it. A reversed game must reverse what it generated.
CREATE OR REPLACE VIEW dq.check_orphaned_giving AS
SELECT ge.id AS giving_event_id, ge.trigger_game_id
FROM giving_event ge
JOIN game g ON g.id = ge.trigger_game_id
WHERE ge.superseded_by IS NULL
  AND g.status IN ('voided', 'disputed');

-- ---------------------------------------------------------------------------
-- Structural guarantees worth stating explicitly
-- ---------------------------------------------------------------------------
-- There is deliberately NO table for:
--   * account balances or league treasuries
--   * pooled funds awaiting distribution
--   * payment methods, cards, tokens, or processor credentials
--   * raffle entries, draws, or anything with a chance element
--   * platform fees on donations
--
-- Their absence is the compliance posture. See charity-addendum.md §4.
-- ============================================================================
