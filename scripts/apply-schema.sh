#!/usr/bin/env bash
# ============================================================================
# Front Office — apply db/*.sql in the order they actually depend on each
# other, skipping whatever's already applied.
#
# This repo has no ORM migrations (see replit.md: "Drizzle for local identity
# tables only; raw pool.query() for all domain tables. The SQL file is the
# source of truth"). That means the only way anything ever got applied,
# session after session, was a human or an agent re-deriving the correct
# order from scratch and typing ~25 psql invocations by hand — which is
# exactly how this repo's dev database and a live Replit workspace ended up
# with mismatched schemas. This script replaces that with one command.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:port/db ./scripts/apply-schema.sh
#
# Idempotent: safe to re-run any time. Each step checks schema_version (or,
# for the one file that predates that table, a proxy check) before running,
# so re-running this after a partial apply — or on a database that's already
# fully up to date — just no-ops.
# ============================================================================
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$SCRIPT_DIR/../db"

psql_run() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
}

# True (exit 0) if this version is already recorded in schema_version.
version_applied() {
  local version="$1"
  local exists
  exists=$(psql "$DATABASE_URL" -tAc \
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_version')")
  if [ "$exists" != "t" ]; then
    return 1
  fi
  local found
  found=$(psql "$DATABASE_URL" -tAc \
    "SELECT EXISTS (SELECT 1 FROM schema_version WHERE version = '$version')")
  [ "$found" = "t" ]
}

# Apply one db/*.sql file, tagged with the schema_version it registers.
# Skips it if that version is already present.
apply() {
  local file="$1"
  local version="$2"
  if version_applied "$version"; then
    echo "skip  $file (already at $version)"
    return
  fi
  echo "apply $file -> $version"
  psql_run -f "$DB_DIR/$file"
}

echo "== Extensions =="
psql_run -c "CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;"

echo "== Base schema =="
apply schema.sql 1.0.1

echo "== Data quality suite (no schema_version row of its own) =="
dq_exists=$(psql "$DATABASE_URL" -tAc "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'dq')")
if [ "$dq_exists" = "t" ]; then
  echo "skip  data-quality-checks.sql (dq schema already exists)"
else
  echo "apply data-quality-checks.sql"
  psql_run -f "$DB_DIR/data-quality-checks.sql"
fi

apply schema-discovery.sql 1.4.0
apply schema-location.sql 1.8.0
apply migration-1.8.0-decline-note.sql 1.8.0   # shares 1.8.0; ON CONFLICT DO NOTHING inside the file

# schema-platform.sql changes column types that v_open_leagues,
# v_league_applicants, and (once schema-location.sql has run) v_waitlist all
# read, and Postgres refuses to ALTER a column a view depends on. Drop them
# first; recreate afterward using whichever definition is currently
# authoritative (v_league_applicants' and v_waitlist's location-aware shape
# from schema-location.sql, once that's been applied).
if ! version_applied 1.5.0; then
  echo "== Dropping views ahead of schema-platform.sql =="
  psql_run -c "DROP VIEW IF EXISTS v_open_leagues; DROP VIEW IF EXISTS v_league_applicants; DROP VIEW IF EXISTS v_waitlist;"
fi
apply schema-platform.sql 1.5.0
if ! psql "$DATABASE_URL" -tAc "SELECT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_open_leagues')" | grep -q t; then
  echo "== Recreating v_open_leagues =="
  psql_run <<'SQL'
CREATE VIEW v_open_leagues AS
SELECT
    l.id AS league_id, l.slug, l.name, l.logo_url, ll.blurb, ll.platform,
    ll.competitiveness, ll.suggested_division, ll.accepting_signups, ll.accepting_waitlist,
    s.id AS active_season_id, s.max_seats,
    COUNT(ts.id) FILTER (WHERE ts.seat_status = 'filled') AS seats_filled,
    s.max_seats - COUNT(ts.id) FILTER (WHERE ts.seat_status = 'filled') AS seats_open,
    (SELECT COUNT(*) FROM waitlist_entry w WHERE w.league_id = l.id AND w.status = 'waiting') AS waitlist_length,
    lh.games_confirmed, lh.active_gms
FROM league l
JOIN league_listing ll ON ll.league_id = l.id AND ll.is_listed
LEFT JOIN season s ON s.league_id = l.id AND s.is_active
LEFT JOIN team_season ts ON ts.season_id = s.id
LEFT JOIN v_league_health lh ON lh.season_id = s.id
WHERE l.deleted_at IS NULL
GROUP BY l.id, l.slug, l.name, l.logo_url, ll.blurb, ll.platform,
         ll.competitiveness, ll.suggested_division, ll.accepting_signups,
         ll.accepting_waitlist, s.id, s.max_seats, lh.games_confirmed, lh.active_gms;
SQL
fi
if ! psql "$DATABASE_URL" -tAc "SELECT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_league_applicants')" | grep -q t; then
  echo "== Recreating v_league_applicants (location-aware) =="
  psql_run <<'SQL'
CREATE VIEW v_league_applicants AS
SELECT
    su.league_id,
    su.user_id,
    u.display_name,
    su.stated_division            AS skill_division,
    COALESCE(su.country_code, u.country_code) AS country_code,
    COALESCE(su.location, u.location)         AS location,
    COALESCE(su.timezone, u.timezone)         AS timezone,
    su.platform,
    su.message,
    su.preferred_club,
    su.created_at,
    w.status                      AS waitlist_status,
    w.position                    AS waitlist_position
FROM league_signup su
JOIN app_user u ON u.id = su.user_id
LEFT JOIN waitlist_entry w ON w.signup_id = su.id;
SQL
fi
if version_applied 1.8.0 && ! psql "$DATABASE_URL" -tAc "SELECT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_waitlist')" | grep -q t; then
  echo "== Recreating v_waitlist =="
  psql_run <<'SQL'
CREATE VIEW v_waitlist AS
SELECT
    w.league_id,
    w.position,
    w.status,
    w.user_id,
    u.display_name,
    su.stated_division            AS skill_division,
    COALESCE(su.country_code, u.country_code) AS country_code,
    COALESCE(su.location, u.location)         AS location,
    COALESCE(su.timezone, u.timezone)         AS timezone,
    su.platform,
    w.joined_at,
    w.invited_at,
    w.invite_expires_at
FROM waitlist_entry w
JOIN app_user u ON u.id = w.user_id
LEFT JOIN league_signup su ON su.id = w.signup_id
WHERE w.status IN ('waiting','invited')
ORDER BY w.league_id, w.position;
SQL
fi

apply schema-membership.sql 1.2.0
apply schema-user-profile.sql 1.9.0
apply schema-commissioner-links.sql 1.7.0
apply schema-feature-request.sql 1.6.0
apply schema-keepers.sql 1.3.0
apply schema-charity.sql 1.1.0
apply migration-2.0.0-league-settings.sql 2.0.0
apply schema-league-settings-identity.sql 2.2.0
apply schema-xbox-verification.sql 2.1.0
apply schema-season-inheritance.sql 2.3.0
apply schema-transactions.sql 2.4.0
apply schema-keeper-deadline.sql 2.5.0
apply schema-keeper-dq-registration.sql 2.6.0
apply schema-box-scores.sql 2.7.0
apply schema-game-result-standings-flag.sql 2.8.0
apply schema-email-digest.sql 2.9.0
apply schema-calendar-feed.sql 2.10.0
apply schema-league-partners.sql 2.11.0
apply schema-replit-id.sql 2.12.0
apply schema-signup-history.sql 2.13.0
apply schema-waitlist-decided-by.sql 2.14.0
apply schema-join-requests.sql 2.15.0
apply schema-gm-card-profile.sql 2.16.0
apply schema-league-limits.sql 2.17.0
apply schema-open-league-season-start.sql 2.18.0
apply schema-club-catalog-leagues.sql 2.19.0
apply schema-favorite-team.sql 2.20.0

echo
echo "== Done. Current schema_version: =="
psql_run -c "SELECT version, notes FROM schema_version ORDER BY version;"
