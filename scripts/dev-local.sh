#!/usr/bin/env bash
# ============================================================================
# Front Office — run the API and the web app on your own machine.
#
# Usage:
#   ./scripts/dev-local.sh
#
# Needs Node 24, pnpm, psql and a running Postgres 16, plus a .env.local file
# (copy .env.local.example and fill it in). See docs/local-development.md.
#
# In order, it: loads .env.local, brings the database schema up to date
# (scripts/apply-schema.sh is idempotent), then starts the API and the web
# app together. Ctrl-C stops both.
#
# Written for the bash 3.2 that ships with macOS as well as newer bash.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.local ]; then
  echo "Missing .env.local. Copy .env.local.example to .env.local and fill it in." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

: "${DATABASE_URL:?DATABASE_URL is not set in .env.local}"
: "${CLERK_PUBLISHABLE_KEY:?CLERK_PUBLISHABLE_KEY is not set in .env.local}"
: "${CLERK_SECRET_KEY:?CLERK_SECRET_KEY is not set in .env.local}"
API_PORT="${API_PORT:-4101}"
WEB_PORT="${WEB_PORT:-4100}"
# The web app reads its Clerk key under a VITE_ name; it is the same key.
export VITE_CLERK_PUBLISHABLE_KEY="${VITE_CLERK_PUBLISHABLE_KEY:-$CLERK_PUBLISHABLE_KEY}"

for tool in node pnpm psql; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is not on your PATH. See docs/local-development.md." >&2
    exit 1
  fi
done

if ! psql "$DATABASE_URL" -tAc 'SELECT 1' >/dev/null 2>&1; then
  echo "Cannot connect to DATABASE_URL. Is Postgres running, and does the database exist?" >&2
  exit 1
fi

mkdir -p .local
echo "== Database schema =="
if ! ./scripts/apply-schema.sh >.local/apply-schema.log 2>&1; then
  cat .local/apply-schema.log >&2
  echo "Schema apply failed (full log above, also in .local/apply-schema.log)." >&2
  exit 1
fi
applied=$(grep -c '^apply ' .local/apply-schema.log || true)
echo "up to date ($applied file(s) applied this run)"

kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

api_pid=""
web_pid=""
cleanup() {
  trap - INT TERM EXIT
  [ -n "$api_pid" ] && kill_tree "$api_pid"
  [ -n "$web_pid" ] && kill_tree "$web_pid"
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "== Starting the API on port $API_PORT and the web app on port $WEB_PORT =="
(
  export PORT="$API_PORT" NODE_ENV=development
  exec pnpm --filter @workspace/api-server run dev
) &
api_pid=$!
(
  export PORT="$WEB_PORT" BASE_PATH=/ API_PROXY_TARGET="http://localhost:$API_PORT"
  exec pnpm --filter @workspace/front-office run dev
) &
web_pid=$!

echo
echo "Front Office: http://localhost:$WEB_PORT   (Ctrl-C to stop)"
echo

# Stop everything as soon as either process exits.
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 1
done
echo "One of the processes exited; stopping the other." >&2
exit 1
