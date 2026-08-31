-- ============================================================================
-- Front Office — keepers & NHL player registry schema delta
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 1.3.0
-- Phase: 2 (build alongside membership; needs franchise + team_season + season)
--
-- Adds:
--   1. A per-season keeper limit the commissioner sets, enforced
--   2. Team-entered keepers, with commissioner override to add/edit/remove
--   3. Original-designation tracking that persists across seasons (keeper tenure)
--   4. An indexed registry of all NHL players, seeded from the free public NHL
--      API, with manual entry as a first-class fallback
--   5. A cached 1/3/5-year stat card shown when a keeper matches the registry
--
-- The existing `player` table already carries external_ids and a GIN index for
-- exactly this. This delta extends it into a searchable registry and adds the
-- keeper and stat-card structures around it.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('1.3.0', 'Keeper limit, keeper designations with tenure, NHL player registry, stat-card cache');

CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- fast fuzzy name search over the registry
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- required for the EXCLUDE constraint below (equality on UUIDs in a GiST index)

-- ---------------------------------------------------------------------------
-- 1. Keeper limit
-- ---------------------------------------------------------------------------
-- Commissioner-set, per season. 0 = keepers disabled for this season.

ALTER TABLE season
    ADD COLUMN keepers_per_team INT NOT NULL DEFAULT 0
        CHECK (keepers_per_team BETWEEN 0 AND 50);

-- ---------------------------------------------------------------------------
-- 2. Player registry
-- ---------------------------------------------------------------------------
-- The `player` table IS the registry. This section makes it searchable and
-- distinguishes registry-backed players (matched to a real NHL identity) from
-- manually-entered ones.
--
-- A registry-backed player has external_ids->>'nhl_api' set (the NHL player id,
-- e.g. 8478402). A manual player has an empty external_ids and is_manual = true.
-- Both are valid keeper targets; only registry-backed players get a stat card.

ALTER TABLE player
    ADD COLUMN is_manual   BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN sweater_num INT,
    ADD COLUMN current_team_abbrev TEXT,
    ADD COLUMN registry_synced_at  TIMESTAMPTZ;

-- Trigram index for typo-tolerant "start typing a name" search across the whole
-- registry. This is what makes the indexed lookup feel instant.
CREATE INDEX player_name_trgm ON player USING GIN (full_name gin_trgm_ops);

-- A registry-backed player is unique by their NHL id. Manual players are not
-- constrained this way (two leagues may each hand-enter "Rookie Callup").
CREATE UNIQUE INDEX player_nhl_id_unique
    ON player ((external_ids->>'nhl_api'))
    WHERE external_ids ? 'nhl_api';

-- Bookkeeping for the periodic registry sync from the NHL API.
CREATE TABLE registry_sync (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source        TEXT NOT NULL,                 -- 'nhl_stats_api' | 'nhl_web_api'
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ,
    players_upserted INT,
    error         TEXT
);

-- ---------------------------------------------------------------------------
-- 3. Keepers
-- ---------------------------------------------------------------------------
-- A keeper designation ties a player to a FRANCHISE (not a team_season), so the
-- original-marked date and the running tenure survive across seasons — the same
-- continuity property banners and records already use. Each season, the active
-- keepers for a franchise are those valid for that season.
--
-- Append-only in spirit: removing a keeper closes the row (released_at) rather
-- than deleting it, so "how long has this player been kept" stays answerable and
-- keeper-tenure rules (e.g. "max 3 years as a keeper") are enforceable.

