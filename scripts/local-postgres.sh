#!/usr/bin/env bash
# Starts a throwaway PostgreSQL 16 instance for `npm run test:db`.
#
# Deliberately not Docker and not the Supabase CLI: the database integration
# tests must be runnable on a plain machine and on a standard GitHub runner
# without a paid project, credentials or a container runtime. In CI the
# workflow's `postgres` service provides the server instead and this script is
# not used - set DVD_TEST_DATABASE_URL there.
#
# The instance holds only fictional test data and is safe to delete.
set -euo pipefail

PORT="${DVD_TEST_PGPORT:-55432}"
SOCKET_DIR="${DVD_TEST_PGSOCKET:-/tmp/pgsock}"
DATA_DIR="${DVD_TEST_PGDATA:-${TMPDIR:-/tmp}/dvd-tivat-pgdata}"
BIN_DIR="${DVD_TEST_PGBIN:-/usr/lib/postgresql/16/bin}"

if [ ! -x "$BIN_DIR/initdb" ]; then
  echo "PostgreSQL 16 binaries not found at $BIN_DIR." >&2
  echo "Install postgresql-16, or point DVD_TEST_DATABASE_URL at an existing server." >&2
  exit 1
fi
export PATH="$BIN_DIR:$PATH"

case "${1:-start}" in
  start)
    mkdir -p "$SOCKET_DIR"
    if [ ! -s "$DATA_DIR/PG_VERSION" ]; then
      rm -rf "$DATA_DIR"
      initdb -D "$DATA_DIR" -U postgres --auth=trust >/dev/null
    fi
    if pg_ctl -D "$DATA_DIR" status >/dev/null 2>&1; then
      echo "Already running on port $PORT."
    else
      pg_ctl -D "$DATA_DIR" -o "-p $PORT -k $SOCKET_DIR" -l "$DATA_DIR/server.log" -w start >/dev/null
      echo "Started on port $PORT (socket $SOCKET_DIR)."
    fi
    echo "DVD_TEST_DATABASE_URL=postgresql://postgres@localhost:$PORT/postgres"
    ;;
  stop)
    if pg_ctl -D "$DATA_DIR" status >/dev/null 2>&1; then
      pg_ctl -D "$DATA_DIR" -w stop >/dev/null
      echo "Stopped."
    else
      echo "Not running."
    fi
    ;;
  *)
    echo "Usage: $0 [start|stop]" >&2
    exit 2
    ;;
esac
