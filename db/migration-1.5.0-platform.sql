-- Make league and applicant platform identity first-class.
BEGIN;

CREATE TEMP TABLE platform_dependent_view_backup ON COMMIT DROP AS
SELECT n.nspname AS schema_name,
       c.relname AS view_name,
       pg_get_viewdef(c.oid, true) AS definition
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'v'
  AND c.relname IN ('v_open_leagues', 'v_league_applicants', 'v_waitlist');

DROP VIEW IF EXISTS v_open_leagues;
DROP VIEW IF EXISTS v_league_applicants;
DROP VIEW IF EXISTS v_waitlist;

\ir schema-platform.sql

DO $$
DECLARE
    saved_view RECORD;
BEGIN
    FOR saved_view IN
        SELECT schema_name, view_name, definition
        FROM platform_dependent_view_backup
        ORDER BY view_name
    LOOP
        EXECUTE format(
            'CREATE VIEW %I.%I AS %s',
            saved_view.schema_name,
            saved_view.view_name,
            saved_view.definition
        );
    END LOOP;
END $$;

COMMIT;