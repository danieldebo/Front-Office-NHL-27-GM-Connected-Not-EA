-- ============================================================================
-- Front Office — add the missing game_result.counts_toward_standings column
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 2.8.0
--
-- competition.ts's reportResult/confirmResult and schedule.ts's force-resolve
-- have referenced game_result.counts_toward_standings since before this build
-- queue started, but no db/*.sql file ever defined it — every write to it was
-- failing (42703: column does not exist) until now. This was masked because
-- v_active_result / v_standings actually key off game.status, not this
-- column, so standings themselves were never wrong; only the write path was
-- broken. Discovered while wiring the box score approval flow (schema-
-- box-scores.sql), which writes to game_result the same way.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.8.0', 'Add the long-referenced-but-never-defined game_result.counts_toward_standings column');

ALTER TABLE game_result
    ADD COLUMN counts_toward_standings BOOLEAN NOT NULL DEFAULT FALSE;
