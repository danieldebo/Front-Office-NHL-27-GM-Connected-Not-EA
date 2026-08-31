#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile
bash scripts/run-domain-migrations.sh
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
