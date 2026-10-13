#!/usr/bin/env bash
# DEV ONLY. Rebuilds a throwaway Postgres 16 + PostGIS database from nothing,
# loads the Supabase stand-in, 001 and 002, then runs test_002.py.
# Needs: Linux, run as root, postgresql-16 + postgresql-16-postgis-3, python3 + psycopg2.
#   bash db/tests/run.sh
set -euo pipefail

D="${FS_PGDIR:-/var/lib/postgresql/fs-test}"
B=/usr/lib/postgresql/16/bin
PORT="${FS_PGPORT:-5544}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DB_DIR="$(cd "$HERE/.." && pwd)"
PSQL=(psql -h "$D" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

if [ ! -d "$D/data" ]; then
  mkdir -p "$D" && chown postgres:postgres "$D"
  su postgres -c "$B/initdb -D $D/data -A trust >/dev/null"
fi
if ! su postgres -c "$B/pg_ctl -D $D/data status" >/dev/null 2>&1; then
  su postgres -c "$B/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log start -w" >/dev/null
fi

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS fs WITH (FORCE)"
"${PSQL[@]}" -d postgres -c "DROP ROLE IF EXISTS anon, authenticated, service_role" 2>/dev/null || true
"${PSQL[@]}" -d postgres -c "CREATE DATABASE fs"
"${PSQL[@]}" -d fs -f "$HERE/00_supabase_stub.sql"
# FS_EXT_SCHEMA=extensions mimics Supabase's dashboard, which installs PostGIS
# and citext into the "extensions" schema and puts it on the search_path.
if [ "${FS_EXT_SCHEMA:-public}" = "extensions" ]; then
  "${PSQL[@]}" -d fs -c "CREATE EXTENSION postgis WITH SCHEMA extensions; CREATE EXTENSION citext WITH SCHEMA extensions;"
  "${PSQL[@]}" -d fs -c "ALTER DATABASE fs SET search_path = \"\$user\", public, extensions"
  echo "layout: PostGIS + citext in schema 'extensions'"
else
  echo "layout: PostGIS + citext in schema 'public'"
fi
"${PSQL[@]}" -d fs -f "$DB_DIR/001_schema.sql"
"${PSQL[@]}" -d fs -f "$DB_DIR/002_reps_and_rls.sql"
echo "schema loaded"

FS_DSN="host=$D port=$PORT user=postgres dbname=fs" python3 "$HERE/test_002.py"
