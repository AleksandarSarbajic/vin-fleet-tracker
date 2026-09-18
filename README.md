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
| `npm run seed:demo` | Obviously-fake loads and stops for development |
| `npm run preflight` | **Required before deploy.** The real Supabase pooler, which the tests cannot reach |
| `npm run test:db:up` | Start the local test cluster (`npm test` does this for you) |
| `npm run test:db:reset` | Destroy and rebuild it from the migrations |

`npm run check` also runs as a Husky pre-commit hook.

### Tests never touch production

They run against a Postgres that belongs to this checkout — `./.testdb`, port
55432, started on demand by `npm test`. It needs `brew install postgresql@17`
once; nothing else.

`vitest.setup.ts` overwrites `DATABASE_URL` with that cluster and **deletes**
`DIRECT_URL`, both Supabase keys, the Samsara token and both Mapbox tokens, so
a test process holds no credential that reaches a live service. The database
is truncated at the start of every run, which means a fixture must create
everything it reads: `select … limit 1` returns nothing rather than quietly
picking somebody's real truck. See §12.32 for why.

If the suite complains it cannot connect, `npm run test:db:reset`.

## Dispatch data (phase 4)

| Surface | Route | Who |
|---|---|---|
| Bulk assignment board | `/assignments` | dispatcher writes, viewer reads |
| Edit stop / new load | `Enter` on the selected row | dispatcher |
| Reassignment confirm | inside the modal, on a driver change | dispatcher |
| `trucks.active` | the modal's Active checkbox | **admin only** |

Every mutating route re-checks the role server-side. A viewer sees the same
controls, disabled, with a tooltip naming why (§12.14) — hidden controls make
people think the app is broken.

### Appointments and receiving hours

Wall time at the facility plus an IANA zone, converted **by Postgres**.

An **APPT** stop has an appointment and an optional ± window. An **FCFS** stop
has **receiving hours** — earliest and latest — and the latest is the deadline
the status engine measures projected arrival against (§12.22). Both reuse
`appointment_start_utc` / `appointment_end_utc`; `appointment_type` says which
reading applies. Overnight windows (22:00–06:00) are refused for now; see
§12.22 for why and for what the fix is. The
wire format carries integer parts (`{y,m,d}`, `{h,min}`) and the schema is
`.strict()`, so a client sending `startUtc` is refused by name.

Two rules worth knowing before touching `src/server/appointment.ts`:

- **Never bind a wall-time string as `${wall}::timestamp` through
  postgres.js's own tagged template.** It infers the parameter type from the
  cast and serialises through a JS `Date`, shifting the value by the Node
  process's offset — measured at two hours from a CEST machine, five and a
  half from `TZ=Asia/Kolkata`. `drizzle(client)` replaces those serialisers,
  so the app's writes are safe, but `scripts/*.mts` open bare clients.
  `make_timestamp` with integer parts is immune on both paths.
- **`AT TIME ZONE` binds tighter than `+`.** `start + interval at time zone
  'UTC'` fails with `function timezone(unknown, interval) does not exist`.

An hour that does not exist at that facility (spring forward) is **refused**
with a field error; an hour that happens twice (fall back) is accepted and
flagged `resolution: 'ambiguous'`, resolved to the second, standard-time
occurrence.

### Test data

```bash
npm run seed:demo            # DEMO- loads and stops across the active fleet
npm run seed:demo -- --clear # removes exactly what it wrote
```

Everything it writes is marked `DEMO-` / `BROKER DEMO`. Nothing it creates
could be mistaken for a real load. It includes FCFS stops with receiving
hours, stops with no appointment, and loads with no number — each a state the
UI has to handle and the easiest kind to forget.

**The demo data is kept on purpose through phase 5** — the status engine has
nothing to compute against without loads and appointments — and **must be
cleared before the phase 6 deploy.** It is in the phase 6 entry of
`PROJECT_BRIEF.md` for that reason. The script refuses to run against
`NODE_ENV=production` without `--force`, which is a seatbelt, not the plan.

## The status engine

`src/lib/status.ts` is pure: no I/O, no database, no clock of its own. `now`
is an argument like everything else. It emits a semantic status and the UI
maps that to a token — no colour value appears in the file.

**Precedence is not urgency rank** (§12.25). Rank orders the list; precedence
orders the questions, and they disagree in one place on purpose: UNASSIGNED is
asked before STALE_GPS, because a parked driverless truck's gateway goes quiet
on ignition and rank order would report the symptom while hiding the cause.

**ETA degrades honestly** (§12.24). `stops.lat/lng` are populated by nothing —
there is no geocoder — so where a stop has no coordinates, LATE falls back to
the clock and AT_RISK does not fire at all. The ETA cell says `no ETA` with the
reason on hover rather than an em dash. `npm run seed:demo` gives its DEMO
cities coordinates so the projection path is exercised in development, and
deliberately leaves every fourth stop without them.

Two thresholds, two failure modes (§12.3): `staleMinutes: 45` is one truck's
gateway; `feedStaleMinutes: 5` is the whole pipe, and it triggers the §5.9
colour withdrawal fleet-wide. To see that, stop the worker and wait five
minutes — the console drops every row to the stale treatment while
**appointment times stay full strength**, because they come from our database
rather than the feed.

**Urgency group heads are still unwritten**, per §5.7: the trigger is the
fleet crossing 40 trucks. It is 23 of 34.

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
- **3 — done.** Read-only console: map, virtualized list, two-way selection,
  search, draggable split.
- **4 — done.** Dispatch data: loads, stops, the edit modal, the two-sided
  reassignment transaction, the bulk assignment board, audit log. The status
  override block (§9.5) is deliberately held back to phase 5, with the engine
  that computes the status it sits beside.
- **5 — done.** Status engine, colour coding, filter chips, footer counts,
  the offline rule and the §9.5 override block. Urgency group heads remain
  unwritten by §5.7 — the trigger is 40 trucks and the fleet is 23.
- **6 — next.** Hardening: roles enforced server-side, rate-limit tuning,
  Sentry, Playwright on the critical flows, deploy. **Clear the demo data
  first** — `npm run seed:demo -- --clear`.
