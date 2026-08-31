-- Canonical player profile identities and immutable history.
-- The implementation remains in schema-user-profile.sql so fresh-schema and
-- upgrade paths share the exact same idempotent statements.
BEGIN;
\ir schema-user-profile.sql
COMMIT;