#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required to check schema safety." >&2
  exit 1
fi

before_columns="$(mktemp)"
before_relations="$(mktemp)"
trap 'rm -f "$before_columns" "$before_relations"' EXIT

psql "$DATABASE_URL" -X -A -F $'\t' -t -v ON_ERROR_STOP=1 <<'SQL' > "$before_relations"
SELECT n.nspname, c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'dq')
  AND c.relkind IN ('r', 'p', 'v', 'm')
ORDER BY 1, 2, 3;
SQL

psql "$DATABASE_URL" -X -A -F $'\t' -t -v ON_ERROR_STOP=1 <<'SQL' > "$before_columns"
SELECT table_schema, table_name, column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema IN ('public', 'dq')
  AND (table_schema, table_name) IN (
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
  )
ORDER BY 1, 2, ordinal_position;
SQL

bash scripts/run-domain-migrations.sh

while IFS=$'\t' read -r schema relation kind; do
  [[ -z "$schema" ]] && continue
  exists="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 \
    -v schema="$schema" -v relation="$relation" -v kind="$kind" <<'SQL'
SELECT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = :'schema' AND c.relname = :'relation' AND c.relkind = :'kind'
    );
SQL
)"
  if [[ "$exists" != "t" ]]; then
    echo "Unsafe release schema diff: removed or replaced $schema.$relation (kind $kind)." >&2
    exit 1
  fi
done < "$before_relations"

while IFS=$'\t' read -r schema table column data_type udt_name; do
  [[ -z "$schema" ]] && continue
  current="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 \
    -v schema="$schema" -v table="$table" -v column="$column" <<'SQL'
SELECT data_type || E'\t' || udt_name
        FROM information_schema.columns
        WHERE table_schema = :'schema' AND table_name = :'table' AND column_name = :'column';
SQL
)"
  if [[ -z "$current" ]]; then
    echo "Unsafe release schema diff: removed column $schema.$table.$column." >&2
    exit 1
  fi
  if [[ "$current" != "$data_type"$'\t'"$udt_name" ]]; then
    case "$schema.$table.$column:$data_type/$udt_name->$current" in
      public.app_user.platform:USER-DEFINED/platform_type-\>text$'\t'text|\
      public.league_listing.platform:USER-DEFINED/platform_type-\>text$'\t'text|\
      public.league_signup.platform:USER-DEFINED/console_type-\>text$'\t'text|\
      public.league.platform:USER-DEFINED/platform_type-\>text$'\t'text)
        ;;
      *)
        echo "Unsafe release schema diff: changed type of $schema.$table.$column from $data_type/$udt_name to $current." >&2
        exit 1
        ;;
    esac
  fi
done < "$before_columns"

echo "Release schema diff contains no unreviewed removals or type changes."