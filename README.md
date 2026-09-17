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

`npm run check` also runs as a Husky pre-commit hook.

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
- **2 — next.** Samsara client and ingestion worker.
