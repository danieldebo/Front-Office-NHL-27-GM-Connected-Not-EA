-- Add applicant location/country snapshots and commissioner review views.
-- Version 1.8.1 avoids the historical collision with the decline-note delta.
BEGIN;
\ir schema-location.sql
COMMIT;