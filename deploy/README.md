# The worker's host

The ingestion worker runs as a systemd service on a small VPS. This directory
holds the two files that live outside the repo on that host, so the deployment
is reproducible from here rather than from one machine's memory — which is the
same problem, at the level of configuration, that moving the worker off a
laptop solved at the level of logs.

**Host:** `209.38.36.72` — Ubuntu 24.04 LTS, AMS3, 1 vCPU / 961 MiB / 24 GB.
**Service:** `vin-fleet-worker.service`, running as the unprivileged `vinfleet`.
**Code:** `/opt/vin-fleet-tracker`, a detached checkout of a pinned commit.
**Secrets:** `/etc/vin-fleet-tracker/worker.env`, `root:vinfleet 0640`.

## Why a VPS and not Fly or Railway

§12.52 is the requirement: a worker on a laptop is not a worker, because every
`feed_health` figure then includes the host's sleep schedule. What was needed
beyond "stays awake" was a **real place for logs to land**, and journald with a
set retention answers that with no second moving part. Fly's log retention is
short enough to need a drain configured, which is one more thing to forget in
exactly the place evidence keeps getting lost.

## Deploy method: `git clone`, pinned

The repository is public, so the droplet holds **no GitHub credential**. What
runs is always a commit that exists on GitHub: `git rev-parse HEAD` on the host
is checkable against `origin`, and a rollback is a checkout.

A bare repo on the droplet with `git push vps` was considered and rejected. It
is tidier and needs no GitHub at all, but it permits deploying a commit that
exists only on one laptop and one box — reintroducing the single-copy failure
this whole phase exists to remove, in the deploy mechanism itself.

## What the host holds, and what it deliberately does not

The worker validates against `WorkerEnv`, not `ServerEnv` — see
`src/env/schema.ts`. Its only database credential is `DIRECT_URL`, the
**session pooler** on port 5432. It holds no Supabase API key, because
`lib/supabase/admin.ts` is the only consumer of either and imports
`server-only`, which a standalone Node process can never satisfy.

    DIRECT_URL              session pooler, :5432   (NOT :6543, NOT db.<ref>…)
    SAMSARA_API_TOKEN
    SAMSARA_ORG_ID
    HERE_API_KEY            optional
    SENTRY_WORKER_DSN       optional, the worker's own Sentry project
    NODE_ENV, ROUTING_MONTHLY_CEILING, SENTRY_RELEASE

`DIRECT_URL` must be the session pooler. Advisory locks are session-scoped and
the singleton guard (§12.62) is built on one, so the transaction pooler would
not merely be slower — it would silently void the guard. `WorkerEnv` refuses
both the transaction pooler and the IPv6-only `db.<ref>.supabase.co` host.

## First-time setup

```sh
# swap — 961 MiB is tight for `npm ci`; insurance, not a workaround
fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo "/swapfile none swap sw 0 0" >> /etc/fstab

curl -fsSL https://deb.nodesource.com/setup_24.x | bash -   # Node 24, Active LTS
apt-get install -y nodejs

useradd --system --create-home --home-dir /var/lib/vinfleet \
        --shell /usr/sbin/nologin vinfleet
install -d -o vinfleet -g vinfleet -m 0755 /opt/vin-fleet-tracker
install -d -o root     -g vinfleet -m 0750 /etc/vin-fleet-tracker

sudo -u vinfleet git clone https://github.com/AleksandarSarbajic/vin-fleet-tracker.git \
  /opt/vin-fleet-tracker

# worker.env is written by hand or piped over stdin. NEVER passed as an
# argument: that puts every secret in the process list.
install -o root -g vinfleet -m 0640 /dev/stdin /etc/vin-fleet-tracker/worker.env

install -m 0644 deploy/vin-fleet-worker.service /etc/systemd/system/
install -D -m 0644 deploy/journald-vin-fleet.conf \
  /etc/systemd/journald.conf.d/vin-fleet.conf
systemctl daemon-reload && systemctl restart systemd-journald
systemctl enable --now vin-fleet-worker.service
```

## Deploying a new commit

```sh
scripts/deploy.sh [<sha>]      # defaults to HEAD
```

**The gates live inside that script rather than beside it.** `PROJECT_BRIEF.md`
asks for "two gates, not notes", and the way a note becomes a gate is that the
only convenient path to production runs through it:

| gate | what it covers that nothing else does |
|---|---|
| `npm run check` | typecheck, lint, the unit suite |
| `npm run preflight` | the REAL transaction pooler — `prepare: false`, the fleet query's row shape, and the advisory lock the singleton guard is built on. The local cluster cannot reproduce any of it (§12.32, §12.62) |
| `npm run db:verify` | RLS on every table, deny-by-default policies, no anon/authenticated grants, and the `feed_health` singleton that nothing recreates (§12.34) |
| `npm run e2e` | the browser flows: middleware redirect, a real session, hydration, the map, and one write path end to end |

It also refuses to deploy a dirty tree, or a commit that is not on a remote —
deploying something that exists only on one laptop is the failure this phase
removed, and the deploy script should not be the place it comes back.

**Stop before start.** The script does this, and the ordering is not a
nicety: the singleton guard refuses a second instance only once the first one
holds the lock, so it makes an overlap *loud* rather than making an unordered
cutover *safe* (§12.64).

Afterwards it proves two things rather than assuming them — that the service is
active on the expected commit, and that a second instance really is refused.

### By hand, if the script is not an option

```sh
systemctl stop vin-fleet-worker.service       # SIGTERM: finishes the cycle,
                                              # closes the pool, releases the lock
cd /opt/vin-fleet-tracker
sudo -u vinfleet git fetch origin
sudo -u vinfleet git checkout --detach <sha>
sudo -u vinfleet npm ci --omit=dev
systemctl start vin-fleet-worker.service
```

`npm ci --omit=dev` skips vitest, playwright, typescript and eslint. It does
**not** skip `next`, `react` or `mapbox-gl`: those sit in `dependencies`
because the app needs them at runtime, so the tree is ~600 MB on the worker
host too. Disk is not the constraint here; the expectation should just be
accurate.

## Reading the logs

```sh
journalctl -u vin-fleet-worker -f                      # follow
journalctl -u vin-fleet-worker --since "1 hour ago"
journalctl -u vin-fleet-worker -o cat | grep '"level":"error"'
journalctl -u vin-fleet-worker -o cat | grep 'feed health'   # §12.42 daily report
```

Every line is one JSON object. Retention is 90 days or 512 MB, whichever comes
first; at ~3 MB/day the time limit binds long before the size one.

## Restart policy

`Restart=on-failure`, `RestartSec=10s`, and at most five starts in five minutes
before systemd gives up. The case that sizing is for is the guard refusing
because another instance holds the lock: that exits 1 every time and will never
succeed by being retried, so an unbounded loop would be thousands of pointless
starts and a journal full of one line. A crash that *is* transient gets five
chances, which is enough for a pooler blip and few enough to notice.

## The measurement boundary

The worker moved hosts at **2026-09-24 13:29:30 UTC**.

`feed_health`'s cumulative counters (`missed_cycles`, `longest_stall_seconds`)
span both eras and are therefore **not comparable across that instant**. At the
cutover they read `missed_cycles 1854`, `longest_stall_seconds 22587`
(2026-09-19) — every bit of which was accumulated on a laptop that slept.

§12.52 left the stall diagnosis explicitly re-openable only from a host that
stays awake. Counters accumulated after this timestamp are the first evidence
that measures Supabase rather than `pmset`.
