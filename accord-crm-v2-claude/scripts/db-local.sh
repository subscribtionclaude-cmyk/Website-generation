#!/usr/bin/env bash
# Recreate a throwaway local Postgres database with the Supabase stubs + all migrations. Usage: db-local.sh [dbname]
set -euo pipefail
DB=${1:-accord_test}; P="psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
cd "$(dirname "$0")/../supabase"
psql -h /tmp -p 54329 -U postgres -q -c "drop database if exists $DB" -c "create database $DB"
$P -d $DB -f tests/00_local_stub.sql
for f in migrations/*.sql; do $P -d $DB -f "$f" || { echo "FAILED: $f"; exit 1; }; done
echo "migrations applied to $DB"
