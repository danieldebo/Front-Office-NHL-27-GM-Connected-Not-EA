-- ============================================================================
-- Front Office — first NHL game + profile image on app_user
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 2.16.0
--
-- Two self-reported, purely cosmetic profile fields surfaced on the seat/GM
-- card: which NHL game got them into this hobby, and a public image URL for
-- an avatar. Neither is verified — same trust level as a display name.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.16.0', 'app_user.first_nhl_game + profile_image_url, surfaced on the GM seat card');

ALTER TABLE app_user
    ADD COLUMN first_nhl_game    TEXT,
    ADD COLUMN profile_image_url TEXT;

-- Keep the append-only profile history snapshot complete so a future edit's
-- diff includes these two fields, same as every other profile column.
ALTER TABLE app_user_profile_history
    ADD COLUMN first_nhl_game    TEXT,
    ADD COLUMN profile_image_url TEXT;
