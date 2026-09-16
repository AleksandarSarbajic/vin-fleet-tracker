# How to run this project with Claude Code

This file is for you, not for the agent. Claude Code never reads it.

## Before the first session

Machine setup — Node, Claude Code, git, folder layout — is in
`MACOS_SETUP.md`. Do that first. Once it's done:

```
cd ~/Projects/vin-fleet-tracker
claude
```

Do **not** run `/init`. It generates its own `CLAUDE.md` by scanning the
codebase — there's no codebase yet, and yours is better. Use `/memory` if you
want to edit `CLAUDE.md` later.

## Credentials to have ready before phase 1

From the Supabase dashboard:

- **Project URL** — `https://<project-ref>.supabase.co`. Settings → Data API,
  or read the ref out of your dashboard URL.
- **Publishable key** (`sb_publishable_…`) — Settings → API Keys. Goes in the
  browser. If that page shows a "Create new API keys" button, click it first;
  your project is still on legacy keys.
- **Two secret keys** (`sb_secret_…`) — same page, create one named `web` and
  one named `worker`. Server only. Either can be rotated without breaking the
  other.
- **Both Postgres connection strings** — the Connect button at the top of the
  project. Pooler on port 6543 for the app, direct on 5432 for migrations and
  the worker.

Plus: Mapbox access token, Samsara org ID and API token (vehicle stats and
locations scopes only — no HOS).

Set a Mapbox billing alert the day you create the account. Mapbox has no hard
spend cap, and that's the only way this costs you anything.

## The shape of every session

1. `/plan` with the phase prompt below.
2. Read the plan. Push back if it's wrong. Approve.
3. It builds. Answer its questions; don't micromanage.
4. `/diff`, then `npm run check`, then `/code-review`, then commit, then `/clear`.

Commit at the end of every phase. Once a session is cleared, git is your only
reliable undo.

## Commands you'll actually use

| Command | When |
|---|---|
| `/plan <task>` | Start of every phase. Read-only until you approve. |
| `/context` | Feels sluggish or repetitive — shows what's filling the window. |
| `/compact` | Context filling up mid-phase, work not finished. |
| `/clear` | Phase finished, starting the next. Keeps CLAUDE.md, drops the chat. |
| `/diff` | Before approving a phase. |
| `/code-review` | End of each phase. `--fix` applies the findings. |
| `/security-review` | End of phases 1, 2 and 6. |
| `Esc` | Interrupt mid-answer when it's going the wrong way. |
| `Esc Esc` or `/rewind` | Roll code and conversation back to a checkpoint. |
| `/resume` | Reopen an earlier session you cleared away from. |

---

# Phase 0 — Extract the design

```
/plan Read CLAUDE.md and PROJECT_BRIEF.md in full.

Then read design/Fleet_Tracker_dc.html — in ranges, not all at once. It is
1,927 lines and reading it whole will fill the context window. Grep for
`class="dv-opt" id=` to get the section map first, then read the sections
you need.

Deliverable: docs/design-spec.md — a plain markdown extraction covering the
token palette with its measured contrast ratios, the type scale, layout and
breakpoints, the status system with every state's colour/shape/icon/label,
truncation order, keyboard map, motion rules, and each screen's behavioural
notes. Everything the build needs, none of the inline styles.

Apply the four corrections listed in PROJECT_BRIEF.md as you extract, so the
spec is correct from the start rather than needing patching later.

Nothing else this session. No scaffolding, no package.json, no code.
```

**Before approving:** its plan must say it will read the HTML in ranges. If it
proposes reading the whole file, stop it and make it re-plan.

**Closing:** read `docs/design-spec.md` yourself — it's short enough to check,
and everything downstream depends on it. Look hardest at the status table and
the token block.

```
Commit this as "docs: extract design spec". Then tell me anything in the
design that is ambiguous or that you would have to guess about when building.
```

---

# Phase 1 — Foundation

```
/plan Phase 1 from PROJECT_BRIEF.md: scaffold, Supabase wiring, schema, auth.

Build docs/design-spec.md into the Tailwind config now — tokens and type
scale only, no components yet.

Specifically:
- Next.js App Router, TypeScript strict, Tailwind, shadcn/ui
- Zod-validated env parsing that fails loudly at boot on a missing variable
- Both Supabase connection strings wired correctly: pooler on 6543 for route
  handlers with prepared statements disabled, direct on 5432 for migrations
  and the worker
- Drizzle schema for every table in the brief, migrations committed
- RLS enabled on every table with deny-by-default policies
- Supabase Auth plus the profiles table with the role column
- npm run check wired to typecheck + lint + test

Stop before any UI beyond a login page and an empty shell.
```

**Before approving:** the plan must show two distinct connection strings used
in two distinct places. Getting this wrong produces intermittent failures that
look like application bugs months later.

**Closing:**

```
/diff
```
```
Run npm run check and show me the output. Then run /security-review on this
diff — I want confirmation that no Supabase secret key (sb_secret_…) or
Samsara token can reach a client bundle.
```

---

# Phase 2 — Samsara ingestion

```
/plan Phase 2 from PROJECT_BRIEF.md: the Samsara client and ingestion worker.

Before writing the client, fetch the current Samsara REST docs at
developers.samsara.com and write docs/samsara.md recording the exact
endpoints and the exact JSON field paths you will depend on. Do not guess
response shapes from memory.

Use the vehicle stats feed endpoint with a DB-persisted cursor. Take the
position string from gps.reverseGeo.formattedLocation — Samsara reverse-
geocodes for us and we call no geocoding service.

Do not request or read any HOS data.

The worker is a standalone Node process (npm run worker) on a direct Postgres
connection, never the pooler. Token bucket limiter, exponential backoff with
jitter on 429 and 5xx, circuit breaker, a log line per throttle event, and a
feed_health heartbeat row on every cycle.
```

