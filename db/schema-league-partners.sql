-- ============================================================================
-- Front Office — charity and sponsor display fields on the league profile
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 2.11.0
--
-- This is deliberately NOT the Phase-3 charity/giving system in
-- schema-charity.sql (pledge, giving_event, donation_receipt, etc.) — that
-- models actual tracked giving and is out of scope for this build. This is
-- just a handful of display fields a commissioner can set: up to 2 charities
-- and 2 sponsors, each with a name/link/blurb/optional logo, shown on the
-- public league page and the Open Leagues card.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.11.0', 'Charity/sponsor display fields on the league profile (max 2 each) — display-only, not the Phase-3 giving system');

CREATE TABLE league_partner (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id      UUID NOT NULL REFERENCES league(id),
    kind           TEXT NOT NULL CHECK (kind IN ('charity', 'sponsor')),
    name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    link           TEXT NOT NULL CHECK (char_length(link) BETWEEN 1 AND 500),
    blurb          TEXT CHECK (blurb IS NULL OR char_length(blurb) <= 280),
    logo_url       TEXT,
    display_order  INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON league_partner (league_id, kind, display_order);

-- Defense-in-depth: application code enforces "max 2 per kind" on write, but
-- a trigger keeps that true even if some future write path forgets — same
-- belt-and-suspenders posture as the keeper-limit trigger in schema-keepers.sql.
CREATE FUNCTION enforce_league_partner_limit() RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM league_partner
         WHERE league_id = NEW.league_id AND kind = NEW.kind) >= 2 THEN
        RAISE EXCEPTION 'A league may have at most 2 % entries', NEW.kind
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER league_partner_limit
    BEFORE INSERT ON league_partner
    FOR EACH ROW EXECUTE FUNCTION enforce_league_partner_limit();
