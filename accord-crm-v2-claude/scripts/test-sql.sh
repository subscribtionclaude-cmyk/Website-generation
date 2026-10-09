#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/db-local.sh accord_test >/dev/null
psql -h /tmp -p 54329 -U postgres -d accord_test -v ON_ERROR_STOP=1 -q -f supabase/tests/10_behaviour.sql
