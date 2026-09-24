#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Validates the Supabase migrations on a throwaway local PostgreSQL cluster:
#   1. applies the Supabase shim (tests only), every migration, then base + demo seeds
#   2. re-applies all migrations to prove they are idempotent
#   3. checks the database matches the frontend JSON contracts (roles, permissions, settings)
#   4. runs the SQL test suites (RLS, RBAC anti-escalation, settings workflow, storage, audit)
#
# Requirements: PostgreSQL 15+ server binaries (initdb, pg_ctl, psql). Override with PG_BIN=/path/bin.
# No Supabase account, Docker or network access needed.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n1)}"
if [[ -z "${PG_BIN}" || ! -x "${PG_BIN}/initdb" ]]; then
  PG_BIN="$(dirname "$(command -v initdb || true)")"
fi
if [[ ! -x "${PG_BIN}/initdb" ]]; then
  echo "✗ PostgreSQL server binaries not found. Install PostgreSQL 15+ or set PG_BIN." >&2
  exit 1
fi

PORT="${PGTEST_PORT:-54329}"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/malek-db-test.XXXXXX")"
DATA="${WORKDIR}/data"
RUN_AS=()
if [[ "$(id -u)" == "0" ]]; then
  # PostgreSQL refuses to run as root; use the postgres OS user when available.
  if id postgres >/dev/null 2>&1; then
    chown -R postgres "${WORKDIR}"
    RUN_AS=(runuser -u postgres --)
  else
    echo "✗ Running as root without a 'postgres' OS user; run as a regular user instead." >&2
    exit 1
  fi
fi

cleanup() {
  "${RUN_AS[@]}" "${PG_BIN}/pg_ctl" -D "${DATA}" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

echo "▶ PostgreSQL: $("${PG_BIN}/postgres" --version)"
"${RUN_AS[@]}" "${PG_BIN}/initdb" -D "${DATA}" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
"${RUN_AS[@]}" "${PG_BIN}/pg_ctl" -D "${DATA}" -o "-p ${PORT} -k ${WORKDIR} -c listen_addresses=''" -l "${WORKDIR}/pg.log" -w start >/dev/null

PSQL=("${PG_BIN}/psql" -h "${WORKDIR}" -p "${PORT}" -U postgres -d postgres)
run_sql() {
  PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null
}

echo "▶ Applying Supabase shim (tests only)"
run_sql "${ROOT}/supabase/tests/supabase-shim.sql"

echo "▶ Applying migrations"
for file in "${ROOT}"/supabase/migrations/*.sql; do
  echo "   • $(basename "${file}")"
  run_sql "${file}"
done

echo "▶ Applying seeds (base + demo)"
run_sql "${ROOT}/supabase/seed/base.sql"
run_sql "${ROOT}/supabase/seed/demo.sql"

echo "▶ Re-applying migrations (idempotency)"
for file in "${ROOT}"/supabase/migrations/*.sql; do
  run_sql "${file}"
done

echo "▶ Checking database ↔ frontend contracts"
node "${ROOT}/scripts/db/check-contracts.mjs" -h "${WORKDIR}" -p "${PORT}" -U postgres -d postgres

echo "▶ Running SQL test suites"
run_sql "${ROOT}/supabase/tests/helpers.sql"
total=0
for file in "${ROOT}"/supabase/tests/sql/*.test.sql; do
  output="$("${PSQL[@]}" -X -q -t -v ON_ERROR_STOP=1 -f "${file}" 2>&1)" || {
    grep -E 'ERROR|FAILED|CONTEXT|DETAIL|HINT' <<<"${output}" | sed 's/^/     /'
    echo "✗ $(basename "${file}") FAILED" >&2
    exit 1
  }
  count="$(grep -c 'ok - ' <<<"${output}" || true)"
  total=$((total + count))
  echo "   ✓ $(basename "${file}") (${count} assertions)"
done

echo "✓ Database migrations valid — ${total} assertions passed"
