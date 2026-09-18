# Vin Logistics INC — Fleet Tracker

You are the lead engineer building an internal dispatch console for Vin Logistics INC, a US trucking carrier. Dispatchers run it for the whole shift, mostly overnight US time from Europe. It must be fast, boring and reliable. Not clever.

The design is finished and signed off. Your job is to build it, not to redesign it.

## The design document

`design/Fleet_Tracker_dc.html` is the approved design — 1,927 lines. Read it in ranges, never whole; grep for `class="dv-opt" id=` to get the section map first. Phase 0 extracts it into `docs/design-spec.md`, and from phase 1 onward that extraction is what you build from.

It is a four-turn canvas document and later turns supersede earlier ones:

- **Turn 4** (4a, 4b, 4c) — reassignment, derived timezones, status overrides. Highest authority.
- **Turn 3** (3a–3f) — edit modal, draggable split, 30- and 60-truck consoles, corrected tokens, login and asset list.
- **Turn 2** (2a–2h) — console screens, degraded states, phone, spec sheet, feedback set. Carries a "Partly superseded" banner naming every place turn 3 overrules it. **2g is the spec sheet and is current** — its token block, type scale, layout table, truncation order and keyboard map were all updated in place.
- **Turn 1** (1a–1d) — status token palette, row variants, interaction states.

Where turns disagree, the later one wins. Lift the Tailwind theme extension out of 2g verbatim rather than retyping hex values; every contrast ratio in the document has been independently verified and any value you retype by hand is a value you can get wrong.

### Deviations from the document — build the corrected version

1. **No HOS anywhere.** We are not pulling Hours of Service from Samsara. Delete every appearance: the "HOS drive left" row in the 2b detail panel, "HOS left" in the 2f phone panel, the "HOS 11h 00m" and "off duty until Tue 06:00" lines in the 3a driver picker, and the HOS clause in the At risk rule. The driver picker shows only current truck assignment and the `active` flag.
2. **Column widths.** 4a widened Status to 128px, 4b widened Appt to 128px. The real row needs **both**. The extra width comes out of Position and Next stop; re-check the 2g truncation order against the actual column set.
3. **DST dates.** 4b's caption quotes 2026 transitions on a screen labelled 2027. Derive every DST boundary in code and in tests. Never paste one.
4. **Override expiry default.** 4c defaults to "end of dispatch day", which is ~20 hours when set just after midnight and defeats the purpose. Default to `+4h`; keep End of day, Until appt and Custom as the other options.

## Ask me before you start

1. Supabase project URL (`https://<ref>.supabase.co`), the publishable key (`sb_publishable_…`), two secret keys (`sb_secret_…`) — one for the web app, one for the worker — and both Postgres connection strings from the Connect dialog.
2. Mapbox access token (the design assumes `dark-v11` tiles).
3. How many dispatchers will be logged in at once.
4. Samsara org ID and API token. Scopes needed: vehicle stats and locations only — do not request HOS.

Already settled, don't ask: dispatch timezone is `America/Chicago`; fleet is roughly 20–30 trucks with headroom designed to 60; reference viewport is 1728×1040 logical.

Logo files (`mark-knockout.svg`, `monogram.svg`, favicon set — full list in 3f) are pending. Build against placeholders and keep every reference in one place so swapping them is a one-file change.

## Stack

Next.js App Router, TypeScript `strict`, Tailwind, shadcn/ui, **Supabase** (Postgres + Auth) with Drizzle for schema and queries, migrations in the repo, TanStack Query, **Mapbox GL JS** via react-map-gl with supercluster, Zod on every boundary, Vitest, Playwright, Sentry, ESLint + Prettier, Husky.

### Supabase specifics

- **Two connection strings.** Transaction pooler (`…pooler.supabase.com:6543`, username `postgres.<ref>`) from Next.js route handlers, with prepared statements disabled — transaction mode does not support them. For Drizzle migrations and the long-running worker, use the **session pooler** (`…pooler.supabase.com:5432`, same username), not the direct `db.<ref>.supabase.co:5432` string: direct connections are IPv6-only without the paid add-on, and common worker hosts have no outbound IPv6. Session mode is a persistent connection like a direct one and supports prepared statements. Env names: `DATABASE_URL` for the transaction pooler, `DIRECT_URL` for the session pooler. Getting these backwards produces intermittent failures under load that look like application bugs.
- **The worker does not run on Supabase.** `pg_cron` has a one-minute floor and Edge Functions aren't built for a persistent poller, so the worker stays a standalone Node process (`npm run worker`) on a small VM, Railway or Fly. It connects directly, not through the pooler.
- **Secret keys are server-side only.** Use the publishable/secret key system, not the legacy `anon` and `service_role` JWTs — those are deprecated and newer projects don't have them at all. The browser gets `sb_publishable_…`; `sb_secret_…` never leaves the server, never `NEXT_PUBLIC_*`, never in a client bundle. Issue one secret key for the Next.js app and a separate one for the ingestion worker so either can be rotated alone. Env names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
- **RLS on every table, no exceptions.** All application reads and writes go through our own route handlers using a secret key, so the policies are a backstop: enable RLS and write deny-by-default policies so an exposed publishable key reads nothing. Do not build the app on client-side Supabase calls with permissive policies.
- **Auth** is Supabase Auth (email/password, or Google Workspace if they want it later). Roles live in a `profiles` table keyed to `auth.users.id` with `role` in `admin | dispatcher | viewer`. Check the role server-side on every mutating route; never trust a role claim from the client.
- **Realtime is not in scope for v1.** Clients poll our API with TanStack Query at 15–30s. Once the app is stable, subscribing to `positions` via Realtime instead of polling is a reasonable phase-6 optimisation — propose it then, don't build it now.