CREATE TABLE keeper (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id          UUID NOT NULL REFERENCES league(id),
    franchise_id       UUID NOT NULL REFERENCES franchise(id),
    player_id          UUID NOT NULL REFERENCES player(id),
    -- The season this designation was made FOR. Tenure spans seasons; this is
    -- the season the keeper counts against.
    season_id          UUID NOT NULL REFERENCES season(id),
    -- THE ORIGINAL DATE. Set once, when the player first became a keeper for this
    -- franchise, and carried forward on every subsequent re-designation. This is
    -- the field the requirement calls out specifically.
    first_marked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- When this specific season's designation was made.
    designated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Who made it, and whether it was the team or a commissioner override.
    designated_by      UUID NOT NULL REFERENCES app_user(id),
    is_commissioner_override BOOLEAN NOT NULL DEFAULT false,
    -- Lifecycle. A released keeper keeps its history.
    released_at        TIMESTAMPTZ,
    released_by        UUID REFERENCES app_user(id),
    release_reason     TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A player is kept by at most one franchise in a given season.
    CONSTRAINT keeper_one_franchise_per_season
        EXCLUDE (season_id WITH =, player_id WITH =) WHERE (released_at IS NULL)
);
CREATE INDEX ON keeper (franchise_id, season_id) WHERE released_at IS NULL;
CREATE INDEX ON keeper (season_id) WHERE released_at IS NULL;
CREATE INDEX ON keeper (player_id);

-- Enforce the per-team keeper limit at write time. A team can never hold more
-- active keepers in a season than the season allows. Commissioner overrides are
-- still bounded by the limit unless the season limit itself is raised — the
-- override is about WHOSE keepers the commissioner can edit, not about exceeding
-- the cap. (If a league wants the commissioner to exceed it, raise the limit.)
CREATE OR REPLACE FUNCTION enforce_keeper_limit() RETURNS TRIGGER AS $$
DECLARE
    limit_keepers INT;
    held          INT;
BEGIN
    IF NEW.released_at IS NOT NULL THEN
        RETURN NEW;   -- releasing never trips the cap
    END IF;
    SELECT keepers_per_team INTO limit_keepers FROM season WHERE id = NEW.season_id;
    SELECT COUNT(*) INTO held
        FROM keeper
        WHERE season_id = NEW.season_id
          AND franchise_id = NEW.franchise_id
          AND released_at IS NULL
          AND id <> NEW.id;
    IF limit_keepers = 0 THEN
        RAISE EXCEPTION 'keepers are disabled for this season'
            USING ERRCODE = 'check_violation';
    END IF;
    IF held >= limit_keepers THEN
        RAISE EXCEPTION 'franchise % already holds % of % keepers this season',
            NEW.franchise_id, held, limit_keepers
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_keeper_limit
    BEFORE INSERT OR UPDATE ON keeper
    FOR EACH ROW EXECUTE FUNCTION enforce_keeper_limit();

-- Carry first_marked_at forward automatically. When a franchise re-designates a
-- player it has kept before, inherit the ORIGINAL date instead of resetting it,
-- so tenure is continuous across seasons.
CREATE OR REPLACE FUNCTION inherit_keeper_origin() RETURNS TRIGGER AS $$
DECLARE
    prior TIMESTAMPTZ;
BEGIN
    SELECT MIN(first_marked_at) INTO prior
        FROM keeper
        WHERE franchise_id = NEW.franchise_id
          AND player_id = NEW.player_id;
    IF prior IS NOT NULL AND prior < NEW.first_marked_at THEN
        NEW.first_marked_at := prior;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_keeper_origin
    BEFORE INSERT ON keeper
    FOR EACH ROW EXECUTE FUNCTION inherit_keeper_origin();

-- ---------------------------------------------------------------------------
-- 4. Stat-card cache
-- ---------------------------------------------------------------------------
-- The 1/3/5-year card shown on the team admin page when a keeper matches the
-- registry. Stats are REAL-WORLD NHL data fetched from the public NHL API and
-- cached here — they are reference data, not league game data, and follow the
-- same principle as any fetched value: cache it, timestamp it, never treat it as
-- a fact the platform authored. `window_years` distinguishes the three cards.

CREATE TABLE player_stat_card (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id      UUID NOT NULL REFERENCES player(id),
    window_years   INT NOT NULL CHECK (window_years IN (1, 3, 5)),
    -- Aggregated skater or goalie line over the window. Shape kept as JSONB so
    -- one table serves both positions; keys use NHL-standard abbreviations.
    -- skater: { GP, G, A, PTS, "+/-", PIM, SOG, "S%", TOI/GP, ... }
    -- goalie: { GP, GS, W, L, OTL, "SV%", GAA, SO, ... }
    stat_line      JSONB NOT NULL,
    season_span    TEXT,                          -- '2022-23 – 2024-25'
    source         TEXT NOT NULL DEFAULT 'nhl_stats_api',
    fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Cache freshness. A stale card is refreshed on next view.
    stale_after    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
    UNIQUE (player_id, window_years)
);
CREATE INDEX ON player_stat_card (stale_after);

