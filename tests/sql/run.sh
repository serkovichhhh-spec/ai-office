#!/usr/bin/env bash
# Runs the office migrations + SQL acceptance tests on a throwaway local database.
# Usage: tests/sql/run.sh   (needs a local Postgres where the current OS user or `postgres` can create databases)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="office_test_$$"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q)
if [ "$(id -u)" = "0" ]; then RUN=(su postgres -c); else RUN=(bash -c); fi
"${RUN[@]}" "createdb $DB"
trap '"${RUN[@]}" "dropdb --if-exists $DB" >/dev/null 2>&1 || true' EXIT
for f in tests/sql/00_supabase_shim.sql supabase/migrations/*.sql tests/sql/10_office_tests.sql; do
  echo "→ $f"
  "${RUN[@]}" "${PSQL[*]} -d $DB -f '$PWD/$f'"
done