**Before approving:** it should say it will fetch the docs first. If it starts
writing a client from memory, stop it.

**Closing:**

```
Run the worker against the real account for five minutes and show me: how many
vehicles came back, one full raw JSON response, and the rows it wrote. Then
show me what happens when the Samsara token is invalid and when the API
returns 429.
```

---

# Phase 3 — Read-only console

```
/plan Phase 3 from PROJECT_BRIEF.md: the read-only console.

Build to docs/design-spec.md exactly — tokens, type scale, row grid, column
widths. Remember the corrected grid: Appt 128 and Status 128 together, the
extra width coming out of Position and Next stop.

In scope: Mapbox GL JS via react-map-gl with supercluster, the virtualized
truck list, two-way selection between row and marker, search, the draggable
persisted split, the sticky column header, the footer bar.

Not in scope: editing anything, the status engine. Use a hardcoded status per
truck for now so the colours are visible, with a clear TODO marking where the
real engine plugs in.
```

**Before approving:** ask how it plans to keep marker rendering smooth while
positions update every 30 seconds. No answer means that bug arrives in phase 6
instead of now.

**Closing:** open it and click around yourself first. Then:

```
/code-review
```
```
Compare what you built against docs/design-spec.md section by section and list
every place the implementation differs from the spec, including differences you
made deliberately. Do not fix anything yet.
```

---

# Phase 4 — Dispatch data

```
/plan Phase 4 from PROJECT_BRIEF.md: loads, stops, the edit modal, the
reassignment transaction, the audit log.

The two things that must be right:

Appointments are entered as stop-local wall time plus an IANA zone and
converted to UTC server-side. The API never accepts a UTC instant for an
appointment from the client. Get this wrong and the app is silently hours
wrong on real loads.

Reassignment writes both trucks in one transaction and one audit entry: new
assignment row on the gaining truck, end timestamp on the losing truck's row.
Never a window where one truck has the driver and the other still claims them.
The confirm dialog renders both sides from a server-side preview of the
change, not a client guess.

Zod schema shared client and server, server re-validates everything,
optimistic update with rollback, dirty-state guard, focus trap, Esc raises the
discard confirm.

Every dispatcher edit writes audit_log.
```

**Before approving:** make it show you the appointment write path end to end —
what the client sends, what the server converts, what lands in the column.

**Closing:**

```
Write me a test that saves an appointment for a Phoenix receiver at 14:30
local, and assert the stored UTC instant is correct in both July and January.
Then write one that reassigns a driver between two trucks and asserts no
intermediate state exists where both or neither truck holds them.
```

---

# Phase 5 — Status engine

```
/plan Phase 5 from PROJECT_BRIEF.md: the status engine, colour coding, filter
chips, footer bar, urgency groups, offline rule.

lib/status.ts is pure functions, no I/O, fully unit tested. It emits a
semantic status; the UI maps status to token. No hex values anywhere near
this file.

The eight states and their order are in the brief. Remember: no HOS clause in
the At risk rule. UNASSIGNED is computed, never stored, and suppresses the ETA
while returning the last computed value separately so the UI can strike it
through. Override expiry is evaluated on read, never by a scheduled job.

The offline rule is a hard requirement, not a nicety: when the feed goes stale
the API returns feedStale and the client withdraws schedule colour fleet-wide.
Appointment times stay full strength.

Timezone tests must derive every DST date in the test itself. Never paste one.
Cover Phoenix, both windows where the US and EU boundaries are out of step,
the repeated 01:30 on the US fall-back, and midnight rollover of the TOMORROW
rule in the dispatch zone.
```

**Before approving:** the plan must show `lib/status.ts` with no imports from
the DB layer. If the engine fetches its own data it becomes untestable.

**Closing:**

```
Show me the full test output. Then show me the status engine file. I want to
read every rule myself.
```

Read it properly. This is the file that decides whether a dispatcher calls a
broker at 4am.

---

# Phase 6 — Hardening and deploy

```
/plan Phase 6 from PROJECT_BRIEF.md: hardening and deploy.

Roles enforced server-side on every mutating route — never trust a role claim
from the client. Rate limit tuning against real Samsara traffic. Sentry.
Playwright on the critical flows: login, find a truck by search, edit an
appointment, reassign a driver, feed goes stale.

Deploy the app to Vercel and the worker to its own host. Document both in the
README, including how to apply migrations against Supabase and how to seed
test data.

Set up a Mapbox billing alert and tell me where to find it.
```

**Closing:**

```
/security-review
```
```
Now give me an honest list of what is weak, unfinished or likely to break
first in production. Not a summary of what works — the parts you would fix
next if this were yours.
```

---

# When it goes wrong

**Editing files you didn't ask about** → `Esc`, then `Esc Esc` to rewind code
and conversation to before the detour.

**Repeating fixed mistakes or re-explaining itself** → `/context` to confirm
the window is full, then `/clear` and restate the current task in three
sentences.

**Claims something works** → ask for the command output, not the claim. "Show
me the actual test output" catches this every time.

**Proposes something on the Never-build list** → point at CLAUDE.md by name
rather than arguing the case.

**A phase runs past one session** → `/compact` once, finish, commit, `/clear`.
Don't stretch a phase across three sessions; you'll lose the thread and so
will it.
