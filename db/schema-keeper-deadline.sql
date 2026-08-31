-- ============================================================================
-- Front Office — keeper deadline schema delta
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1),
--                                        schema-keepers.sql (>= 1.3.0)
-- Schema version: 2.5.0
--
-- Build-queue prompt F item 4: "After [the deadline] passes the list locks and
-- only the commissioner can change it; every post-deadline change is appended
-- to the transaction log with the note."
--
-- schema-keepers.sql modeled the limit, tenure, and registry but not the
-- per-season deadline itself. A deadline is optional (NULL = no lock, keepers
-- stay editable all season) — most leagues only care about this before the
-- season starts.
--
-- "the transaction log" here means audit_log, not transaction_event: a keeper
-- designation is not a cap-affecting roster move (it doesn't touch `contract`),
-- it is operational league-admin state, exactly what audit_log already exists
-- for (league_settings_version changes use it the same way).
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.5.0', 'Keeper deadline: locks keeper edits to the commissioner after it passes');

ALTER TABLE season
  ADD COLUMN IF NOT EXISTS keeper_deadline_at TIMESTAMPTZ;
