#!/usr/bin/env bash
#
# Deploy the worker. `scripts/deploy.sh [<sha>]`
#
# THE GATES ARE PART OF THIS SCRIPT, not a note beside it. PROJECT_BRIEF.md
# says "two gates, not notes", and the way a note becomes a gate is that the
# only convenient path to production runs through it. Skipping them now takes
# deliberate effort rather than forgetfulness.
#
#   npm run check      typecheck, lint, 1000+ unit tests
#   npm run preflight   the REAL transaction pooler, which the local cluster
#                       cannot reproduce: `prepare: false`, the fleet query's
#                       row shape, and the advisory lock the worker's
#                       single-instance guard is built on (§12.32, §12.62)
#   npm run db:verify   RLS on every table, deny-by-default policies, no
#                       anon/authenticated grants, and the feed_health
#                       singleton that nothing recreates (§12.34)
#   npm run e2e         the browser flows (phase 6, item 5)
#
set -euo pipefail

HOST="${DEPLOY_HOST:-root@209.38.36.72}"
APP_DIR="/opt/vin-fleet-tracker"
SERVICE="vin-fleet-worker.service"
ENV_FILE="/etc/vin-fleet-tracker/worker.env"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. What is being deployed must exist somewhere other than this laptop.
# ---------------------------------------------------------------------------
say "checking the working tree"
[ -z "$(git status --porcelain)" ] || die "the working tree is dirty. Commit or stash first."

SHA="${1:-$(git rev-parse HEAD)}"
SHA="$(git rev-parse "$SHA")"
git branch -r --contains "$SHA" 2>/dev/null | grep -q . \
  || die "$SHA is not on any remote branch. Push it: deploying a commit that exists only here is the failure this phase removed."
echo "deploying ${SHA:0:12}"

# ---------------------------------------------------------------------------
# 2. The gates. Non-zero anywhere and nothing is touched.
# ---------------------------------------------------------------------------
say "gate 1/4 — npm run check";      npm run check      || die "check"
say "gate 2/4 — npm run preflight";  npm run preflight  || die "preflight (§12.32)"
say "gate 3/4 — npm run db:verify";  npm run db:verify  || die "db:verify (§12.34)"
say "gate 4/4 — npm run e2e";        npm run e2e        || die "e2e"

# ---------------------------------------------------------------------------
# 3. STOP BEFORE START. The guard makes an overlap loud; the ordering is what
#    prevents one. §12.64 records the deployment where that distinction was
#    learned the awkward way.
# ---------------------------------------------------------------------------
say "stopping the worker"
ssh "$HOST" "systemctl stop $SERVICE && systemctl is-active $SERVICE || true"

say "checking out ${SHA:0:12} and installing"
ssh "$HOST" "set -e
  cd $APP_DIR
  sudo -u vinfleet git fetch -q origin
  sudo -u vinfleet git checkout -q --detach $SHA
  sudo -u vinfleet npm ci --omit=dev
  # The release tag an error is reported against has to be the code running.
  sed -i 's|^SENTRY_RELEASE=.*|SENTRY_RELEASE=$SHA|' $ENV_FILE
  grep -q '^SENTRY_RELEASE=$SHA' $ENV_FILE"

say "starting the worker"
ssh "$HOST" "systemctl start $SERVICE && sleep 12 && systemctl is-active $SERVICE"

# ---------------------------------------------------------------------------
# 4. Prove it, rather than assume it.
# ---------------------------------------------------------------------------
say "verifying"
ssh "$HOST" "set -e
  cd $APP_DIR
  echo \"running commit: \$(sudo -u vinfleet git rev-parse HEAD)\"
  echo \"restarts since start: \$(systemctl show -p NRestarts --value $SERVICE)\"
  echo '--- the singleton guard must refuse a second instance ---'
  if sudo -u vinfleet env \$(grep -v '^#' $ENV_FILE | xargs) \\
       ./node_modules/.bin/tsx src/worker/index.ts > /tmp/second.log 2>&1; then
    echo 'THE SECOND INSTANCE STARTED. The guard is not holding.' >&2
    rm -f /tmp/second.log
    exit 1
  fi
  head -1 /tmp/second.log; rm -f /tmp/second.log
  echo '--- last poll ---'
  journalctl -u $SERVICE --no-pager -o cat | grep -m1 'poll: ingested' | cut -c1-160 || \\
    echo '(no poll yet — check again in 30s)'"

say "deployed ${SHA:0:12}"
echo "journalctl -u $SERVICE -f   # to watch it"