### Verified against the real account

These were confirmed by calling the live Samsara org on 2026-09-16. Build to them; do not re-derive them.

- **`gps.reverseGeo.formattedLocation` exists and is populated.** Confirmed shape: `"Maple Road, New Lenox, IL, 60451"`. This is why no geocoding service is used. Store the string whole; the Position column renders city and state, the detail panel and tooltip get the full string.
- **The stats feed returns every vehicle ever registered, including dead ones.** One response contained fixes ranging from seconds old to seven months old — trucks parked or decommissioned since 2019 are still in the feed with their last known position. Samsara exposes no active flag on vehicles. Therefore `trucks.active` is ours: seed it from position recency (a fix within the last 24h = active), let an admin flip it, show only active trucks in the console, and put the rest behind a filter. Never render the raw Samsara vehicle list as the fleet — half of it is history.
- **Vehicle `name` is `"Truck #147"`, not `147`.** Store the raw Samsara name and a parsed `truck_number`; display the bare number in the tabular-figure column.
- **Do not use the `tags` field for truck numbers.** Tags disagree with names on at least one vehicle in this org (`Truck #147` carries tag `Kamion 129`). `name` is the source of truth.
- **`headingDegrees` is 0 on stationary vehicles.** Don't rotate the map marker when `speedMilesPerHour` is 0.
- **Drivers: store `id`, `name`, and `driverActivationStatus` only.** The payload also contains `licenseNumber`, `licenseState`, `eldSettings` and `hosSetting` — store none of it. Licence data is liability with no use here, and the ELD fields are the HOS data we cut.
- **Samsara returns no driver phone numbers for this org.** Driver cell is a field dispatchers fill in our app, not a Samsara field. The detail panel's "Call driver" control depends on that field being populated; hide it when empty rather than rendering a dead button.
- **Every driver's `timezone` is `America/Chicago`**, consistent with the dispatch timezone above.
- **`/fleet/driver-vehicle-assignments` requires `filterBy=vehicles` or `filterBy=drivers`.** Without it the endpoint returns 400, which is a parameter error, not a scope error.
- **Token scopes granted:** Read Vehicles, Read Vehicle Statistics, Read Drivers, Read Assignments. Nothing else. If an endpoint you want returns 403, do not ask for a broader token — find another way or raise it with me.

## Hard rules

- The Samsara token is server-side only. Never in a client bundle, never in a browser network tab.
- **Browsers never call Samsara.** One server-side ingestion worker polls, writes to our DB, and every client reads from our DB. Ten open tabs must not mean ten times the Samsara traffic.
- Token-bucket rate limiter, exponential backoff with jitter on 429/5xx, circuit breaker, and a log line for every throttle event.
- Our DB owns dispatch data (loads, stops, appointments, assignments, notes, overrides). Samsara owns position, odometer and engine state. Never write dispatch data back into Samsara.
- All instants stored UTC with a separate IANA zone string. No naive local timestamps anywhere.
- No `any`. No unhandled rejections. No silent catches.
- Never hardcode a hex in a component. Semantic status out of the engine, token in the config, class in the component.

## Do not build

Five things appear in superseded screens or earlier drafts and are explicitly cut:

- **SMS or any driver notification.** Nothing is sent to anyone — 4a says so on the confirm dialog.
- **Dock/door validation against a facility door list.** Free text, as the broker wrote it.
- **Load-number format validation.** Non-empty and trimmed, nothing more — broker numbers come in any shape.
- **Anything HOS-derived.**
- **Any external geocoding service.** Position strings come from Samsara's `gps.reverseGeo.formattedLocation`, returned in the same Vehicle Stats response as the coordinates. Store that string on the position row. No Mapbox Geocoding, no Google, and no reverse-geocoding cache or debounce layer — there is nothing to cache.

