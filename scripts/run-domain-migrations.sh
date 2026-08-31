#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required to run domain migrations." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -tAc \
  "SELECT to_regclass('public.schema_version') IS NOT NULL" | grep -qx 't'; then
  echo "The database has no Front Office base schema. Apply db/schema.sql before upgrades." >&2
  exit 1
fi

driver_file="$(mktemp)"
trap 'rm -f "$driver_file"' EXIT

{
  cat <<'SQL'
\set ON_ERROR_STOP on
SELECT pg_advisory_lock(hashtextextended('front-office-domain-migrations', 0));
\echo 'Checking Front Office domain migrations...'
SQL

  mapfile -t migration_files < <(
    printf '%s\n' "$repo_root"/db/migration-*.sql | sort -V
  )
  declare -A seen_versions=()

  if [[ ${#migration_files[@]} -eq 0 || ! -e "${migration_files[0]}" ]]; then
    echo "No domain migrations found in db/." >&2
    exit 1
  fi

  for migration_file in "${migration_files[@]}"; do
    filename="$(basename "$migration_file")"
    if [[ ! "$filename" =~ ^migration-([0-9]+\.[0-9]+\.[0-9]+)-[a-z0-9-]+\.sql$ ]]; then
      echo "Invalid domain migration filename: $filename" >&2
      exit 1
    fi
    version="${BASH_REMATCH[1]}"
    if [[ -n "${seen_versions[$version]:-}" ]]; then
      echo "Duplicate domain migration version $version: ${seen_versions[$version]} and $filename" >&2
      exit 1
    fi
    seen_versions[$version]="$filename"
    printf "SELECT EXISTS (SELECT 1 FROM schema_version WHERE version = '%s') AS migration_applied \\\\gset\n" "$version"
    printf "\\\\if :migration_applied\n"
    printf "  \\\\echo '  %s already applied'\n" "$version"
    printf "\\\\else\n"
    printf "  \\\\echo '  applying %s'\n" "$version"
    printf "  \\\\ir '%s'\n" "$migration_file"
    printf '  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM schema_version WHERE version = '\''%s'\'') THEN RAISE EXCEPTION '\''migration %s did not record schema_version'\''; END IF; END $$;\n' "$version" "$version"
    printf "\\\\endif\n"
  done

  cat <<'SQL'
SELECT pg_advisory_unlock(hashtextextended('front-office-domain-migrations', 0));
\echo 'Front Office domain migrations are current.'
SQL
} > "$driver_file"

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f "$driver_file"