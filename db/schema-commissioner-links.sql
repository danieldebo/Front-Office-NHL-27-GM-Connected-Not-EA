-- ============================================================================
-- Front Office — commissioner links schema delta
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1),
--                                        schema-membership.sql (>= 1.2.0)
-- Schema version: 1.7.0
-- Phase: 1 (Checkpoint 2 — league creation) / 2 (invite management)
--
-- Two links every commissioner gets:
--   1. A unique, shareable LEAGUE link  — the public front door to their league
--   2. A unique INVITE link             — hands out seats without manual adds
--
-- The league already has `slug` (from schema.sql) and league_member already has
-- a per-row `invite_token` (from schema-membership.sql). This delta adds the
-- COMMISSIONER-level reusable invite link that sits alongside them, plus the
-- bookkeeping to rotate, expire, and track use.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('1.7.0', 'Commissioner shareable league link + reusable invite link');

-- ---------------------------------------------------------------------------
-- 1. The shareable league link
-- ---------------------------------------------------------------------------
-- The league's public URL is /l/{slug}. `slug` is already UNIQUE in schema.sql,
-- so the link is unique by construction. What's added here: a short, stable,
-- shareable PUBLIC CODE the commissioner can hand out verbally or in a Discord
-- ("join at frontoffice/j/RUSTBELT") that resolves to the league. Distinct from
-- slug so a commissioner can rename/re-slug the league without breaking a code
-- they've already shared.

ALTER TABLE league
    ADD COLUMN public_code TEXT UNIQUE
        CHECK (public_code ~ '^[A-Z0-9]{5,12}$');   -- human-shareable, e.g. RUSTBELT

-- ---------------------------------------------------------------------------
-- 2. The reusable invite link
-- ---------------------------------------------------------------------------
-- A single link a commissioner shares to let people claim a seat, instead of
-- provisioning every member by hand. One active link per league at a time;
-- rotating it revokes the old one. Bounded by max_uses and/or an expiry so a
-- leaked link can't fill the league with strangers forever.
--
-- This complements league_member.invite_token (which is a SINGLE-USE token for a
-- specific pre-provisioned person). The commissioner invite link is REUSABLE and
-- open-ended: whoever holds it can request/claim a seat, subject to the caps.

CREATE TABLE commissioner_invite (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id      UUID NOT NULL REFERENCES league(id),
    -- Opaque, unguessable token in the URL: /join/{token}. Rotated on demand.
    token          TEXT NOT NULL UNIQUE,
    created_by     UUID NOT NULL REFERENCES app_user(id),
    -- Bounds. NULL = unbounded on that axis; set at least one for a leaked-link
    -- to be self-limiting.
    max_uses       INT CHECK (max_uses IS NULL OR max_uses > 0),
    uses           INT NOT NULL DEFAULT 0,
    expires_at     TIMESTAMPTZ,
    -- Lifecycle. Rotating creates a new row and revokes the prior active one.
    is_active      BOOLEAN NOT NULL DEFAULT true,
    revoked_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active invite link per league. Rotation = revoke old, insert new.
CREATE UNIQUE INDEX commissioner_invite_one_active
    ON commissioner_invite (league_id) WHERE is_active;
CREATE INDEX ON commissioner_invite (token) WHERE is_active;

-- Record each claim through the link, so "who joined via the invite" is
-- answerable and the use count can't drift from reality.
CREATE TABLE commissioner_invite_claim (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_id       UUID NOT NULL REFERENCES commissioner_invite(id),
    user_id         UUID NOT NULL REFERENCES app_user(id),
    claimed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Where it led: a provisioned member, a sign-up, or a waitlist entry.
    resulted_in     TEXT,                          -- 'member' | 'signup' | 'waitlist'
    UNIQUE (invite_id, user_id)                    -- a person claims a given link once
);

-- ---------------------------------------------------------------------------
-- Eligibility view — is this invite link still usable right now?
-- ---------------------------------------------------------------------------
CREATE VIEW v_invite_usable AS
SELECT
    ci.id AS invite_id,
    ci.league_id,
    ci.token,
    (ci.is_active
     AND ci.revoked_at IS NULL
     AND (ci.expires_at IS NULL OR ci.expires_at > now())
     AND (ci.max_uses  IS NULL OR ci.uses < ci.max_uses)) AS usable,
    ci.uses,
    ci.max_uses,
    ci.expires_at
FROM commissioner_invite ci;

-- ---------------------------------------------------------------------------
-- Data quality
-- ---------------------------------------------------------------------------

-- BLOCK: never more than one active invite link per league.
CREATE OR REPLACE VIEW dq.check_invite_cardinality AS
SELECT league_id, COUNT(*) AS active_links
FROM commissioner_invite
WHERE is_active
GROUP BY league_id
HAVING COUNT(*) > 1;

-- ALERT: an active link past its expiry or use cap that wasn't auto-revoked.
CREATE OR REPLACE VIEW dq.check_invite_exhausted AS
SELECT id AS invite_id, league_id, uses, max_uses, expires_at
FROM commissioner_invite
WHERE is_active
  AND ( (expires_at IS NOT NULL AND expires_at < now())
     OR (max_uses  IS NOT NULL AND uses >= max_uses) );

-- ALERT: use count out of step with recorded claims (integrity check).
CREATE OR REPLACE VIEW dq.check_invite_use_drift AS
SELECT ci.id AS invite_id, ci.uses AS counter, COUNT(cc.id) AS claims
FROM commissioner_invite ci
LEFT JOIN commissioner_invite_claim cc ON cc.invite_id = ci.id
GROUP BY ci.id, ci.uses
HAVING ci.uses <> COUNT(cc.id);

-- ---------------------------------------------------------------------------
-- Notes for the build
-- ---------------------------------------------------------------------------
-- * Both links are UNIQUE per league by construction (public_code UNIQUE, token
--   UNIQUE). A commissioner's own copy of them lives on their league dashboard.
-- * The join endpoint /join/{token} is a PUBLIC, unauthenticated-until-claim
--   surface: rate-limit it, check v_invite_usable before honoring, and increment
--   `uses` in the SAME transaction as writing the claim (so the cap can't be
--   raced past). A revoked or exhausted link returns a clean "invite no longer
--   active" page, never a 500.
-- * Claiming still respects the season seat limit (schema-membership.sql trigger)
--   and platform eligibility (schema-platform.sql console_eligible). A full or
--   ineligible league routes the claimant to the waitlist instead of a seat.
-- * The token is opaque and unguessable; the public_code is human-shareable and
--   deliberately low-entropy — it is NOT a secret, only a friendly locator, and
--   grants nothing on its own beyond viewing the public league page.
-- ============================================================================