If you think you need one of these, ask first.

## Architecture

```
Samsara API
    │  single poller, 30s, incremental feed endpoint with a DB-persisted cursor
    ▼
Ingestion worker ──► positions (latest + 7d rolling) ──► feed_health heartbeat
    │  (standalone Node process, direct Postgres connection)
    ▼
Supabase Postgres ◄──── dispatch data written by the app
    │
    ▼
Next.js route handlers (pooled connection) ──► client (TanStack Query, 15–30s)
```

Persist the feed cursor in the DB, not in memory.

## Data model

```
profiles       id (= auth.users.id), full_name, role, created_at
trucks         id, samsara_vehicle_id, samsara_name, truck_number,
               active, last_seen_at, notes
               -- active is OURS, not Samsara's; see Verified against the
               -- real account. samsara_name is the raw "Truck #147".
drivers        id, samsara_driver_id, name, phone, active
               -- phone is entered by dispatchers; Samsara returns none.
               -- Never store licenseNumber, licenseState, or eldSettings.
assignments    id, truck_id, driver_id, started_at, ended_at, created_by
               -- history, never a column on trucks
positions      truck_id, lat, lng, heading, speed_mph, recorded_at,
               formatted_location        -- from Samsara reverseGeo, never computed here
loads          id, truck_id, load_number, broker, status
stops          id, load_id, type (PU|DEL), sequence,
               facility_name, address_line, city, state, zip, lat, lng,
               dock_door TEXT,                       -- free text
               appointment_start_utc, appointment_end_utc, appointment_tz,
               appointment_type (FCFS|APPT),
               arrived_at, departed_at,
               dispatcher_note, note_by, note_at
overrides      stop_id, forced_status, reason (enum), reason_note,
               set_by, set_at, expires_at
audit_log      actor_user_id, entity, entity_id, before, after, created_at
feed_health    newest_position_at, last_success_at, last_error
```

Index `positions(truck_id, recorded_at desc)`. Every dispatcher edit writes `audit_log` — when a DEL time is wrong at 3am someone needs to see who changed it.

Override reason enum: `RECEIVER_CONFIRMED_DETENTION`, `APPT_RESCHEDULED_BY_BROKER`, `ELD_POSITION_WRONG`, `DRIVER_REPORTED_DELAY`, `OTHER`. Reason is required; reject the write without one. `expires_at` is mandatory — there is no "never". Expiry is evaluated **on read**, not by a scheduled job that might not run: an expired override silently returns the row to computed status and moves to history with no notification.

## Status engine

`lib/status.ts`, pure functions, no I/O, fully unit tested. It emits a semantic status; the UI maps status to token.

```ts
type Status =
  | 'LATE' | 'STALE_GPS' | 'UNASSIGNED' | 'AT_RISK'
  | 'NO_APPT' | 'ARRIVED' | 'ON_TIME' | 'TOMORROW'
```

That array is also the urgency sort order, top to bottom.

Rules:
- **ARRIVED** — `arrived_at` is set.
- **STALE_GPS** — newest fix older than `staleMinutes`.
- **UNASSIGNED** — computed, never stored: no open `assignments` row and a live appointment. Suppress the ETA (an ETA with no driver is fiction) but return the last computed value separately so the UI can strike it through.
- **NO_APPT** — no `appointment_start_utc`.
- **TOMORROW** — appointment's calendar day in the **dispatch** timezone is after today. Not the stop's zone, not the browser's.
- **LATE** — projected ETA past the appointment by ≥30 min, or the appointment has passed with no arrival.
- **AT_RISK** — projected ETA inside 45 min of the appointment, or past it by <30 min.
- **ON_TIME** — everything else.

An active override returns the forced status, but the engine keeps computing the real one. The API always returns **both**, plus the override metadata, because the detail panel renders them adjacent.

ETA: phase 1 is straight-line distance × 1.25 road factor ÷ 52 mph, recomputed on each position update. Phase 2 swaps in a routing ETA behind an `EtaProvider` interface, cached per stop, recomputed only on meaningful movement or an appointment change. Never call a routing API per render or per poll.

Config in one object, no magic numbers scattered around: `riskBufferMinutes`, `lateThresholdMinutes`, `avgSpeedMph`, `roadFactor`, `staleMinutes`, `dispatchTz`.

**Offline rule — hard requirement.** When `feed_health.newest_position_at` exceeds the stale threshold, the API returns `feedStale: true` and the client withdraws schedule colour **fleet-wide**: every row drops to the stale treatment. A green row built on nine-minute-old GPS is worse than no row. Appointment times stay full strength because they come from our DB, not the feed.

## Timezones

