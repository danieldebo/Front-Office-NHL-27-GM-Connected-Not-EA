-- ============================================================================
-- Front Office — Favorite Team profile field + GM card display preference
-- Target: PostgreSQL 15+  |  Depends on: schema-club-catalog-leagues.sql (>= 2.19.0)
-- Schema version: 2.20.0
--
-- A user can pick a favorite club from the full catalog (NHL + the curated
-- alternate leagues), and choose whether their GM seat card shows their
-- first NHL game, their favorite team, or both.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.20.0', 'app_user.favorite_club_id + gm_card_display, surfaced on the GM seat card');

ALTER TABLE app_user
    ADD COLUMN favorite_club_id UUID REFERENCES nhl_club(id),
    ADD COLUMN gm_card_display  TEXT NOT NULL DEFAULT 'first_game';

ALTER TABLE app_user
    ADD CONSTRAINT app_user_gm_card_display_check
    CHECK (gm_card_display IN ('first_game', 'favorite_team', 'both'));

-- Keep the append-only profile history snapshot complete, same as every
-- other profile column (see schema-gm-card-profile.sql).
ALTER TABLE app_user_profile_history
    ADD COLUMN favorite_club_id UUID REFERENCES nhl_club(id),
    ADD COLUMN gm_card_display  TEXT NOT NULL DEFAULT 'first_game';
