#!/usr/bin/env bash
#
# A Postgres cluster that belongs to this checkout and nothing else (§12.32).
#
# Not a system service and not a shared database: initdb into ./.testdb on a
# non-default port, so it cannot be confused with a real one, cannot outlive
# `rm -rf .testdb`, and needs no admin rights to create or destroy.
#
#   scripts/test-db.sh up      start it, creating the cluster on first run
#   scripts/test-db.sh down    stop it
#   scripts/test-db.sh reset   destroy and rebuild from the migrations
#   scripts/test-db.sh status  is it listening
#
# Postgres 17 to match production (Supabase runs 17.6); the major version is
# what decides whether a migration that applies here applies there.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDIR="${ROOT}/.testdb"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PORT="${TEST_PGPORT:-55432}"
DB="fleet_test"
LOG="${PGDIR}/postgres.log"

if [ ! -x "${PGBIN}/pg_ctl" ]; then
  echo "postgres 17 not found at ${PGBIN}" >&2
  echo "  brew install postgresql@17     (or set PGBIN)" >&2
  exit 1
fi

running() { "${PGBIN}/pg_ctl" -D "${PGDIR}" status >/dev/null 2>&1; }

create() {
  # --locale matches the Supabase cluster: collation decides ORDER BY on text,
  # and a test that sorts differently here than in production is worse than no
  # test at all.
  "${PGBIN}/initdb" -D "${PGDIR}" -U postgres \
    --locale=en_US.UTF-8 --encoding=UTF8 -A trust >/dev/null
  # listen_addresses is deliberately loopback-only.
  {
    echo "port = ${PORT}"
    echo "listen_addresses = '127.0.0.1'"
    echo "unix_socket_directories = '${PGDIR}'"
    echo "fsync = off"
    echo "synchronous_commit = off"
    echo "full_page_writes = off"
  } >> "${PGDIR}/postgresql.conf"
}

start() {
  running && return 0
  "${PGBIN}/pg_ctl" -D "${PGDIR}" -l "${LOG}" -w -t 30 start >/dev/null
  "${PGBIN}/createdb" -h 127.0.0.1 -p "${PORT}" -U postgres "${DB}" 2>/dev/null || true
}

case "${1:-up}" in
  up)
    [ -d "${PGDIR}" ] || create
    start
    echo "test database up on 127.0.0.1:${PORT}/${DB}"
    ;;
  down)
    running && "${PGBIN}/pg_ctl" -D "${PGDIR}" -m fast -w stop >/dev/null
    echo "test database down"
    ;;
  reset)
    running && "${PGBIN}/pg_ctl" -D "${PGDIR}" -m immediate -w stop >/dev/null || true
    rm -rf "${PGDIR}"
    create && start
    echo "test database rebuilt on 127.0.0.1:${PORT}/${DB}"
    ;;
  status)
    running && echo "up on ${PORT}" || { echo "down"; exit 1; }
    ;;
  *)
    echo "usage: $0 {up|down|reset|status}" >&2; exit 2 ;;
esac