Every displayed time goes through `Intl.DateTimeFormat` with the stop's IANA zone and `timeZoneName:'short'`, formatted at render. Abbreviations are never stored, never concatenated, never hardcoded.

Appointment writes take **stop-local wall time plus an IANA zone** and convert to UTC server-side. Never accept a UTC instant from the client for an appointment — a rate confirmation reading 14:30 means 14:30 at the receiver, and if the input is anything else the app will be silently hours wrong on real loads.

Unit tests must cover, with every date derived in the test and none pasted:
- An appointment in `America/Phoenix` (no DST).
- Both windows each year where US and EU DST boundaries are out of step — three weeks apart in spring, one week in autumn — and the dispatch-to-Belgrade gap is 6h instead of 7h.
- The repeated 01:30 on the US fall-back date.
- Midnight rollover of the TOMORROW rule in the dispatch zone.

## UI

Follow `docs/design-spec.md` for everything visual. The behaviour that isn't obvious from the drawings:

**Split** — draggable, default 60/40 in the list's favour, map hard minimum 520px, list minimum 560px, below 1086px total the split disables and the map becomes a toggle. Persist to `localStorage["ft.splitPct"]` on release, one decimal, fall back to 60 if missing or unparseable. Handle is focusable, `← →` move it 2%, `Home` and double-click reset. No column transition while dragging; defer the map reflow to drag-end.

**List** — virtualize with TanStack Virtual regardless of current fleet size. Column header sticky inside the scroller. Footer bar counts what's below the fold by status, including the explicit "0 problems below the fold" when that's true. Above 40 trucks, urgency becomes collapsible group heads with counts; On time and Tomorrow default collapsed.

**Map** — clustered, but **problem markers never cluster**; cluster counts include on-time and tomorrow trucks only. Markers differ by shape before hue. Selection is two-way: marker click scrolls and rails the row, row click pans the map, 120ms.

**Search** — debounced 250ms across truck number, driver, load number, city, state, destination. Filters list and map together. Never re-sorts, only removes rows. URL reflects search and filters so a dispatcher can send a colleague a link.

**Edit modal** — assignment group, stop-local-first appointment, stop and load, override and note. Zod schema shared client and server; server re-validates everything. Optimistic update with rollback, dirty-state guard, focus trap, Esc raises the discard confirm rather than closing silently, Cmd/Ctrl+Enter saves. Save disabled while any field is invalid or an override lacks a reason.

**Reassignment is a two-sided transaction.** Both trucks in one DB transaction and one audit entry: the gaining truck gets a new assignment row, the losing truck's assignment closes with an end timestamp. Never a window where one truck holds the driver and the other still claims them. The confirm dialog renders both sides from the **server's own preview** of the change, not the client's guess. Reversible from the losing truck's history for the rest of the shift.

## Quality bar

Server components by default. Skeletons, real empty states, panel-level error boundaries with a reference code — never a whole-screen failure. `.env.example` committed and every variable Zod-parsed at boot so a missing one fails loudly on start, not at 2am. `npm run check` runs typecheck, lint and tests and must pass before you call a phase done. README covering local setup, running the worker, applying migrations against Supabase, and seeding test data.

## Build order

Stop at the end of each phase, show me what works, wait for a go-ahead.

0. Read this brief and the design document. Produce `docs/design-spec.md` — the design extracted to plain markdown with the four corrections above already applied. No code this phase.
1. Scaffold, env validation, Supabase project wiring (both connection strings), Drizzle schema and migrations, RLS policies, Supabase Auth with the `profiles` role table, `npm run check` green.
2. Samsara client and ingestion worker. Positions landing in the DB, verified against the real account. Write the exact response fields you depend on into `docs/samsara.md` — fetch the official docs, don't guess the shapes.
3. Read-only console: map with clustering, virtualized list, two-way selection, search, draggable split.
4. Dispatch data: loads, stops, edit modal, reassignment transaction, audit log.
5. Status engine, colour coding, filter chips, footer bar, urgency groups, offline rule — with the full timezone test suite.
6. Hardening: roles enforced server-side, rate-limit tuning, Sentry, Playwright on the critical flows, deploy.
   **Clear the demo data before deploying — `npm run seed:demo -- --clear`.**
   **`npm run preflight` must pass before deploying — it is a gate, not a note.**
   The suite runs against a local Postgres (§12.32), which cannot exercise the
   real Supabase pooler. `prepare: false` in `createPooledDb` is the setting
   whose absence fails only under concurrency, in production, as a stall rather
   than an error. `preflight` is the only thing that checks it.
   Phase 4 seeded `DEMO-` loads and stops so the console and the status engine
   have something to compute against. They are kept deliberately through
   phase 5 and must not ship.

Tell me when something I've asked for is a bad idea, and why, before you implement it.
