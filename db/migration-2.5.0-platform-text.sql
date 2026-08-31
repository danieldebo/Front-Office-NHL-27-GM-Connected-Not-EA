-- Keep platform columns publish-safe when production views depend on them.
BEGIN;

CREATE TEMP TABLE platform_view_backup ON COMMIT DROP AS
SELECT n.nspname AS schema_name,
       c.relname AS view_name,
       pg_get_viewdef(c.oid, true) AS definition
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v'
  AND (
    (n.nspname = 'public' AND c.relname IN ('v_open_leagues', 'v_league_applicants', 'v_waitlist'))
    OR (n.nspname = 'dq' AND c.relname = 'check_platform_mismatch')
  );

DROP VIEW IF EXISTS dq.check_platform_mismatch;
DROP VIEW IF EXISTS public.v_open_leagues;
DROP VIEW IF EXISTS public.v_league_applicants;
DROP VIEW IF EXISTS public.v_waitlist;

ALTER TABLE app_user
    ALTER COLUMN platform TYPE TEXT USING platform::TEXT;

ALTER TABLE league_listing
    ALTER COLUMN platform DROP DEFAULT,
    ALTER COLUMN platform TYPE TEXT USING platform::TEXT,
    ALTER COLUMN platform SET DEFAULT 'crossplay';

ALTER TABLE league_signup
    ALTER COLUMN platform TYPE TEXT USING platform::TEXT;

ALTER TABLE league
    ALTER COLUMN platform DROP DEFAULT,
    ALTER COLUMN platform TYPE TEXT USING platform::TEXT,
    ALTER COLUMN platform SET DEFAULT 'crossplay';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_type')
       AND EXISTS (SELECT 1 FROM pg_type WHERE typname = 'console_type') THEN
        EXECUTE 'DROP FUNCTION IF EXISTS console_eligible(platform_type, console_type)';
    END IF;
END $$;

DROP TYPE IF EXISTS platform_type;
DROP TYPE IF EXISTS console_type;

CREATE OR REPLACE FUNCTION console_eligible(lp TEXT, c TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT lp = 'crossplay'
        OR (lp = 'xbox' AND c = 'xbox')
        OR (lp = 'playstation' AND c = 'playstation');
$$;

DO $$
DECLARE
    saved_view RECORD;
BEGIN
    FOR saved_view IN
        SELECT schema_name, view_name, definition
        FROM platform_view_backup
        ORDER BY CASE WHEN schema_name = 'public' THEN 0 ELSE 1 END, view_name
    LOOP
        EXECUTE format(
            'CREATE VIEW %I.%I AS %s',
            saved_view.schema_name,
            saved_view.view_name,
            saved_view.definition
        );
    END LOOP;
END $$;

INSERT INTO schema_version (version, notes)
VALUES ('2.5.0', 'Use canonical text platform values so view-backed columns publish safely')
ON CONFLICT (version) DO NOTHING;

COMMIT;