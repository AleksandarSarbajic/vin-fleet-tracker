# Vin Logistics Fleet Tracker

Internal dispatch console. Full spec: `PROJECT_BRIEF.md` (read once, phase 0).
Design: `design/Fleet_Tracker_dc.html` — 1,927 lines, read in ranges, never
whole. From phase 1 onward build from `docs/design-spec.md`, not the HTML.

## Non-negotiable

- Samsara token and the Supabase secret key (`sb_secret_…`) are server-side
  only. Never `NEXT_PUBLIC_*`, never in a client bundle, never in a browser
  network tab. The browser gets the publishable key (`sb_publishable_…`) and
  nothing else. Do not use the legacy `anon` / `service_role` JWT keys.
- Browsers never call Samsara. One worker polls; every client reads our DB.
- All instants stored UTC with a separate IANA zone string. Appointments are
  entered as stop-local wall time and converted server-side. Never accept a
  UTC instant for an appointment from the client.
- Timezone abbreviations via `Intl.DateTimeFormat` at render time. Never
  stored, never concatenated, never hardcoded. Derive DST dates in code and
  in tests — never paste one.
- Two Supabase connection strings: pooler (6543, prepared statements off) for
  route handlers, direct (5432) for migrations and the worker.
- RLS enabled on every table with deny-by-default policies.
- No `any`. No unhandled rejections. No silent catches.
- No hex values in components. Semantic status out of the engine, token in the
  config, class in the component.
- `npm run check` (typecheck + lint + test) passes before any phase is done.

## Never build

- SMS or any driver notification. Nothing is sent to anyone.
- Dock/door validation against a facility door list. Free text only.
- Load-number format validation. Non-empty and trimmed, nothing more.
- Anything HOS-derived. We do not pull Hours of Service from Samsara.
- Any external geocoding service. Position strings come from Samsara's
  `gps.reverseGeo.formattedLocation`. No cache or debounce layer — there is
  nothing to cache.

If you think you need one of these, ask first.

## Working agreement

One phase per session. Stop at each phase boundary and wait for approval.
Say so when something I asked for is a bad idea, before implementing it.
Show command output rather than claiming something works.
