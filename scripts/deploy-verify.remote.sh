#!/usr/bin/env bash
#
# Deploy verification. Runs ON THE DROPLET, fed to `bash -s` over ssh by
# scripts/deploy.sh:   deploy-verify.remote.sh <app_dir> <service> <env_file>
#
# A file, not a double-quoted string inside deploy.sh, and that is the fix
# rather than a tidy-up (§12.74). As a string, every character passed through
# the LAPTOP's shell first. A comment in it quoted `grep -m1` in backticks,
# which ran grep locally, and put "last poll" in double quotes, which closed
# the string early and inverted every quote after it -- so the droplet got
# `[ -n $RECENT ]` unquoted, a JSON poll line split into words, `[` failed,
# and the check printed "no poll in the last 3 minutes" while a poll existed.
# Sent as a file on stdin, nothing here is expanded until the droplet runs it,
# and comments can say anything.
#
# src/test/deploy-verify.test.ts runs this against stub commands.

set -euo pipefail

APP_DIR="$1"
SERVICE="$2"
ENV_FILE="$3"

cd "$APP_DIR"
echo "running commit: $(sudo -u vinfleet git rev-parse HEAD)"
echo "restarts since start: $(systemctl show -p NRestarts --value "$SERVICE")"

echo '--- the singleton guard must refuse a second instance ---'
SECOND_LOG="$(mktemp)"
# The env file's assignments are word-split into `env` on purpose.
# shellcheck disable=SC2046
if sudo -u vinfleet env $(grep -v '^#' "$ENV_FILE" | xargs) \
     ./node_modules/.bin/tsx src/worker/index.ts > "$SECOND_LOG" 2>&1; then
  echo 'THE SECOND INSTANCE STARTED. The guard is not holding.' >&2
  rm -f "$SECOND_LOG"
  exit 1
fi
head -1 "$SECOND_LOG"
rm -f "$SECOND_LOG"

# tail, NOT `grep -m1`. The first version printed the FIRST poll in the whole
# journal -- a line from a previous deploy -- under "most recent poll", which
# reads exactly like a worker that has not polled since. A verification step
# that can show stale evidence is worse than one that shows none.
#
# `|| true` because under pipefail a journal with no poll in it makes grep
# exit 1, and "no poll yet" is an answer to print, not a reason to abort.
echo '--- most recent poll ---'
RECENT="$(journalctl -u "$SERVICE" --no-pager -o cat --since '-3 min' | grep 'poll: ingested' | tail -1 || true)"
if [ -n "$RECENT" ]; then
  printf '%s\n' "$RECENT" | cut -c1-160
else
  echo "(no poll in the last 3 minutes -- watch journalctl -u $SERVICE -f)"
fi
