# Vin Logistics — Fleet Tracker

Internal dispatch console. Dispatchers run it for the whole shift, mostly
overnight US time from Europe.

- **What to build:** `PROJECT_BRIEF.md`
- **What it looks like and how it behaves:** `docs/design-spec.md` — the
  extraction of the approved design. Build from this, not from
  `design/Fleet_Tracker_dc.html`.
- **Rulings that supersede both:** `docs/design-spec.md` §12.

## Local setup

Requires Node ≥ 20.9.

```bash
npm install
cp .env.example .env.local     # then fill in the blanks
npm run db:migrate             # applies ./drizzle over the session pooler
npm run db:verify              # asserts RLS and grants landed
npm run dev
```

Every variable in `.env.local` is Zod-parsed at boot. A missing or malformed
one fails immediately with a message naming the variable — not at 2am.

### The two connection strings

Getting these backwards produces intermittent failures under load that look
like application bugs, so the env schema rejects each wrong shape by name.

| Variable | Pooler | Port | Used by |
|---|---|---|---|
| `DATABASE_URL` | Transaction | 6543 | Next.js route handlers |
| `DIRECT_URL` | Session | 5432 | Migrations, ingestion worker |

Pool sizes are set for **3 concurrent dispatchers across 5 accounts**: the
app pool is `max: 10`, the worker `max: 2`. Revisit only if that headcount
changes.

Transaction mode does not support prepared statements — the pooled client
sets `prepare: false` and that line is load-bearing.

`DIRECT_URL` must be the **session pooler**, never
`db.<ref>.supabase.co:5432`. That host is IPv6-only without the paid add-on
(verified: AAAA record, no A record) and most worker hosts have no outbound
IPv6. Take both strings from the Supabase Connect dialog.

### Keys

The browser gets `sb_publishable_…` and nothing else. The two `sb_secret_…`
keys are server-side only — never `NEXT_PUBLIC_*`, never in a client bundle.
There are two of them so either service can be rotated without downing the
other. The legacy `anon` / `service_role` JWTs are deprecated and unused.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run check` | typecheck + lint + test. **Must pass before a phase is done.** |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (session pooler) |
| `npm run db:verify` | Assert RLS, policies and grants are intact |
| `npm run db:studio` | Drizzle Studio |
| `npm run worker` | Ingestion worker — the only thing that calls Samsara |
| `npm run samsara:probe` | Re-verify `docs/samsara.md` against the live org |

`npm run check` also runs as a Husky pre-commit hook.

## The ingestion worker

```bash
npm run worker
```

A standalone Node process, **not** deployed on Supabase: `pg_cron` has a
one-minute floor and Edge Functions are not built for a persistent poller.
Put it on a small VM, Railway or Fly.

### Deployment region — settled, do not relitigate

**The worker runs in `eu-west-1`, next to Postgres. Not near the fleet.**

The database is in `eu-west-1` (Ireland). The worker is chatty with Postgres
— every poll is several round trips — and makes exactly **one** Samsara call
per cycle regardless of where it sits. Moving it to the US to be "closer to
the trucks" adds transatlantic latency to every database round trip and saves
nothing on the single API call. Dispatchers work from Europe, so the Next.js
app belongs in `eu-west-1` too.

- **Exactly one instance.** It is the only thing that talks to Samsara;
  every client reads our database. Ten open tabs must not mean ten times the
  Samsara traffic.
- Polls `/fleet/vehicles/stats/feed` every 30s with a **cursor persisted in
  `feed_health.cursor`**, so a restart resumes rather than re-ingesting cold.
- Token bucket, exponential backoff with full jitter, circuit breaker, and a
  log line for every throttle event.
- On a cold start it seeds from the stats snapshot and derives
  `trucks.active` from position recency. Samsara has no active flag and a
  third of this org's feed is trucks that have not moved in months.
- Syncs the vehicle and driver rosters hourly; prunes positions beyond the
  7-day rolling window, always keeping each truck's newest fix.
- Connects over `DIRECT_URL`, the session pooler.

`docs/samsara.md` records the response shapes this worker parses, **verified
against the live org** rather than taken from the published reference.
Re-check it with `npm run samsara:probe`.

## Security model

All application reads and writes go through our own route handlers using a
secret key. RLS is a **backstop**, not the access model: every table has RLS
enabled with a deny-all policy and no grants to `anon` or `authenticated`, so
a leaked publishable key reads nothing.

Verified after migration — all ten tables return `42501 permission denied` to
the publishable key.

Do not open a table up to make a client-side query work. Add a route handler.

Roles live in `profiles`, keyed to `auth.users.id`, defaulting to `viewer`.
A signup trigger creates the row. Check the role **server-side on every
mutating route** with `requireRole` — never trust a role claim from the
client. `can()` in `src/lib/roles.ts` is for UI affordance only.

## Layout

```
src/
  app/              Next App Router. Server components by default.
  db/
    schema.ts       Drizzle schema — the data model
    connection.ts   Plain connection factories (no `server-only`)
    index.ts        App-facing handle, `server-only`
    migrate.ts      Migration runner (standalone Node)
  env/
    schema.ts       Pure Zod schemas — unit tested
    client.ts       Parses NEXT_PUBLIC_* (inlined into the browser bundle)
    server.ts       Parses the rest, `server-only`
  lib/
    auth.ts         getSessionUser / requireUser / requireRole
    roles.ts        Pure role ranking
drizzle/            Generated migrations + hand-written RLS
docs/design-spec.md The design, extracted
```

`server-only` lives on the Next-facing entry points, so standalone processes
(migrations, and the phase-2 worker) import `db/connection.ts` directly.

## Phase status

- **0 — done.** `docs/design-spec.md`.
- **1 — done.** Scaffold, env validation, schema, migrations, RLS, auth.
- **2 — done.** Samsara client and ingestion worker, verified against the
  live org. See `docs/samsara.md`.
- **3 — next.** Read-only console: map, virtualized list, two-way selection,
  search, draggable split.