-- ---------------------------------------------------------------------------
-- 5. Views
-- ---------------------------------------------------------------------------

-- A franchise's active keepers for a season, with tenure and (if registry-
-- backed) a flag that a stat card is available. Drives the team admin page.
CREATE VIEW v_active_keepers AS
SELECT
    k.league_id,
    k.season_id,
    k.franchise_id,
    k.player_id,
    p.full_name,
    p.position,
    p.is_manual,
    (p.external_ids ? 'nhl_api')                        AS registry_matched,
    k.first_marked_at,
    k.designated_at,
    k.is_commissioner_override,
    -- Whole-season tenure count: how many distinct seasons this franchise has
    -- kept this player. The number keeper-tenure rules are written against.
    (SELECT COUNT(DISTINCT k2.season_id)
       FROM keeper k2
      WHERE k2.franchise_id = k.franchise_id
        AND k2.player_id = k.player_id)                 AS seasons_kept
FROM keeper k
JOIN player p ON p.id = k.player_id
WHERE k.released_at IS NULL;

-- Keeper slots used vs. allowed, per franchise per season. Drives the "2 / 3
-- keepers" UI and the marketplace-style "slots open" prompt.
CREATE VIEW v_keeper_slots AS
SELECT
    ts.season_id,
    ts.franchise_id,
    s.keepers_per_team AS allowed,
    COUNT(k.id) FILTER (WHERE k.released_at IS NULL) AS used,
    s.keepers_per_team - COUNT(k.id) FILTER (WHERE k.released_at IS NULL) AS open_slots
FROM team_season ts
JOIN season s ON s.id = ts.season_id
LEFT JOIN keeper k ON k.franchise_id = ts.franchise_id AND k.season_id = ts.season_id
GROUP BY ts.season_id, ts.franchise_id, s.keepers_per_team;

-- ---------------------------------------------------------------------------
-- Data quality additions
-- ---------------------------------------------------------------------------

-- BLOCK: no franchise exceeds its keeper allotment (trigger should prevent it;
-- this catches a limit lowered below current holdings).
CREATE OR REPLACE VIEW dq.check_keeper_limit AS
SELECT season_id, franchise_id, allowed, used
FROM v_keeper_slots
WHERE used > allowed;

-- BLOCK: a player is an active keeper for two franchises in one season.
CREATE OR REPLACE VIEW dq.check_keeper_conflict AS
SELECT season_id, player_id, COUNT(*) AS holders
FROM keeper
WHERE released_at IS NULL
GROUP BY season_id, player_id
HAVING COUNT(*) > 1;

-- ALERT: first_marked_at later than designated_at means origin tracking broke.
CREATE OR REPLACE VIEW dq.check_keeper_origin AS
SELECT id AS keeper_id, franchise_id, player_id, first_marked_at, designated_at
FROM keeper
WHERE first_marked_at > designated_at;

-- WATCH: a keeper pointing at a manual player that could plausibly be matched to
-- the registry later (name search finds a close registry hit). Surfaced so a
-- commissioner can promote a manual entry to a real identity and unlock its card.
CREATE OR REPLACE VIEW dq.check_manual_keeper_matchable AS
SELECT k.id AS keeper_id, p.full_name, k.franchise_id
FROM keeper k
JOIN player p ON p.id = k.player_id
WHERE k.released_at IS NULL
  AND p.is_manual
  AND EXISTS (
      SELECT 1 FROM player r
      WHERE r.external_ids ? 'nhl_api'
        AND r.full_name % p.full_name        -- pg_trgm similarity
  );

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
-- * Stat cards are fetched reference data (see docs/keeper-addendum.md for the
--   NHL API endpoints). They are cached, timestamped, and refreshed on staleness
--   — never authored by the platform and never mixed into league standings.
-- * A manual keeper is a first-class citizen. It simply has no stat card until
--   someone matches it to a registry player.
-- ============================================================================
