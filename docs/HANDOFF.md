# Handoff

State on 2026-10-14. Phases 3a and 3a-2 of the language-model reader are
done, local only: the evaluation PREP, and a second redaction pass that lets
all 25 text-layer samples be prepared. Nothing was sent anywhere and the API
key was not used. Phase 2b and its follow-up are built: the Anthropic
adapter, behind `LLM_READER_ENABLED` (off by default; OFF in production until
2026-10-15, ON in production since: see "What is live"). On 2026-10-14 it had
been called live only with invented text.
See "Language-model reader" below. `npm run check` passed on 2026-10-14
(170 files, 2503 tests).
`git log` has the newest; the deploy is checked with the curl calls under
"How to run the checks".

Read `CLAUDE.md` first. Build from `docs/design-spec.md`; each feature below
names its § there.

## What is live

**The AI reader is live since 2026-10-15:** deployed at `cc0e60d`, in
production behind `LLM_READER_ENABLED`, with the caps 25 a user and 100 a day
(the defaults, 2b). Who reported what, and what is unverified: "Next",
section 1. The table below lists only older commits.
**Not deployed yet:** a fifth template, Route blocks (3aa, `c59042e`), is
committed and not pushed.
**3aq: NOT pushed** (2026-10-28): unexpected route errors reach Sentry,
without their messages. See "Phase 3aq" below.
**3ar: NOT pushed** (2026-10-28): no server error event carries text, and
the route console line drops the message. See "Phase 3ar" below. Neither is
on origin: its master is `ad04eb9`.
**Update at the start of 3as (2026-10-28): 3aq and 3ar are pushed**: origin's
master was `86084fd`. Whether Vercel has deployed them is not checked here.
**3as: NOT pushed, worker NOT deployed** (2026-10-28): the worker sends no
error text to Sentry. See "Phase 3as" below.
**3as LIVE (2026-10-28):** pushed (`86084fd..17865af`), and the worker
deployed at `17865af` at 15:14 UTC, verified (see "Phase 3as", "Deployed").
3as changed no app behaviour. Its Vercel deploy is not checked here.
**3at (2026-10-28):** next 15.5.28, sharp 0.35.5 and source-map-js 1.2.2,
patches only, with no code change. Committed for the phase's one authorised
push. The push and Vercel's deploy are recorded in "Phase 3at". The worker
is not redeployed and does not load these packages.
**3ap: NOT pushed** (2026-10-28): Currently, the truck's live chip and
position on /assignments. Seven assignments baselines differ and none is
re-saved; the advisor reviews the images first. See "Phase 3ap" below.
**3ap follow-up (2026-10-28):** the picker capped at 300 (Alex), and all 8
assignments baselines re-saved and committed. Still NOT pushed.
**3av: NOT pushed** (2026-10-29): one helper for the status chip's props,
and the map popup's chip withdraws its colour on a stale feed (§5.9). See
"Phase 3av" below.
**Update at the start of 3aw (2026-10-29): 3av is pushed**: origin's
master was `9e688d8`. Its deploy is not checked here.
**3aw: NOT pushed** (2026-10-29): the map popup's Position, Projected and
Computed lines on a dead feed read as the phone sheet's (§12.146). See
"Phase 3aw" below.
**3ax: STOPPED after its first template, NOT pushed** (2026-10-29): a
seventh template, `stop-detail`, committed; it changed an existing sample's
score, the brief's gate, so the phase waits for Alex. See "Phase 3ax" below.
**3ay: NOT pushed** (2026-10-29): 3ax continued on Alex's answers: four more
templates (eleven in all), `stop-detail` reads a window, `stop-table` finds a
spaced phone (§12.147). See "Phase 3ay" below.

| Commit | What | § |
|---|---|---|
| `4ad77ae` | The zone follows the state; a two-zone state asks, and Save waits | 12.120 |
| `c43adac` | Paste an address into Street: fills street, city, state, ZIP | 12.121 |
| `6e90a91` | Baseline 7c pinned at its list position, then waits for stillness | — |
| `52452ca` | Fill a new load from a rate confirmation PDF, read in the browser | 12.122 |
| `aed14ae` | Baseline 7f re-saved with the one-line fill strip | 12.122 |
| `ccddd9b` | E2e runs say at the end whether the machine slept | — |
| `99365d0` | The board says "Not updating" when its poll has stopped | 12.123 |
| `2eba5a1` | React #418 fixed: the board hydrates as the server rendered it, in any zone and on any clock | 12.124 |
| `a89504d` | The hydration e2e runs in a browser zone the server is not in | 12.124 |
| `9e13148` | A fourth reader: Pickup # / Delivery # columns, load number beside "Arrive Order" | 12.125 |

PDF fill reads four layouts: label rows, a Stops section, PU/SO blocks,
and Pickup # / Delivery # columns. It never sends the file anywhere.

**Local samples (28 PDFs in `.samples/`, triaged 2026-10-13, counts only).**
This replaces the 21-PDF count of 2026-10-09.
- 13 read: 1 label rows, 3 Stops section, 6 PU/SO blocks, 3 Pickup/Delivery
  columns. The same 13 as on 2026-10-09; none of the new files is read.
- 3 scans with no text layer.
- 12 not recognised, all with a text layer (was 5).
- Every read file filled its load number and every address field. 25 of 26
  appointment times were filled; the one missing time blocks Save until it is
  typed (item (a), not touched). 16 of 26 stops are marked Check.
- `expected.json` (ground truth) covers only 7 of the 28: six read files, all
  passing the bar with no appointment silently wrong, and the "Route #" file,
  correctly refused. The other 21 have no ground truth, so
  `npm run ratecon:score` skips them. The 7 read files among them filled every
  field, but that is not checked against what the PDF says.
- 10 PDFs carry the date 2026-10-13, though only 7 are net new. So 3 earlier
  files were replaced or re-saved: two of the three scans and one not
  recognised file. Ask Alex whether these are the unsigned originals in (c).
  If so, the two scans still have no text layer.

**The 12 not recognised: new layouts, not old ones changed.** None has more
than one of any existing layout's `recognise` labels, and the labels it
does have are common words.

**Clustered by shared lines, 2026-10-13: 8 clusters.** For each pair of the
12 files, the number of identical distinct lines they share (trimmed,
whitespace collapsed), divided by the smaller file's distinct-line count.
Clusters are single-linkage at a ratio of **0.10** or more.

| Cluster | Size | Files | Ratios within |
|---|---|---|---|
| C1 | 3 | #2, #4, #10 | 0.12–0.24 |
| C2 | 2 | #16, #17 | 0.66 |
| C3 | 2 | #7, #11 | 0.22 |
| C4–C8 | 1 each | #8, #9, #12 (the 9-page "Route #" file), #21, #28 | ≤ 0.05 to any file |

How 0.10 was chosen, on the 13 read files, whose layouts are known:
- Pairs from different layouts: 57 pairs, never above 0.02.
- Pairs within one layout: Stops section 0.86–0.92, Pickup/Delivery columns
  0.74–0.76. PU/SO blocks range from 0.02 to 0.83 (median 0.02).
- So 0.10 sits above every cross-layout pair. A ratio that high means the
  same source.

Caveats:
- **C1 and C3 may split.** At 0.12–0.24 they are well above the cross-layout
  ceiling but well below a clean same-layout score. That fits template
  versions from one broker as well as one layout.
- **Singletons may merge.** The metric cannot see layouts like PU/SO, where
  label and value share a line, so two files of one such layout can share
  almost no lines.
- **Best estimate:** 8 layouts, with a likely range of 7 to 10.
- **Strongest single layout:** C2, at 0.66, close to the known same-layout
  scores.

File numbers are by name order across the 28 PDFs in `.samples/` as of
2026-10-13. They shift whenever a file is added, renamed or removed, so check
the count is still 28 before using them. No names or values are written down
anywhere.

## Rules for rate confirmations (from Alex, standing)

- Real PDFs live only in `.samples/` (git-ignored). Never commit, copy, upload,
  log or screenshot them. Tests use invented fixtures only
  (`src/test/ratecon-fixtures.ts`, `src/test/tiny-pdf.ts`).
- No report prints a rate, broker contact, phone, email or driver name.
- No real document goes to any outside service. Do not choose a vendor.
- `git ls-files | grep -iE "\.pdf|expected\.json|samples"` must print nothing.

## Decided by Alex, 2026-10-13

- **Sentry hydration filter: keep it.** The Sentry config is not changed.
  (Was open decision 4.)
- **FCFS windows, question (b): yes.** A start and end more than two hours
  apart, filled as FCFS receiving hours and marked Check, is what Alex would
  enter. The rule in `design-spec.md` (Appointments, under §12.122) stays as
  it is.

**The language-model reader** (design: [`llm-reader-design.md`](llm-reader-design.md)):

- **Sending is allowed,** redacted text only: rates, broker contacts,
  phones, emails and driver names are stripped in the browser before
  anything leaves. (Was open decisions 1 and 2. The basis for "allowed" is
  still to be written down; see below.)
- **Templates stay first;** the model is the fallback after "Layout not
  recognised". No more templates are built.
- **Scans** are read later, by OCR in the browser (phase 4).
- **Not authorised:** sending any text from `.samples/` to any vendor. That
  needs its own go-ahead.
- **The design's §10:**
  - Item 1, yes: a per-stop **Looks right** button. AI marks are their own
    kind, counted and cleared apart from "Check". Phase 1 built the data
    side; the button and strip text are phase 2.
  - Item 2, yes: a **Show what is sent** expander, phase 2. Phase 1 makes
    the sent text available as one value.
  - Item 3, out of scope, **a decision for later**: the shared rate limiter
    (`src/server/rate-limit.ts`) keeps its buckets in memory, which is weak
    on Vercel, where each instance has its own. The reader's real guard is
    its daily cap in Postgres. Also, `PROJECT_BRIEF.md` around line 310 still
    says no route is rate-limited; that is stale (at least ten are).
  - Item 4, accepted: redaction cannot promise that unlabelled names are
    stripped.
- **Defaults accepted:**
  - 25 reads per user per day, 100 per day in all;
  - dispatchers and admins;
  - dates with no year only inside the −1/+30 day window, with exactly one
    candidate year;
  - counts kept 90 days.

**The language-model reader, phase 2a** (Alex, 2026-10-13):

- **UI per the design's §10:**
  - "Read with AI" only after a template miss;
  - "Show what is sent" (the redacted, numbered lines, browser only);
  - a per-stop "Looks right", with the source quote beside each field;
  - a separate confirm for the load number;
  - AI marks counted apart from "fields to check".
- **Today's date,** in the dispatch zone, goes with each request, so a
  date with no year can be read. The verifier stays the judge of the year.
- **The shared limiter's weakness** is a later decision. The Postgres
  daily cap is the real guard. Caps are env vars: 25 a user, 100 in all.
- **Still open:** vendor, EU processing, flagged content, the basis for
  "allowed". Build nothing vendor-specific.

**Phase 2b: the vendor** (Alex, 2026-10-13/14):

- **Anthropic.** Model `claude-haiku-5-5` from `LLM_READER_MODEL`;
  `claude-sonnet-5-5` is the fallback, by env only. The env schema accepts
  only those two exact ids (Fable and Mythos force 30-day retention; Opus
  costs far more).
- **The key** is `LLM_READER_API_KEY` in `.env.local`. Never opened, printed
  or quoted; read only through the env schema or `node --env-file`. A $5
  prepaid balance with a spend limit is all the money at risk.
- **Live calls:** invented text only, at most 5 this phase, through
  `npm run reader:smoke` (needs `READER_SMOKE=yes`). Nothing from
  `.samples/` (phase 3, separately approved).
- **Request rules:** no temperature/top_p/top_k, no forced tool_choice, no
  prefill; structured outputs; effort `low` and no thinking parameter, as
  constants; `maxRetries: 0`; 25 s; bounded `max_tokens`; only the lines,
  the instruction and today's date.
- **A new code, `vendor_capped`,** for the account's own spend limit: "The
  AI reader's spending limit is reached. Tell an admin."
- **Misconfigured** (on, `anthropic`, no key or no model): reader off, one
  log line, never a crash.

**Phase 2b follow-up: config safety** (Alex, 2026-10-14):

- **The reader's settings fail CLOSED.** They are parsed apart from
  `AppEnv`. Any problem turns the reader off, logs one server line naming
  the setting, never its value, and never stops the app booting: unknown
  vendor, model outside the allow-list, invalid caps, missing key or model,
  the fake in production, a flag that is neither on nor off. A blank cap is
  the default.
- **One exception:** a key equal to any `NEXT_PUBLIC_*` value still refuses
  boot.
- **A synthetic key in the e2e run,** and an e2e spec that scans the build's
  static files for it.
- **`inference_geo` stays `global`** (standard price; `us` is 1.1×). This
  closes the open question from 2b.
- **A prepaid balance run dry** is the likeliest limit: map it to
  `vendor_capped` only if Anthropic documents it, otherwise keep it
  `unavailable` with the status in the log. Outcome: below.

**Closing phase 2a** (Alex, 2026-10-13):

- **The e2e server's reader settings** come from the `e2e` script in
  `package.json` (`df97d08`): `LLM_READER_ENABLED=true
  LLM_READER_VENDOR=fake LLM_READER_FAKE_SCRIPT=e2e/.fake-reader.json
  playwright test`. `playwright.config.ts` is not touched. `npm run gate`
  runs `npm run e2e`, so it gets them too. `e2e:ui` does not; run the AI
  spec there with the three variables set by hand.
- **The `b0bc35b` comparison for the baseline flake is skipped.** See
  "The 'Synced 0s ago' flake" below for the reason.

**The AI reader's use and redaction** (Alex, 2026-10-15):

- The AI reader is for Vin Logistics' own dispatch use only. Alex accepts that
  redacted rate-confirmation text goes to Anthropic (Haiku 5.5, default
  retention) and that an unlabelled person name can still go through.
  Redaction stays at `redact-2026-10-14.5` and is not extended or removed; no
  further redaction phases unless Alex asks. No new ground truth unless Alex
  wants a scored test of a new layout. New layouts are judged by Alex comparing
  the filled form to the PDF, and after launch by the outcome counts (3s
  queries).
- Three more decisions, same day (Alex, 2026-10-15, stated in chat):
  - **EU processing is not required.** Vin Logistics, its brokers and its
    drivers are not in the EU, so Anthropic's lack of EU processing is not a
    blocker.
  - **The basis for "sending is allowed" is business judgment, not the
    brokers' confidentiality clauses.** Alex describes this as an internal
    testing app and accepts the risk that a broker's rate confirmation may say
    it is confidential.
  - **The Anthropic account spending limit is set.** Which account or
    workspace it is on is unverified. A separate production key is not yet
    done. **Since done** (Alex reports, 2026-10-15): see "Next", section 1.

**The e2e flakes and the deploy gates** (Alex, 2026-10-16; the four
questions of phase 3ae):

- **Changing how the login is checked so the tests do not depend on
  Supabase: no.** It would weaken production security — with `getClaims()`
  in place of `getUser()`, a revoked login would keep working until its token
  expired — only to make the tests less sensitive to the network.
- **Run deploys on a steady setup: yes.** The advisor said "that's the whole
  fix", and Alex agreed. 3ae's runs were on battery with Low Power Mode on,
  and the probe saw the stalls on the path to hosted Supabase.
- **Retries or longer waits: no.** They hide real problems, and a 15 s stall
  would outlast them anyway.
- **Printing connection timings at the end of each e2e run: not now.**
  Revisit only if e2e fails again on a good connection.

## Open decisions, waiting on Alex

1. **The language-model reader's vendor: Anthropic** (decided
   2026-10-13/14; see above). Nothing is still open with it: EU processing,
   flagged content and the basis for "sending is allowed" are decided (below).
   - ~~EU processing:~~ ~~is it required? If so, Anthropic's own API is out
     today.~~ Decided 2026-10-15: not required; see "The AI reader's use and
     redaction", above.
   - ~~Flagged content:~~ ~~is the vendors' retention of flagged inputs
     acceptable (up to 2 years at Anthropic)?~~ Decided 2026-10-15:
     accepted; see "The AI reader's use and redaction", above.
   - ~~The basis for "sending is allowed":~~ ~~the brokers' confidentiality
     clauses, or a business judgment? Write down which.~~ Decided 2026-10-15:
     business judgment; see "The AI reader's use and redaction", above.
2. ~~Broker confidentiality.~~ Folded into 1, above.
3. **Vendor terms.** Researched 2026-10-09; see
   [`llm-reader-vendors.md`](llm-reader-vendors.md) (vendor defaults, may
   change, not legal advice). In short:
   - Every vendor read says no training on API data by default, except
     Mistral, which is unconfirmed.
   - Anthropic's own API has no EU processing option today.
   - AWS Bedrock stores no prompts by default, except for some models.
   - Azure, OpenAI and Google offer EU processing, each with conditions.
   - Still to read: data-processing agreements, sub-processors, what
     "flagged" means in practice, and SOC 2/ISO reports.
4. ~~Sentry hydration filter.~~ Decided 2026-10-13: keep it (above). The
   Sentry project drops React hydration errors on arrival, which is why #418
   never showed as an issue. The tracing report still waits for 10+ real
   sign-ins.
5. **Sleep test.** Alex runs e2e, closes the lid mid-run, and confirms the
   end-of-run line names the sleep.
6. **The "worker feeding knowledge" question**, as Alex named it on
   2026-10-09. It isn't written down in any session so far: get the question
   from Alex before doing anything with it.
7. **The 9-page "Route #" layout** (4 stops; correctly refused today): is
   "Route #" the load number; what does "Scheduling: Open" mean; can more
   samples from that broker be had? Not the same as the Pickup/Delivery
   columns reader, which is built.
8. **Stage 4 scope.** The window-order and date-range checks cover filled
   stops only. Should typed stops get them too?

## React #418: fixed

Fixed in `2eba5a1` (§12.124). The header's "YOU" clock and the dispatch
clock's title read the viewer's zone while rendering. "Not updating" compared
the server's fetch instant with the browser's clock. Both now wait until the
page has loaded.

- `src/components/console/hydration.test.tsx` renders the whole board under
  `TZ=UTC` and hydrates it in Europe/Belgrade, and again with the browser's
  clock 5 minutes behind.
- The e2e "the console hydrates without a React hydration error"
  (`e2e/console.spec.ts`) now runs in a browser zone the server is not in.
  It also matches the production wording ("Minified React error #418"). On
  the pre-fix code it fails with exactly that error.
- In Sentry: filtered hydration errors arrived nearly every day up to the
  13:00 UTC hour on 2026-10-09. None arrived after the fix went live at 14:14
  UTC (checked 16:33 UTC). At a few a day, a longer window is still worth a
  look.

## How to run the checks

```sh
npm run check            # typecheck + lint + vitest (starts the test DB on 127.0.0.1:55432)
npm run e2e              # Playwright: builds once, then runs; baselines in e2e/__screenshots__
npm run ratecon:score    # only if .samples/ exists; prints pass/fail per field per file, never values
npm run gate             # check + preflight + db:verify + e2e
```

- Test databases: `fleet_test` (vitest), `fleet_e2e`, `fleet_commit`. Never
  commit into `fleet_test`.
- Baselines: if any moves, stop and show Alex the diff before re-saving. Do
  not change the Playwright config.
- Deploy status: `gh` is not installed. Curl
  `https://api.github.com/repos/AleksandarSarbajic/vin-fleet-tracker/deployments?per_page=3`,
  then `/deployments/<id>/statuses?per_page=1`.

## Language-model reader

**Phase 1:** pure code and tests — redaction, the schema, the verifier, the
`model` fill branch, the fake. Phase 2a (below) calls it.

| File | What |
|---|---|
| `src/lib/ratecon/redact.ts` | Page selection (page 1 and pages with a US city line), typed placeholders, fail-closed re-scan, `REDACTION_VERSION`, size limits; `prepared.text` is the sent text for "Show what is sent" |
| `src/lib/ratecon/nanp-area-codes.ts` | The static set of assigned North American area codes rule A reads (hand-entered snapshot; not exhaustive of future codes) |
| `src/lib/ratecon/model-read.ts` | The `ModelRead` schema (`zod/v4`, inside the installed zod), the shared instruction, the JSON schema for vendors |
| `src/lib/ratecon/verify-read.ts` | Every value checked against the lines sent; what stands becomes a `model` read |
| `src/components/edit/ratecon-fill.ts` | The `model` branch: AI marks (`aiMarks`, `confirmAiStop`, `confirmAiLoadNumber`), apart from "fields to check" |
| `src/server/ratecon-reader/adapter.ts`, `fake.ts` | The vendor interface (types only) and a scripted fake |
| `src/test/model-read-fixtures.ts` | Invented documents; every line carries a sentinel |

**Phase 2a is built:** the route, the counts table, the UI and the Sentry
hardening, through the FAKE vendor only. No real adapter, no vendor SDK,
no network call to any vendor. `LLM_READER_ENABLED` is off by default.

| File | What |
|---|---|
| `src/app/api/ratecon/read/route.ts` | `POST /api/ratecon/read`; wires the live dependencies |
| `src/server/ratecon-reader/handle-read.ts` | The route's body: limits, role, flag, body checks, then the daily-cap reservation, the vendor under 25 s, the reply's schema. Never lets an error escape |
| `src/server/ratecon-reader/reads.ts`, `drizzle/0026_ratecon_ai_reads.sql` | The counts table (no text column, RLS deny-all) and the atomic daily caps (advisory lock); applied to the LOCAL test databases only |
| `src/server/ratecon-reader/live.ts` | Settings from the env; `readerOffered(role)` for the page; the fake's script from `LLM_READER_FAKE_SCRIPT` |
| `src/server/ratecon-reader/log.ts` | The route's one log line: reference, code, error class name, vendor status |
| `src/lib/ratecon/read-codes.ts`, `read-client.ts` | The wire contract and the browser's call (35 s, Cancel) |
| `src/lib/sentry-reader.ts` | `scrubReaderEvent` and `withoutAiIntegrations`, wired in `sentry.server.config.ts` |
| `src/components/edit/RateconStrip.tsx`, `StopForm.tsx`, `LoadStrip.tsx`, `Field.tsx` | Read with AI, Show what is sent, Cancel, the AI marks, Looks right, the load number's confirm |
| `e2e/ratecon-ai.spec.ts` | Through the route and the fake. Runs under `npm run e2e`, which gives the server the reader's env. It still skips, and says why, on a server where the reader is off |

**Phase 2b is built:** the Anthropic adapter. OFF in production until
2026-10-15; deployed and ON since (see "What is live").

| File | What |
|---|---|
| `src/server/ratecon-reader/anthropic.ts` | The adapter: the request, the schema Anthropic is sent, every outcome as a code. Imports `server-only` and the SDK; never throws, never logs |
| `src/server/ratecon-reader/live.ts` | `readerWiring`: `anthropic` with its key and model, or OFF with the missing settings named, logged once |
| `drizzle/0027_ratecon_ai_anthropic.sql` | `anthropic` (vendor) and `vendor_capped` (outcome). Applied to the LOCAL test databases only |
| `scripts/reader-smoke.mts` | `READER_SMOKE=yes npm run reader:smoke`: ONE live call with the invented fixture |
| `src/test/reader-key-bundle.test.ts` | The key cannot reach the browser bundle, shown from the import graph |

**Env (server only):** `LLM_READER_ENABLED`, `LLM_READER_VENDOR` (`fake` or
`anthropic`), `LLM_READER_MODEL` (`claude-haiku-5-5` or `claude-sonnet-5-5`,
nothing else), `LLM_READER_API_KEY`, `LLM_READER_FAKE_SCRIPT`,
`LLM_READER_USER_DAILY_CAP` (25), `LLM_READER_DAILY_CAP` (100). Listed in
`.env.example`.

**How they are read (2b follow-up):** `parseReaderEnv` (`src/env/schema.ts`),
exported parsed as `readerEnv` from `src/env/server.ts`. It never throws.

- **Checked only when the flag is on,** and then only what the named vendor
  uses: the fake needs no key or model, Anthropic no script.
- **Any problem** turns the reader off: no button, and the route says
  `disabled`. `live.ts` logs it ONCE per server instance:
  `ratecon reader is off: its settings have problems`,
  `{ problems: [{ setting, fault }] }`.
  - The faults are fixed words: `missing`, `invalid`, `not allowed`,
    `refused in production`.
  - No value is ever logged.
- **`AppEnv` reads only the key,** for its one boot refusal: the key may
  equal no `NEXT_PUBLIC_*` value.
- **Tests:**
  - `schema.test.ts`: every case, each problem named.
  - `app-env.test.ts`: the real `@/env/server` loads with every bad value at
    once, and still refuses a published key.
  - `live.test.ts`: not offered, `disabled`, one log line with no value.

**The key in the browser bundle, checked on the build (2b follow-up):**

- **The synthetic key:** the `e2e` script sets
  `LLM_READER_API_KEY=sk-ant-e2e-SYNTHETIC-not-a-real-key-4f1c9a` and
  `E2E_READER_KEY_SCAN=1`. Playwright's `webServer` inherits them, so the
  e2e build and server start with them. `playwright.config.ts` is not
  touched.
- **The spec,** `e2e/reader-key-bundle.spec.ts`, scans every file under
  `.next-e2e/static` (the e2e build's directory) for that key.
  - A control first: the e2e Sentry DSN, which Next does inline, must be
    found by the same scan.
  - Skipped unless `E2E_READER_KEY_SCAN=1`, so the real key is never read
    or compared.
- **Run 2026-10-14:** `npm run e2e -- e2e/reader-key-bundle.spec.ts
  e2e/ratecon-ai.spec.ts` gave 3 passed (setup, the AI spec, the scan).
- **Mutation:** the key planted as a literal in `RateconStrip.tsx` (split
  and joined; the minifier folded it back) made the scan fail on
  `.next-e2e/static/chunks/app/page-….js`. Reverted.

**A prepaid balance run dry (2b follow-up):**

- **What Anthropic documents:** the message only. On
  [API credits for Max and Team plans](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers),
  under "When the balance is exhausted, requests return":
  "Your credit balance is too low to access the Anthropic API. Please go to
  Plans & Billing to upgrade or purchase credits."
  - The HTTP status and error type are NOT documented, and the errors page
    does not mention it. Read 2026-10-14.
- **So the message is matched on any 4xx** (its prefix, `Your credit balance
  is too low`) and is `vendor_capped`. On a 5xx it stays `unavailable`.
- **The status always reaches the log:** every vendor failure is logged with
  its `vendorStatus`. A test sends the credit message on a 400 and finds
  `{ code: 'vendor_capped', vendorStatus: 400 }` in the one log line; an
  undocumented 4xx logs `{ code: 'unavailable', vendorStatus: 400 }`.
- **Caveat:** the page is about Max and Team credits, but its wording
  ("if the organization has no credits left") covers any exhausted
  organization balance.

**Not applied anywhere but the local test cluster:** migrations 0026 and
0027. Both must be applied to production before the route can count there.

**The smoke runs, 2026-10-14** (`claude-haiku-5-5`, the invented
UNKNOWN_LAYOUT fixture, 20 lines). 4 of the 5 allowed calls; one unused.

| Run | Outcome | What it showed |
|---|---|---|
| 1 | `unavailable (HTTP 400)` | A 400 that was not the spend limit. The adapter, rightly, says no more |
| 2 | `unavailable (HTTP 400)` | The script now prints a 4xx's type and message: "The compiled grammar is too large… Simplify your tool schemas" |
| 3 | the same | Every property required, the nullable flag one enum: not enough |
| 4 | `ok` | Each reused part defined once under `$defs`. Tokens: input 3117, output 1565. `ModelRead` passes; verified: 10 values stood, 0 did not |

**Measured cost** (Anthropic's pricing page, read 2026-10-14). A 400 bills
nothing; run 4 billed 3117 input and 1565 output tokens.

| Model | Input | Output | One read |
|---|---|---|---|
| Haiku 5.5, measured (prompt ≤ 100K: $0.10 / $0.50 per MTok) | $0.00031 | $0.00078 | **$0.0011** |
| Sonnet 5.5, the same tokens ($2 / $10 per MTok) | $0.0062 | $0.0157 | $0.022 |

- **At the daily cap of 100 reads:** about $0.11 a day on Haiku, $2.19 on
  Sonnet.
- **Against the $5 prepaid balance:** about 4,500 reads on Haiku, about 230
  on Sonnet (2.3 days at the cap).
- **Not counted:** thinking, at effort `low`, is inside the 1565 output
  tokens, and a real document is longer than the 20-line fixture (design §7).
- **`global` routing,** so no 1.1× multiplier.

```
model: claude-haiku-5-5
lines sent: 20
outcome: ok
tokens: input 3117, output 1565
ModelRead: passes
verified against the invented text: yes — 10 values stood, 0 did not
```

**Where 2b differs from Alex's prompt** (all in `llm-reader-design.md` §11,
items 17–24):

- **`vendor_capped` covers more cases than the 400 named:** the 429 of a
  tier's monthly cap (`enforced_spend_limit_reached`), a 402, and (2b
  follow-up) the documented out-of-credit message on any 4xx.
- **Migration 0027 adds an outcome too** (`vendor_capped`), not only the
  vendor: the counts row stores the outcome as an enum.
- **`inference_geo: 'global'` is sent.** The prompt listed what to send and
  did not name it; design §6 requires the region set in code. `global` is
  the default and costs 1× (`us` is 1.1×). Anthropic has no EU option and
  no per-request no-storage option. Alex kept `global` (2026-10-14).
- **The SDK does not prepare the schema.** Its 0.133 transform demotes
  `enum` and `const` to description text; the adapter cuts the schema to the
  documented keywords itself.
- **The schema as generated did not compile** ("grammar too large"). Fixed by
  `$defs`, every property required and the nullable flag as one enum;
  `ModelRead` gained only a shared `CitedText`; the instruction gained two
  clauses (`lineEnd` = `line` for one line; `endQuote` = `timeQuote` when
  shared). The route's `safeParse` is still the authority.
- **The smoke script prints a 4xx's vendor type and message,** beyond "only
  outcome, tokens, validates, verifies". Needed to find run 1's cause; safe
  because the text is invented; the key is masked if it appears. The app has
  no such path.
- **Every vendor failure is now logged** (code, vendor status, no text);
  2a logged only 500s. Without it a revoked key looks like an outage.
- **The browser derives its code list** from `READ_MESSAGES`; the old list
  would have shown `vendor_capped` as `unavailable`.
- **`vitest.setup.ts` deletes the reader's variables and `ANTHROPIC_*`:**
  vitest loads `.env.local`, where the real key now lives. Guard 1's test
  checks the key is absent.
- **No server-side `fallbacks`.** Haiku 5.5 has none (a 400). On Sonnet 5.5
  it could hand a refused read to another model, outside the allow-list.

**Built in the follow-up, both from 2b:**

- **The `.next/static` scan:** with a synthetic key, not the real one
  (above).
- **The blank-cap boot refusal is gone:** a blank cap is now its default.

Every way the build differs from the design, phases 1 and 2a, is listed in
`llm-reader-design.md` §11.

### Phase 3a: evaluation prep (2026-10-14)

Local only: no network, no API call, no use of the key. `ratecon:eval-ai`
(step 1) is NOT built: it needs Alex's separate written approval. (Built in
3b-prep, below; still not run.)

| File | What |
|---|---|
| `scripts/ratecon-corpus.mts` | The samples by number; reads a PDF the way the browser does. Prints nothing |
| `scripts/ratecon-redact-report.mts` | `npm run ratecon:redact-report`: step 0, counts per file |
| `scripts/ratecon-review-redacted.mts`, `scripts/ratecon-review-server.mts` | `npm run ratecon:review-redacted <n>`: one local page for Alex |
| `src/lib/ratecon/redact.ts` | `redactedForReview`: the lines the send would use, each with its re-scan hits. For the viewer only; the send path is unchanged |
| `scripts/ratecon-expected.mts` | The ground truth's shape, shared by the two commands below |
| `scripts/ratecon-expected-skeleton.mts` | `npm run ratecon:expected-skeleton`: blank entries for the samples that had none |
| `scripts/ratecon-check-expected.mts` | `npm run ratecon:check-expected`: shape and blanks per file, no values |
| `docs/ground-truth-howto.md` | How to write each field, with invented examples |

**E2e, full run (2026-10-14), at the start of 3a:**

- **Result:** `npm run e2e` gave 246 passed in 20.4 minutes, exit 0.
- **Baselines:** none moved; nothing was re-saved.
- **The two hangs:** neither recurred. The truck-lists spec at line 59
  passed in 11.2 s, and every timeline step passed.
- **Sleep:** the end-of-run line said the machine stayed awake.

**Step 0, the redaction report** (`npm run ratecon:redact-report`; counts
only, by number):

- 28 PDFs: 25 with a text layer, 3 scans (3, 5, 6).
- **Too large to send: none.** Largest sends: 9 (222 lines, all 6 pages)
  and 28 (285 lines, 5 of 7 pages).
- **Residual detector hits: 9 files, 10 category hits** (sample 8 has two).
  Corrected 2026-10-14: this line first said "10 files", reading the
  report's category total as a file count. They would NOT be sent: the
  browser refuses any file with a hit (`not_redacted`).
  **Superseded by 3a-2, below: none now.**
  - Unrecognised: 7 (id), 8 (email, phone), 10 (email), 11 (id), 12 (id),
    16 (email), 21 (email).
  - Template-read, so the AI is never asked: 13 (email), 15 (email).
- **So of the 12 unrecognised files, only 5 could be sent today:** 2, 4, 9,
  17, 28. The other 7 are blocked until Alex says what each hit is: a missed
  redaction (fix the redaction) or a false alarm (fix the detector). Both
  are fixed with invented test cases, then step 0 is re-run.
- Each hit is a category only. Nothing was looked at to find out more: that
  is for Alex, in the viewer.

| Sample | Template | Lines in | Lines sent | Masks: email / phone / amount / labelled / id / url | Residue |
|---|---|---|---|---|---|
| 1 | label-rows | 50 | 50 | 2 / 6 / 3 / 11 / 0 / 0 | 0 |
| 2 | — | 75 | 53 | 3 / 3 / 5 / 14 / 2 / 0 | 0 |
| 4 | — | 78 | 55 | 1 / 5 / 4 / 10 / 2 / 0 | 0 |
| 7 | — | 174 | — | — | id |
| 8 | — | 143 | — | — | email, phone |
| 9 | — | 222 | 222 | 22 / 4 / 14 / 10 / 1 / 0 | 0 |
| 10 | — | 60 | — | — | email |
| 11 | — | 64 | — | — | id |
| 12 | — | 282 | — | — | id |
| 13 | pickup-delivery-columns | 144 | — | — | email |
| 14 | pickup-delivery-columns | 140 | 140 | 2 / 9 / 10 / 27 / 0 / 4 | 0 |
| 15 | pickup-delivery-columns | 136 | — | — | email |
| 16 | — | 175 | — | — | email |
| 17 | — | 152 | 70 | 3 / 2 / 2 / 7 / 0 / 0 | 0 |
| 18, 19, 20 | stops-section | 77 each | 77 each | 4 / 5 / 6 / 8 / 2 / 0 each | 0 |
| 21 | — | 49 | — | — | email |
| 22, 23, 24, 25 | pu-so-blocks | 47–49 | all | 3 / 6 / 4 / 10–11 / 1 / 0 | 0 |
| 26, 27 | pu-so-blocks | 103, 99 | all | 6 / 11 / 8 / 16 / 1 / 0 each | 0 |
| 28 | — | 327 | 285 | 20 / 10 / 2 / 12 / 0 / 6 | 0 |

**The viewer** (`npm run ratecon:review-redacted <n>`):

- **What it is:** a standalone script, outside the Next app. A test holds
  that nothing under `src/` imports `scripts/`.
- **How it serves:**
  - binds 127.0.0.1 on a random port, under a random 32-hex path; every
    other path is an empty 404;
  - prints only the URL, and exits on Ctrl-C or after 30 minutes;
  - writes nothing to disk and logs nothing.
- **The page:**
  - no script, link, font or image; a CSP of `default-src 'none'`;
    `no-store`; the text HTML-escaped;
  - shows every line that would be sent, with its page, and HIGHLIGHTS the
    lines the re-scan still flags, so Alex can judge the residue files (9 in
    3a, none after 3a-2).
    A file that sends nothing would otherwise show nothing.
- **Tested on invented fixtures only** (`src/test/review-redacted.test.ts`,
  16 tests): loopback, the random path, an unknown number serving nothing,
  no external URL, escaping, the timeout. Binding 0.0.0.0, or adding a
  font link, each made a test fail.
- **Real run:** started once on sample 2 to see that it prints only the
  URL, then stopped. The page was NOT fetched, opened or captured.
  Unknown numbers (0, 99, `abc`) and a scan (3) refuse and serve nothing.

**Ground truth** (`.samples/rate-confirmations/expected.json`; the prompt
said `.samples/expected.json`):

- **Shape, read from its keys only:** `{ note, scoredAt, files }`, `files`
  keyed by file name.
  - The 6 complete entries: `{ loadNumber, stops: [{ type, street, city,
    state, zip, appointment }] }`.
  - Appointment forms: APPT `{ type, date, time, windowMinutes }`, FCFS
    `{ type, date, time, endTime, marked }`, `{ couldntRead, date }`.
  - Sample 12: `{ notRecognised: true }`.
- **18 skeletons added:**
  - Priority 1, 11 files: 2, 4, 7, 8, 9, 10, 11, 16, 17, 21, 28.
  - Priority 2, 7 files: 13, 14, 15, 20, 24, 25, 26.
  - The 3 scans are skipped.
- **The 7 existing entries are byte-identical.** The new entries were
  inserted as text before the end of `files`. The first 3450 bytes (every
  existing entry, through the last one's closing brace) hash the same
  before and after (sha256 `f9238f1101978c8e…`), and `cmp` finds them
  identical.
  - The original is kept beside it as
    `expected.json.before-skeleton-2026-10-14` (git-ignored, inside
    `.samples/`).
- **Blanks are `null`, not `""`.** `""` is ground truth (a document with no
  load number, §12.21), so a blank needs its own marker.
  - `ratecon:check-expected` counts the `null`s: 13 per skeleton.
  - `ratecon:score` skips an entry while any is left.
- **A fourth appointment form, `{ "none": true }`** (no date or time), so a
  stop with no appointment can be written. `ratecon:score` scores it.
- **`ratecon:score` treats a complete priority-1 entry** that no template
  reads as AI ground truth, not as a template failure. It is still 6 of 6.
- **Differs from the prompt:**
  - **7 read-but-unchecked files, not 6:** 13 template-read, of which 6
    have ground truth.
  - **11 priority-1 skeletons, not 12:** sample 12 already had an entry.
    Its entry has no stops, so the AI cannot be scored on it; giving it
    stops means changing an entry that must stay byte-identical. Alex's
    call.

### Phase 3a-2: the redaction catches what the re-scan found (2026-10-14)

Local only: no network, no key. Generic fixes from the detectors; no
document text was read.

**What changed** (`src/lib/ratecon/redact.ts`, `REDACTION_VERSION`
`redact-2026-10-14.1`):

- **A second masking pass over the JOINED line** (`maskJoined`), with the
  same detectors as a cell gets: emails, web addresses, MC/DOT ids, phones
  (and the phone-word rule), `$` and USD amounts. A value split across cells
  is whole only there. Labels are not re-run; the re-scan still checks
  them. It is idempotent: a placeholder matches no detector.
- **Any `@` left takes its whole token** (`maskAtTokens`). At a cell edge,
  the word touching it across the boundary goes too, outward while each is
  its cell's only word, and stopping at a placeholder.
  - `ops` | `@example.com` loses `ops`: a local part can be a name.
  - Inside a cell, `Pick up @ 08:00` loses only the `@`; the time stays.
  - The cost: a word next to an email fragment can go with it.
- **The `$` detector now takes any spaces after the `$`;** it took at most
  one. `$` | `1,850` in two cells, `$  1,850` joined, passed both the mask
  and the re-scan whenever no money word was in either cell. This is
  stronger, not looser: the re-scan is stronger with it.
- **The re-scan (`residue`) is not loosened,** and no detector is removed
  or weakened. Tests pin that it still flags each joined shape: an email,
  a stray `@`, a phone, an MC number, an amount.

**Tests (invented text):**

- **Split shapes:**
  - an email across 2 cells (three ways) and across 3 cells (two ways);
  - an `@` at a cell boundary, and the walk stopping at a placeholder or at
    a cell of several words;
  - an `@` inside a cell;
  - a phone across 2 and 3 cells;
  - MC#, MC | # | number, USDOT, DOT #:;
  - `$` | amount, with and without a money word.
- **Kept, unmasked:** a city and its ZIP, a ZIP next to a street number, a
  time range across cells, a date and a time, a street number and its
  street, a load number, ten bare digits as an order number, a dashed date
  and a ZIP.
- **Idempotence** and mask counts.
- **Mutations:** with the joined pass off, 11 tests fail; with the walk
  across cells off, 4; with the old one-space `$` rule, 2.
- **Two tests that pinned "a split email or phone is refused"** now pin that
  it is masked and sent.
- **No invented input is known that the masking leaves for the re-scan.**
  - So the strip test of the refusal message now forces the refusal (a
    wrapper around the real `prepareForReading`, that one test only).
  - The viewer test gives its highlighted line as data.

**Before and after** (`npm run ratecon:redact-report`, which now also prints
the line numbers of any hit lines, never their text, and a short sha256 of
what each sendable file would send):

| | Before | After |
|---|---|---|
| Files with a residual hit | 9 (10 category hits) | **0** |
| Files that can be sent | 16 of 25 | **25 of 25** |
| The 16 that already sent | — | **byte-identical** (all 16 hashes equal) |
| Too large | 0 | 0 |

The hit lines before, by number as the review page shows them. The
selection did not change, so the numbers still point at the same lines;
these are the lines for Alex to look at first:

| Sample | Lines that hit, before 3a-2 |
|---|---|
| 7 | L10 (id), L11 (id) |
| 8 | L24 (phone), L45 (email) |
| 10 | L38 (email) |
| 11 | L10 (id), L11 (id) |
| 12 | L20 (id), L21 (id) |
| 13 | L81 (email) |
| 15 | L58 (email) |
| 16 | L9 (email) |
| 21 | L34 (email) |

**Found, not fixed: a labelled name split across cells goes through, and
the re-scan does not catch it.**

- `Dispatcher:` | `Dana` | `Example` sends `Example`.
- `Contact` | `[PHONE] Dana Example` sends the name.
- The cause: the re-scan asks only whether a label's value STARTS with a
  placeholder.
- This is fail-open, unlike the residue above. The design's §2 now lists it.
- **Fixing it means deciding where a label's value ends in the joined
  line.** To the end of the line would mask whatever follows it (a time, a
  city). Alex's call; until then the review page is where it is caught.

**E2e after 3a-2:** the AI spec and the key-scan spec, 3 passed (with
setup).

### Phase 3a-3: the labelled-name gap, closed (2026-10-14)

Local only: no network, no key, no document text read. Alex decided: fix it.

**The rule** (`src/lib/ratecon/redact.ts`, `maskPersonNames`; a third pass,
on the joined line split back on the cell gap). After a PERSON label —
contact, dispatcher, broker or carrier rep, agent, rep, booked by, driver
(with name, cell or phone):

- **In the label's own cell,** the name-like words after its placeholders
  go: `Contact: [PHONE] Dana Example` → `Contact: [PHONE] [REMOVED]`. The
  rest of the cell after them stays (`… [REMOVED] 08:00-17:00`).
- **If that reaches the cell's end,** the following cells go while each is
  name-like, at most 3, stopping at the first that is not.
- **Name-like:** letters (any alphabet), spaces, apostrophes, hyphens,
  periods; no digit, colon, comma or placeholder.

**Three refinements to Alex's rule, and why:**

1. **A cell of placeholders only is passed over,** not a stop, and not
   counted in the 3. `Contact` | `[EMAIL]` | `Dana Example` is the same
   layout as `Contact` | `[PHONE] Dana Example`, only cut differently by
   the PDF. Stopping there would have left the name.
2. **A cell with a label of its own ends the walk.** A new label starts a
   new value; without this, `Rep:` | `Dana` | `Phone` | … would mask the
   word "Phone".
3. **The re-scan has no 3-cell limit.** Its check (`nameLeft`) is written
   apart from the mask: a person label still followed by a name-like word
   in its cell, or a name-like cell past placeholder-only cells, is a
   `labelled` hit. So a fourth name-like cell past the mask's three
   REFUSES the document rather than sending it. Fail-closed, as asked. No
   detector was loosened or removed.

**Kept by tests (invented text):** ZIPs, times, time ranges, dates, street
numbers and streets, load numbers (`Load # EX-40417`, and `EX-40417`
alone), a dock door (`Door 12A`), city lines, and `Fargo, ND` with its ZIP
in the next cell. Lines with no person label are untouched, facility names
included. A phone or shipper label does not walk on.

**The cost, pinned in a test:** a facility name in the cells right after a
person label goes with the name (`Contact:` | `Dana` | `Prairie Cold
Storage`).

**What it still misses** (design §2, verified on invented text):

- a name sharing a later cell with a non-name word: `Dispatcher: Dana` |
  `Example x22` sends `Example`, and the re-scan agrees with the mask;
- a name on the line after its label (the walk is within one line);
- a name after a contact label that is not a person label: `Phone:` |
  `612-555-0147` | `Dana` sends `Dana`.

**Tests:** 114 in `redact.test.ts` (74 before), every name invented.
**Mutations,** each applied alone and reverted:

| Mutation | Tests that fail |
|---|---|
| The person pass off | 21 |
| A placeholder-only cell stops the walk | 16 |
| The re-scan's person check off | 6 |
| The re-scan stops at a placeholder-only cell | 4 |
| Names after a placeholder in a walked cell kept | 3 |
| A digit counts as name-like | 2 |
| A label cell does not stop the walk | 1 |
| No 3-cell limit | 1 |
| Names after a placeholder in the label's cell kept | 1 |
| A comma counts as name-like | 1 |

The digit and comma mutations first passed every test. Every "kept" case
also failed the needs-a-letter rule, so neither exclusion was pinned. Three
keep cases were added that only those exclusions protect.

`REDACTION_VERSION` is `redact-2026-10-14.2`. The browser and the route must
ship together: a page still on `.1` gets `outdated` (409).

**Before and after** (`npm run ratecon:redact-report`; it now also prints
the line numbers where the person pass masked, and how many masks, never
the text):

| | Before | After |
|---|---|---|
| Residual hits | 0 | **0** |
| Files that can be sent | 25 of 25 | **25 of 25** |
| Hash unchanged | — | **14:** 1, 4, 7, 8, 9, 10, 11, 18, 19, 20, 21, 26, 27, 28 |
| Hash changed | — | **11:** 2, 12, 13, 14, 15, 16, 17, 22, 23, 24, 25 |

Every changed file is one where the new pass masked, and in each the
`labelled` count rose by exactly that many. Where it masked, by line number
as the review page shows them (masks in brackets where more than one):

| Sample | Lines |
|---|---|
| 2 | L12, L38 |
| 12 | L34 (2), L240 |
| 13 | L55, L79 |
| 14 | L75 |
| 15 | L14, L57, L71 |
| 16 | L7 |
| 17 | L7 |
| 22, 23, 24, 25 | L18, L23 each |

**For Alex:** these lines are where to look first in the viewer. Was a
name taken, or a facility name or something else the read needs (the cost
above)?

### Phase 3b-prep: `ratecon:eval-ai`, built and NOT run (2026-10-14)

No call was made, the key was not used, and the command was never started
with the real adapter. It was run only to show its refusals, with an empty
environment (no key), and in tests that spawn it the same way.

| File | What |
|---|---|
| `scripts/ratecon-eval.mts` | The engine: flags, file checks, ceilings, the run, the score. Tested |
| `scripts/ratecon-eval-ai.mts` | `npm run ratecon:eval-ai`: reads the samples and ground truth, builds the real adapter, calls the engine |
| `scripts/ratecon-expected.mts` | `appointmentScore` moved here from `ratecon-score.mts`, unchanged (`ratecon:score`'s output diffed identical) |
| `src/test/ratecon-eval.test.ts` | 44 tests, fake adapter and invented ground truth only |

**How to run it, once Alex approves in writing:**

    npm run ratecon:eval-ai -- --approved=YYYY-MM-DD --files=1,18,19 [--runs=3]

**It refuses, before the key or any sample is read:**

- with no `--approved`;
- with an `--approved` that is not a real date or is after today;
- with no `--files`, or a list that is not sample numbers or names one twice;
- with any unknown flag.

**Then, before any call, it refuses the whole run when:**

- the key or model is wrong;
- any named file is a scan, does not prepare (residue), or lacks complete
  ground truth with stops;
- files × runs is more than 75.

**The path is the app's:**

- `prepareForReading`;
- the adapter, given `n` and `text` and today in the dispatch zone, as the
  route sends them;
- `ModelRead`, then `verifyRead` against exactly the lines sent;
- `fillLoad` into an empty form.

`now` is `expected.json`'s `scoredAt`, as `ratecon:score` uses it, so
year-less dates read against the same day the ground truth was written for.

**Ceilings, checked before each call:**

- **75 calls.**
- **$1.00:** what was spent (measured tokens × the price constants), plus
  the most the next call can cost.
  - **Prices:** Haiku 5.5 at $0.10 in and $0.50 out per million tokens, for
    prompts up to 100K tokens. Source: Anthropic's model table in the
    claude-api reference (cached 2026-10-06), read 2026-10-14. A call whose
    input bound passes 100K is never made.
  - **Sonnet 5.5's prices are there too** ($2 and $10), only in case Alex
    names it.
- **A bound, not a measurement, before the call.** Measuring first would
  mean `count_tokens`, which sends the document's text a second time.
  - The bound is the request body's UTF-8 bytes plus 2,000 tokens in, and
    `max_tokens` (8,192) out.
  - The 2b smoke call: 5,470 bytes, billed 3,117 input tokens.
  - The largest file's bound is about $0.0073 a call, so 75 calls is at
    most about $0.55.
- **Fail-safes:**
  - a reply billed more input than its bound stops the run;
  - a failure that reports no usage is counted at its bound;
  - `vendor_capped` stops the run.

**Output:** counts and codes only, never a value, a quote or any text.
Calls run in rounds (run 1 of every file, then run 2), so a ceiling still
leaves every file a run.

- **Per file and run:** the outcome code, tokens and cost.
- **Per field:** a status (`verified`, `blank-and-marked`,
  `filled-and-marked`) and a score against the truth.
  - `exact`, `marked`, or **`WRONG`** (verified, filled, and not what the
    PDF says).
  - A blank with no mark is WRONG unless the truth is blank. It should
    never happen, and the bar must not pass it.
  - Appointments are scored by `ratecon:score`'s own function.
- **At the end:** total calls, tokens and cost, WRONG per bar field, and
  the bar.
  - A run cut short, or one with unscored runs, is never called a pass.

**Tests** (44, fake adapter and invented data):

- each ceiling stops it before the call that would pass it, and spending
  never passes $1.00;
- the input-tier refusal, a failure counted at its bound, the over-bound
  stop and `vendor_capped`;
- the request is `n` and `text` only, with the zone's today;
- exact, WRONG, a wrong stop count, and a verifier-refused value (blank
  and marked, never WRONG);
- a missing approval refuses: the parser, and the command spawned with no
  key;
- no value, quote, sentinel or ground-truth value reaches the output, and
  every line matches one of the known shapes.

**Mutations:** each fails at least one test.

- no call ceiling;
- no dollar ceiling;
- the ceiling checked without the next call's bound;
- a usage-less failure counted as free;
- no over-bound stop;
- approval not required;
- a load number printed;
- a ground-truth value printed;
- the page sent to the adapter.

**Control (template-read) files with COMPLETE ground truth:** **1, 18, 19,
22, 23, 27** (6 of 13).

- **Still blank in places:** 13, 14, 15, 20, 24, 25, 26.
- **Of the 12 unrecognised files, none is complete yet.** Sample 12 has no
  stops.
- **So today the command would accept only 1, 18, 19, 22, 23 and 27.** At 3
  runs that is 18 calls.

**E2e, phase 2a build (2026-10-13), with the reader still off on the e2e server:**

- **Result:** 241 passed, 1 skipped (the AI spec) and 1 did not run.
- **Failures:** two desktop `1-default` baselines failed, the flake below.
- **Rerun:** all 13 desktop baselines passed.

**E2e, closing 2a (2026-10-13), with the reader on through the `e2e` script:**

- **First full run:** 243 passed, 1 failed and 1 did not run.
  - The failure was the AI spec itself, at the paste: "NotAllowedError:
    Failed to execute 'writeText' on 'Clipboard': Write permission
    denied."
  - The spec never granted clipboard permission. `60b802f` grants
    `clipboard-read` and `clipboard-write` before the paste, as
    `paste-address.spec.ts` does. It is a test fix only; no app code
    changed.
- **Second full run:** 245 passed, exit 0.
  - The AI spec ran, not skipped, and passed.
  - It made exactly one `ratecon_ai_reads` row, `{outcome: 'ok', lines_sent: 23}`, and saved no stops.
  - No baseline moved, and nothing was re-saved.

**The "Synced 0s ago" flake** (a desktop baseline, not a 2a bug):

- **Symptom:** `e2e/desktop-baseline.spec.ts`, shot `1-default`, sometimes
  differs from its baseline. The run shows "Synced 0s ago" beside the
  header's dot, and the baseline does not. (The cause is not the first poll,
  as first written here; see "Fixed" below.)
- **At HEAD (`60b802f`):** `npm run e2e -- e2e/desktop-baseline.spec.ts -g
  "desktop at" --repeat-each=5 --update-snapshots=none` gave 28 passed and
  3 failed.

  | Width | Passed | Failures |
  |---|---|---|
  | 768 px | 3 of 5 | `1-default`, 35 px each |
  | 1920 px | 4 of 5 | `1-default`, 155 px |
  | 1024, 1280, 1440, 1680 px | 5 of 5 | — |

- **It predates 2a,** so the comparison at `b0bc35b` was skipped (Alex,
  option 3). In `git diff b0bc35b..HEAD`, the board changes only in one
  boolean prop, `aiReader`, passed through `src/app/page.tsx` and
  `src/components/console/Console.tsx`. No header, poll or sync code
  changed.
- **It blocked `npm run gate`:** on a bad draw, the gate's e2e step failed.

**Fixed, 2026-10-13: the spec's timing only.** No app code, no baseline,
no threshold, no retry, and `playwright.config.ts` is not touched.

- **The cause:** a race between the spec's fixed wait and the header's first
  one-second tick.
  - From hydration until that tick, the header's `now` is the server's
    fetch instant, which is real time. The poll's last success is on the
    frozen browser clock (FROZEN, 2026-10-01), days earlier.
  - So for about a second `isNotUpdating` is true, and the header shows
    "Not updating" with a Retry button.
  - The tick sets `now` to FROZEN, and the healthy "Synced" label comes back
    as a NEW element.
  - `open()` waited a fixed 1200 ms. That cleared the tick by about 150 ms.
  - When it did not, `hideLiveValues` tagged the outgoing label, and the
    shot pictured the new one untagged.
  - It was never the 20 s poll.
- **Measured:** probes, not committed, on 18 page loads at every width.
  - "Not updating" appeared 270–400 ms after navigation, and the healthy
    label 1.05–1.3 s after that.
  - The tag ran at 1.5–2.6 s. All three failures were tagged at
    1517–1599 ms, before the tick.
  - Passes at 1280 and 1440 cleared the tick by only 180–300 ms.
- **Why only 768 and 1920:** chance, not width. The race is the same at
  every width.
- **The fix:** `open()` keeps its 1200 ms and then waits for two things.
  - The page has hydrated: the dispatch clock has its "· you" title.
  - The Retry button (`[data-sync-retry]`) is gone.

  A probe on 28 page loads saw the title and "Not updating" arrive in the
  same render every time, so the wait cannot pass before the tick. It
  follows 7c's pattern (`6e90a91`): put the page in the state the approved
  shot has, by a condition rather than a longer sleep.
- **Proof:** with `--update-snapshots=none`.

  | Widths | Runs each | Passed |
  |---|---|---|
  | 768, 1920 | 10 | 10 of 10 each |
  | 1024, 1280, 1440, 1680 | 3 | 3 of 3 each |

  Then one full `npm run e2e`: 243 passed, 1 failed and 1 did not run. Every
  desktop baseline and the AI spec passed. The failure is the next item.

**Two other intermittent hangs, seen while proving the fix.** Neither is
fixed; both are follow-ups.

- **`e2e/truck-lists.spec.ts:59`** ("create Bob's trucks…"), in the full
  run.
  - After "Add to list", the dialog sat on "Adding…" for the whole 10 s.
  - Run alone 5 times, it passed 5 of 5.
- **`e2e/desktop-baseline.spec.ts`, desktop at 1920, step `6-timeline`,**
  in a diagnostic run.
  - The Timeline dialog sat on "Loading…" for 15 s.
  - It did not recur in any later desktop run that day.
- **In both,** a request from the page did not answer in time. Not
  investigated.

### Phase 3b: evaluation run 1, the six control files (2026-10-14)

**Alex's written approval, 2026-10-14:** "I have read the redacted text of
samples 1, 18, 19, 22, 23 and 27 in the viewer and found nothing that
should not be sent. Approved: ratecon:eval-ai on samples 1,18,19,22,23,27,
3 runs each (18 calls), Claude Haiku 5.5, ceilings $1.00 and 75 calls. The
account's default retention (inputs deleted within 30 days, flagged ones
possibly kept up to 2 years) is ACCEPTABLE."

**The command, run once:**

    LLM_READER_MODEL=claude-haiku-5-5 npm run ratecon:eval-ai -- --approved=2026-10-14 --files=1,18,19,22,23,27 --runs=3

- **One addition to the command as given:** the model is pinned on the
  command line.
  - **Why:** the script takes the model from `.env.local`, which was not
    opened. Had the file named Sonnet, the run would not have been the one
    approved.
  - **Checked first, on a scratch file:** under Node 26.8.2, a variable in
    the shell wins over `--env-file`.
  - The run's first line confirmed `Model claude-haiku-5-5`.
- **No `--as-of`:** `now` is `expected.json`'s `scoredAt`, so the run
  compares with `ratecon:score`.
- **Nothing was stored.** The output is counts and codes only.

**Result:**

| | |
|---|---|
| Calls | 18 of 18 planned, all `ok` (no refusal, timeout or invalid output) |
| Tokens | 76,947 in, 40,668 out |
| Cost | **$0.0280** (the ceiling is $1.00; the bound-based most was $0.0921) |
| Runs scored | 18 |
| **The bar** | **NOT met: 1 WRONG.** The reader stays off |

**WRONG on the bar's fields** (load number, stop count, order and type,
street, ZIP, city, state):

| Field | WRONG | Where |
|---|---|---|
| stop count | 1 | **sample 22, run 3:** 1 stop read, 2 expected; stop 2 missing |
| all the others | 0 | — |

**WRONG on appointments** (not a bar field, but `ratecon:score` fails a
file on it: filled, unmarked, and not what the PDF says):

| Field | WRONG | Where |
|---|---|---|
| appointment | 3 | **sample 27, stop 1, in all 3 runs** |

Fixed: nothing, as instructed.

**Per file, over 3 runs** (bar fields: exact unless said):

| Sample | Bar fields | Appointments |
|---|---|---|
| 1 | all exact | stop 1 exact ×3; stop 2 marked, filled differently ×3 |
| 18 | all exact | both stops marked, filled as the PDF says ×3 |
| 19 | all exact. Run 1: 2 values did not stand | run 1: both stops marked, filled differently; runs 2–3: both marked, filled as the PDF says |
| 22 | **run 3: stop count WRONG.** Run 1: stop 2's type filled and marked | stop 1 marked, filled as the PDF says ×3; stop 2 exact (runs 1–2) |
| 23 | all exact | stop 1 marked, filled as the PDF says ×3; stop 2 exact ×3 |
| 27 | all exact | **stop 1 WRONG ×3**; stop 2 exact ×3 |

**What surprised me:**

1. **A dropped stop is silent.** In sample 22's run 3, the model returned
   one stop.
   - The verifier checks each value against its quote. It never checks how
     many stops there are, so the read came back `ok` with 6 values
     standing.
   - A dispatcher would see a one-stop load with nothing marked, and the
     delivery would be gone.
   - The templates read the same file with both stops. This is the one
     WRONG on the bar.
2. **Sample 27's first appointment is WRONG in all three runs.** That makes
   it systematic, not chance.
   - The verifier let a value stand that is not the ground truth's.
   - Either the quote supports a reading the ground truth does not, or the
     ground truth is wrong.
   - It was not investigated: that needs the text, which is Alex's to read.
3. **Not deterministic.** Sample 19's run 1 differed from runs 2 and 3: 2
   values did not stand, and its appointments came back "filled
   differently".
   - Sample 22 differed in each run: a marked type in run 1, a dropped stop
     in run 3.
   - Three runs were worth it. One run of sample 22 could have shown either
     a pass or a fail.
4. **The script exits 0 when the bar is not met.** It sets a failing exit
   code only when a ceiling stops it early. Not fixed (fix nothing); worth
   changing before the next run.
5. **Smaller things:**
   - Input tokens were identical across runs of a file; only output varied.
   - Real cost was about 30% of the bound.
   - No reply came near its input bound.

**What this says, so far:**

- On the files the templates already read 6 of 6, the AI met the bar in
  17 of 18 runs.
- Its one miss is the kind the design most needs to prevent: a filled load
  that silently lacks a stop.
- The 12 unrecognised files, the ones the reader exists for, are not yet
  evaluated: their ground truth is not written.

### Phase 3c: a dropped stop made visible; sharper diagnostics (2026-10-14)

No API call, no use of the key, no document text or ground-truth value read
or printed.

**1. `ratecon:eval-ai`'s exit code** (`barVerdict`):

- It exits 0 ONLY when every planned call was made and scored and nothing
  on the bar is WRONG.
- A WRONG is `not-met`; anything short of every run scored is
  `incomplete`; both exit 1.
- Run 1 exited 0 with a WRONG; that cannot happen now.

**2. Appointment diagnostics** (`appointmentDiff`, in
`scripts/ratecon-expected.mts`, shared by `ratecon:score` and
`ratecon:eval-ai`):

- When an appointment is WRONG or "marked, filled differently", the output
  names WHICH parts differ, never their values: `WRONG (date, time)`.
- The parts are `none-versus-set`, `type`, `date`, `time`, `window` and
  `end time`.
- **The form has no end date.** An appointment's end is its `window` in
  minutes, and receiving hours' end is `end time`, so a wrong end date shows
  as one of those.
- `appointmentScore` is now built on the diff. `ratecon:score`'s results are
  unchanged: the output was diffed with the part names removed.
- On the six control files the TEMPLATES are right on every appointment, so
  `ratecon:score` names no part. That sharpens run 1:
  - on sample 27, stop 1, the template fills what the PDF says, and the AI
    was WRONG in all 3 runs;
  - on sample 1, stop 2, the template fills what the PDF says, and the AI
    was "marked, filled differently" in all 3 runs.
  - The next run will name the parts.

**3. The dropped-stop cue, in the app** (`src/lib/ratecon/address-cue.ts`;
the strip):

- **What it finds:** after verification, the sent lines that look like a US
  city, state and ZIP (`cityLine`, on the whole line or any cell) that no
  quote covers.
  - A quote covers a line only when it is in the text: the verifier's own
    `locate`, now exported. A made-up citation does not hide a line.
  - Any quote counts: an appointment quoting the city line covers it.
  - A quote over several lines covers each of them.
- **What the strip says:** "N lines that look like addresses were not used:
  L12, L45" (or "1 line that looks like an address was not used: L18"), with
  "Show what is sent".
  - It blocks nothing and changes no mark.
  - It survives the "Replace" path.
- **It cannot tell a stop from any other address.** A broker's own address,
  as the only uncited line, fires it. A test pins this.
- **It folds away** with the rest of the strip's detail the moment the load
  is typed into. On a real dropped stop, the warning can be gone after one
  keystroke. Not changed; worth Alex's view.

**4. Offline measurement** (`npm run ratecon:cue-report`; no model; counts
only). For a template-read file, the template's own reading stands in for a
read that dropped nothing: its source lines are taken as the citations. A
model cites quotes, not whole lines, so this is an estimate. The columns
layout cites a cell, not a line, and is matched by cell.

| Sample | Template | Stops (template / truth) | Lines sent | Address-like | Uncited, nothing dropped | Of those, after the first stop |
|---|---|---|---|---|---|---|
| 1 | label-rows | 2 / 2 | 50 | 2 | 0 | 0 |
| 13 | columns | 2 / — | 144 | 6 | 4 | 2 |
| 14 | columns | 2 / — | 140 | 6 | 4 | 2 |
| 15 | columns | 2 / — | 136 | 6 | 4 | 2 |
| 18 | stops-section | 2 / 2 | 77 | 4 | 2 | 0 |
| 19 | stops-section | 2 / 2 | 77 | 4 | 2 | 0 |
| 20 | stops-section | 2 / — | 77 | 4 | 2 | 0 |
| 22 | pu-so-blocks | 2 / 2 | 48 | 4 | 2 | 0 |
| 23 | pu-so-blocks | 2 / 2 | 49 | 4 | 2 | 0 |
| 24 | pu-so-blocks | 2 / — | 47 | 4 | 2 | 0 |
| 25 | pu-so-blocks | 2 / — | 48 | 4 | 2 | 0 |
| 26 | pu-so-blocks | 2 / — | 103 | 6 | 4 | 2 |
| 27 | pu-so-blocks | 2 / 2 | 99 | 6 | 4 | 2 |

The 12 unrecognised files have no known stop count yet. Address-like lines
sent: 2 → 3, 4 → 3, 7 → 2, 8 → 3, 9 → 8, 10 → 4, 11 → 2, 12 → 10, 16 → 4,
17 → 4, 21 → 2, 28 → 8.

**How often it fires when no stop was dropped:**

| | Control files (1, 18, 19, 22, 23, 27) | Template-read files |
|---|---|---|
| The cue as built | **5 of 6** (all but 1) | 12 of 13 |
| Narrowed to lines after the first stop (measured only, NOT built) | 1 of 6 (27) | 5 of 13 |

**As built in 3c, the cue was noise** (narrowed in 3d, below). Every file but sample 1 has more
address-like lines than stops: the broker's, the carrier's, bill-to and
remit-to. A dispatcher shown it on nearly every AI read would learn to
ignore it, the same risk §10 item 1 named for marks.

**The narrowing is promising but not proven.**

- It would still have caught run 1's dropped stop (sample 22's stop 2 comes
  after stop 1), and it is silent on 22.
- It cannot catch a dropped FIRST stop: nothing a later stop cites comes
  before it.
- It is measured on templates' citations, not a model's.

Alex's call, before the reader goes on: build the narrowing, try another
signal (stop words near the line), or keep the cue as it is.

**5. `ratecon:eval-ai` measures the cue per run.** For each scored run, it
prints whether the cue would have fired and the line numbers
(`address cue   would fire: 2 uncited address-like lines: L12, L45`), and
the total at the end. So the next run measures it on real reads.

**Tests:** 2639 in all (2587 before).

| File | Tests |
|---|---|
| `src/lib/ratecon/address-cue.test.ts` (new) | 20 |
| `src/test/ratecon-expected.test.ts` (new) | 21 |
| `src/test/ratecon-eval.test.ts` | 52 (44 before) |
| `src/components/edit/ratecon-ai.test.tsx` | 3 more |

The exit-code, diff and cue tests were written first and seen to fail.

**Mutations,** each applied alone and reverted; every one fails at least one
test:

- a quote not in the text still covers its line;
- a city line in one cell of several not seen;
- `lineEnd` ignored;
- appointment quotes not counted;
- the singular said as a plural;
- the cue dropped on the Replace path;
- the cue never computed.

"Not seen in one cell of several" first passed every test: a line whose
cell matches nearly always matches whole. It now has a case where only the
cell finds the city (`Order PO 44120` | `Fargo, ND 58102`).

### Phase 3d: two-read agreement, built and tested, not wired (2026-10-14)

No API call, no use of the key, no document text or ground-truth value read
or printed.

**1. `agreeReads(a, b)`** (`src/lib/ratecon/agree-reads.ts`; pure; NOT used
by the app yet). Two reads of the same lines, each already verified:

- **The stop count:** when it differs, the read with MORE stops gives them,
  each verified against its own quotes.
  - A notice names both counts: "The two AI reads found 1 and 2 stops. The
    2 shown are the read with more; check each against the document."
- **Stop by stop, by index:** a field the reads differ on is left blank and
  marked "The two AI reads differed. Enter it by hand."
  - That includes one read filled and the other blank.
  - A field both left blank or unconfirmed stays as it was, with its own
    mark.
- **An appointment:** any difference blanks and marks the whole of it. That
  is the kind (exact, range), date, time, end date, end time or flag.
  - Two unconfirmed appointments (`none` or `unreadable`) are not a
    difference.
  - One confirmed and one not is.
- **The stop type** cannot be blank in a read. A differing type keeps the
  base read's value, marked "… Check it."
- **The load number** follows the same rules.
- **The result:**
  - the `RateconRead` that `fillLoad` takes (layout `model`);
  - `notices` for a later UI;
  - `differed` (stop and field name), for the evaluation;
  - neither input is changed.
- **Two things changed outside it:**
  - `StopRead` gains `timeCheck`;
  - `fillLoad` says it in place of its own appointment check.
  Only agreement sets it; a test fills a merged read through `fillLoad`.
- **Costs:**
  - **Comparing by index.** A stop dropped from the MIDDLE shifts the rest,
    which then compare as different and are blanked. It is the safe side (a
    blank is seen), and it is pinned in a test.
  - **The same mistake twice is invisible.** Sample 27's appointment was
    WRONG the same way in 3 runs of 3, so a pair would most likely agree on
    it. A test pins that a shared WRONG stays WRONG.

**2. `ratecon:eval-ai --pairs`:**

- **Each run is two calls** with the same request, made in parallel. Both
  are verified, merged by `agreeReads` and scored as before.
- **Per run** (counts and names only):
  - `pair: agree`, or `pair: differ (stop count 1/2; fields that differed:
    street x1, appointment x1)`;
  - the merged fill's score;
  - `read A alone: N WRONG on the bar`.
- **At the end:** pairs agreed and differed, and read A's WRONG per bar
  field beside the merged ones. So a run shows whether agreement removed a
  WRONG.
- **A pair with a read that does not verify** is `pair_incomplete (A ok, B
  timeout)` and is not scored (so the verdict is `incomplete`).
- **The ceilings count calls:**
  - a pair is made only if two more calls and two bounds fit;
  - the plan refuses more than 75 calls (so at most 12 files × 3 runs);
  - $1.00 and the approval flags are unchanged.
- **The default stays single-read,** and prints as before (the 52 earlier
  tests pass unchanged).
- **A pair costs about $0.003 on Haiku 5.5.** Run 1 measured $0.0280 for 18
  calls. A paired run 2 on the six control files would be 36 calls, about
  $0.06.

**3. The address cue, narrowed** to the version 3c measured: uncited
address-like lines AFTER the first line any stop was read from.

- **The rule** is `cueLines`, shared by the strip and `ratecon:cue-report`,
  which now measures exactly what ships.
- **With nothing dropped,** it would fire on 1 of 6 control files (27) and
  5 of 13 template-read files. As first built in 3c it was 5 of 6 and 12 of
  13.
- **It cannot catch a dropped FIRST stop:** its lines come before any stop
  the read kept. A test pins this miss.
- **It still fires on an address after the stops** (a remit-to, a footer).
  A broker header before the stops is now silent.
- **With no stop quote in the text,** there is no first stop, and every
  uncited address line counts.
- **It still folds away** at the first keystroke in the load (3c).
  Unchanged.

**Tests:** 2680 in all (2639 before).

| File | Tests |
|---|---|
| `agree-reads.test.ts` (new) | 24 |
| `ratecon-fill.test.ts` | 1 more |
| `ratecon-eval.test.ts` | 64 (52 before) |
| `address-cue.test.ts` | 23 (20 before) |
| `ratecon-ai.test.tsx` | 1 more |

**Mutations,** each applied alone and reverted; every one fails at least one
test:

- **`agreeReads` (11):**
  - the smaller read gives the stops;
  - no count notice;
  - a blank against a value agrees;
  - the flag not compared;
  - the end date not compared;
  - an unconfirmed against a confirmed time agrees;
  - a differing appointment kept;
  - a differing field kept;
  - the type not compared;
  - the load number not compared;
  - extra stops dropped.
- **Pairs (7):**
  - one call made;
  - the call ceiling counts a pair as one;
  - the dollar ceiling prices one call;
  - read A filled instead of the merge;
  - read A scored on the merge;
  - a half-failed pair scored;
  - the plan counts a pair as one call.
- **The narrowing (3):**
  - no narrowing;
  - the load number's quote as the first stop;
  - silent with no stop quote.

**For Alex, before agreement goes into the app:**

- **Does it pay?** A paired run 2 on the six control files (36 calls,
  about $0.06) would show whether agreement removes sample 22's kind of
  WRONG, and what it costs in blanks. It needs its own written approval.
- **The caps:** each read would be two calls against the daily cap. Either
  the cap counts calls and halves the reads, or it is doubled. *Decided in
  3f: the cap counts reads, and a pair, failed or not, is one read.*
- **Latency:** the two calls run in parallel, so a read takes about as long
  as one call.

### Phase 3e: evaluation run 2, paired, the six control files (2026-10-14)

**Alex's written approval, 2026-10-14:** "Approved: ratecon:eval-ai with
--pairs on samples 1,18,19,22,23,27, 3 runs each (36 calls), Claude Haiku
5.5, ceilings $1.00 and 75 calls. These are the same six files whose
redacted text I reviewed in the viewer earlier today and found nothing that
should not be sent; the redaction has not changed since (only an export was
added). The account's default retention (inputs deleted within 30 days,
flagged ones possibly kept up to 2 years) is ACCEPTABLE."

**Checked before the run:**

- **`redact.ts` since run 1 (`428e8ae`):** the only change is the `export`
  on `selectPages`.
- **The six files' sent text** hashes the same as at review: 1
  `fb29410648b3`, 18 `468a682c66ec`, 19 `956b427864f6`, 22 `59d3639c56f8`,
  23 `90354f4c21b4`, 27 `1225bd3f09cf`.

**The command, run once, as given:**

    LLM_READER_MODEL=claude-haiku-5-5 npm run ratecon:eval-ai -- --approved=2026-10-14 --files=1,18,19,22,23,27 --runs=3 --pairs

**Result:**

| | |
|---|---|
| Calls | 36 of 36 |
| Tokens | 153,894 in, 81,584 out |
| Cost | **$0.0562**, about $0.0031 a pair (ceiling $1.00; bound-based most $0.1842) |
| Runs scored | **17 of 18.** Sample 22, run 1: `pair_incomplete (A invalid_output, B ok)`, so not scored |
| Pairs | **12 agreed, 5 differed** |
| WRONG on the bar, read A alone | **0** |
| WRONG on the bar, merged | **0** |
| WRONG on appointments, merged | **0** |
| Verdict | `incomplete`, exit 1: not a pass, because one run was not scored |

**Per run:**

| Sample | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| 1 | agree | agree | agree |
| 18 | agree | agree | agree |
| 19 | agree | agree | agree |
| 22 | not scored (A `invalid_output`) | agree | **differ:** appointment ×1 (stop 2) |
| 23 | agree | **differ:** appointment ×1 (stop 2) | agree |
| 27 | **differ:** appointment ×2 (stops 1 and 2) | **differ:** appointment ×1 (stop 1) | **differ:** appointment ×1 (stop 1) |

- **Only appointments ever differed.** No pair differed on the stop count,
  the load number, the type, the street, ZIP, city or state. No read
  dropped a stop this time.
- **Read A alone vs merged, on the bar:** 0 and 0. Agreement had no bar
  WRONG to remove in this run: run 1's dropped stop (1 read in 18) did not
  recur in 35 verified reads.

**Sample 27, stop 1's appointment:**

- **In all 3 runs, the two reads DISAGREED on it,** so the merge blanked it
  and marked it: `marked, filled differently (type, date, time, end time)`.
  In run 1 this appointment was WRONG in all 3 single reads. Here it is
  marked in all 3, never silently wrong.
- **This corrects 3d.** There I wrote that agreement would most likely NOT
  catch sample 27, as the same mistake made twice. The reads did not repeat
  each other: each pair split.
- **The parts named are the BLANK merged appointment against the ground
  truth,** so every part differs. They do NOT say which part either read
  got wrong. The script prints read A's WRONG only for the bar's fields,
  not per-read appointment diagnostics. So the question of which sub-field
  the model gets wrong on 27 stop 1 is still open. A diagnostic gap, not
  fixed: per-read appointment verdicts (names only) would answer it next
  time.

**What else agreement did to appointments:**

- **It blanked appointments the single reads usually got right.**
  - In run 1 these were `exact` whenever read: sample 27 stop 2 (pair 1)
    and sample 23 stop 2 (pair 2), 3 of 3 each; sample 22 stop 2 (pair 3),
    2 of 2 (the stop was missing in the third).
  - Each came out `marked, filled differently (…)`: a blank for the
    dispatcher to fill.
  - **That is the cost:** 3 of the 6 appointments blanked here were ones
    the model reads right whenever it reads them. The other 3 are sample 27
    stop 1, the one that was WRONG.
- **Sample 1, stop 2: `marked, filled differently (date)` in all 3 runs,**
  with both reads agreeing.
  - This is the same mistake made twice, as 3d predicted for some case. It
    is marked, so a dispatcher looks; it is not WRONG.
  - The template fills this appointment as the PDF says.

**The narrowed cue:**

- **It would have fired on 3 of 17 scored runs:** sample 27, every run, on
  L72 and L99.
- **No stop was dropped in any of them,** so all 3 are false alarms.
- This matches the offline count exactly: 27 was the 1 of 6 control files
  it fires on.

**A read that failed the schema:** sample 22, run 1, read A,
`invalid_output`. That is 1 of 36 reads; run 1 had none in 18. Under
`--pairs` the run is not scored, by design (3d). In the app, what a pair
with one failed read does is undecided.

### Phase 3f: each read diagnosed on its own; a failed pair fails whole (2026-10-14)

No API call, no use of the key, no document text or ground-truth value read
or printed.

**1. Each read is diagnosed on its own** (`ratecon:eval-ai`, both modes):

- **One line per read:** A, and B in `--pairs`. It gives that read's own
  bar WRONG count and, per stop, which appointment parts differ from the
  ground truth (names only):

      read A: 0 WRONG on the bar · appointments: stop 1 (window), stop 2 same

  The parts are `none-versus-set`, `type`, `date`, `time`, `window` and
  `end time`. A stop the read did not return is `missing`.
- **Why:** in run 2 only the MERGED appointment was diagnosed. A merged
  appointment the reads disagreed on is blank, so it differs in every part,
  and sample 27's reads could not be told apart. The next run says which
  part each read gets wrong.
- **At the end, in `--pairs`:** read B's own WRONG per bar field, beside
  read A's and the merged ones.
- **This replaces 3d's `read A alone: N WRONG on the bar`.**

**2. A pair where either read fails FAILS AS A WHOLE** (Alex, 2026-10-14):

- **The rule:** a read fails at the adapter, at the schema
  (`invalid_output`) or at the verifier (`nothing_confirmed`). The pair then
  fails with that code (read A's when A failed, else read B's) and fills
  nothing. It never falls back to the read that succeeded.
- **In code:** `agreePair(a, b)` in `agree-reads.ts`, and `agreeReads`'s
  comment states the caller's contract: call `agreePair`, not
  `agreeReads`, with the two outcomes.
- **In the eval:**
  - the run is `<code> (pair: A ok, B timeout)`;
  - nothing of either read is printed or scored;
  - the verdict is `incomplete` (so 3e's `pair_incomplete (…)` is now e.g.
    `invalid_output (pair: A invalid_output, B ok)`).
- **In the design** (§4, §5, §11 item 38):
  - a pair, failed or not, is ONE read against the cap: one reservation,
    two calls;
  - the strip says the AI read did not complete, with the code's own
    sentence, and fills nothing.
  - This replaces 3d's "two calls a read against the cap".
- **Not wired into the app:** no route, UI or cap code changed.

**Tests:** 2691 in all (2680 before).

| File | Tests |
|---|---|
| `agree-reads.test.ts` | 29 (24 before): the pair contract, including both reads failing |
| `ratecon-eval.test.ts` | 70 (64 before) |

The eval tests cover:

- per-read lines in single and paired runs;
- read B's own WRONGs;
- the merged appointment naming every part while the reads name only
  their own;
- a pair failing on read A's schema, read B's timeout, read B's nothing
  confirmed, and both failing.

The line-shape checks that keep text out of the output cover the new lines.

**Mutations,** each applied alone and reverted; every one fails at least one
test:

- a half-failed pair scored from the read that verified;
- read B diagnosed on read A's fill;
- a read diagnosed on the merge;
- single reads not diagnosed;
- `agreePair` ignoring a failed read B.

### Phase 3g: street and city in normal case (2026-10-14)

No API call, no use of the key, no document text or ground-truth value read
or printed. Nothing under `.samples/` was opened.

**Decision (Alex, 2026-10-14):** when a rate confirmation is filled, street
and city are shown in normal capitalization. Many PDFs print ALL CAPS
("DALLAS"); dispatchers want "Dallas".

- **Where:** `fillStop` in `ratecon-fill.ts`, the one seam both the template
  readers and the AI reader go through. Street and city only. State stays
  upper-case; ZIP, load number, appointment, marks and checks are untouched.
  Manual entry and the paste-address path are not touched.
- **When:** AFTER the read is verified, never before. `verify-read.ts`
  matches the model's quote against the printed line case-insensitively, so
  it and the AI prompt are unchanged. The `RateconRead`, each field's
  `source` line ("From p.1: “4001 MAIN ST”") and the agreement of two reads
  keep what was printed. Only the form's value changes.
- **Why:** the reader copies the PDF as printed. Capitals are how some
  brokers print, not what the dispatcher means to save.
- **Not a geocode matter:** `normalizeAddress` upper-cases first, so the
  geocode cache key and the "did the address change?" test do not move.

**The rule** (`src/lib/ratecon/normal-case.ts`, `normalCase(text)`, pure):

- Word by word, whitespace kept exactly. A word with any lowercase letter
  is left as is (it was mixed case on purpose: "McAllen"). An all-caps word
  becomes Title case.
- Hyphens and apostrophes split a word; each part is cased:
  "WINSTON-SALEM" -> "Winston-Salem", "O'FALLON" -> "O'Fallon".
- "Mc" + letter: "MCALLEN" -> "McAllen".
- Kept upper-case: N S E W NE NW SE SW, PO ("P.O." too), and a route prefix
  (I, US, FM, SH, CR, RR) followed by a number: "I-35", "US-90", "FM 1960".
- Ordinals lower-case the suffix: "1ST" -> "1st". Any other word with a
  digit, and "#", are untouched.
- "ST." -> "St."; ST, AVE, BLVD, HWY, RD, DR, LN, PKWY, STE -> "St", "Ave",
  and so on (plain Title case; no list is needed).
- Idempotent; a no-op on mixed-case input.
- **One addition to the rule as given:** after an apostrophe, S, T, D, M,
  LL, RE and VE go lower-case when the part before is two letters or more
  ("JOHN'S" -> "John's", "DON'T" -> "Don't"). Without it the directional
  rule would have produced "John'S". "O'FALLON" and "D'IBERVILLE" are
  unaffected.

**Known limit (do not fix with a list):** a name whose capitals are inside
the word cannot be recovered from all-caps. "DEKALB" comes out "Dekalb",
"MLK BLVD" comes out "Mlk Blvd", "JFK" comes out "Jfk". The dispatcher sees
the field filled, with its source line (printed in capitals) under it, and
edits it. A mixed-case word is never touched, so a PDF that prints "DeKalb"
is right.

**Scripts:** `ratecon:score` and `ratecon:eval-ai` (through
`ratecon-eval.mts`) both run `fillLoad` and compare the form's street and
city to `expected.json`, so they pick the change up with no edit. How they
print is unchanged; neither prints a value or a file name.
**For Alex:** an existing `expected.json` street or city typed in capitals
will now score WRONG. Retype it in normal case (a mixed-case word as the PDF
prints it). `docs/ground-truth-howto.md` now says so.

**Tests:** 2716 in all (2691 before).

| File | Tests |
|---|---|
| `normal-case.test.ts` | 18 (new): every rule above, idempotence, the mixed-case no-op |
| `ratecon-fill.test.ts` | 33 (26 before): all-caps read in normal case, mixed case unchanged, state and ZIP untouched, sources keep the printed line, marks and checks unchanged, an AI read in capitals |

Three tests outside those files expected the fixture's printed capitals in
the form and now expect normal case (the invented fixture still prints
"FARGO" and "DICKINSON"): two in `ratecon-strip.test.tsx`, and the e2e
`ratecon-fill.spec.ts` (form and saved row; it passes). `ratecon-ai.test.tsx`
and `agree-reads.test.ts` needed no change: reads are compared before
`fillLoad`, on what was printed.

**Mutations,** each applied alone and reverted; every one fails at least one
test:

- state also normalized;
- a source line normalized;
- a city's "Not found in the PDF." mark dropped.

Doing the second showed my first "sources keep the printed line" test was
vacuous (its fixture had no capitals in the source line); it was
strengthened and re-checked.

### Phase 3h: evaluation run 3, paired, samples 2, 4, 9, 17 and 28 (2026-10-14)

**Approval (Alex, 2026-10-14, written):** `ratecon:eval-ai --pairs` on
samples 2, 4, 9, 17 and 28, 3 runs each (30 calls), Claude Haiku 5.5,
ceilings $1.00 and 75 calls.

- Alex read the redacted text of each of the five in the viewer that day
  and found nothing that should not be sent. Samples 7, 8, 10, 11, 12, 16
  and 21 were NOT approved.
- The ground truth for the five is written, in normal case (as the app now
  fills), and passes `ratecon:check-expected`.
- The account's default retention (inputs deleted within 30 days, flagged
  ones possibly kept up to 2 years) was accepted for this run only.

**Checked before the run:**

- **`redact.ts`:** byte-identical to its state at run 2 (`9daac76`); `git
  diff` empty. No commit since then touches `redact.ts`, `lines.ts`,
  `read-pdf.ts`, `pdf.worker.ts`, `templates.ts`, `model-read.ts`,
  `verify-read.ts`, the reader server or the redaction report. Since run 1
  (`428e8ae`) the only change is the `export` on `selectPages`, which run 2
  already carried.
- **Sent text,** sha256 (first 12): 2 `a72717aa76c5`, 4 `f38cb9922cfe`,
  9 `dc2a776ec7f4`, 17 `1afe327813da`, 28 `0b03d4a2f36d`.

**The command, run once, as given** (not re-run; nothing about the
reader's settings was changed, it stays off):

    LLM_READER_MODEL=claude-haiku-5-5 npm run ratecon:eval-ai -- --approved=2026-10-14 --files=2,4,9,17,28 --runs=3 --pairs

**Result: the bar is NOT met (12 WRONG, merged). Exit 1.**

| | |
|---|---|
| Calls | 30 of 30 planned (ceiling 75) |
| Tokens | 173,910 in, 64,628 out |
| Cost | $0.0497 (ceiling $1.00) |
| Runs scored | 15 |
| Pairs | 12 agreed, 3 differed |
| Address cue | would fire on 6 of 15 runs |

Every call returned `ok`; there was no adapter, schema or verifier failure.

**Merged WRONG, by field:** load number 0, stop count 3, order + type 0,
street 6, ZIP 3, city 0, state 0.
**Read A alone:** stop count 3, street 10, ZIP 3 (16). **Read B alone:**
stop count 3, street 8, ZIP 3 (14).

**Per file** (3 runs each; counts only):

| Sample | Pairs | Merged WRONG on the bar | Notes |
|---|---|---|---|
| 2 | 3 agreed | 0 | everything exact, every run; cue silent |
| 4 | 3 agreed | 0 | stop 1's ZIP blank and marked in both reads, every run; both appointments marked, "filled as the PDF says"; cue silent |
| 9 | 3 agreed | 9 (3 a run: street on both stops, stop 2's ZIP) | both reads agree on every wrong value, and each is "verified"; stop 2's appointment differs in time (marked); in runs 2 and 3 both stops' order + type marked; cue fires every run on 5 lines |
| 17 | 3 differed | 0 | the reads differed on street x2 every run; the merge blanked and marked both streets. One read alone had 2 WRONG streets in each run (A in runs 1 and 3, B in run 2); cue silent |
| 28 | 3 agreed | 3 (stop count, every run) | both reads return 3 stops, ground truth has 2; stop 2's appointment differs in date (marked); cue fires every run on 4 lines |

**What the counts say (no values looked at):**

- The cue fired on exactly the two files with merged WRONG (9 and 28), and
  was silent on the other three.
- Two-read agreement did its job on 17: a disagreement became a mark, not a
  WRONG. It cannot help on 9 and 28, where both reads agree.
- Sample 9's WRONGs are in verified fields on which both reads agree, and
  one is a ZIP, which the case change cannot explain. Whether the read or
  the ground truth is wrong is not decidable from counts; it is the first
  thing to look at. Same for sample 28's third stop.
- Nothing was fixed. What to change is Alex's call.

### Phase 3i: a ZIP that cannot exist is not put in the form (2026-10-14)

No API call, no use of the key, no `ratecon:eval-ai`. Nothing under
`.samples/` was opened.

**Decision (Alex, 2026-10-14):** a ZIP the reader found but that cannot be a
US ZIP is treated as not given.

- **Why:** a rate confirmation can print a placeholder ZIP such as `00001`
  (a broker system's default). Both AI reads copied it and the verifier
  confirmed it against the text, so a dispatcher would have got a plausible
  wrong ZIP with no mark. Evaluation run 3 (3h) had a ZIP WRONG on sample 9
  that the case change could not explain; this is the reason that was
  decided for it. (It was not checked against the ground truth here: no
  `.samples/` value was read.)
- **The rule** (`isRealUsZip`, `src/lib/ratecon/us-zip.ts`, pure): the
  first five digits, numerically, must be 00501 or more (00501 is the
  lowest assigned US ZIP). 00000 to 00500 are not ZIPs. Five digits or
  ZIP+4 (hyphen or not); a +4 never lifts a placeholder over the line;
  an empty string, or any other shape, is not a ZIP. The readers only ever
  produce five digits, so nothing that was accepted before is now refused
  except below 00501.
- **Where:** `fillStop` in `ratecon-fill.ts`, in the address loop, so the
  template readers and the AI reader are covered together. The form's ZIP
  stays blank, no source is kept for it, and the field gets the check
  `ZIP_NOT_REAL`: "Check: the PDF's ZIP is not a real US ZIP. Enter it by
  hand." The value is not repeated in the message. The read, its source line
  and the verifier keep what was printed; `verify-read.ts` and the AI prompt
  are unchanged.
- **It comes out as a ZIP not found does:** blank, a check (so "fields to
  check" counts it), the zone left for the dispatcher to confirm where the
  state spans two. For an AI read the blank is a check, not an AI mark
  (`aiMarkedFields` does not list `zip`). Only the wording differs from
  "Not found in the PDF."
- **Not done, by decision:** no ZIP-to-state check beyond today's
  `zipStateCheck`, no lookup table, no external service. State, street, city
  and the ZIP formats accepted elsewhere are untouched.
- **Ground truth** (`docs/ground-truth-howto.md`): a ZIP below 00501 printed
  in the PDF is `""`. **For Alex:** an `expected.json` ZIP written as
  `00001` will now score WRONG; change it to `""`.
- **No known issue** about "ZIP 00001 is copied as printed" was written in
  this file, so none was closed. No existing test used a placeholder ZIP as
  a fixture; none was changed.

**Tests:** 2728 in all (2716 before).

| File | Tests |
|---|---|
| `us-zip.test.ts` | 6 (new): 00000, 00001, 00500 refused; 00501, 10001, 60450, 99950 accepted; ZIP+4 follows the first five digits; empty and malformed refused |
| `ratecon-fill.test.ts` | 39 (33 before): 00001 blank + marked with the other fields and their sources unchanged; equal to a ZIP not found (form, zone, count); 00000, 00500, ZIP+4 refused and 00501 and a real ZIP filled; the other stop untouched; a model read keeps `00001` in the read and blanks it in the form, with no AI mark (`aiMarks` 11 fields, not 12) |

**Mutations,** each applied alone and reverted; every one fails at least one
test:

- blank without the mark;
- the refused ZIP keeping its source line;
- the rule off for AI reads only.

### Phase 3j: evaluation run 4, paired, samples 2, 4, 9, 17 and 28 (2026-10-14)

**Approval (Alex, 2026-10-14, written):** a re-run of phase 3h's run: the
same five samples, 3 runs each (30 calls), Claude Haiku 5.5, ceilings $1.00
and 75 calls. Since 3h, Alex corrected the ground truth for samples 9 and 28
(typing errors, and a missing third stop on 28), and 3i changed what the
fill does with a ZIP below 00501. 3h's WRONG counts for 9 and 28 therefore
do not stand. Retention (30 days default, flagged up to 2 years) accepted
for this run. I did not read the ground truth.

**Checked before the run:**

- The tree was clean. `redact.ts` is byte-identical to 3h (`b6370ca`), and
  no commit since then touches the sent-text path (`redact`, `lines`,
  `read-pdf`, `pdf.worker`, `templates`, `model-read`, `verify-read`, the
  reader server, the redaction report, `ratecon-eval-ai`, `ratecon-eval`).
  The only files changed were the fill, its tests, `us-zip` and docs.
- **Sent-text hashes** equal 3h's, all five: 2 `a72717aa76c5`, 4
  `f38cb9922cfe`, 9 `dc2a776ec7f4`, 17 `1afe327813da`, 28 `0b03d4a2f36d`.
  So the model saw the same text as in 3h; every difference below is the
  ground truth, the fill, or the model's own variation between runs.

**The command, run once, as given** (not re-run; nothing about the reader's
settings was changed, it stays off):

    LLM_READER_MODEL=claude-haiku-5-5 npm run ratecon:eval-ai -- --approved=2026-10-14 --files=2,4,9,17,28 --runs=3 --pairs

**Result: the bar is NOT met, with 1 WRONG (3h: 12). Exit 1.**

| | 3h | 3j |
|---|---|---|
| Calls | 30 of 30 | 30 of 30 (ceiling 75) |
| Tokens | 173,910 in, 64,628 out | 173,910 in, 65,094 out |
| Cost | $0.0497 | $0.0499 (ceiling $1.00) |
| Runs scored | 15 | 15 |
| Pairs | 12 agreed, 3 differed | 12 agreed, 3 differed |
| Address cue fires | 6 of 15 | 6 of 15 |

Every call returned `ok`.

**Merged WRONG, by field:**

| Field | 3h | 3j |
|---|---|---|
| load number | 0 | 0 |
| stop count | 3 | 0 |
| order + type | 0 | 0 |
| street | 6 | 1 |
| ZIP | 3 | 0 |
| city | 0 | 0 |
| state | 0 | 0 |
| **all** | **12** | **1** |

**Each read alone:** A 16 -> 1 (street 1); B 14 -> 3 (street 3).

**Per sample** (merged WRONG on the bar; "marked" is not WRONG):

| Sample | 3h | 3j | What changed |
|---|---|---|---|
| 2 | 0 | 0 | nothing: all exact, 3 pairs agreed, cue silent |
| 4 | 0 | 0 | nothing: stop 1's ZIP blank and marked in both reads, every run; both appointments marked "filled as the PDF says"; cue silent |
| 9 | 9 | **0** | street WRONG gone on both stops; stop 2's ZIP went from verified WRONG to **blank and marked** in all 3 runs; stop 2's appointment still differs in time between the fill and the ground truth (marked); order + type marked on stop 1 in runs 1 and 3 and on stop 2 in run 3 (3h: both stops in runs 2 and 3); run 3's pair **differed** (appointment x1; 3h: all 3 agreed); cue still fires on 5 lines every run |
| 17 | 0 | **1** | pairs: street x1 differed in runs 1 and 2, run 3 agreed (3h: street x2 differed in all 3). Runs 2 and 3: both streets blank and marked. **Run 1: stop 1's street is verified WRONG**, agreed by both reads (stop 2's blank and marked). Each read alone: A 4 -> 1, B 2 -> 3 |
| 28 | 3 | **0** | stop count 3 read, 3 expected (3h: 3 read, 2 expected) in all 3 runs; stops 2 and 3's appointments are marked "filled as the PDF says" (3h: stop 2 differed in date); cue still fires on 4 lines every run |

**What the counts say (no values looked at):**

- Samples 9 and 28 went to 0 WRONG on the bar. The ground-truth corrections
  and the ZIP rule account for it; the output does not say which of the two
  did what. A blank-and-marked ZIP looks the same whether the reader found
  none or 3i refused a placeholder.
- The one WRONG is sample 17, run 1, stop 1's street. It is the only
  filled-and-wrong value left, it is in 1 of 15 runs, and both reads
  agreed on it, so two-read agreement cannot catch it. In the other two
  runs of the same file the merged street is blank and marked. Sample 17's
  streets are unstable from run to run on identical text.
- The cue fires on 6 of 15 runs, all on samples 9 and 28, which are now at
  0 WRONG. On 28 all three stops are read and the cue still names 4 lines;
  on 9, 5. So it is not finding a dropped stop in these runs; whether those
  lines are anything else is not decidable from line numbers.
- Nothing was fixed. Whether to turn the reader on is Alex's call, after
  reading the result together.

### Phase 3k: evaluation run 5, paired, samples 2, 4, 9, 17 and 28 (2026-10-14)

**Approval (Alex, 2026-10-14, written):** a re-run of phase 3j's run: the
same five samples, 3 runs each (30 calls), Claude Haiku 5.5, ceilings $1.00
and 75 calls. Since 3j, Alex corrected the ground truth for the two streets
on sample 17 (they had abbreviations the PDF does not print); 3j's one WRONG,
on sample 17, was against the old truth. Retention (30 days default, flagged
up to 2 years) accepted for this run. I did not read the ground truth.

**Checked before the run:**

- The tree was clean. The only file changed since 3j's code (`862c393`) was
  `docs/HANDOFF.md`; no commit touches the sent-text path; `redact.ts` is
  identical.
- **Sent-text hashes** equal the 3j section's, all five: 2 `a72717aa76c5`, 4
  `f38cb9922cfe`, 9 `dc2a776ec7f4`, 17 `1afe327813da`, 28 `0b03d4a2f36d`.

**The command, run once, as given** (not re-run; nothing about the reader's
settings was changed, it stays off):

    LLM_READER_MODEL=claude-haiku-5-5 npm run ratecon:eval-ai -- --approved=2026-10-14 --files=2,4,9,17,28 --runs=3 --pairs

**Result: the bar is NOT met, with 1 WRONG (3j: 1). Exit 1.**

| | 3j | 3k |
|---|---|---|
| Calls | 30 of 30 | 30 of 30 (ceiling 75) |
| Tokens | 173,910 in, 65,094 out | 173,910 in, 65,817 out |
| Cost | $0.0499 | $0.0503 (ceiling $1.00) |
| Runs scored | 15 | 15 |
| Pairs | 12 agreed, 3 differed | 11 agreed, 4 differed |
| Address cue fires | 6 of 15 | 6 of 15 |

Every call returned `ok`.

**Merged WRONG, by field:** street 1 (3j: 1); load number, stop count,
order + type, ZIP, city and state 0, as in 3j. **Each read alone:** A 1 -> 3
(street), B 3 -> 2 (street).

**Per sample** (merged WRONG on the bar; "marked" is not WRONG):

| Sample | 3j | 3k | What changed |
|---|---|---|---|
| 2 | 0 | 0 | nothing: all exact, 3 pairs agreed, cue silent |
| 4 | 0 | 0 | nothing: stop 1's ZIP blank and marked, both appointments marked "filled as the PDF says", cue silent |
| 9 | 0 | 0 | stop 2's ZIP blank and marked and its appointment time differing (marked) in all 3 runs, cue 5 lines: all as in 3j. Run 2's pair **differed** (appointment x1; 3j: run 3), runs 1 and 3 agreed. Order + type marked on both stops in run 1 only (3j: stop 1 in runs 1 and 3, stop 2 in run 3) |
| 17 | 1 | **1** | **the same one:** run 1, stop 1's street, verified WRONG, agreed by both reads; stop 2's street blank and marked. The ground-truth correction did not change it. Run 2: pair agreed, both streets blank and marked (3j: differed x1). Run 3: pair differed on street x2, both blank and marked (3j: agreed). Each read alone: A 1 -> 3, B 3 -> 2 |
| 28 | 0 | 0 | stop count 3 read, 3 expected, stops 2 and 3's appointments marked "filled as the PDF says", cue 4 lines: as in 3j. Run 3's pair **differed** (street x1) and the merge blanked and marked stop 1's street (3j: all 3 agreed) |

**What the counts say (no values looked at):**

- The one WRONG is the same cell as in 3j: sample 17, run 1, stop 1's
  street. Run 1's per-read counts for 17 are the same as in 3j (A 1, B 2).
  The truth was corrected and the cell did not move. Counts cannot say
  whether the read is wrong or the truth still differs from the printed
  line; that needs the two values side by side.
- Sample 17's streets remain unstable on identical text: filled and wrong in
  one run, blank and marked (by the reads differing, or by both failing to
  find a value) in the other two. Every other filled value across the
  five files is exact.
- The pairs that differed moved around (17 in 2 runs, 9 in 1, 28 in 1; 3j:
  17 in 2, 9 in 1). Each time the merge turned a difference into a mark,
  never a WRONG.
- The cue fires on the same 6 runs, all on samples 9 and 28, at 0 WRONG.
- Nothing was fixed. Whether to turn the reader on is Alex's call.

### Phase 3l: evaluation run 6, paired, samples 2, 4, 9, 17 and 28 (2026-10-14)

**Approval (Alex, 2026-10-14, written):** a re-run of phase 3k's run: the
same five samples, 3 runs each (30 calls), Claude Haiku 5.5, ceilings $1.00
and 75 calls. Since 3k, Alex corrected the ground truth for the two streets
on sample 17: the entries had a street suffix the PDF never prints, and
abbreviated directions. The one WRONG in 3j and 3k, on sample 17, was
against that wrong truth, so the 3k result does not stand for that cell.
Retention (30 days default, flagged up to 2 years) accepted for this run. I
did not read the ground truth.

**Checked before the run:**

- The tree was clean. The only file changed since the code of 3k
  (`862c393`) was `docs/HANDOFF.md`; no commit touches the sent-text path;
  `redact.ts` is identical.
- **Sent-text hashes** equal the 3k section's, all five: 2 `a72717aa76c5`, 4
  `f38cb9922cfe`, 9 `dc2a776ec7f4`, 17 `1afe327813da`, 28 `0b03d4a2f36d`.

**The command, run once, as given** (not re-run; nothing about the reader's
settings was changed, it stays off):

    LLM_READER_MODEL=claude-haiku-5-5 npm run ratecon:eval-ai -- --approved=2026-10-14 --files=2,4,9,17,28 --runs=3 --pairs

**Result: the bar is MET, with zero WRONG (3k: 1). Exit 0.**

| | 3k | 3l |
|---|---|---|
| Calls | 30 of 30 | 30 of 30 (ceiling 75) |
| Tokens | 173,910 in, 65,817 out | 173,910 in, 65,652 out |
| Cost | $0.0503 | $0.0502 (ceiling $1.00) |
| Runs scored | 15 | 15 |
| Pairs | 11 agreed, 4 differed | 12 agreed, 3 differed |
| Address cue fires | 6 of 15 | 6 of 15 |

Every call returned `ok`.

**WRONG on the bar's fields:** merged 0 in all seven (3k: street 1). Read A
alone 0 (3k: 3). Read B alone 0 (3k: 2).

**Per sample** (merged WRONG on the bar; "marked" is not WRONG):

| Sample | 3k | 3l | What changed |
|---|---|---|---|
| 2 | 0 | 0 | nothing: all exact, 3 pairs agreed, cue silent |
| 4 | 0 | 0 | nothing: stop 1's ZIP blank and marked, both appointments marked "filled as the PDF says", cue silent |
| 9 | 0 | 0 | all 3 pairs agreed (3k: 2 agreed, 1 differed). Order + type marked on both stops in run 1 only, as in 3k. Stop 2's ZIP blank and marked and its appointment time differing (marked) in all 3 runs, cue 5 lines: as in 3k |
| 17 | 1 | **0** | the 3k WRONG is gone. Pairs: street x2 differed in all 3 runs (3k: 2 differed, 1 agreed). Both merged streets are blank and marked in all 3 runs. Read A alone: 11 values stood, 0 did not, 0 WRONG, every run; read B alone: 9 stood, **2 did not**, 0 WRONG, every run |
| 28 | 0 | 0 | all 3 pairs agreed (3k: run 3 differed). 3 stops read, 3 expected; stops 2 and 3's appointments marked "filled as the PDF says"; cue 4 lines: as in 3k |

**What the counts say (no values looked at):**

- The WRONG that stood through 3j and 3k is gone with the corrected truth,
  as Alex said. Read A's values for sample 17 are all exact against it.
- **What "met" does and does not say.** The bar counts filled values that are
  wrong and unmarked. It is zero here, but sample 17's two streets are
  **blank and marked in all 3 runs**: read B's two streets fail the
  verifier every run, so the pair differs and the merge leaves them for the
  dispatcher. Samples 4 and 9 also leave a ZIP blank and marked in every run
  (the output does not say whether the reader found none or 3i refused a
  placeholder), and 9 and 28 carry marked appointments. The bar is met
  without those fields being filled.
- The cue fires on the same 6 runs, all on samples 9 and 28, at 0 WRONG.
- The scope is 5 of the 25 ground-truth files, 3 runs each, 15 scored runs,
  one model. The six control files (1, 18, 19, 22, 23, 27) were run in 3b
  and 3e, before the fixes since (the cue, agreement, normal case, the ZIP
  rule), and not re-run on this code. Samples 7, 8, 10, 11, 12, 16 and 21
  are not reviewed by Alex and not approved to send; the rest have not been
  sent.
- Nothing was fixed. Whether to turn the reader on is Alex's call.

### Phase 3m: the app runs the pair (2026-10-14)

No API call, no use of the key, no document text or ground-truth value read
or printed, nothing under `.samples/` opened, and **the reader stays OFF**:
`LLM_READER_ENABLED` is set in no env file (the e2e server sets it itself,
with the fake vendor). `ratecon:eval-ai` was not run; it was only shown to
still refuse without a valid `--approved`.

**Why:** the evaluation (3h to 3l) measured a PAIR of reads merged by
agreement, but the route and the browser made a single read, so the app did
not run what was measured. It does now.

**The decisions already made (Alex) were not reopened:** a pair, failed or
not, is ONE read against the daily cap (one reservation, two vendor calls);
a pair where either read fails (adapter, schema, or the verifier's
`nothing_confirmed`) fails as a whole, with a code, and fills nothing; it
never falls back to the read that succeeded; the route does not verify, the
browser verifies each reply against exactly the lines it sent and then
merges.

**1. The route** (`handle-read.ts`; the order of checks is unchanged):

- After the same checks and the same single reservation, **two vendor calls
  with the same redacted lines, made at once** (`Promise.all`), so a request
  stays inside the existing time limit. Both get one signal: the server's
  25 s timeout joined with the request's cancellation, so a timeout or a
  Cancel reaches both.
- **Either call failing** (adapter, or the schema) fails the request with
  that code (**read A's when A failed, else read B's**) and returns neither
  reply. On success: `{ ok: true, reads: [A, B] }`.
- **What the counts row now means for a pair.** Still **one row per pair**,
  and it counts what it already counted: the **outcome is the pair's** (`ok`,
  or the failing read's code), **`input_tokens` and `output_tokens` are both
  calls' summed** (a failed pair keeps the tokens of every call that was
  billed; both empty when neither reported any), `lines_sent` is the lines
  once, `vendor` as before. No column, no migration.
- **The one log line** is per failed pair: the failing read's code and
  vendor status, as before; a schema failure and a cancel are not logged, as
  before. Nothing from a document or a vendor is logged or returned.

**2. The shared function** (`src/lib/ratecon/read-pair.ts`, `readPair`; pure):

- It does exactly what `ratecon-eval.mts` did privately: verify each reply
  against the sent lines, `agreePair`, the fill's input (layout `model`),
  `notices`, `differed`, and the cue (a line either read cited is used). Its
  failure carries no read: `{ ok: false, code, codes: [A's, B's] }`.
- The **eval's private copy was moved, not duplicated**: it now calls
  `readPair`. Its output is unchanged (its 70 tests pass as they were). The
  eval's single-read mode (no `--pairs`) still verifies its lone reply with
  `verifyRead`, as does `reader:smoke`: both are diagnostics that fill no
  form.

**3. The browser:**

- `requestModelRead` is gone; `requestModelReads` returns both replies or a
  code, and a reply list that is not exactly two schema-valid reads is
  `invalid_output` (so the old `{ ok: true, read }` shape is refused).
- The strip calls `readPair`, shows the **agreement notices** (the two stop
  counts when they differ; how many fields were blanked and marked) under its
  line, and the blanked fields carry their own marks. The AI marks and
  checks behave as before. A pair counts once in "N read with AI".
- **A failed pair** fills nothing and says "The AI read did not complete."
  and then the code's own sentence (for `timeout`, `unavailable`,
  `vendor_capped`, `refused`, `invalid_output`, `nothing_confirmed`). This
  changes the words of those failures from before 3m (they led with the
  code's sentence alone); the limits, the body's checks, Cancel and the
  server's own `error` are worded as before.
- **No path fills the form from one AI read** (proved, not argued):
  `src/test/pair-only.test.ts` scans the code, without its comments, and
  fails if `requestModelRead` returns, if anything but `readPair` calls
  `verifyRead` in the app, if the strip reads `.reads`, `.verified` or a lone
  reply, if `agreeReads` is called outside `agreePair`, if the route answers
  with a single `read`, or if the eval copies the pair logic.

**4. The fake and its script:** the fake plays its steps in call order, so
two concurrent calls take step 1 (read A) and step 2 (read B), whatever each
step's delay; it now records each call's signal, so a test can show a cancel
reached both. The e2e script holds **two steps per read**; a script whose
second step is `{ "fail": "unavailable" }` fails read B.

**Cost and caps (unchanged, counting reads):**

- **Per read, now a pair:** about **$0.0033** on Haiku 5.5, from 3l's
  $0.0502 for 15 pairs (30 calls); about $0.0017 a call, and run 1's single
  read was $0.0016. The doubling is vendor spend only.
- The **daily caps stay 25 a user and 100 a day** and still count READS
  (one reservation a pair). The per-user rate limit stays 3 at once, then 1 a
  minute, per request. At the cap's worst case (100 reads a day) the vendor
  spend is about $0.33 a day on Haiku.

**Tests:** 2775 in all (2728 before).

| File | Tests |
|---|---|
| `read-pair.test.ts` (new) | 13: agree, differ on a field, differ on stop count, a read confirming nothing, A/B/both failing (A's code), the cue's intersection, no input changed |
| `pair-only.test.ts` (new) | 7: the single-read path is gone; the eval calls the strip's function |
| `handle-read.test.ts` | 42 (31 before): two calls, one reservation; both replies or a code and neither; each failure; cap counts reads; calls at once; cancel and timeout reach both; tokens summed |
| `read-client.test.ts` | 20 (15 before) |
| `ratecon-ai.test.tsx` | 29 (21 before): agree, differ, stop counts, notices, a failed pair, no fallback to the read that stood, one count a pair |
| `fake.test.ts` | 10 (7 before) |

**Changed to follow the contract:** the route, client, strip and e2e tests
now send and expect `reads: [A, B]`; the strip's failure sentences for the
pair codes carry the "did not complete" lead. The Anthropic route tests
return a fresh `Response` per call (a body reads once) and expect doubled
tokens.

**e2e** (`e2e/ratecon-ai.spec.ts`, run on its own with `ratecon-fill` and
`reader-key-bundle`; `npm run check` does not run it): 6 passed. It covers a
pair, a pair whose second read fails (nothing filled, one row, read A's
tokens), and a pair whose reads differ. Its probe of the route is replaced
by a check of the strip: the probe spent one of the user's three reads a
minute, and the file makes exactly three.

**Mutations,** each applied alone and reverted; every one fails at least one
test:

- the calls run one after the other;
- a half-failed pair falls back to the read that stood (route; `readPair`);
- only the first call's tokens in the row;
- B's code when both failed;
- the request's cancel not given to the calls;
- a second reservation per call;
- the cue as a union instead of an intersection;
- the strip dropping the notices;
- the strip saying the bare sentence for a failed pair.

**Found while building (for Alex to weigh; none changed):**

1. **A pair is as available as both of its calls.** If a call fails with
   probability p, a pair fails with about 2p. That follows from "fails as a
   whole"; it was not measured (all 30 calls in 3l returned `ok`).
2. **A failed pair still pays for both calls.** The other call is not
   cancelled when one fails, so the row's tokens are complete. Cancelling it
   early would save money on a failed pair and lose its token count.
3. **The eval's default (single) mode now measures something the app no
   longer does.** It is kept as a diagnostic; every approved run so far has
   used `--pairs`. Removing it would be a separate change.
4. **Two concurrent calls from one request** meet the vendor's rate limits
   sooner (a 429 is `unavailable`).

### Phase 3n: evaluation run 7, paired, samples 7, 8, 10, 11, 12, 16 and 21: the out-of-sample test (2026-10-14)

**Approval (Alex, 2026-10-14, written):** `ratecon:eval-ai --pairs` on samples
7, 8, 10, 11, 12, 16 and 21, 3 runs each (42 calls), Claude Haiku 5.5,
ceilings $1.00 and 75 calls. These seven are files the reader had not been
run on or tuned against: the out-of-sample test of the bar. Alex read the
redacted text of each in the viewer that day and found nothing that should
not be sent, and checked every street, city and ZIP in the ground truth
against the PDF text. Retention (30 days default, flagged up to 2 years)
accepted for this run. I did not read the ground truth.

**Checked before the run:**

- The tree was clean. Since the code of 3l (`862c393`): `redact.ts` is
  byte-identical, and **no file on the sent-text path changed** (redaction,
  lines, PDF reading, templates, the model's instruction and schema, the
  verifier, the cue, agreement, the vendor adapters, the redaction report,
  the eval command). What did change is the app's route, client and strip
  (3m), and `ratecon-eval.mts` internally: it now calls `readPair`, with
  output unchanged (3m).
- **Sent-text hashes** (first 12 of sha256): 7 `e83b8114d30b`, 8
  `2097af1b29cd`, 10 `5a57dd07b1ad`, 11 `432dc67b6e7f`, 12 `afd147515071`,
  16 `10c8f0f51354`, 21 `77b64d5b9b8e`.

**The command, run once, as given** (not re-run; nothing about the reader's
settings was changed, it stays off):

    LLM_READER_MODEL=claude-haiku-5-5 npm run ratecon:eval-ai -- --approved=2026-10-14 --files=7,8,10,11,12,16,21 --runs=3 --pairs

**Result: the bar is NOT met, with 10 WRONG, all on street. Exit 1.**

| | 3l (samples 2, 4, 9, 17, 28) | 3n (samples 7, 8, 10, 11, 12, 16, 21) |
|---|---|---|
| Calls | 30 of 30 | 42 of 42 (ceiling 75) |
| Tokens | 173,910 in, 65,652 out | 184,500 in, 100,641 out |
| Cost | $0.0502 | $0.0688 (ceiling $1.00) |
| Runs planned / scored | 15 / 15 | 21 / **20** |
| Pairs | 12 agreed, 3 differed | **10 agreed, 10 differed** |
| Address cue fires | 6 of 15 | 6 of 20 |
| Merged WRONG on the bar | 0 | **10** |

**One pair failed:** sample 16, run 2, `invalid_output` (read A's reply
failed the schema, read B was fine). The pair failed as a whole, filled
nothing and was not scored; its tokens are counted. In 3l none of 15 failed.

**Merged WRONG, by field:** street 10; load number, stop count, order +
type, ZIP, city and state 0. **Each read alone:** A street 16, B street 12
(nothing else). Where the two reads differed on a street (sample 12, runs 1
and 2), the merge blanked and marked it, so agreement removed those; it
cannot remove a value both reads share.

**Per sample** (merged WRONG on the bar; "marked" is not WRONG):

| Sample | Pairs (3 runs) | Merged WRONG | What the output shows |
|---|---|---|---|
| 7 | 2 differed (appointment x1; city x1 and state x1), 1 agreed | 0 | stop 2's ZIP blank and marked every run; in runs 2 and 3 its city and state too; appointments marked, filled differently from the truth; cue silent |
| 8 | 3 agreed | **6** | street WRONG on stops 2 and 3 in all 3 runs, both reads agreeing on each; stop 3's appointment time differs (marked); cue silent |
| 10 | 2 differed (appointment x2; x1), 1 agreed | 0 on the bar | stop 1's ZIP blank and marked every run. **Appointment WRONG (time) on stop 2 in runs 2 and 3**, unmarked, both reads agreeing (in run 1 the reads differed and it was blanked); cue silent |
| 11 | 2 differed (appointment x2, both runs), 1 agreed | 0 | stop 2's ZIP blank and marked every run; marked appointments; cue silent |
| 12 | 2 differed (street x4, in runs 1 and 2), 1 agreed | **1** | runs 1 and 2: all four streets blank and marked. Run 3: **stop 4's street WRONG**, both reads agreeing. ZIPs on stops 2 to 4 blank and marked; stop 1's appointment differs (type, end time; marked); cue fires every run, on the same 3 lines |
| 16 | 2 differed (appointment x2, both scored runs), **1 pair failed** | 0 | appointments blanked and marked on both stops; cue silent. Scored in 2 of 3 runs |
| 21 | 3 agreed | **3** | stop 1's street WRONG in all 3 runs, both reads agreeing; both stops' appointments marked, filled differently (type, date, time, end time); cue fires every run, on the same 2 lines |

**What the counts say (no values looked at):**

- **The 10 WRONG are 4 cells, not 10 independent errors:** sample 8 stops 2
  and 3, sample 21 stop 1 (each WRONG in all 3 runs, both reads agreeing),
  and sample 12 stop 4 (run 3 only). Three of the four are identical across
  runs and across both reads, which looks like something systematic rather
  than the model varying. Counts cannot say what. Candidates for Alex to
  check, cell by cell, against the PDF's own line: the form's value vs the
  truth after `normalCase` (a name printed in capitals whose capitals the
  rule cannot recover is the documented known limit, 3g); a street value
  that is a part of the printed line; or the truth. City, ZIP and state have
  no WRONG at all.
- **Two appointments are wrong and unmarked** (sample 10, stop 2, runs 2
  and 3, time). The bar's seven fields do not include the appointment, so
  they are not in the 10, but they are the silent kind. Both reads agree on
  the time in run 3 and in run 2, so agreement did not catch them.
- **Agreement differed on half the pairs** (10 of 20 scored; 3l: 3 of 15).
  Most of the differences are in appointments (7, 10, 11, 16), each turned
  into a blank and a mark. This is the out-of-sample behaviour the
  in-sample files did not show.
- **The cue** fired on 6 of 20 runs, on samples 12 and 21 only. It was
  silent on sample 8, whose three WRONG streets are wrong values, not
  dropped stops.
- **Cost** per scored pair was about $0.0033 as in 3l; output tokens per
  call were higher (about 2,400 against 2,200).
- **Scope:** 7 of the 25 files, 3 runs each, one model. With 3l's five,
  12 files have now been run on the current code; the six control files
  (1, 18, 19, 22, 23, 27) have not been re-run on it.
- Nothing was fixed. Whether to turn the reader on is Alex's call.

### Phase 3o: `ratecon:eval-ai` says HOW a wrong street or city differs (2026-10-14)

No API call, no network, no use of the key, no document text or ground-truth
value read or printed, nothing under `.samples/` opened, and **no change to
the reader, the verifier, the fill, the prompt, the route or the settings**.
`ratecon:eval-ai` was not run (it was only shown to still refuse without
`--approved`). Diagnostics only.

**Why:** run 7 (3n) had 10 merged street WRONG in four cells, three of them
identical across runs and across both reads. The counts could not say
whether a read was too long, too short or differed in punctuation, and the
reads are not stored. The output said WRONG and nothing more.

**What it prints.** For every **street or city** cell that scores WRONG, one
added line: the field, the stop, a relation code, and the two word counts.
Nothing else is added and no existing line changes.

- **Merged** (single mode and `--pairs`), right after the stop's line:

      street, stop 3: read has 2 extra trailing words (read 6, truth 4)

- **Each read on its own** (`--pairs` only), right after that read's
  `read A:` or `read B:` line:

      read A street, stop 3: read has 2 extra trailing words (read 6, truth 4)

  In single mode the one read IS the merged one, so it is said once.
- Only a cell the scorer calls WRONG gets a line: an exact cell, or a
  blank-and-marked one (an agreement blank, or a value the verifier
  refused), gets none. So a street the reads disagreed on has no merged line
  but does have one for each read that was wrong.
- **What is compared:** the form's value (so already in the normal case the
  app shows) against the truth as it was written, which is what the scorer
  compares. Words are compared without commas, periods and hyphens, and a
  hyphen is a word break. The word counts are of those words.
- **Never printed:** a word, a character, a file name, or the shape of a
  value. A code and counts only. A test puts the sentinel in a value and
  checks that it, and the invented words, are absent.

**The codes, in precedence order (each pair gets exactly one):**

| Code | Means |
|---|---|
| `equal` | the strings are the same (never on a WRONG cell; the function is total) |
| `read is empty` | the read has no words (blank, or only punctuation) |
| `truth is empty` | **not in Alex's list; added.** The truth has none and the read has a value. Without it, this would read "different words (0 of 0)" |
| `case-only` | the same but for case, punctuation identical |
| `spacing-only` | **added.** The same words with a different gap between them |
| `punctuation-only` | the same words once commas, periods and hyphens are taken out. Tested after `case-only` and without regard to case, so "ST," against "St" is this one |
| `read has N extra trailing words` | the truth's words, then N more |
| `read has N extra leading words` | N more words, then the truth's |
| `read is missing N trailing words` | the read is the truth's first words |
| `read is missing N leading words` | the read is the truth's last words |
| `same words in a different order` | the same words, another order |
| `different words (K of M words differ)` | anything else. M is the longer side's word count; K is M less the words that pair up |

Every line ends with `(read R, truth T)` (the word counts), which for the
last code reads `(K of M words differ; read R, truth T)`.

**Which code wins, and why:**

- **A trailing comma plus a case difference** ("ST," against "St"):
  `punctuation-only`. `case-only` needs the punctuation identical, and the
  punctuation test ignores case.
- **An extra word and a comma** ("St, Dock" against "St"): `extra trailing
  words`. The words are compared with the commas taken out, so the extra
  word is the difference that is left and the comma is not mentioned. The
  comma can hide a word difference; it cannot make one.
- **Extra words at both ends**, or in the middle: `different words`, not
  leading or trailing.
- **A repeated word** that could be leading or trailing: `trailing`, which
  is tested first.
- **Leading and trailing "missing"** are tested the same way: the read must
  be exactly the first (or last) words of the truth.

**Where:** `scripts/ratecon-relation.mts` (pure: `relationOf`,
`relationSaid`) and `scoreRun` in `ratecon-eval.mts`, the shared evaluation
code both modes use. Not copied anywhere.

**Tests:** 2803 in all (2775 before).

| File | Tests |
|---|---|
| `ratecon-relation.test.ts` (new) | 20: one test per code, the precedence cases above, one code each over a spread of pairs, nothing of a value in a phrase |
| `ratecon-eval.test.ts` | 78 (70 before): the lines after their stop and read lines, only WRONG cells, single mode not repeated, pairs, and the sentinel |

**One change to existing tests, for Alex to see:** two output-shape
whitelists in `ratecon-eval.test.ts` (the "no value, every line a known
shape" checks, single and `--pairs`) each gained one alternation admitting the
new line, because the new line is a new shape. Nothing else in the 70
existing eval tests changed, and they pass.

**Mutations,** each applied alone and reverted; every one fails at least one
test:

- leading tested before trailing;
- punctuation tested before case-only;
- a value appended to the phrase;
- a line for every street, WRONG or not;
- single mode repeating the lines per read.

**For the next run:** with `--pairs`, a street that is wrong the same way in
every run will now say, for each of the four 3n cells, whether the read is
longer, shorter, differently ordered or differently worded than the truth.

### Phase 3p: evaluation run 8, paired, samples 8, 10, 12 and 21: how the wrong streets differ (2026-10-14)

**Approval (Alex, 2026-10-14, written):** `ratecon:eval-ai --pairs` on samples
8, 10, 12 and 21, 3 runs each (24 calls), Claude Haiku 5.5, ceilings $1.00
and 75 calls. A diagnostic re-run of 3n's out-of-sample run, now that the
output says how a wrong street differs from the truth (3o). Alex corrected
two ground-truth entries since 3n (which, I do not know: I did not read the
ground truth). Alex reviewed the four files' redacted text that day.
Retention (30 days default, flagged up to 2 years) accepted for this run.

**Checked before the run:** the tree was clean; since the code of 3n
(`2af1c78`) only the eval's printing (`ratecon-eval.mts`,
`ratecon-relation.mts`), its tests and docs changed; `redact.ts` is
byte-identical and no file on the sent-text path changed. **Sent-text
hashes equal 3n's, all four:** 8 `2097af1b29cd`, 10 `5a57dd07b1ad`, 12
`afd147515071`, 21 `77b64d5b9b8e`.

**The command, run once, as given** (not re-run; nothing about the reader's
settings was changed, it stays off):

    LLM_READER_MODEL=claude-haiku-5-5 npm run ratecon:eval-ai -- --approved=2026-10-14 --files=8,10,12,21 --runs=3 --pairs

**Result: the bar is NOT met, with 14 WRONG, all on street. Exit 1.**

| | 3n, the same four files | 3p |
|---|---|---|
| Calls | 24 of the 42 | 24 of 24 (ceiling 75) |
| Tokens | not separable | 120,792 in, 59,735 out |
| Cost | not separable | $0.0419 (about $0.0035 a pair) |
| Runs scored | 12 | 12 |
| Pairs | 8 agreed, 4 differed | **10 agreed, 2 differed** |
| Address cue fires | on 12 and 21, every run | 6 of 12 runs: 12 and 21, every run |
| Merged WRONG on the bar | 10 (street) | **14 (street)** |

Every call returned `ok`; no pair failed. Merged WRONG: street 14, every
other bar field 0. **Read A alone: street 14. Read B alone: street 14.** The
two reads were wrong in the same cells, every time, so agreement had nothing
to remove.

**What the 3o lines say.** Every WRONG street cell, by code (the same code
for the merge and for read A and read B in every case):

| Cell | Runs WRONG (3n) | Runs WRONG (3p) | Code and word counts |
|---|---|---|---|
| 8, stop 2 | 3 of 3 | 3 of 3 | **case-only** (read 6, truth 6) |
| 8, stop 3 | 3 of 3 | 3 of 3 | **read has 1 extra trailing word** (read 5, truth 4) |
| 12, stop 1 | none (blanked in runs 1 and 2) | run 1 | **punctuation-only** (read 3, truth 3) |
| 12, stop 2 | none (blanked in runs 1 and 2) | run 1 | **punctuation-only** (read 4, truth 4) |
| 12, stop 3 | none (blanked in runs 1 and 2) | run 1 | **punctuation-only** (read 3, truth 3) |
| 12, stop 4 | run 3 | runs 2 and 3 | **punctuation-only** (read 4, truth 4) |
| 21, stop 1 | 3 of 3 | 3 of 3 | **punctuation-only** (read 3, truth 3) |

That is 3 cell-runs of `case-only`, 8 of `punctuation-only` and 3 of `read
has 1 extra trailing word`: **11 of the 14 differ from the truth in case or
punctuation only, with the same words**; 3 have one more word at the end.
No cell is a different word, a missing word, or a different order.

**Per sample** (merged WRONG on the bar; "marked" is not WRONG):

| Sample | Pairs | Merged WRONG | 3n | What changed |
|---|---|---|---|---|
| 8 | 3 agreed | 6 | 6 | the same two cells in all 3 runs, now with codes; stop 3's appointment time differs (marked), cue silent |
| 10 | 2 differed (appointment x1), 1 agreed | 0 | 0 | stop 1's ZIP blank and marked every run. **Appointment WRONG (time) on stop 2 in runs 1 and 2**, unmarked (3n: runs 2 and 3); in run 3 the reads differed and it was blanked and marked |
| 12 | 3 agreed | **5** | 1 | stops 1 to 3 in run 1 and stop 4 in runs 2 and 3, all punctuation-only; cells flip between exact and punctuation-only from run to run; ZIPs on stops 2 to 4 blank and marked; stop 1's appointment differs (type, end time; marked); cue fires every run on the same 3 lines |
| 21 | 3 agreed | 3 | 3 | stop 1, punctuation-only, every run; both stops' appointments differ (type, date, time, end time; marked); cue fires every run on the same 2 lines |

**The appointment parts that differ from the truth** (by name, as before):

- **8:** stop 3 (time), both reads, every run. Marked.
- **10:** stop 2 (time), both reads, every run; read B also stop 1 (type,
  time, end time) in run 2. **Silent WRONG** in runs 1 and 2, where the two
  reads agreed on the time; marked in run 3, where they differed.
- **12:** stop 1 (type, end time), both reads, every run. Marked.
- **21:** both stops (type, date, time, end time), both reads, every run.
  Marked.

**What the counts say (no values looked at):**

- **The street WRONGs on these files are not wrong addresses by the codes.**
  Seven cell-types, and for each the read has the truth's words (or one more
  at the end). Whether `case-only` and `punctuation-only` should be WRONG at
  all is a question about the scorer, not the reader: the scorer compares
  strings exactly. That is Alex's call, and nothing was changed.
- **Where they come from is for Alex to check,** cell by cell, against the
  PDF's own line, now that the kind is known:
  - `case-only` (8, stop 2): the form's value is the normal-case rule's
    output (3g); a name printed in capitals whose inner capitals the rule
    cannot recover is its documented known limit. The truth may also be
    written differently from what the rule produces.
  - `punctuation-only` (12, 21): the value's punctuation follows what the
    model quoted, so it can vary from run to run, as 12's does; the truth's
    is fixed.
  - `extra trailing word` (8, stop 3): the read carries one word more than
    the truth.
- **Sample 12's rise from 1 to 5 is not a worse reading.** In 3n the reads
  differed on four streets in runs 1 and 2 and the merge blanked them; now
  they agree, with the same punctuation, so the cells show as WRONG instead.
  Each cell is exact in some runs.
- **The silent appointment WRONG on sample 10 stop 2 is still there** (two
  cells, as in 3n), and agreement cannot catch it while the reads agree.
- **The cue** fired on 12 and 21 every run, as in 3n, and was silent on 8.
- **Cost** is as before, about $0.0035 a pair.
- Nothing was fixed. Whether to turn the reader on, and whether the scorer
  should count case-only and punctuation-only as exact, are Alex's calls.

### Phase 3q: no trailing punctuation on a street or city (2026-10-14)

No API call, no network, no `ratecon:eval-ai`, nothing read from `.samples/`
by me except what `ratecon:score` prints (sample numbers and pass or fail,
never a value). No change to state, ZIP, appointments, `verify-read.ts`, the
prompt or the route.

**Decision (Alex, 2026-10-14):** strip trailing punctuation from a street
and a city in the form.

**Why:** the PDF can print "...Rd." or "...Rd," at the end of the line, and
the model quotes the punctuation in some runs and not in others, so the same
read was WRONG in one run and exact in the next. Evaluation run 8 (3p): 8 of
the 14 WRONG street cells were `punctuation-only` (sample 12's flipped
between exact and punctuation-only from run to run; sample 21's was
punctuation-only every run).

**The rule** (`withoutTrailingPunctuation`, `src/lib/ratecon/normal-case.ts`,
beside `normalCase`; pure and idempotent):

- Any run of `,` `;` `:` `.` and whitespace at the END of the value goes,
  until none is left: `"2300 20th Ave NE,"` -> `"2300 20th Ave NE"`,
  `"840 N Thayer Rd."` -> `"840 N Thayer Rd"`, `"Rd.,"` -> `"Rd"`.
- **Interior punctuation is untouched:** `"St. Louis"`, `"N. Main"`,
  `"Winston-Salem"`, `"#4"`. Any other trailing character stays (a hyphen,
  `#`, `?`, a bracket).
- **A value that is only punctuation becomes empty** and is treated as not
  found: the form's field is blank, no source is kept, and it gets the same
  check as a missing street or city (the read's own reason when it has one,
  else "Not found in the PDF."). For an AI read the blank is a check, not an
  AI mark.
- **Street and city only,** in `fillStop`, where `normalCase` is applied, and
  after verification as it is: the read, its source line ("From p.2:
  “4001 Main St,”") and the verifier keep what was printed. State and ZIP are
  as before.

**Ground truth** (`docs/ground-truth-howto.md`): write street and city
WITHOUT trailing punctuation, since the app removes it; interior punctuation
stays.

**`ratecon:score` after the change:** 13 of 13, none failing, "Appointments
silently wrong: none". So no template-read ground-truth entry carries a
trailing mark. The entries `ratecon:score` does not score (the files only
the AI reader reads, for `ratecon:eval-ai`) are not covered by that run: an
entry there written with a trailing mark will score WRONG there, as
`punctuation-only`.

**Tests:** 2815 in all (2803 before).

| File | Tests |
|---|---|
| `normal-case.test.ts` | 6 more: what ends a value, a run with whitespace, punctuation alone, interior and other characters left alone, idempotent, the same either side of `normalCase` |
| `ratecon-fill.test.ts` | 6 more: shown without it; the source line and the marks as without the comma; punctuation alone is blank with the "Not found" check; interior kept; state and ZIP not stripped; an AI read's blank is a check, not an AI mark |

No existing test expected a trailing period or comma, so none was changed.

**Mutations,** each applied alone and reverted; every one fails at least one
test:

- state also stripped;
- punctuation alone kept without the "Not found" check;
- the source line stripped too;
- one mark removed instead of a run;
- interior punctuation removed too.

**Known limit:** a street or city that really ends in a period or comma that
matters (an abbreviation such as "Ft." or "St." at the very end) loses it.
The owner decided this.

### Phase 3r: evaluation run 9, paired, all twelve files no template reads, under the final code (2026-10-14)

**Approval (Alex, 2026-10-14, written):** `ratecon:eval-ai --pairs` on samples
2, 4, 7, 8, 9, 10, 11, 12, 16, 17, 21 and 28, 3 runs each (72 calls), Claude
Haiku 5.5, ceilings $1.00 and 75 calls: the first run on all twelve files no
template reads, under the final code (normal case 3g, the ZIP rule 3i, the
pair in the app 3m, the relation diagnostics 3o, no trailing punctuation 3q).
Alex corrected the ground truth since 3n and 3p and checked every street and
city in it against the PDF text. Alex read the redacted text of all twelve.
Retention (30 days default, flagged up to 2 years) accepted for this run. I
did not read the ground truth.

**Checked before the run:** the tree was clean. Since the code of 3p
(`92e9fdc`) only the fill (3q), its tests and docs changed; `redact.ts` is
byte-identical and no file on the sent-text path changed. **Sent-text hashes
(first 12 of sha256), each equal to the one recorded for its sample (3l for
2, 4, 9, 17, 28; 3n for 7, 8, 10, 11, 12, 16, 21):** 2 `a72717aa76c5`, 4
`f38cb9922cfe`, 7 `e83b8114d30b`, 8 `2097af1b29cd`, 9 `dc2a776ec7f4`, 10
`5a57dd07b1ad`, 11 `432dc67b6e7f`, 12 `afd147515071`, 16 `10c8f0f51354`, 17
`1afe327813da`, 21 `77b64d5b9b8e`, 28 `0b03d4a2f36d`.

**The command, run once, as given** (not re-run; nothing about the reader's
settings was changed, it stays off):

    LLM_READER_MODEL=claude-haiku-5-5 npm run ratecon:eval-ai -- --approved=2026-10-14 --files=2,4,7,8,9,10,11,12,16,17,21,28 --runs=3 --pairs

**Result: zero WRONG on every bar field, but the verdict is "incomplete", not
"met" (exit 1): one pair failed, so 35 of 36 runs were scored.** The script
calls a run short of every planned run scored "Not a pass".

| | 3l (5 files) | 3n (7 files) | 3p (4 files) | 3r (12 files) |
|---|---|---|---|---|
| Calls | 30 | 42 | 24 | **72 of 72** (ceiling 75) |
| Tokens | 173,910 in, 65,652 out | 184,500 in, 100,641 out | 120,792 in, 59,735 out | 358,410 in, 163,540 out |
| Cost | $0.0502 | $0.0688 | $0.0419 | **$0.1176** (ceiling $1.00) |
| Runs scored / planned | 15 / 15 | 20 / 21 | 12 / 12 | **35 / 36** |
| Pairs agreed / differed / failed | 12 / 3 / 0 | 10 / 10 / 1 | 10 / 2 / 0 | **22 / 13 / 1** |
| Address cue fires | 6 of 15 | 6 of 20 | 6 of 12 | **12 of 35** |
| Merged WRONG on the bar | 0 | 10 | 14 | **0** |

**The failed pair:** sample 16, run 3, `invalid_output` (read A's reply failed
the schema; read B was fine). The pair failed as a whole, filled nothing and
was not scored. Sample 16 failed the same way in 3n (run 2, also read A). Two
of its six pairs in the runs so far, none anywhere else.

**WRONG:** merged 0 in all seven bar fields; **read A alone 0, read B alone
0**. No appointment is WRONG (3n had two, on sample 10 stop 2). There is no
WRONG street or city cell, so there is **no relation code to report**. The
cells 3p named are all gone from the WRONG column:

| 3p cell | 3p | 3r |
|---|---|---|
| 8, stop 2 (case-only) | WRONG, 3 of 3 | exact, 3 of 3 |
| 8, stop 3 (1 extra trailing word) | WRONG, 3 of 3 | exact, 3 of 3 |
| 21, stop 1 (punctuation-only) | WRONG, 3 of 3 | exact, 3 of 3 |
| 12, stops 1 to 4 (punctuation-only) | WRONG in 4 cell-runs | exact in run 1; **blank and marked in runs 2 and 3** |
| 10, stop 2 appointment time (silent WRONG) | WRONG, runs 1 and 2 | exact in runs 2 and 3; marked in run 1 |

(Part of that is the corrected ground truth, part is 3q; the output does not
say which did what.)

**Merged WRONG per sample:** 0 for every one of the 12. **Pairs per sample**
(3 runs each):

| Sample | Pairs | Differed on |
|---|---|---|
| 2, 4, 8, 21, 28 | 3 agreed | |
| 9 | 2 agreed, 1 differed | appointment x1 |
| 7 | 1 agreed, 2 differed | appointment x1; city x1 and state x1 |
| 10 | 2 agreed, 1 differed | appointment x2 |
| 11 | 0 agreed, 3 differed | city x1 and state x1; appointment x2 (twice) |
| 12 | 1 agreed, 2 differed | street x4 (runs 2 and 3) |
| 16 | 1 differed (appointment x2), 1 agreed, **1 failed** | |
| 17 | 3 differed | street x2 (every run) |

**Marked fields (blank-and-marked, or filled and marked), cell-runs:**

- **ZIP blank and marked:** samples 4, 7, 9, 10, 11 (one stop, every run: 3
  each) and 12 (stops 2 to 4, every run: 9). 24 in all.
- **Street blank and marked:** sample 12, 8 (all four stops in runs 2 and 3);
  sample 17, 6 (both stops, every run; read B's two streets fail the verifier
  or the reads differ, as in 3l).
- **City and state blank and marked:** sample 7 stop 2 in runs 1 and 2;
  sample 11 stop 2 in run 1.
- **Order and type filled and marked:** sample 9, both stops in run 2;
  sample 11, both stops in run 1 and stop 1 in run 3.

**Appointment parts that differ from the truth** (all marked; none silent):

- **7:** both stops (date, time) in runs 1 and 2, both reads; run 3 read A
  both stops (date, time), read B stop 2 (time).
- **8:** stop 3 (time), both reads, every run.
- **9:** stop 2 (time), both reads, every run.
- **10:** run 1 read B stop 1 (type, time, end time); run 2 both reads stop 1
  (type, date, time, end time); run 3 none.
- **11:** run 2 read A both stops (type, date, time, end time); run 3 read B
  both stops (type, date, time, end time); run 1 none.
- **12:** stop 1 (type, end time), both reads, every run.
- **16:** run 1 both reads both stops (type, date, time, end time); run 2 read
  B both stops (type, date, time, end time).
- **21:** both stops (type, date, time, end time), both reads, every run.
- **2, 4, 17, 28:** none.

**Address cue:** fires on samples 9, 12, 21 and 28, every run (12 of 35),
silent on the other eight. With 0 WRONG on all of them, it named lines on four
files where nothing is wrong. As in 3l, 3n and 3p.

**Compared with 3l (samples 2, 4, 9, 17, 28), per cell:** the same. Sample 17's
streets are still blank and marked in all three runs (6 cell-runs); 9's stop 2
ZIP is still blank and marked every run and its stop 2 appointment time still
differs (marked); 28 reads 3 stops with its stops 2 and 3 appointments marked
"as the PDF says"; 2 and 4 unchanged. One difference: sample 9's pair differs
in run 1 (appointment x1; 3l: all three agreed).

**Compared with 3p (samples 8, 10, 12, 21):** the 14 WRONG cells are gone, as
in the table above.

**What the counts say (no values looked at):**

- **Zero WRONG across 35 scored runs of 12 files, in both reads alone and
  merged.** That is the bar's seven fields. It is a "no WRONG in what was
  scored", not a pass: 1 of 36 runs was not scored.
- **The zero is partly blanks.** Streets on 12 (runs 2 and 3) and 17 (every
  run), and a ZIP on six files, are left for the dispatcher. They are marked.
- **A possible cost of 3q, for Alex to weigh (not changed, not tested here):**
  agreement compares what the two reads QUOTED (`agreeReads` compares the
  verified values, before the fill strips punctuation). 3p showed sample 12's
  punctuation varying from run to run. In runs 2 and 3 its reads now differ on
  all four streets and the merge blanks them. If that difference is only a
  trailing mark, it is exactly what the strip made harmless in the form, and
  the merge still blanks it. The counts do not say it is; they cannot. Making
  the comparison after the same trailing-punctuation and case rules is
  small; it needs its own decision.
- **Cost** per pair was about $0.0033, as before ($0.1176 for 36 pairs).
- **Scope:** 12 of the 25 files, 3 runs each, one model. The six control files
  (1, 18, 19, 22, 23, 27) were run in 3b and 3e, before most of this code, and
  have not been re-run. Template-read files are read by templates, not this.
- Nothing was fixed. Whether to turn the reader on is Alex's call.

### Phase 3s: what the dispatcher did with an AI read, recorded (2026-10-14)

No API call, no network, no `ratecon:eval-ai`, nothing read from `.samples/`.
**The reader stays off by default** (`LLM_READER_ENABLED` is set in no env
file; the e2e server sets it itself, with the fake vendor). Nothing the
dispatcher sees changed.

**Why:** the system stored one counts row per pair (calls, tokens, outcome)
and nothing about what happened next, so a real-world trial would produce no
accuracy evidence. Now each read that filled the form leaves, once, a count of
what the dispatcher kept, changed and cleared, by field name.

**What is counted.** For a read that filled the form, once, at the FIRST save
of the load after the fill (the first that lands; a refused save waits):

- **a field the read FILLED:** `kept` (saved as filled), `changed` (saved as
  something else), `cleared` (saved empty, or its stop removed);
- **a field the read left BLANK and marked:** `blank_filled` (the dispatcher
  filled it) or `blank_left`;
- per **field name**: `load_number`, `stop_type`, `street`, `city`, `state`,
  `zip`, `appointment`; **summed over stops**.

Values are compared trimmed and by value, in the browser's memory: a field
edited and put back is kept; a space at an end is not a change; the
appointment is compared by type, date, time, end time and window (not the
zone, which follows the address). A field the dispatcher had typed before a
"Replace" that the read left blank is `blank_left` unless changed. A stop
added after the fill is not counted; a stop removed counts its filled fields
as cleared.

**What is never stored:** a value, a quote, a stop address, a load number, a
file name, any field's text. Both tables hold a read id, a field NAME from a
closed list, and small integers. A schema test asserts the column types.

**Tables (migration 0028, additive, direct connection):**

| Table | Holds |
|---|---|
| `ratecon_ai_outcomes` | `read_id` (primary key; a foreign key to `ratecon_ai_reads`, `ON DELETE CASCADE`), `created_at`. The once-per-read marker |
| `ratecon_ai_outcome_fields` | `read_id`, `field` (enum `ratecon_ai_field`), `kept`, `changed`, `cleared`, `blank_filled`, `blank_left` (smallints). Primary key (read_id, field). A check bounds the sum: at most 1 for `load_number`, 10 for any other |

RLS on both, a deny-all policy, nothing granted to `anon` or `authenticated`
(as every table). **They live 90 days:** they follow the read's counts row,
which each reservation deletes after 90 days, and a foreign key without the
cascade would make that clean-up fail. Read the numbers inside 90 days, or
copy the query results out (decision for Alex below).

**The route** `POST /api/ratecon/outcome` (`handle-outcome.ts`, written on the
pooler connection like every route handler): the address limit; a dispatcher
or admin; the reader on (off: 404 `disabled`); the user's **`write`** limit
(its own bucket, so outcomes never spend the reader's three-a-minute); a 2 KB
body; a strict parse (`OutcomeBody`): a read id, and per field name five
counts, each 0 to 10, adding up to at most what a read can fill, no field
twice, no unknown key (a 400 `bad_request` otherwise; the issues are not
echoed). Then the read must be **the caller's own and `ok`**: a read that is
someone else's, does not exist, or whose pair failed is the same 404
`unknown_read`. The once-per-read marker is inserted `on conflict do nothing`,
and only the post that inserted it stores the counts, in the same transaction:
a second post, or two at the same moment, store nothing and answer
`recorded: false`. The browser is untrusted: nothing in the body drives
behaviour beyond being stored.

**The read response** gains `readId` (the counts row's id), so the modal can
name the read. A failed pair returns none.

**It never delays, blocks or fails a save.** The modal posts AFTER the load
has saved, does not await it, and `recordFillOutcome` cannot throw or reject.
If the post is refused or fails (or the summary throws), the tab counts it
(`outcomeNotRecorded`, kept with the strip's other session counts and shown to
nobody). If the server fails while recording it logs ONE line, `ratecon
outcome not recorded { reference, code, errorName }`, never the request or the
error's message. **Nothing the dispatcher sees changes**: a test compares the
strip after a recorded and an unrecorded outcome.

**Not recorded** (each tested): a load saved with no AI fill; a template fill,
or an AI fill replaced by a template one; a failed pair; a save that did not
land (the outcome waits for the one that does); a modal closed without saving;
any later save; the reader off.

**Reading the numbers.** Run these on the production database (they work on
any Postgres with the tables; checked here on invented rows):

    -- 1. By field: how much of what the AI filled was kept, and how much of
    --    what it left blank the dispatcher filled.
    select f.field,
           sum(f.kept) as kept, sum(f.changed) as changed, sum(f.cleared) as cleared,
           sum(f.blank_filled) as blank_filled, sum(f.blank_left) as blank_left,
           round(100.0 * sum(f.kept) / nullif(sum(f.kept + f.changed + f.cleared), 0), 1) as pct_kept
      from ratecon_ai_outcome_fields f
     group by f.field
     order by array_position(enum_range(null::ratecon_ai_field), f.field);

    -- 2. The funnel and the cost: reads that answered, reads whose load was
    --    saved, and what a saved read cost (tokens, both calls).
    select count(*) filter (where r.outcome = 'ok') as reads_answered,
           count(o.read_id) as reads_saved,
           round(100.0 * count(o.read_id) / nullif(count(*) filter (where r.outcome = 'ok'), 0), 1) as pct_saved,
           round(avg(r.input_tokens + r.output_tokens) filter (where o.read_id is not null)) as tokens_per_saved_read
      from ratecon_ai_reads r left join ratecon_ai_outcomes o on o.read_id = r.id
     where r.created_at >= now() - interval '30 days';

    -- 3. Reads saved with nothing changed or cleared.
    select count(*) filter (where changed = 0 and cleared = 0) as saved_untouched,
           count(*) as reads_saved
      from (select read_id, sum(changed) as changed, sum(cleared) as cleared
              from ratecon_ai_outcome_fields group by read_id) t;

`pct_kept` is of the fields the AI filled (kept + changed + cleared); a
blank-filled count is of the fields it left blank and marked. A read answered
and never saved (query 2's gap) is not an outcome: the dispatcher typed the
load another way, or abandoned it.

**Tests:** 2940 in all (2815 before). New or changed:

| File | Tests |
|---|---|
| `outcomes-schema.test.ts` (new) | 14: no text column, a closed list of names, RLS, once per read, bounds, cascade with the read |
| `outcome-codes.test.ts` (new) | 25: the strict contract |
| `fill-outcome.test.ts` (new) | 21: every outcome per field, multiple stops, nothing filled, kept / changed / cleared, blank-then-filled, a typed-before value, no value in the rows |
| `handle-outcome.test.ts` (new) | 28: stored once, a second ignored, not the caller's or unknown or not `ok` read refused, no role, reader off, every bad body, the sentinel in the row and the log, its own bucket, a failure logs one line |
| `outcome-client.test.ts` (new) | 11: what is sent (nothing but the id and counts), recorded or not, never thrown |
| `record-outcome.test.ts` (new) | 7: it never throws or rejects |
| `fill-outcome-save.test.tsx` (new) | 15: through the strip, the save and the network: once, after the save, not on a failed save, a template fill, or a later save; a save that still succeeds when recording is refused, unreachable or never answers; nothing visible changes |
| `handle-read.test.ts` (42, as before), `read-client.test.ts` (24; 20 before) | the read response's `readId`, and a read id that is no id is no link |

**e2e** (`e2e/ratecon-ai.spec.ts`, run on its own; `npm run check` does not
run it): the pair test now Saves, and checks the real rows: seven field
names, `street` kept 2, `load_number` kept 1, `appointment` kept 1 and
blank-left 1, joined to the read's tokens, with no value in them. The spec
seeds the geocode cache for its two invented places so the Save calls no
outside service. 6 passed with `ratecon-fill` and `reader-key-bundle`.

**Mutations,** each applied alone and reverted; every one fails at least one
test:

- summary: empty counted as changed; values not trimmed; a removed stop not
  counted; a blank that stays counted as filled; a template fill recorded;
- server: not the caller's read; any read, answered or not; no once-per-read
  marker; the error message in the log; the reader's own rate-limit bucket;
  Zod's issues echoed in the 400;
- modal: the pending outcome not dropped after the first save; the save
  awaiting the recording; a template fill leaving the AI fill pending;
  recorded at the click rather than after the save; the strip dropping the
  read id.

**For Alex to decide / found while building (none changed):**

1. **90 days.** The outcome tables live as long as the read's counts row. A
   longer trial needs either a longer retention on `ratecon_ai_reads` or
   copying query results out. Lengthening it is one constant (`KEEP_DAYS`) and
   its privacy statement.
2. **A recording that never reaches the server is only counted in the
   browser tab,** and is lost when the tab closes. There is nothing to log on
   a server that was never called. The funnel (query 2) shows it as a read
   answered and never saved.
3. **Two reads in one modal.** If the dispatcher reads with AI twice, the
   first read gets no outcome (the second replaced it). Only the read that
   was in the form at the save is recorded.
4. **The load number is one field name for the load; the others are summed
   over stops.** A trial that cares which stop is wrong (the second of four,
   say) cannot tell: that is deliberate, to keep the numbers free of anything
   that identifies a load.

### Phase 3t: two redaction gaps closed, and the claim made honest (2026-10-14)

No API call, no network, no `ratecon:eval-ai`. **The reader stays off.** The
real samples were read LOCALLY by the report scripts only, and only counts
and line numbers were printed. Invented text in every test.

**What was found** (in the redacted text "Show what is sent" displays):

1. A bare 10- or 11-digit phone with no separators and no phone word was not
   masked ("it could be a load number"): one in a table cell after an address
   cell, one of 11 digits starting with 1 in a driver row.
2. A name in the row BELOW a header row that names a person was not masked:
   the header's cells went by the label rule, the values were on the next
   line. Two full names in a carrier contact row, a first name in a driver row.
3. The strip said "rates, contacts, phones, emails and driver names
   removed"; `redact.ts` says it is not a guarantee.

**What changed** (`REDACTION_VERSION` `redact-2026-10-14.3`, then `.4`
(below); the server refuses an older one, and **every approval that named a
sent-text hash is void**):

- **Rule A** (`redact.ts`, `nanp-area-codes.ts`): a run of exactly 10 digits,
  or 11 starting with 1, alone (not in a longer number, word, hyphenated id or
  decimal), with an ASSIGNED area code, is `[PHONE]`, unless an identifier
  label (load, order, pro, bol, po, so, si, ref, reference, shipment, pickup,
  delivery, confirmation, tracking, trip, stop #) is just before it in its
  cell or the previous one. Applied last in `redactLine`. The re-scan
  (`residue`) uses the same detector, so a regression fails closed.
- **Rule B** (`redactDocument`, `maskBelowHeaders`): the cells of the next
  line (and the one after, if the next is blank or only placeholders) under a
  person header are `[REMOVED]` when one to four words of letters, unless an
  ALL-CAPS company cell, a state, a run of weekdays. By row. After B masks
  a cell, rule A looks again, because a masked `Load` cell no longer guards
  its number (found by a mutation that survived; now pinned by a test).
  `prepareForReading` and `redactedForReview` go through `redactDocument`.
- **The claim:** "sends N lines with phones, emails, rates and the names it
  recognises removed; a name it does not recognise can still go through, so
  read “Show what is sent” before you click." One sentence; the old trailing
  "Nothing is saved until Save." is gone from this line (the fill messages
  after a read still say it). The header of `redact.ts` lists the known gaps.
- `isUsState` is exported from `templates.ts` (one line).

**Decisions made, for Alex to overrule:**

1. **No street-like test.** The brief said to use the one the code has; there
   is none. Every real street line has a digit, and a digit already keeps a
   cell out of rule B, so a street test could only matter for a number-less
   street name, where it would unmask surnames (Lane, Court). Not built;
   `Main St` alone under a person header is masked.
2. **`cityLine` is not called by rule B.** A city line has a comma and digits,
   which keep it out already. Pinned by tests with a city line, a ZIP and a
   street.
3. **A header is read from the cells as they were,** not as masked (see the
   `.4` follow-up below for what a header is now).
4. **The area-code list was typed by hand,** from the NANPA list as I know
   it, not fetched (no network). It should be diffed against the NANPA
   download. It leans to over-inclusion (a code not in service masks a number
   that was not a phone).
5. **Rule B is not checked by the re-scan,** which sees one line at a time.
   Rule A is.

**The known limit, unchanged in kind:** a name with no label and no header
above it can still go through (a signature, "Questions? Call Riley", a name
in a cell nothing names), and so can one more than four words, or one under
a header that is not a person label. "Show what is sent" is the check.

**Tests (invented text):** `redact-gaps.test.ts` 178, `nanp-area-codes.test.ts`
33; the 114 older redaction tests ran **unchanged** and pass. Changed outside
the new files: the strip's expected sentence (and its test title) in
`ratecon-ai.test.tsx` and `e2e/ratecon-ai.spec.ts`, and that e2e's locator for
the "Show what is sent" summary (the new sentence quotes the text, so
`getByText` matched twice). Also added: the `ratecon:redact-rules-report`
script. `npm run check`: 188 files, 3151 tests, exit 0. E2E, run on their own:
`ratecon-ai.spec.ts` 4 passed, `ratecon-fill.spec.ts` 2 passed.

**Mutation-checked,** 25 mutations, each one killed: area-code check, the
11-digit shape, the label guard, its adjacency, the digit boundary, the mask
itself, the re-scan's blindness to it, A running last; B off, header without
a role word, same-line value as a header, the blank-line reach (both ways), a
header row masked as values, crossing a page, the company, state and weekday
rules, the 4-word limit (both ways), digits in a cell, placeholder peeling,
the second look for bare phones, the review/prepare path, and the version.

**On the real samples** (`npm run ratecon:redact-rules-report`, counts only;
the 12 AI-only files; neither rule reached 20 lines on any):

| Sample | Lines sent | A lines (masks) | B lines (masks) | Re-scan clean | Load-number-like left |
|---|---|---|---|---|---|
| 2 | 53 | 0 | 0 | yes | yes |
| 4 | 55 | 0 | 1 (2) | yes | yes |
| 7 | 34 | 1 (1) | 1 (1) | yes | yes |
| 8 | 46 | 1 (1) | 0 | yes | yes |
| 9 | 222 | 0 | 0 | yes | yes |
| 10 | 56 | 0 | 1 (2) | yes | yes |
| 11 | 32 | 0 | 0 | yes | yes |
| 12 | 244 | 0 | 0 | yes | no |
| 16 | 65 | 1 (1) | 1 (1) | yes | yes |
| 17 | 70 | 2 (2) | 1 (1) | yes | yes |
| 21 | 37 | 0 | 0 | yes | no |
| 28 | 285 | 0 | 0 | yes | yes |

Rule A by line: sample 7 L21, 8 L26, 16 L9, 17 L9 and L24. Rule B: sample 4
L23, 7 L29, 10 L29, 16 L25, 17 L24. The full `ratecon:redact-report` over all
25: 0 residual hits, 25 of 25 can be sent. "Load-number-like left" means a
6 to 12 digit run with an identifier label just before it is still in the
sent text; samples 12 and 21 have none, so for them the answer says nothing.
Whether A masked a real load number cannot be told without reading values: in
the four A samples, only sample 7 L21 has an identifier-label word in its
line (not beside the number: a label of 8 letters and a colon, a 10-digit
cell, then the label cell), and none has one on the line above, which is
where a load number under a `Load #` header would show.

**Follow-up, `redact-2026-10-14.4` (same phase, from sample 17):** rule B
still sent two names in a carrier table. Diagnosis, by cell shapes only: on
the header line the cells after `Contact` were not header vocabulary (one two
words with a comma, one two capitalised words), so "the label is the last
cell or is followed by a header cell" failed; and the label rule had already
turned those cells into placeholders. The ALL-CAPS rule was NOT the cause
(an all-caps cell with no company word was already masked; now pinned).

- **A header is any line with a person label, whatever follows:** a cell that
  is only header-vocabulary words with a person role, OR a person label at the
  start of a cell with only placeholders after it (the first pass's result).
  A label inside a longer cell does not count.
- **The cost, decided by the brief ("whatever follows"):** `Contact:` |
  `Dana Example` is a header too, so the line below it is masked by row. The
  earlier test that pinned "the next line untouched" now pins the opposite.
- **Company words:** unchanged in effect; pinned whole-word and all-caps only
  (`COLE QUENBY` is a name, `Zorblat INC` is a name). A latent slip fixed on
  the way: `personLabelBare` sliced from the match's length, not its end.
- `redactedForReview` lines carry `header`; `maskPersonCell` is exported for
  the report. The report has a new column, an all-caps non-company cell left
  under a person header (it is `no` on all 12; it is a consistency check, not
  an independent one).

Tests: `redact-gaps.test.ts` 194; `npm run check` 188 files, 3167 tests, exit
0; `ratecon-ai.spec.ts` 4 and `ratecon-fill.spec.ts` 2 pass. Mutation-checked:
13 mutations on (1) the header and (2) the company rule; 4 survived the first
time (label-last, label-anywhere, mixed-case company word, substring company
word), each is now pinned by a test and killed.

Rule B on the 12 AI-only samples, lines (masks), `.3` then `.4`:
2 0→1 (1), 4 1→2 (4), 7 1→1 (1), 8 0→0, 9 0→1 (1), 10 1→2 (4), 11 0→1 (1),
12 0→2 (3), 16 1→2 (3), 17 1→2 (3; the new line is the carrier row, 2 masks),
21 0→0, 28 0→5 (5). None near 20. Re-scan clean on all 12. 27 cells are
masked by B across them: 3 all-caps single words, 2 all-caps pairs, 9
mixed-case single words, 10 pairs, 3 triples. Names, mostly, by shape; a
facility name among the mixed-case ones cannot be ruled out without reading
values. Rule A is unchanged (5 masks, 4 samples).

**Found wrong or worth knowing:**

- The brief's "use the street-like test the code already has" has no target
  (above).
- A person header is recognised from a small vocabulary; a header such as
  `Primary` | `Name` is not one, and its row is not touched. Widening the
  vocabulary widens what is masked.

### Phase 3u: evaluation run 10, paired, all twelve files, first under redaction `.4` (2026-10-15)

**Approval (Alex, written, dated 2026-10-14):** `ratecon:eval-ai --pairs` on
samples 2, 4, 7, 8, 9, 10, 11, 12, 16, 17, 21 and 28, 3 runs each (72 calls),
Claude Haiku 5.5, ceilings $1.00 and 75 calls: the first run under
`redact-2026-10-14.4`, which closed the bare-phone gap and the names under a
person header. Earlier approvals that named a sent-text hash are void. Alex
read the redacted text of all twelve in the viewer under `.4` and accepted
that the text of earlier runs contained names and phone numbers. Retention (30
days default, flagged up to 2 years) accepted for this run. I did not read the
ground truth or any value.

**Checked before the run:** the tree was clean, `REDACTION_VERSION` was
`redact-2026-10-14.4`, and the migration state was as expected (29 SQL files,
29 journal entries ending at 0028, 29 applied in the local test DB; the eval
script touches no database and stores nothing). **Sent-text hashes (first 12
of sha256), with 3r's in brackets:** 2 `fe5f7539e194` (`a72717aa76c5`), 4
`f05494d30f77` (`f38cb9922cfe`), 7 `baa6c413ef11` (`e83b8114d30b`), 8
`826196de5a3f` (`2097af1b29cd`), 9 `220af5986443` (`dc2a776ec7f4`), 10
`0d14bdd88041` (`5a57dd07b1ad`), 11 `49288d225e5d` (`432dc67b6e7f`), 12
`282113934c2a` (`afd147515071`), 16 `8538f55afaf5` (`10c8f0f51354`), 17
`5b56633ef15b` (`1afe327813da`), 21 `77b64d5b9b8e` (`77b64d5b9b8e`, the only
one unchanged), 28 `435a59f2c590` (`0b03d4a2f36d`). Residual hits 0.

**The command, run once, as given** (not re-run; nothing about the reader's
settings was changed, it stays off):

    LLM_READER_MODEL=claude-haiku-5-5 npm run ratecon:eval-ai -- --approved=2026-10-14 --files=2,4,7,8,9,10,11,12,16,17,21,28 --runs=3 --pairs

**Result: the bar is MET, exit 0: 36 of 36 runs scored, zero WRONG on all seven
bar fields, merged and in read A and read B alone.** One appointment is WRONG
(below); appointments are not on the bar.

| | 3r | 3u |
|---|---|---|
| Calls | 72 of 72 | **72 of 72** (ceiling 75) |
| Tokens | 358,410 in, 163,540 out | **358,704 in, 166,408 out** |
| Cost | $0.1176 | **$0.1191** (ceiling $1.00) |
| Runs scored / planned | 35 / 36 | **36 / 36** |
| Pairs agreed / differed / failed | 22 / 13 / 1 | **26 / 10 / 0** |
| Address cue fires | 12 of 35 | **12 of 36** (9, 12, 21, 28, every run) |
| Merged WRONG on the bar | 0 | **0** |

**The failed pair is gone:** sample 16's run 3 (`invalid_output` in 3r, and
in 3n) agreed this time. One run, so this is not evidence the failure is
fixed.

**WRONG:** none on the bar. No street or city cell is WRONG, so **there is no
relation code to report.** **One appointment is WRONG and silent: sample 10,
run 2, stop 1 (type, time, end time).** Both reads gave the same wrong parts
and agreed, so nothing marked it; stop 2 is exact. In 3r the same cell in run
2 differed in four parts (type, date, time, end time) in both reads and was
marked; it is the one cell that moved from marked to silent. Sample 10's stop
1 differs from the truth in all three runs (marked in runs 1 and 3).

**Pairs per sample** (3 runs each; 3r in brackets):

| Sample | Pairs | Differed on | 3r |
|---|---|---|---|
| 2, 4, 8, 21, 28 | 3 agreed | | same |
| 17 | **3 agreed** | | 3 differed (street x2, every run) |
| 11 | 2 agreed, 1 differed | city x1 and state x1 (run 1) | 0 agreed, 3 differed |
| 16 | 2 agreed, 1 differed | appointment x2 (run 1) | 1 agreed, 1 differed, 1 failed |
| 7 | 1 agreed, 2 differed | appointment x1 (runs 2, 3) | 1 / 2: appointment x1; city x1 and state x1 |
| 9 | 1 agreed, 2 differed | appointment x1 (runs 1, 2) | 2 / 1 |
| 10 | 1 agreed, 2 differed | appointment x1 (runs 1, 3) | 2 / 1 (appointment x2) |
| 12 | 1 agreed, 2 differed | street x4 (runs 1, 2) | 1 / 2: street x4 (runs 2, 3) |

**Marked fields, cell-runs (3r in brackets):**

- **ZIP blank and marked: 24 (24)**, the same cells: samples 4, 7, 9, 10, 11
  (one stop, every run) and 12 (stops 2 to 4, every run).
- **Street blank and marked: 8 (14).** Sample 12, all four stops in runs 1
  and 2 (3r: runs 2 and 3). **Sample 17: 0 (6)**; its streets are exact in
  every run.
- **City and state blank and marked: 2 (3)**: sample 7 stop 2 and sample 11
  stop 2, run 1 each (3r: sample 7 in runs 1 and 2, sample 11 in run 1).
- **Order and type filled and marked:** sample 4 stop 1 in every run (3
  cell-runs; **none in 3r**), sample 9 both stops in run 1 (3r: run 2),
  sample 11 none (3r: 3 stops across runs 1 and 3).

**Appointment parts that differ from the truth** (marked, except where said):

- **7:** both stops (date, time) in run 1, both reads; run 2 read A both
  stops (date, time), read B stop 2 (time); run 3 read A stop 2 (time), read B
  both stops (date, time).
- **8:** stop 3 (time), both reads, every run (as 3r).
- **9:** stop 2 (time), both reads, every run (as 3r); the merged stop 1
  (date, time) is also marked as filled differently in runs 1 and 2.
- **10:** run 1 read A stop 1 (type, time, end time), merged marked; run 2
  both reads stop 1 (type, time, end time), merged **WRONG and silent**; run 3
  read B stop 1 (type, date, time, end time), merged marked.
- **11:** none in either read in any run (3r: both stops, one read, in runs 2
  and 3). All its appointments are marked "as the PDF says".
- **12:** stop 1 (type, end time), both reads, every run (as 3r).
- **16:** run 1 read B both stops (type, date, time, end time); runs 2 and 3
  none (3r: run 1 both reads, run 2 read B).
- **21:** both stops (type, date, time, end time), both reads, every run (as 3r).
- **2, 4, 17, 28:** none (as 3r).

**What the extra masking changed, per cell, by the counts (no value looked
at).** Eleven of the twelve sent texts changed; sample 21's did not and its
cells did not move. The cells that moved: sample 17's two streets went from
blank-and-marked in every run to exact (6 cell-runs), and its pairs from
3 differed to 3 agreed; sample 11 stopped differing on appointments; sample 16's
pair that failed in 3r agreed; sample 4 gained a filled-and-marked order and
type on stop 1. Sample 10's stop 1 appointment, in run 2, went from marked
to silent. Everything else is the same cell, or moves between runs in a way 3n,
3p and 3r already showed (sample 12's four blanked streets sit in runs 1 and 2
instead of 2 and 3; samples 7, 9 and 10 trade which runs differ). **The
counts do not say why:** a run-to-run difference of this size is within what
3p and 3r already showed on unchanged text, and one run per file under `.4` is
too few to tell a masking effect from that. That sample 17's streets became
exact is consistent with its carrier row (two masks under `.4`) no longer
being there for the model to misread, but nothing here shows that is the
cause; 17's text also changed on two bare phones.

**Counts that matter:**

- **Zero WRONG on the bar in 36 of 36 scored runs, in both reads alone and
  merged.** This is the first run with every planned run scored.
- **The zero is still partly blanks:** 24 ZIPs, 8 streets and 2 city-and-state
  cells are left for the dispatcher, marked.
- **A silent WRONG appointment exists** (sample 10, run 2, stop 1). It is not
  on the bar, and the bar does not see it. It is the sort of failure the
  address cue is not built for: both reads agree.
- **The 3q question stands** (agreement compares quoted values, before the fill
  strips trailing punctuation): sample 12's four streets differ between the
  reads in two of three runs again. Not changed.
- **Cost** per pair about $0.0033 ($0.1191 for 36). By sample, in dollars and
  tokens in/out over 3 runs: 2 $0.0073 (23,442 / 9,924); 4 $0.0099 (25,062 /
  14,765); 7 $0.0092 (20,352 / 14,404); 8 $0.0083 (22,770 / 12,203); 9 $0.0114
  (52,920 / 12,069); 10 $0.0099 (24,192 / 15,060); 11 $0.0086 (19,524 /
  13,369); 12 $0.0146 (53,256 / 18,581); 16 $0.0092 (23,850 / 13,544); 17
  $0.0084 (25,812 / 11,559); 21 $0.0094 (20,670 / 14,696); 28 $0.0127 (46,854
  / 16,234).
- **Scope:** 12 of the 25 files, 3 runs each, one model. The six control
  files have not been re-run since 3e. Nothing was fixed. Whether to turn the
  reader on is Alex's call.

**Housekeeping, my error:** commit `231d612` (3t) cut about 2,100 lines of
earlier phases from this file, through a text replace that matched an older
section. Found while reading 3r for this comparison. Restored in `7b3b8ed`
from `0582697`: the diff against it is additions only (3t, its `.4`
follow-up, a file-table row). No other file was affected.

### Phase 3v: an appointment the AI filled is never silent (2026-10-15)

No API call, no network, no `ratecon:eval-ai`; nothing read from `.samples/`.
**The reader stays off by default.** Invented data only.

**Why:** evaluation run 10 (3u) had one appointment, stop 1 of one file, filled
wrong by BOTH reads. They agreed, so the pair did not blank it, and it carried
no check, so nothing told the dispatcher to look. Agreement cannot catch the
same mistake made twice; the form can.

**The rule** (`fillStop` in `ratecon-fill.ts`; `AI_APPOINTMENT_CHECK`): when
the read is a model read and the stop's appointment is filled (enabled, with a
time; APPT or FCFS, exact or a window), the appointment's check always
includes "Check: the AI filled this appointment. Confirm the date and time
against the PDF." It follows whatever the appointment already said (the flag or
window sentence, the date sentence), with a space, once; if it had no check,
that is the whole check. Not applied to a template read, to a blank
appointment, to "No date or time", to "Couldn't read", or to an appointment
the pair blanked and marked. No other field, the verifier, agreement, the
prompt or the route changed. The dispatcher clears it as any check: by editing
the appointment (`fillAfterEdit`). No new mechanism.

**What it does to counts:**

- **"Fields to check"** rises by the filled appointments that gained a check
  (an invented two-stop read: 1 for the pickup, none for the blank delivery).
- **`aiMarkedFields`, `aiMarks` and the outcome summary are unchanged:** a
  filled appointment is still an AI-marked, filled field, so the snapshot
  counts it as filled and the outcome counts per field are as before (pinned).
- **One existing test changed**, `src/test/ratecon-eval.test.ts`, "a reply that
  matches the ground truth": its stop line said `appointment exact` and now
  says `appointment marked, filled as the PDF says`. The evaluation scores the
  form as the dispatcher sees it, and every filled appointment now has a mark.

**Two consequences for the evaluation script (not changed):**

1. In `ratecon:eval-ai` output a filled appointment is now "marked, filled as
   the PDF says" or "marked, filled differently (parts)", never "exact" and
   never a silent WRONG. The silent-WRONG category for appointments cannot
   occur by construction. The per-read lines (`read A: appointments: stop 1
   (type, time)`) are unaffected, and are the way to compare with 3r and 3u.
2. A comparison of marked-field counts with earlier runs must leave the
   appointments out: they are all marked now.

**A cost, for Alex to weigh:** every AI read now leaves at least one "field to
check" per filled appointment, and "Looks right" does not clear it (it clears
the AI mark only, as for every check); the dispatcher has to edit the
appointment, or leave the count standing. If that is too loud, "Looks right"
could clear this one check; not done, because the brief said no new mechanism.

**Tests (invented text):** 15 new in `ratecon-fill.test.ts` (an exact time; a
window of two hours or less; an FCFS exact time, window and receiving hours,
each old sentence first and the new one once; a date check already there, past
and far; blank, none, unreadable and pair-blanked left as they were; the case
both reads agree on; template reads in all four layouts; the marks and outcome
counts; "fields to check" up by one and down when edited, and unmoved by
"Looks right"). **Mutation-checked,** 11 mutations: FCFS excluded (by type and
by flag), applied to template reads, duplicated (twice over), new sentence
first, applied to a blank appointment, applied to a pair-blanked one, replacing
instead of following an old check, the sentence reworded: all killed. One
survived, "applied to a disabled appointment": an equivalent mutant (a stop
starts from a blank form, so a disabled appointment has no time).
`npm run check`: 188 files, 3182 tests, exit 0. E2E, on their own:
`ratecon-ai.spec.ts` 4 and `ratecon-fill.spec.ts` 2 pass.

### Phase 3w: rule C, a name before " at <COMPANY>" (2026-10-15)

No API call, no network, no `ratecon:eval-ai`. **The reader stays off.**
Invented text in every test. The real files were read LOCALLY by the report
scripts only; counts, sample numbers, line numbers and letter shapes were
printed, never a value.

**A sample was added, and the numbers moved.** There are 29 PDFs now. The new
file is **sample 22**; the old 22 to 28 are **23 to 29**. Everything above
this entry (3a to 3v) uses the old numbers, so "sample 28" there is **29**
now; the file's sent-text hash, `435a59f2c590`, is the same as in 3u. The
default list of `ratecon:redact-rules-report` is now 2, 4, 7, 8, 9, 10, 11,
12, 16, 17, 21 and 29. **A future `--files=...,28` would name a different
(template-read) file.**

**What was found:** on the first page of a C.H. Robinson carrier load
confirmation, a line `<First Last> at <COMPANY> - <ID>` names the carrier's
rep. No label, no header: nothing masked it.

**Rule C** (`redact.ts`, `redact-2026-10-14.5`; approvals that named a `.4`
hash are void):

- **Shape:** two to four Capitalised words, ` at `, then an ALL-CAPS word of
  two or more characters, a number of six or more digits, or an `[ID]`. The
  name becomes `[REMOVED]`, ` at <rest>` stays. Anywhere in a cell; across the
  cell gap in the joined pass. In both passes; the re-scan uses the same
  detector (`labelled`), so a regression fails closed.
- **Also:** ` with ` (company must be ALL-CAPS letters), and `<Name>, <Role> at
  <COMPANY>` (the name goes, the role stays; a role needs a role word).
- **Guards:** a facility or function word ends the run (`Pick Up at DOCK 4`,
  `Check In at GATE B` pass; `Call Dana Example at ACME` loses only the name);
  a single word, lower case, `at Dock 4`, `at 08:00`, `at Gate B`, `at 8 PM`,
  a mixed-case company and `atACME` pass.
- **In doubt, mask:** I removed a lookbehind that kept a run from starting
  inside a word, because it made `d'Arcy Example at ACME` leak `d'Arcy`; now
  it gives `d'[REMOVED]`. Five Capitalised words mask the last four.
- The label rule still wins: `Contact: Dana Example at ACME` is `Contact:
  [REMOVED]`, as before (rule C runs after it).

**Tests (invented text):** `redact-name-at-company.test.ts`, 73; the older
redaction tests ran unchanged and pass (one assertion moved: the version
string in `redact-gaps.test.ts`). `npm run check`: 189 files, 3255 tests, exit
0. E2E, on their own: `ratecon-ai.spec.ts` 4, `ratecon-fill.spec.ts` 2.
**Mutation-checked,** 25 mutations on the rule and its guards: the mask, the
re-scan, each pass, the order of replacement, the stop words, the company
shape (any token; a Capitalised word; PM/TBD; `with` with an ID; long and
short numbers; `[ID]`), the word counts (1, 3, 5), lower case, the role rule
both ways, `with`, the connector's spaces and the version. All killed except
one equivalent mutant: **the first-pass call is redundant** (the joined pass
gives the same text for every input), kept because the brief named both. Four
others survived the first run: an `[ID]` after `at`, the connector's space
after it, and the connector's space before it (each now pinned by a test),
and the lookbehind that kept a run from starting inside a word (removed, see
above).

**On the real files (counts only):**

- **The 28 files that existed: rule C fires on none** (0 lines, 0 masks), and
  the 12 AI-only files' sent text is **byte-identical to run 10** (hashes
  equal), so 3u's result stands for the text it sent.
- **On the new file, sample 22: 1 line, 1 mask** (line 5, page 1). Its shape
  is a two-word name, `at`, an all-caps company of three words, ` - `, and an
  ID of a letter and seven digits: the rule's example. The mask took the two
  name words. The brief said to stop for review if it fired; it fired on the
  file it was written for and on no other. Re-scan clean (31 lines, no
  residue). Its ground truth is not complete, so the check below does not
  cover it.
- **Re-scan clean on all 29 files** (26 text-layer, 3 scans); 0 residual hits.
- **The ground-truth values that are in a sample's own text, and still in the
  sent text** (12 files): the load number in all 12, every street, every
  city, and every ZIP except **one ZIP on sample 7 and one on sample 11**
  (below).

**Found while checking, not caused by rule C and not changed: the label rule
loses a city line on samples 7 and 11.** On each, one line is a label of five
letters and a colon in one cell and a city-and-ZIP in the next
(`Aaaaa:` | `City, ST ddddd`). The label rule takes the next cell as the
label's value and masks the whole city line, so that stop's ZIP never reaches
the model. That is why those stops' ZIPs were blank and marked in every run
of 3r and 3u (and, on those stops, the city and state in the runs that were
blank for them): the cause was the redaction, not the model. Probably a two-column layout
where the label's value is below and the neighbour is the stop's address. A
fix would be its own phase: the label rule would have to leave a city line.

**Known limit of rule C:** a name with no company or ID after it, `Last,
First at ACME`, a company in mixed case after `at`, and any other way of
introducing a name. "Show what is sent" is still the check.

### Phase 3x: the verifier no longer lets a date eat a time, and reads a 24-hour document as 24-hour (2026-10-15)

No API call, no network, no `ratecon:eval-ai`; nothing read from `.samples/`
or `expected.json`. **The reader stays off by default.** Invented data only.
The model, the prompt, the schema and the route are unchanged; the change is
in `src/lib/ratecon/verify-read.ts`.

**Why:** on a real C.H. Robinson load the AI read both stops correctly and the
verifier discarded both. The pickup said `08:00-15:00`, the delivery
`Delivery Time: 11:00 Appt.`.

**Fix 1, a bug: a date ate a time.** `NUMERIC_DATE` matched `00-15` inside
`08:00-15:00`; `datesIn` blanks every date it finds before the times are
read, so both times vanished and the appointment was `unreadable`. The
pattern now has a lookbehind (not right after a colon) and a lookahead (not
right before a colon and a digit). Both are needed, and each catches what the
other does not: `08:00-15:00` is caught by either, but `10-11:30 AM` (a
range, not October 11) needs the lookahead, and `13:00-17` or `8:30-12` need
the lookbehind. Kept: `7-10 AM`, `1400`, and the dates `10/14`, `10-14-26`,
`10/14/2026`, `2026-10-14`, `Oct 14`, also right next to a time.

**The same bug in `NAMED_DATE`, found and fixed:** its optional year took any
four digits, so `Oct 14 0800` was October 14 of the year 800 and the time was
blanked with it. A year after a named date is now 2020 to 2039. **A cost,**
pinned: `Oct 14 2000` is October 14 at 20:00, not the year 2000, and a year
before 2020 after a named date is no longer read. `ISO_DATE` cannot eat a
time (it needs `dddd-dd-dd`) and is unchanged.

**Fix 2, a rule: a bare `HH:MM` in a 24-hour document.** `documentIs24Hour`
(exported), computed once in `verifyRead` from the lines that were sent: the
document is 24-hour when it holds at least one unambiguous 24-hour time
(`HH:MM` with an hour from 13 to 23, or a two-digit hour with a leading zero,
`08:00`) AND no time with AM/PM anywhere (`8 AM`, `8:00 pm`, `5 p.m.`,
`8:00PM`, `8:00P`, the end of `7-10 AM`). Then a bare `HH:MM` in a quote is
accepted as 24-hour (hour up to 23, minute up to 59). Otherwise nothing
changes: the quote's own evidence still works as before, and `11:00` alone is
not guessed. `0800` and `8:00` are not evidence; `10:00`, `11:00` and `12:00`
are not unambiguous.

**Decisions, for Alex to overrule:**

1. **One AM/PM time anywhere in the sent text rules the document out,** even
   on an unrelated line (a "Close 8:00 PM" notice, say). This is the brief's
   rule and the safe side, but a 24-hour load confirmation with one stray
   "PM" loses its bare times again.
2. **A `13:22:05` timestamp in a footer counts as 24-hour evidence,** because
   the pattern finds `13:22` in it. A document with that and bare times and no
   AM/PM reads the bare times as 24-hour. Not guarded.
3. **The ground truth follows the rule** (`ground-truth-howto.md`): a bare
   `11:00` is `"11:00"` in a document that shows a 24-hour clock elsewhere and
   has no AM/PM, and a couldn't-read otherwise. **Any ground-truth entry that
   was written as a couldn't-read for a bare time in such a document is now
   stale** and would score the AI's correct time as WRONG. I did not read
   `expected.json`; that check is Alex's, or a later phase's.
4. **Evaluation numbers are not comparable across this change** for
   appointments on 24-hour documents: before it the verifier threw some of
   them away (and they showed as `unreadable`, marked); now they are read.

**`templates.ts`, checked and NOT changed:** it has no date-eats-time problem.
Every date and time there is taken by an anchored, whole-shape pattern
(`^(\d{1,2})\/(\d{1,2})\/(\d{4})\b` with the time parsed from the text after
`TIME:`; `\d{2}\/\d{2}\/\d{4}\s+\d{4}`; `Mon D, YYYY` with a separate
`HH:MM` cell; the stops-section stamp), and none blanks a date out of a string
before reading times from what is left.

**Tests (invented text):** 61 new in `verify-read.test.ts` (66 became 127): the
range forms with a date before them (`08:00-15:00`, `8:00-15:00`,
`08:00 - 15:00`, `0800-1500`, dashed, no-year, ISO and named dates, the date
after the times, a flag between), `10-11:30 AM`, `13:00-17`, `8:30-12`, real
dates beside times, `documentIs24Hour` on its own (evidence, none, every
AM/PM form, look-alikes), and the document fact through `verifyRead` (the
brief's four cases, evidence and AM/PM together, 25:00 and 11:75, a range of
bare times, a whole two-stop reply). `npm run check`: 189 files, 3316 tests,
exit 0. E2E, on their own: `ratecon-ai.spec.ts` 4, `ratecon-fill.spec.ts` 2.
**Mutation-checked,** 23 mutations (each lookaround, weakened lookarounds, the
AM/PM guard on dates, the year rule, both guards of the document fact, each
kind of evidence, each AM/PM form, the first-line-only mistake, the fact
never, always, false and true, and 25:00). Six survived the first run (the
lookarounds, which each hid the other on `08:00-15:00`; a weakened lookbehind;
`25:00`) and are pinned now. One survivor remains and is an equivalent
mutant: dropping the minutes from the AM/PM pattern, because `\b` already
matches before the minutes.

### Phase 3y: a layout fingerprint with each AI read's outcome (2026-10-15)

No API call, no network, no `ratecon:eval-ai`. **The reader stays off by
default.** Invented text in every test. The real PDFs were read LOCALLY by
`ratecon:layouts-report --samples` only; sample numbers and counts were
printed, never a value, a label, a hash or a file name. **Migration 0029 is
applied to the LOCAL test databases only.**

**Why:** to see which layouts of rate confirmation recur among the AI reads,
and which of them deserve a template. Each saved AI read now carries a
fingerprint of the document's layout, next to the counts the dispatcher's save
already records.

**The fingerprint** (`src/lib/ratecon/layout.ts`, pure, computed in the browser
from the prepared, already redacted lines):

- **A label** is the text just before a colon or a `#` in a cell (cells are what
  the sent line joins with two spaces): `Pick Up Date`, `Appointment#`,
  `Delivery Time`. Lower-cased, trimmed, digits removed (`Stop 2 Date` is `stop
  date`), words squeezed, 2 to 40 characters, **at most five words** (a longer
  run is a sentence). The last piece of a cell has no delimiter after it, so a
  value is never a label; a clock (`08:00`) gives nothing. **A cell holding a
  placeholder is ignored whole**, its labels too (`Phone: [PHONE]`, `Booked
  by: [REMOVED]`).
- **Each label is its hash:** the first 8 hex characters of SHA-256 of the
  lower-cased label (a small synchronous SHA-256, checked against Node's, so
  the browser, a test and a script compute it the same way). Sorted, each
  once, **at most 64: the 64 smallest hashes** if there are more, so the same
  document gives the same 64 whatever the order of its lines. No label text,
  value, name, address or load number is kept.
- **Known limit:** any text directly before a colon is a label. A name written
  `Dana Example:` would be hashed (8 hex characters; a dictionary of names could
  test a guess against it). The redaction has already run, and more than five
  words is not a label; nothing more is done.
- **Jaccard similarity** of two label sets; 0 if either is empty. **Groups:** a
  read joins the EARLIEST read it is 0.7 similar to (itself if none before),
  and only that one: not transitive, so drifting layouts do not chain. Reads
  with no labels are in no group.

**On the wire and in the database:**

- `POST /api/ratecon/outcome` takes an optional `layout`: an array of at most
  64 strings of exactly 8 lower-case hex characters, **strictly ascending**
  (each once). Anything else is a 400, nothing stored, no echo. It is optional
  so a page loaded before this still records its counts. The body limit is
  4 KB (was 2).
- **Migration 0029** (additive, hand-written like 0028): `ratecon_ai_outcomes`
  gains `layout text[] NOT NULL DEFAULT '{}'` and a check
  (`ratecon_ai_outcomes_layout_hashes`): at most 64 entries, none NULL, one
  dimension, every entry exactly 8 lower-case hex characters. Existing rows get
  an empty layout. RLS and the deny-all policy are the table's, from 0028. The
  layout lives and dies with its outcome row: **90 days**, deleted with the read.
  **Rollback** (in the file): drop the constraint, then the column.
- **Stored once:** the layout goes on the same row as the once-per-read marker,
  by whichever post inserts it; a second post stores nothing (the first
  layout stands), and two at once store one.
- **Deploy order:** apply 0029 BEFORE the code. The insert names the column, so
  a database without it answers every outcome post with a 500 (one log line of
  a code, a reference and a class name). A save is never affected: the modal
  posts after it and counts a failure in the tab.
- **The browser:** the strip computes the fingerprint when the pair is read
  (from the lines it sent), keeps it with the read id, and the modal posts it
  with the counts after the first save. A fingerprint that cannot be made is
  `[]`. It never delays, fails or shows anything on a save.

**Reading it.** `npm run ratecon:layouts-report` (reads `DIRECT_URL`, or
`LAYOUTS_REPORT_URL` when set; **do not point it at production before 0029 is
applied there**: it says so and stops) prints the two queries below. By hand,
on a database that has migration 0029:

    -- 1. Groups of similar layouts: reads, how many kept every field the AI
    --    filled, how many had at least one change or clear.
    with o as (
      select read_id, created_at, layout from ratecon_ai_outcomes where cardinality(layout) > 0
    ), sim as (
      select a.read_id, b.read_id as anchor, b.created_at as anchor_at,
        (select count(*) from (select unnest(a.layout) intersect select unnest(b.layout)) i)::float8
          / (select count(*) from (select unnest(a.layout) union select unnest(b.layout)) u) as j
      from o a join o b on (b.created_at, b.read_id) <= (a.created_at, a.read_id)
    ), anchored as (
      select distinct on (read_id) read_id, anchor from sim where j >= 0.7 order by read_id, anchor_at, anchor
    )
    , per_read as (
      select an.anchor, an.read_id,
        coalesce(bool_and(f.changed = 0 and f.cleared = 0), true) as kept_all,
        coalesce(bool_or(f.changed + f.cleared > 0), false) as any_change
      from anchored an left join ratecon_ai_outcome_fields f on f.read_id = an.read_id
      group by an.anchor, an.read_id
    )
    select anchor::text as anchor, count(*)::int as reads,
      (count(*) filter (where kept_all))::int as kept_all, (count(*) filter (where any_change))::int as any_change
    from per_read group by anchor order by reads desc, anchor

    -- 2. Per group and field name: how many of the group's reads filled the
    --    field, and how many of those changed or cleared it.
    with o as (
      select read_id, created_at, layout from ratecon_ai_outcomes where cardinality(layout) > 0
    ), sim as (
      select a.read_id, b.read_id as anchor, b.created_at as anchor_at,
        (select count(*) from (select unnest(a.layout) intersect select unnest(b.layout)) i)::float8
          / (select count(*) from (select unnest(a.layout) union select unnest(b.layout)) u) as j
      from o a join o b on (b.created_at, b.read_id) <= (a.created_at, a.read_id)
    ), anchored as (
      select distinct on (read_id) read_id, anchor from sim where j >= 0.7 order by read_id, anchor_at, anchor
    )
    select an.anchor::text as anchor, f.field::text as field,
      (count(*) filter (where f.kept + f.changed + f.cleared > 0))::int as filled,
      (count(*) filter (where f.changed + f.cleared > 0))::int as changed
    from anchored an join ratecon_ai_outcome_fields f on f.read_id = an.read_id
    group by an.anchor, f.field order by an.anchor, f.field::text

**How to read them.** A *group* is a layout that recurs (an `anchor` is the
first read of it; ids are read ids, never printed by the script). *kept_all*
is the reads where nothing the AI filled was changed or cleared; *any_change*
the reads where something was (a blank the dispatcher filled is neither). In
a big group with a high kept share the AI is already doing well and a template
buys little; in a big group with a low kept share a template pays, and query 2
says which fields: `street 4 of 9 changed or cleared` is a street the AI gets
wrong in nearly half of that layout's reads. A group of one is a layout seen
once. Reads older than 90 days are gone; reads from before 0029 have no
layout and are not grouped. Small groups say little: read counts, not only
shares.

**On the real samples** (`npm run ratecon:layouts-report -- --samples`; counts
and sample numbers only; the numbers are by name order, 29 PDFs, 26 with a text
layer that can be sent). Labels per sample: least 4, median 17, most 36; none
without. **The 0.7 rule makes 17 groups:**

| Group | Samples | By |
|---|---|---|
| 1 | 23, 24, 25, 26 | a template |
| 2 | 13, 14, 15 | a template |
| 3 | 18, 19, 20 | a template |
| 4 | 7, 11 | **only the AI** |
| 5 | 27, 28 | a template |
| 6 to 17 | 1, 2, 4, 8, 9, 10, 12, 16, 17, 21, 22, 29 (one each) | 1 by a template, 11 only the AI |

So the files of one template family group together (lowest similarity to the
first in a group 0.84 to 1.00), which says the fingerprint sees a layout. Of the
eleven AI-only files that are alone, none is 0.7 similar to another. **The
nearest misses** (first samples of two groups between 0.30 and 0.7): 23 and 29
at 0.40, 4 and 10 at 0.36. The two AI-only files that DO group, 7 and 11
(0.89), are the one layout among these twelve that recurs: the first candidate
for a template, if more of its kind come. This is a handful of files; nothing
here is a rate.

**Tests (invented text):** `layout.test.ts` 49 (the hash against Node's, what
a label is, the cap, the order, the sentinel, Jaccard, the grouping rule),
`layout-report.test.ts` 7 (the SQL against the database and against
`groupLayouts`), `outcome-codes.test.ts` +25 (the contract), `handle-outcome
.test.ts` +14 (stored, 64, none, empty, once, two at once, every bad shape with
a sentinel in it, the 500 line), `outcomes-schema.test.ts` +14 (the column, the
check against every bad input), `record-outcome.test.ts` and
`fill-outcome-save.test.tsx` (the browser sends it, a refusal never touches the
save), and the e2e spec (the stored layout is hashes). `npm run check`: 191
files, 3427 tests, exit 0. E2E, on their own: `ratecon-ai.spec.ts` 4,
`ratecon-fill.spec.ts` 2.

**Mutation-checked,** 28 mutations (the sentinel: values, placeholder cells,
digits, five words, 40 characters, one letter, label text instead of its hash;
the cap of 64 in the fingerprint, the order, the wire and the body; the
once-per-read rule: a second post overwriting or storing counts twice; the
layout dropped or not stored; the threshold; Jaccard). All killed except one
equivalent mutant: lower-casing a label that is already lower-case. The
database check was shown directly: with it dropped inside a rolled-back
transaction a label is stored. **A process slip, said plainly:** the wire
contract (`outcome-codes.ts`) was changed in the same step as its tests, so I
did not watch those tests fail first; the mutation checks on it (nine, all
killed) are what show they bite.

**Decisions, for Alex to overrule:**

1. **The 64 kept are the 64 smallest hashes,** not the first 64 or the most
   common: stable across line order and a fair sample for Jaccard. A document
   with more than 64 labels is represented by a random-looking subset.
2. **`layout` is optional on the wire** (a stale tab still records its counts),
   but **strictly ascending when present**, so a client bug is a 400 and a
   missed layout, not a stored mess.
3. **Groups are not transitive.** A read counts with the earliest read it is
   0.7 similar to. A layout that drifts slowly will split into groups; chained
   clustering would merge it. Chosen for a rule that the SQL and the script
   state the same way and a group that means "like its first read".
4. **A placeholder anywhere in a cell hides the whole cell's labels,** as the
   brief said. The labels of a cell like `Phone: [PHONE]` are therefore not in
   the fingerprint, nor are `Rate: [AMOUNT]` or `Contact: [REMOVED]`.
5. **Samples mode fingerprints the text that WOULD be sent** (the redacted lines
   of `prepareForReading`, page-selected), which is what the browser hashes.

**Approved by Alex, 2026-10-15.** Phase 3y is approved as built. Decided with it:

- **The known-limit note stands as written** (the text before a colon is a label).
  No further hardening on names before a colon; do not reopen it.
- **0029 stays on the LOCAL test databases.** It is applied nowhere else: not
  production, not any shared database. Nothing is pushed.
- **Deploy order when the reader is turned on: 0029 to production first, then
  the code.** Never the other way round (the insert names the column; see
  "Deploy order" above).
- **The reader decision** (the "Next" section) is Alex's, to make alone.

### Phase 3z: evaluation run 11, paired, the twelve files, first run under 3v, 3w and 3x (2026-10-15)

**Approval (Alex, written, dated 2026-10-15):** `ratecon:eval-ai --pairs` on
samples 2, 4, 7, 8, 9, 10, 11, 12, 16, 17, 21 and 29 (current numbers; 29 is
3u's "28"), 3 runs each (72 calls), Claude Haiku 5.5, ceilings $1.00 and 75
calls, under `redact-2026-10-14.5`. Earlier approvals that named a sent-text
hash are void. Retention (default) is accepted by the decision of 2026-10-15,
"The AI reader's use and redaction". The approval covers this one run. I did
not read the ground truth, any sample text or any value.

**Checked before the run:** the tree was clean (`git status` empty, HEAD
`eac9976`), `REDACTION_VERSION` was `redact-2026-10-14.5`, and
`ratecon:redact-report` (local, no network) gave **residual hits 0**.
**Sent-text hashes (first 12 of sha256) match 3u's for all twelve:** 2
`fe5f7539e194`, 4 `f05494d30f77`, 7 `baa6c413ef11`, 8 `826196de5a3f`, 9
`220af5986443`, 10 `0d14bdd88041`, 11 `49288d225e5d`, 12 `282113934c2a`, 16
`8538f55afaf5`, 17 `5b56633ef15b`, 21 `77b64d5b9b8e`, 29 `435a59f2c590` (3u's
28). That is what 3w said; the run's input tokens agree (below).

**The command, run once, as given** (not re-run; the reader's settings were not
changed, it stays off):

    LLM_READER_MODEL=claude-haiku-5-5 npm run ratecon:eval-ai -- --approved=2026-10-15 --files=2,4,7,8,9,10,11,12,16,17,21,29 --runs=3 --pairs

**Result: exit 0, the bar is MET: 36 of 36 runs scored, zero WRONG on all seven
bar fields, merged and in read A and read B alone.**

| | 3u | 3z |
|---|---|---|
| Calls | 72 of 72 | **72 of 72** (ceiling 75) |
| Tokens | 358,704 in, 166,408 out | **358,704 in, 164,234 out** |
| Cost | $0.1191 | **$0.1180** (ceiling $1.00) |
| Runs scored / planned | 36 / 36 | **36 / 36** |
| Pairs agreed / differed / failed | 26 / 10 / 0 | **22 / 14 / 0** |
| Address cue fires | 12 of 36 | **12 of 36** (9, 12, 21, 29, every run) |
| Merged WRONG on the bar | 0 | **0** |

**WRONG:** none on the bar, so **there is no relation code to report.** **No
appointment is WRONG:** all 84 appointments (stop-runs) are marked, by the 3v
check or blank and marked (corrected, see "Appointments" below), none
silent. 3u's one silent WRONG appointment (sample 10, run 2, stop 1) is marked
here.

**Pairs per sample** (3 runs each; 3u in brackets):

| Sample | Pairs | Differed on | 3u |
|---|---|---|---|
| 2, 4, 8, 21, 29 | 3 agreed | | same |
| 17 | 1 agreed, 2 differed | street x2 (run 1), street x1 (run 2) | 3 agreed |
| 11 | 2 agreed, 1 differed | appointment x2, city x1, state x1 (run 2) | 2 / 1: city x1 and state x1 (run 1) |
| 16 | 0 agreed, 3 differed | appointment x2 (every run) | 2 / 1 |
| 7 | 1 agreed, 2 differed | appointment x2 (run 1); appointment x2, city x1, state x1 (run 2) | 1 / 2 |
| 9 | 1 agreed, 2 differed | appointment x2 (runs 2, 3) | 1 / 2 |
| 10 | 0 agreed, 3 differed | appointment x1 (every run) | 1 / 2 |
| 12 | 2 agreed, 1 differed | street x4 (run 3) | 1 / 2 |

**Marked fields, cell-runs (3u in brackets):**

- **ZIP blank and marked: 24 (24)**, the same cells: samples 4, 7, 9, 10, 11
  (one stop, every run) and 12 (stops 2 to 4, every run).
- **Street blank and marked: 7 (8).** Sample 12, all four stops in run 3 (3u:
  runs 1 and 2); sample 17, 3 (3u: 0), in the runs whose pairs differed on it.
- **City and state blank and marked: 4 (2)**: sample 7 stop 2 in run 2, and
  sample 11 stop 2 in every run (3u: sample 7 and sample 11, run 1 each).
- **Order and type filled and marked: 5 (5)**: sample 4 stop 1 in every run,
  and sample 11 both stops in run 3 (3u: sample 9 both stops in run 1; sample
  11 none).

**Appointments, separately from the bar.** **All 84 appointments are marked,
but not all by the 3v check** (corrected after the run; the first write-up
said all 84 carried it). `appointmentScore` counts any
`fill.checks.appointment` as "marked" (`scripts/ratecon-expected.mts:122`), so
its 84 of 84 includes blanks. **About 58 carry the 3v check and about 26 are
blank and marked** "Couldn't read" or "The two AI reads differed": inferred
from the parts that differ, not read from the replies (the script stores no
reply and prints no check text, so the exact split needs a re-run). **No
appointment is silent WRONG:** a WRONG is unmarked by definition, and every
one of the 84 carries a mark. Of the 84, the scorer puts **55 "filled as the
PDF says" and 29 "filled differently",
every one marked.** The 29, by sample: 16, 6 (both stops, type, date, time and
end time, every run); 21, 6 (the same, every run); 7, 5 (date and time on
both stops in runs 1 and 2; time on stop 2 in run 3); 9, 4 (date and time on
both stops in runs 2 and 3); 10, 3 (stop 1: type, date, time, end time, every
run); 12, 3 (stop 1: type and end time, every run); 11, 2 (both stops, run
2); samples 2, 4, 8, 17 and 29: none. **"Filled differently" is the scorer's
wording and covers blank-and-marked appointments:** a blank appointment
differs from any truth (`appointmentDiff`, `scripts/ratecon-expected.mts:96`).
**By part signature, 26 of the 29 are blanks** (samples 16, 21, 10 and 11;
samples 7 and 9 in the runs where the pair differed; sample 7, run 3, stop 2);
inferred, not read from the replies. **Only sample 12 stop 1 (3 cell-runs) is
a filled value that differs.** **Stale ground truth does not explain the 29**
(corrected; the first write-up said some might be stale): the diagnosis after
the run counted the twelve files' ground truth (counts only, no value read
out) and found no couldn't-read entries, so 3x's stale case does not occur in
them; samples 16 and 21 are FCFS at every stop. Sample 8's stop 3 time differed in
every run of 3u and does not here; sample 9 went from stop 2's time in every
run to date and time on both stops in runs 2 and 3. The counts do not say why
(a run-to-run change of this size is within what 3p and 3r showed on unchanged
text, and 3x is one candidate, not shown).

**Samples 16 and 21, and a limit of the verifier** (diagnosis after the run,
2026-10-15: no code changed, no network call; part names and counts only):

- **Sample 21 did not change:** both stops differ in type, date, time and end
  time, both reads, every run, in 3p (line 2424), 3r (line 2625), 3u (line
  3082: "both stops (type, date, time, end time), both reads, every run (as
  3r)") and here: blank at both stops each time (by part signature). Each
  read had 2 values that did not stand (this run's stdout).
- **Sample 16 is run-to-run variance on identical text:** the sent text,
  prompt and input tokens are 3u's. In every run here exactly one read
  differed at both stops (read B in runs 1 and 3, read A in run 2; stdout), so
  the pair differed and the merge blanked the appointment (by part signature;
  whether that read answered `unclear` or did not verify is not in the
  stdout). Runs with a blank: 1 in 3u (line 3080), 2 in 3r (line 2623), 3
  here. 3x cannot produce a blank: it only turns some unreadable reads into
  ranges, never the reverse (synthetic test on the pre-3x tree and HEAD; the
  script was not kept).
- **The limit:** the verifier never accepts a day-first named date (for
  example `16-Oct-2026`, `16 Oct 2026`, `16OCT26`) or a numeric date range
  (`10/16-10/17`). It reads ISO, month-first named and numeric M/D dates only
  (`src/lib/ratecon/verify-read.ts:84` to `97`). The date stays null, which
  makes the whole appointment unreadable (`verify-read.ts:241` to `261`): the
  form gets a blank APPT marked "Couldn't read", and the dispatcher enters
  it. **Sample 21's likely cause is a day-first date: UNVERIFIED.** Its sent
  text has two lines with a day-first named date; whether those are the
  appointment dates was not checked. A numeric date range is ruled out for 16
  and 21 (no such shape in their sent text).
- **A stop whose truth is FCFS at 120 minutes or less cannot score "same":**
  the fill makes a window of 120 minutes or less APPT with that window
  (`appointmentFrom`, `src/components/edit/ratecon-fill.ts:106` to `113`;
  `APPT_WINDOW_MAX_MINUTES = 120`, line 46), so its type differs from FCFS
  truth even when read perfectly. One of sample 21's stops is such a stop.
- **Not changed.** Adding day-first parsing would be a new phase and is
  Alex's decision; so is a re-run of sample 16 (it needs a written approval).

**Cost** per pair about $0.0033 ($0.1180 for 36). By sample, in dollars (summed
from the per-run figures, which are rounded) and tokens in/out over 3 runs: 2
$0.0072 (23,442 / 9,714); 4 $0.0104 (25,062 / 15,784); 7 $0.0091 (20,352 /
14,031); 8 $0.0075 (22,770 / 10,529); 9 $0.0110 (52,920 / 11,491); 10 $0.0093
(24,192 / 13,743); 11 $0.0087 (19,524 / 13,540); 12 $0.0147 (53,256 /
18,624); 16 $0.0094 (23,850 / 14,104); 17 $0.0084 (25,812 / 11,728); 21
$0.0096 (20,670 / 15,025); 29 $0.0126 (46,854 / 15,921). Input tokens per
sample equal 3u's to the token; the output tokens differ.

**What the run shows, and what it does not:**

- **It shows** that on the same sent text, the code with 3v, 3w and 3x still
  gets zero WRONG on the bar in 36 of 36 runs, in each read and merged, and
  that no appointment is silent: about 58 carry the 3v check (by
  construction) and about 26 are blank and marked (corrected, see above).
- **It does not show** that the appointments are right: 29 of 84 differ from
  the ground truth (26 blank and marked, 3 a filled value, inferred). Stale
  ground truth explains none of them (corrected): sample 21 has been blank
  since 3p, sample 16 is run-to-run variance, and a day-first date is
  sample 21's likely cause (unverified; see above). It does not
  show that 3x changed anything, or that 3v is "Looks right"-proof.
- **The zero is still partly blanks:** 24 ZIPs, 7 streets and 4 city-and-state
  cells are left for the dispatcher, marked. The 3q question stands: sample
  12's four streets differ between the reads in one of three runs.
- **The pair disagreed more** (14 of 36 against 10): on appointments mostly
  (samples 7, 9, 10, 16), and on street for sample 17 (0 differing in 3u).
  Single runs of three; I cannot tell a change from run-to-run noise.
- **Scope:** 12 of the 25 files, 3 runs each, one model (Haiku 5.5), one run.
  The six control files have not been re-run since 3e. Nothing was fixed.
  Which Anthropic account or workspace this key bills to: unverified (no phase
  records it). Whether to turn the reader on is Alex's call.

### Phase 3aa: a fifth template, Route blocks, read only when every stop is confirmed (2026-10-15)

**Why:** Alex wants layouts that recur to stop going to the AI reader: a
template is instant, free and sends nothing out. The advisor's evidence
(local, no values): sample 8 and a second PDF of the same layout (Alex's own
file, kept outside `.samples/`, 2 stops; sample 8 has 3) have a layout
fingerprint similarity of 1.00 on 4 label words, and no template read either.
The AI read sample 8 right in run 11 (3z) and Alex's file live (Alex checked
stop 1 field by field). Code and tests are commit `c59042e`; NOT pushed, NOT
deployed.

**What it reads** (`readRouteBlocks`, `src/lib/ratecon/templates.ts`; layout
`route-blocks`):

- **The page header,** on every page: "Page N" and "Shipment ID", "Rate
  Confirmation", then a date and the ID. **The load number is that ID,** not a
  "Pickup #" or "Delivery #" number. When the pages disagree, it is blank with
  a check, as in the other templates.
- **The stops,** in three columns opened by "Route": four lines a stop (the
  type, "Pickup" or "Delivery", and the facility; the date and the address;
  the time and the stop's own "Pickup #" or "Delivery #" number, which must
  say the same type; one more line of the facility's). Any number of stops.
- **The summary line** below them: "Facility (City, ST) > Facility (City,
  ST)", naming the FIRST and the LAST stop only.
- **Never read:** rate, broker contact, phones, emails, carrier, equipment,
  notes, terms, the stops' own numbers.

**Recognised by** (all five must be present; on the samples and the other
four templates' fixtures they match nothing else):
`^Page \d+\s+Shipment ID$` (the header line; it starts with "Page", so the
columns template's `^Shipment ID\b` does not match it), `^Rate
Confirmation$` (the whole line), `^Route\s+Pickup\s+\S` (no other layout opens
its stops with "Route"), and "Pickup # <digit>" and "Delivery # <digit>" with
a space before the "#" (the columns template's headings are "Pickup #1", on
their own line). None of them is a time, so an odd time still reaches the
reader and comes back unreadable.

**The finding: the street and the city are ONE run.** Each address is a
single pdf.js item, "street city, ST 12345", with single spaces and nothing
between street and city. Where the street ends is written down only in the
summary line, and only for the first and the last stop. The first version
split those two and left a middle stop's street and city blank and marked
(the §12.121 rule for a pasted address that runs together); on sample 8 that
scored stop 2's street and city `read is empty` (marked), every other cell
pass and all three appointments `exact`. Stopped and reported.

**Decision (Alex, written, 2026-10-15): option B, tightened.** The template
reads a document ONLY when every stop's street and city can be split with the
summary line's confirmation: the stop is one the summary names, and its
address ends in exactly that city and state. A document with any stop the
summary does not name (the middle stop of three) is refused whole, so it goes
to the AI reader as today. Applied as "every stop confirmed", not as "more
than two stops". Rejected: splitting by street-suffix words (a guess, and a
template read carries no AI check), and a partial read with blanks. **So
sample 8 is now recognised, then refused,** and stays with the AI; two-stop
documents of this layout are read in full.

**Times:** only "HH:MM Apt" (one run or two) is a time, an appointment at
that time. The hour is 24-hour when it is past 12 or has a leading zero, or
when the document is on a 24-hour clock by the app's rule (3x,
`documentIs24Hour`); a template sends nothing, so the rule runs over the whole
document. Anything else beside a stop (a range, "FCFS", AM/PM, a one-digit
hour, "Appt", another date shape) is quoted as unreadable, never guessed:
template reads carry no "the AI filled this" check (3v), so there is no
second line of defence.

**Strict, a wrong stop being worse than none:** pasted text (no positions), a
block of any other shape (a line missing or too many, a cell beyond the
columns), a stop's number naming the other type, a stop with no city line, a
city line anywhere but a stop's address, no summary line or two, a summary
naming another first or last facility, an address that does not end in the
summary's city and state or does not start like a street, a first stop that
is not a pickup, or no delivery: and nothing is read.

**The import cycle, closed:** the template needs the verifier's 24-hour rule.
`documentIs24Hour` and its two patterns moved unchanged to
`src/lib/ratecon/clock-24.ts`, which both `templates.ts` and `verify-read.ts`
import, so neither imports the other for it. `verify-read.ts` changed only in
its imports, plus a re-export, so `verify-read.test.ts` is unchanged (127 tests,
passing).

**Also:** `ratecon:score` said "not one of the four layouts"; it says five
(`b613d2b`).

**Checked locally (counts and codes only, no values):**

- `recognisedLayouts` per sample, HEAD against 3aa: the same for all 29 but
  sample 8 (0 layouts before, `route-blocks` alone after). Every file another
  template reads matches exactly its own layout. Alex's file: `route-blocks`
  alone.
- `readRatecon`: unchanged for every sample (same read or not, same stop
  counts); sample 8 is not recognised, as before, now because the reader
  refuses it (0 stops).
- `npm run ratecon:score`: output identical to HEAD's (`diff` exit 0); the bar
  13 of 13, appointments silently wrong: none. Sample 8 prints "not a template
  layout — ground truth for the AI evaluation only".
- **Alex's file:** read, 2 stops, every field filled (load number; each stop's
  type, street, city, state, ZIP; both times exact). Not copied into
  `.samples/`: it would renumber every sample after it (as 3w did).

**Tests** (invented fixtures only, `routeBlocks` in
`src/test/ratecon-fixtures.ts`): 16 new in `templates.test.ts` (43 there,
27 before), one pdf.js round trip in `read-pdf.test.ts`, and `route-blocks`
added to the fill test that a template read carries no AI check. `npm run
check`: 191 files, 3444 tests (3427 before). Mutations, each applied alone and
reverted: dropping the 24-hour rule, the stray-city-line refusal, the
every-stop-confirmed rule, the type check, or "Apt" from the time each fail
one test. Dropping the no-positions guard fails none: pasted lines are one
cell each, so the "Route" cell is never found and the document is refused
anyway; the guard is a second line of defence.

**Unverified:**

- **The template's values on Alex's file.** Only Alex's by-eye check of its
  two stops against the PDF can settle them; the earlier check was of the
  AI's fill of stop 1, not the template's.
- **No ground truth covers the template:** sample 8 is refused, and Alex's
  file is not in `.samples/`.

**For Alex:** add Alex's file to `.samples/` (it renumbers the samples after
it), and when to deploy `c59042e`. Neither is decided here.

### Phase 3ab: the verifier accepts a correct ZIP+4 (2026-10-15)

Approved by Alex, 2026-10-15. Code and tests are commit `aa9c5b2`; NOT pushed,
NOT deployed.

**Evidence** (the advisor's checks, local, no real values):

- **Alex's live read in production** (2026-10-15, reported to the advisor):
  a 4-stop load printing ZIP+4 on its city lines. The AI filled street, city,
  state and appointment, but every ZIP was blank and marked "Read by AI, but it
  does not follow from “<city line>”. Enter it by hand." In a two-zone state
  (ND) the blank ZIP also brings "More than one time zone … Enter the ZIP", so
  Save waits until the dispatcher types it.
- **A synthetic `verifyRead` test** (advisor, local, invented text): out of
  the quote "Fargo, ND 58102-1234", the model value "58102" filled and
  "58102-1234" was blank, "does not follow".
- **Run 11 (3z) blanked 24 ZIP cell-runs.** City lines with a ZIP+4 in the
  evaluation files (advisor, local, line counts): sample 12 has 7, samples 4
  and 10 one each, the rest none. That fits 15 of the 24 (sample 12 stops 2 to
  4, samples 4 and 10 one stop each, 3 runs). **INFERRED from line counts, not
  measured from replies.** Samples 7 and 11 are the 3w redaction case; sample
  9 has no ZIP+4 line, so its 3 cell-runs are unexplained.

**Cause** (`addressField`, `src/lib/ratecon/verify-read.ts`): on a city line
the model's ZIP was compared with `cityLine`'s ZIP, which is five digits
(`cityLine` drops the +4), so a ZIP+4 never matched. On any other line the
value had to be exactly five digits.

**The fix:** a ZIP+4 from the model ("58102-1234", or "581021234", both of
which `us-zip.ts` reads as ZIP+4) stands only when (a) its first five digits
are the city line's AND (b) the quote holds the value exactly as given. The
FIVE digits fill, with the quote as their source. Refused exactly as before,
with the same "does not follow" message: a +4 the text does not hold, first
five that differ, and a ZIP below 00501 (`isRealUsZip`: a +4 never lifts a
placeholder). A line that is not a city line takes a ZIP+4 under the same
conditions. A five-digit value behaves as before. Nothing else in the verifier
changed.

**Why five digits:** `isRealUsZip` reads ZIP+4 with or without the hyphen and
judges the first five, and the fill puts the ZIP in as read. Every template
fills five (`cityLine` drops the +4), the ground truth is "the five digits as
printed" (`docs/ground-truth-howto.md`), and the scorer compares exactly. The
zone lookup and the ZIP-state check read the first five digits, so the zone
would follow a ZIP+4 too.

**Tests** (invented text, every line with the sentinel): 7 new in
`verify-read.test.ts`, covering a five-digit value out of a ZIP+4 line, a
matching ZIP+4, a +4 not in the text, first five that differ (also when the
quote holds that ZIP+4 elsewhere), a placeholder with a +4, nine digits
without the hyphen, and a line that is not a city line. The 127 existing
tests are unchanged and pass. `npm run check`: 191 files, 3451 tests.
**Mutations,** each applied alone and reverted: dropping condition (a) fails
1 test, dropping (b) fails 2, and dropping the placeholder check fails 1 on a
city line and 1 on another line. The first version of the tests did not catch
(a), because the value was not in the text either; the case where the quote
holds the model's ZIP+4 but the city line's five differ was added for it.

**Unverified:** no run measures this. Neither the 15 of 24 nor Alex's live
load has been re-read since the fix. Deploying it, and any evaluation run,
are Alex's to decide.

**Found, not changed:**

- **Two messages for a ZIP below 00501.** A five-digit one stands in the
  verifier and the fill marks it "not a real US ZIP"; one with a +4 is refused
  by the verifier, "does not follow" (as before, as asked).
- **A five-digit value from a nine-digit ZIP printed without the hyphen**
  ("Fargo ND 581021234") is still refused, as before: the five are not a whole
  token there.

### Phase 3ac: Route blocks reads a middle stop, its street and city split by the app and marked (2026-10-15)

**Decision (Alex, written, 2026-10-15, in chat):** "yes i want template for
this also with 3 stops, reason is because we run this load with 3 stops 6 days
per week". **This supersedes 3aa's decision B for the Route blocks template
only:** a document whose middle stop the summary line does not name is no
longer refused for that alone. A SILENT split (3aa's option C) stays
rejected; a MARKED split is approved. Code and tests are commit `ce654db`;
pushed (`origin/master` at `9a475ca`, 2026-10-15); deployed: unverified.

**What is read and what is marked:**

- **Stops the summary line names** (the first and the last): read as in
  3aa, their city confirmed by the summary, **no mark**.
- **Any other stop:** its run-together street and city are divided by the
  app's own grammar (`splitStreetCity`, `src/lib/ratecon/street-split.ts`),
  state and ZIP read as before, and **the street and the city both carry a
  check**: "Check: the street and city were split by the app from “<the
  run-together text>”. Confirm them against the PDF."
- **Nothing else is marked:** no AI mark and no AI check on any template
  read, appointments included (3v is for model reads only).
- **The check is cleared, like every check, by editing that field,** and it
  counts in the strip's "fields to check". That count is shown, never a gate
  on Save. The brief said "Looks right" clears it "like any Check": it does
  not, and no check is cleared that way. "Looks right" exists only for fields
  the AI filled and clears only their AI marks (3v), and a template read has
  no "Looks right". Not changed: that would be a new control.
- **The fill change:** `fillStop` keeps a read's check on a field it filled
  (`ratecon-fill.ts`, one line). Only this template sets one; the verifier
  sets a check only on a field it left blank.
- **A pasted address that runs together is still never split (§12.121).**
  The exception is this template's, written in `street-split.ts`; nothing
  else calls it.

**The grammar,** over the words before ", ST 12345":

    street = NUMBER NAME+ TYPE [DIR] [UNIT]
    city   = WORD WORD? WORD?

- **NUMBER:** a house number: digits, then a letter or "-digits" at most.
- **NAME:** any words, at least one that is not an abbreviated directional.
- **TYPE:** a street-type word. The vocabulary is USPS Publication 28,
  Appendix C1: each primary suffix and its standard abbreviation, without FORT
  and MOUNT, which begin cities. `paste-address.ts` has no suffix list, and
  `src/lib/address.ts` has a deliberately small one without PARK or LAKE,
  which could not refuse "Park Ridge".
- **DIR:** N, S, E, W, NE, NW, SE or SW.
- **UNIT:** ONE of UNIT, STE, SUITE, APT, BLDG, RM or FL and one token of
  letters and digits, or "#" with one ("# 4", "#4").
- **WORD:** letters (and . ' -), so never a number; never a unit word. The
  FIRST word is never an abbreviated directional. WEST, EAST, NORTH, SOUTH,
  NEW, FORT and MOUNT may begin a city.

**Why exactly one division:** every division of the words that fits is a
candidate, and the split is taken only when there is EXACTLY ONE, and its
city does not begin with a street-type word. Zero, or two or more, and the
WHOLE document is refused, so it goes to the AI reader as before. A candidate
whose city begins with a street-type word still COUNTS, because that is where
the division is ambiguous: "Main St St Louis" could be "St Louis", and
"Main St Park Ridge" could be "Park Ridge". Counting it refuses the document,
where filtering it out would have read "Louis". A city beginning with an
abbreviated directional, a unit word or a number is not counted: under the
grammar those belong to the street ("St N Fargo" is "St N" and "Fargo").
Refused on purpose (tested):
- a city beginning with a street-type word;
- "Park Ridge"-shaped;
- a street with no street-type word;
- a second unit phrase;
- more than three city words;
- a street-type word inside the street name before another ("Lake Park
  Ave");
- a city with a street-type word before its last word ("Palm Beach
  Gardens").

**Checked locally (counts and codes only, no values):**

- **`npm run ratecon:score`: sample 8 passes every field at all three stops,
  stop 2's street and city included,** all three appointments `exact`. The
  bar is 14 of 14. Against HEAD, compared byte for byte by stashing, only
  sample 8's lines and the bar line differ; the 13 other template samples are
  identical.
- **`recognisedLayouts` per sample:** unchanged against HEAD for all 29.
  Every file another template reads still matches exactly its own layout.
- **Alex's two PDFs** (outside `.samples/`, not copied): the 2-stop one is
  read, 2 stops, no stop marked. The 3-stop one, refused under 3aa, is read,
  3 stops, street and city marked on 1 stop (stop 2) and on neither of the
  other two.

**Tests** (invented addresses only): 26 for the grammar
(`street-split.test.ts`), plus these in the other suites:
- **`templates.test.ts`:** 2-, 3- and 4-stop reads, the refusal examples as
  middle stops, a unit phrase, a directional then a unit, a city beginning
  WEST or NEW, and the marks present on split stops and absent on named ones.
  3aa's "refuses a three-stop document" test is replaced by the 3-stop read.
- **`ratecon-fill.test.ts`:** the checks in the form, no AI mark or AI check,
  the strip count, and an edit clearing the check.
- **`read-pdf.test.ts`:** a pdf.js round trip of three stops.
- **The existing "a template read with the same data: no AI check" test** is
  unchanged and still passes.
- **`npm run check`:** 192 files, 3483 tests (3451 before).

**Mutations,** each applied alone and reverted:

| Broken | Tests that fail |
|---|---|
| unique split (take the first of several) | 1 |
| the abbreviated-directional ban | 2 |
| the street-type-start ban | 1 |
| no mark on a split stop | 6 |
| the fill dropping a filled field's check | 2 |

The unique-split rule first failed nothing, because the street-type-start
check refused the same cases; the "Palm Beach Gardens" case was added for it.

**Unverified:**

- **The template's values on Alex's two PDFs,** above all the 3-stop one's
  split middle stop. Only Alex's by-eye check against the PDFs settles them.
- **How often the grammar refuses on real loads:** nothing measures it; one
  live 3-stop file and sample 8 split as tested.
- **The street-type list** was transcribed from USPS Publication 28 for this
  phase and not checked against the publication in this session (no network).

### Phase 3ad: the worker logs status changes (2026-10-15)

From the advisor's brief and its addendum: logging only, no engine change.
Commits:

- `5341943`: the migration and the schema;
- `2db9c3c`: the worker step and its tests.

NOT pushed, NOT deployed. Migration 0030 is applied to the local test
databases only. The design is §12.126.

**Deployed later** (added 2026-10-19): the worker went live on 2026-10-15 at
23:35 UTC, the first row in `eta_status_changes` (the advisor's read-only
check, 2026-10-19; unverified here).

**Why:** the ETA log (§12.112) writes only at distance marks, and the board
recomputes its status on every read. So a truck can turn AT_RISK and then
LATE between two marks with nothing recorded, and how early the board warned
cannot be measured. Truck 145 may be an example: unverified, its positions
are pruned.

**What was built:**

- **Migration 0030** (`drizzle/0030_eta_status_changes.sql`, plus its
  journal entry; hand-written and additive, like 0023): the table
  `eta_status_changes`, with the stop's foreign key on delete cascade. RLS
  on, a deny-all policy, nothing granted to anon or authenticated on the
  table or its sequence.
- **The schema** (`src/db/schema.ts`): `etaStatusChanges`.
- **`src/worker/status-changes.ts`**: `logStatusChanges` and the
  never-throwing `runStatusLog`, shaped like `logEtaMarks` and `runEtaLog`.
  - The rows come from the board's own code: `LATEST_POSITION_SQL`,
    `parseFleetRows` and `applyStatus`, with `DISPATCH_TZ` from `WorkerEnv`.
  - A row on first sight, then one per change of (status, computed).
  - The key is stop + truck + destination.
  - Cap: 100 rows a sequence, the first row in each status excepted.
- **`src/worker/index.ts`**: the step runs right after `runEtaLog`, as its
  own step. Its counts are on `poll: ingested`: `statusStopsConsidered`,
  `statusFirstSeen`, `statusChanges`, `statusCapped` (truck number and stop
  id) and `statusPastCapWritten`.
- **`src/worker/eta-marks.ts`**: `describe` and `LOG_TIMEOUT_MS` are now
  exported, so neither is copied. `logEtaMarks`, the settle step and the
  `eta_marks` table are unchanged.

None of the addendum's stop conditions applied:

- `fleet-query.ts` imports unchanged (no `server-only`, no env);
- `WorkerEnv` already has `DISPATCH_TZ`;
- 0030 is hand-written like 0023 and 0029;
- every field needed is on `applyStatus`'s rows.

**Choices made here.** Each is in §12.126; any can be changed.

- **The id is a bigint identity, not a uuid.** Rows written in one
  transaction share `logged_at` (now()), so a uuid leaves them with no order.
  That is audit_log's trap, and the tests poll many times in one
  transaction.
- **The sequence's history is read in one GROUP BY** over the stops on the
  board, and matched by a key in which null is a value. The brief said "is
  not distinct from": GROUP BY treats nulls the same way, and a test polls an
  unlocated stop twice and gets one row.
- **`distance_basis` is null when the board shows no ETA.** The engine always
  returns a basis, `straight-line` by default, even for an unlocated stop.
- **The cap's exception is a first row in a status OR in a computed
  status.** So a LATE that first appears under an override is kept too: at
  most 100 + 16 rows a sequence.
- **Past the cap, the comparison is with the newest row WRITTEN.** So a
  dropped change is named on every poll while the board differs from that
  row. A return to that row's status is no change, and is not named.
- **Status columns are text with CHECKs**, as the brief said, although the
  `truck_status` enum holds the same eight values. A test holds each CHECK
  to `STATUSES`, in order.
- **The identity's sequence is revoked explicitly.** It is the first
  sequence in `public`; 0001's default privileges already withhold it.

**Tests:** 20 in `src/worker/status-changes.test.ts`, against the local test
database, rolled back:

- agreement with `applyStatus` over the fleet query, all eight statuses and
  a live override;
- two polls with no change write one row;
- ON_TIME → AT_RISK → LATE → ON_TIME, the last by a new fix;
- an override going live and expiring;
- a destination edit, and a load moved to another truck;
- a stop with no coordinates;
- the cap, and the first LATE after 101 flips;
- no driver, load number or address in a row;
- the table's CHECKs, grants and column list;
- failure isolation both ways, and the 3 s timeout.

**`npm run check`:** 193 files, 3503 tests (3483 before).

**Mutations,** each applied alone and reverted:

| Broken | Tests that fail |
|---|---|
| write every poll, not only on a change | 5: two polls one row; the four-change sequence; the override; the unlocated stop; the cap |
| destination left out of the key | 1: the destination edit |
| a hand-written status instead of `applyStatus` | 4: the agreement test; the four-change sequence; the override; the cap |
| the first-in-status exception left out | 1: the cap |
| no cap | 1: the cap |
| no `statement_timeout` | 1: the timeout |

**Volume, for Alex:**

- **Polls:** up to 120 an hour. `POLL_INTERVAL_MS = 30_000`
  (`src/worker/index.ts:121`), less when a poll runs long. A poll whose feed
  brought no readings returns before both logs.
- **Rows per trip:** NOT measured. One row on first sight, then one per
  change. The only figure is §12.50's replay: 10 crossings into LATE and 4
  into AT_RISK in 20 hours, across 28 trucks. It did not count stale-GPS,
  upcoming-day or arrival changes. At most 116 rows a sequence by
  construction.
- **Size:** about 200 bytes of data a row (one row measured locally).
- **Time:** measured on the local test cluster only (loopback, fsync off),
  20 runs each:

| data | board query, median | whole step, median (max) |
|---|---|---|
| 34 trucks (23 active), 112,200 fixes, 30 open loads | 3.7 ms | 6.0 ms (32.9) |
| 60 trucks, 1,200,000 fixes, 60 open loads | 5.3 ms | 11.8 ms (44.0) |

**Deploy order (Alex's):**

1. Apply migration 0030 to the hosted database.
2. `scripts/deploy.sh`.

The running worker and the app ignore the new table, so the migration first
is safe.

**Rollback:** deploy the previous worker commit. The table can stay, or be
dropped: `DROP TABLE "eta_status_changes"`.

**NOT deployed.** The migration is not applied to the hosted database, and
nothing is pushed.

**Questions for Alex (not decided here):**

1. **Run the step on a poll that brought no readings?** `poll: no changes`
   returns before both logs. If the whole fleet is quiet (overnight), a
   change by the clock is logged at the next poll with readings, with that
   poll's time. A deadline passing, a fix going stale and an override
   expiring are such changes. Running it there costs one board query on
   such a poll.
2. **Inactive trucks:** logged, because the board shows their status under
   the Inactive chip. Keep that, or log active trucks only, as the ETA log
   does?
3. **Retention:** nothing prunes the table, and `eta_marks` is not pruned
   either. Rows go only when their stop is deleted.
4. **A reader:** nothing reads the table. A report like `eta:score` would be
   its own phase.

**Unverified:**

- The step's time on production data over the network; the figures above
  are local only.
- Rows per trip in practice.
- Truck 145 as an example.
- That a worker deployed before the migration only warns. The wrapper
  catches the failed read as it catches the failed insert in the tests; it
  was not tried against a database without the table.

### Phase 3ae: the flaky tests that blocked the 3ad worker deploy (2026-10-15)

**Where things stand** (the advisor verified, 2026-10-15): 3ac and 3ad are
pushed (`origin/master` at `9a475ca`), and migration 0030 is applied to the
hosted database. **The 3ad worker deploy is still pending.**
`scripts/deploy.sh` failed its gates three times on flaky tests, none of
them in 3ad's code. Alex runs `scripts/deploy.sh`. This phase changes test
code only:

- `a801b7c`: the unit fix;
- no e2e commit, because the cause found is not in test code (below).

`a801b7c` is pushed: `git branch -r --contains a801b7c` names `origin/master`
(the local remote-tracking ref, 2026-10-19, no fetch).

#### Gate 1 (vitest): the deadlock

**Evidence:** the local cluster log, `.testdb/postgres.log`, records every
deadlock with both statements. There were five on 2026-10-15: two before
this phase and three in its baseline runs. All five have one shape:

- clear-stop's `create trigger clear_stop_break before update on stops`
  waits for a ShareRowExclusiveLock on `stops`, behind another test file's
  open transaction that has written to stops;
- that file's `insert into trucks` waits for the trigger test's
  transaction, because both inserted `vitest-vehicle-<n>`;
  `src/test/fleet.ts` numbered fixtures from 1 in every file.

In one of the five, Postgres killed the insert side, which was 3ad's
agreement test. 3ad added a file that inserts many fixture trucks, so it
added chances to be the victim. 3ad's own DDL (on `eta_status_changes`) is
in none of the five.

The older deadlocks in the log (2026-10-08 and -09) are guard 3's truncate
under running tests: the commit-into-`fleet_test` problem that
`fleet_commit` fixed (§12.119).

**The class, every site.** 13 tests ran DDL inside `rolledBack()` on
`fleet_test`, on five shared tables:

| file | tests | DDL | table |
|---|---|---|---|
| `src/server/clear-stop.test.ts:401` | 2 | create trigger | stops, audit_log |
| `src/server/clear-stop.test.ts:846`, `:1171` | 2 | create trigger | stops |
| `src/server/reopen-load.test.ts:454` | 1 | create trigger | audit_log |
| `src/db/route-shadow-closed.test.ts:41` | 1 | alter table … disable trigger | route_shadow |
| `src/worker/eta-marks.test.ts:165`, `:184`, `:217` | 3 | create, drop trigger | eta_marks |
| `src/worker/eta-marks.test.ts:410` | 1 | alter table … add constraint | eta_marks |
| `src/worker/status-changes.test.ts:552`, `:578`, `:594` | 3 | create trigger | eta_status_changes, eta_marks |

Found by grep and confirmed by the new guard, which refused exactly these 13
and nothing else. Two other sites were checked and left as they are:

- `lock table` (`src/server/ratecon-reader/reads.test.ts:165`) runs on
  `fleet_commit`, where locks between committed transactions are the point
  (§12.119).
- `src/db/departure-source.test.ts` runs 0024's `DO` block, which is a read.

**The fix,** at the shared layer (`src/test/db.ts`):

- **One advisory lock in every test transaction, taken first.**
  `rolledBack()` holds it shared. The new `rolledBackAlone()` holds it
  alone: it starts only when no other test transaction is open, and none
  starts until it ends, so there is no row lock left to deadlock against.
  The 13 tests above use `rolledBackAlone()`.
- **Enforced, three ways:**
  - An event trigger, in the test database only, refuses DDL in a shared
    transaction as it is issued, before it takes its lock. The message names
    `rolledBackAlone()`.
  - Any other table lock (`lock table`, `truncate`) still held when a shared
    transaction ends fails the test.
  - A test transaction opened inside another is refused, because it would
    hang.
- **Why the event trigger is needed:** a check after the body alone missed
  route_shadow's test. A statement that fails at the top level aborts the
  transaction, and Postgres releases its locks at once, so a fault-injection
  test that ends in its expected error showed no lock.
- **Guard 3:** its truncate runs alone, and its count runs shared.

**The other half** (`src/test/fleet.ts`): fixture unique keys carry the
vitest worker id (`vitest-vehicle-<worker>-<n>`), so parallel files no
longer collide on them.

**Before and after.** Full `npx vitest run`, on the local cluster:

| | runs | failed | deadlocks in the cluster log | time a run |
|---|---|---|---|---|
| before (`9a475ca`) | 10 | 3 (runs 3, 8, 9; one test each) | 3 | 25–28 s |
| after (`a801b7c`) | 10 | 0 (193 files, 3509 tests each run) | 0 | 26–30 s |

**Tests:** 6 new in `src/test/guards.test.ts`. `npm run check`: 193 files,
3509 tests (3503 before).

**Mutations,** each applied alone and reverted:

| Broken | Tests that fail |
|---|---|
| `rolledBackAlone` takes the lock shared | 1: waits for the tests already running |
| the shared mark not set, so the guard never fires | 1: refuses DDL as it is issued |
| no table-lock check at the end | 1: any other table lock |
| no nesting check | 1: a transaction inside another |
| fixture keys without the worker | 1: fixture keys carry the worker |

With the guard in place and the 13 tests not yet switched, all 13 failed
with the guard's message and the run had 0 deadlocks.

#### Gate 4 (e2e): the three failures

Each was a 10 s expect timeout, with the browser waiting on the server.
Evidence from the traces (method, path, status and timings only) and from
the cluster log.

**Phone toast** (13:06 run; the failing context started 15:30:00 CEST):

- In the 11 sizes that passed, the board loaded in about 190 ms.
- In the failing size, `GET /` took 3,211 ms and the RSC request 3,952 ms.
- `GET /api/fleet` and `GET /api/trail` never answered within 10 s, and
  the toast waits for that fleet fetch.

**`e2e/truck-lists.spec.ts:113`** (20:50 run; at 23:10:01 CEST):

- `POST /api/truck-lists` took 5,734 ms; it took 170 ms earlier in the same
  test.
- The refetch after it never answered, so the dialog stayed open.
- In the same seconds, an RSC navigation took 2,655 ms and
  `GET /api/loads/…` 7,800 ms.

**`e2e/board-return.spec.ts:61`** (21:14 run; at 23:15:01 CEST):

- After the Board link, the RSC request for the board never answered
  within 9 s.

**Ruled out:**

- **The local database:** the cluster log is silent at each of the three
  times, and no vitest run overlapped any of them.
- **Machine sleep:** the power log shows no sleep or wake in any of the
  windows, and the run-clock reading shows none since the 21:14 run started.
- **Leaked browser contexts:** each failing run had one failure, and a
  context leaks only after a failure.
- **A race in the specs:** each waits on the right thing — the dialog
  closes when the server answers, the URL changes when the navigation does,
  and the toast follows the fetch.

**The cause found.** Every request the e2e server answers calls the HOSTED
Supabase Auth twice: `getUser()` in `src/middleware.ts:33` and again in
`src/lib/auth.ts:27`. In e2e, data is local but auth is real. A probe ran
beside the two e2e runs below, every 2 s:

- the app's `/login` (middleware, but no auth call without a session):
  never over 1 s; mean 3–4 ms, max 204 ms across 1,577 probes;
- `<supabase>/auth/v1/health`:

| run | probes | over 1 s | over 5 s | max |
|---|---|---|---|---|
| 1 | 678 | 35 | 11 | 15.1 s |
| 2 | 655 | 39 | 14 | 12.8 s |

The long ones were in TCP connect, with DNS at 2 ms: 2.1, 3.3, 7.8 to 9.2,
12.7 and 15.0 s. That is the shape of lost packets being retransmitted. The
shorter ones had a fast connect and a slow answer.

The local server answered in milliseconds throughout. So the e2e failures
are the network path to hosted Supabase stalling, not the tests. A stall
that lands on a 10 s wait fails one test, a different one each run. This
stays INFERRED: the probe and the failures were not in the same run, and
nothing records the server's own calls to Supabase. The Mac was on battery
with Low Power Mode on (2026-10-15/16); whether it was on at the three
failures is unknown.

**After** (e2e, `npm run e2e`, at `a801b7c`, on battery):

- run 1: 248 passed (26.8 min); "the machine stayed awake for the whole
  run";
- run 2: 248 passed (26.5 min); "the machine stayed awake for the whole
  run".

Both passed with the stalls above happening during them.

No test code was changed for e2e: nothing found was in it. No timeout was
raised and no retry added.

**Questions for Alex (not decided here):**

1. **Should the e2e gate depend on hosted auth for every request?** The
   alternatives are app or harness changes, not test fixes:
   - verify the session locally, e.g. `getClaims()` with asymmetric keys
     instead of `getUser()`. That changes what production checks: a revoked
     session is not caught until its token expires.
   - or give e2e a local auth stand-in.
2. **Run deploy gates on a steadier network?** Wired, or not on battery and
   Low Power Mode. The probe is in this phase's report and can be rerun.
3. **Retries, or a longer wait** on the three steps? Not done. A retry turns
   the evidence into a pass (playwright.config.ts says so), and a TCP stall
   of 15 s outlasts any modest raise.
4. **Should e2e record the auth path itself?** For example, a teardown line
   like the sleep check, with the probe's counts. It would add test-runner
   calls to Supabase.

**Decided** (Alex, 2026-10-16): 1 no, 2 yes, 3 no, 4 not now. The reasons
are under "Decided by Alex", in "The e2e flakes and the deploy gates".

#### Unverified

- That the three e2e failures were auth stalls. The probe ran in later runs
  than the failures.
- Low Power Mode at the failure times.
- That `rolledBackAlone()` costs nothing beyond the measured 1–2 s a run: a
  run that queues several alone tests behind slow ones was not measured.

### Phase 3af: after a save lands, the edit modal is on the saved load (2026-10-19)

From the advisor's brief, approved by Alex (as the user relayed it). No
migration. The design is §12.127. Commits:

- `bdbb0e7`: the save returns the version it leaves;
- `1b28877`: the modal, and its tests;
- this section and §12.127, then a separate commit for two HANDOFF fixes.

NOT pushed, NOT deployed.

**Why.** These are the advisor's findings of 2026-10-19, from the code and a
read-only database check. The check cannot be re-run here, so its figures are
the advisor's and unverified here:

- 8 extra loads on 5 trucks (113, 116, 128, 133, 145), each with the same
  truck and stops as its original and saved with the same load number,
  between 2026-10-12 and 2026-10-16. Truck 116 got 4 loads from one entry on
  2026-10-12, in 56 s, each with one stop and all saved with a blank load
  number; the first was given its number on 2026-10-13, which is why
  matching by number counted 7. The 7 that first matched were created 10 to
  75 s after their original. None was open on 2026-10-19. Clear stop's "3
  open loads" on truck 128 was correct for the data.
- **Corrected 2026-10-19** (the advisor's read-only check; unverified here):
  3ag wrote in this bullet that one copy had no stops, so matching by stops
  counted 7. That was the advisor's guess, and it was wrong.
- A screenshot of truck 133 shows the stale refusal and "Saved · one thing
  to know" (an arrival with no anchor, §12.85) at the same time.
- **Unverified:** that every copy came through the warnings branch. Warnings
  are not stored. It is the path in the code that creates twice from one
  modal.

**What was wrong**, from the code. On the old modal, 13 of this phase's 14
modal tests fail. Two branches kept the modal open after a save landed: the
save's warnings, and the stop saved with the active flag refused (§12.14).
Both set the warning and returned, with the form's baseline, load id and
version unchanged:

- "Unsaved changes" stayed, Save stayed on, and Cancel asked to discard saved
  work;
- on a new load, a second Save sent `loadId: null`, and the server created a
  second load;
- on an existing load, a second Save carried the opened version and was
  refused as stale by the dispatcher's own first save.

**What was built:**

- **Server** (`src/server/stop-edit.ts`): `LoadEditResult.loadVersion` is
  read with `readLoadVersion` in the save's transaction, after every write,
  the overrides included, as `clearOverrideAt` does. `POST /api/stops`
  returns the result whole, so the route passes it through unchanged.
- **Modal** (`src/components/edit/EditStopModal.tsx`): one step, `landOn`,
  for every branch where a save landed and the modal stays open. It reads the
  load again by the returned id (`GET /api/loads/:id`). The wrapper then opens
  a NEW editor on that read, keyed per landing. The editor holds the version
  the save returned, the warnings and the selected stop. Until the read
  arrives, the old form is "spent": nothing unsaved, Save off, Cancel and Esc
  close, no rate-confirmation strip, no pending reassign. `sendSave` refuses
  it too. If the read fails, the form stays spent, says so, and offers Retry.
- **The route chosen: re-open on a fresh read.** This is Reload's route,
  but by the id the save returned, not the board row's. The form patched in
  place was rejected. The form's stops are built from a read (ids, stored
  values, arrivals), and a new stop has no id until the server gives it one.
  The row's next stop was rejected too: after a save it need not be on the
  saved load, for example on the next trip or when every stop is left.
- **The version held is the one the save returned, not the read's.** They
  differ only if someone else changed the load between the commit and the
  read; the next save is then refused as stale, and Reload shows the change.
  A test pins this.
- **Same class, same step:**
  - an active-flag request that throws counts as refused. It used to show
    "Save failed" and restore the pre-save board row over a landed save;
  - a warning and a refused flag are shown together; the refused flag used
    to replace the warning;
  - the reassign confirm closes with its save. After a warned save it used
    to stay open over the modal, still able to send;
  - `Clear now` that lands moves the override baseline. Save used to light up
    with nothing typed, and a save re-sent the clear.

**Sites checked:** every request in `src/components/edit` and
`src/components/console/phone`, plus the one write the modal renders from
elsewhere.

| site | what it writes | verdict |
|---|---|---|
| `EditStopModal` `sendSave`, `POST /api/stops` | the load | affected; fixed (`landOn`) |
| `EditStopModal`, `POST /api/trucks` | the active flag | affected; fixed, a throw counted as refused |
| `ReassignConfirm` → `sendSave` | the load | affected; closes with its save, and `sendSave` refuses a spent form |
| `EditStopModal` `Clear now`, `DELETE /api/overrides` | ends the override | affected in part: it took back the version (§12.117) but not the override baseline; fixed. Its failure branch is a different defect, below |
| `EditStopModal`, `POST /api/assignments/preview` | nothing (a read) | safe |
| `ClearStopConfirm`, `POST /api/stops/clear` | closes a load | safe: success closes the whole modal; a retry after a lost answer is refused ("already Delivered") |
| `ReopenConfirm`, `POST /api/stops/reopen` | reopens a load | safe: success closes the whole modal; a retry is refused ("Already reopened") |
| `RecentlyClosed`, `GET /api/stops/reopen` | nothing (a read) | safe |
| `RateconStrip`, `POST /api/ratecon/read` | a counts row | safe: a read, not a save; a second read is allowed by design (3s) |
| `record-outcome`, `POST /api/ratecon/outcome` | counts | safe: dropped before it is sent, once per read; a new editor holds none |
| `DriverSelect` → `AddDriverInline`, `POST /api/drivers` (in `components/assignments`, rendered in the modal) | a driver | safe: the inline form closes on success and the picker holds the new driver (§12.38) |
| `src/components/console/phone/*` | nothing: no request in any file | safe; editing is desktop-only there |

`PhoneTopBar` renders `AccountMenu` and `ScopeMenu` from
`src/components/console`. Neither file makes a request. They were not
followed further.

**Found, not changed: `Clear now`'s failure branch.** It is a different
defect, the opposite shape: a write that did NOT land, treated as if it had.

- Any answer but 200 or 409 (403, 429, 500) still sets the draft to "Auto",
  with no message. The override stays live, and the next save clears it
  inside the save.
- A request that throws leaves `clearOverrideNow` with no catch, so its
  rejection is unhandled (CLAUDE.md: "No unhandled rejections").

**Tests:** before, 193 files and 3509 tests; after, 194 files and 3527 tests
(+18).

- `src/server/load-edit.test.ts`, 3:
  - the returned version is the load's after the save, its override
    included, and a next save with it is accepted;
  - the next trip returns the new load's id and version;
  - on `fleet_commit`: a new load saved with a §12.85 warning, then saved
    again with what it returned. Exactly one load results, edited, and the
    version read after the commit equals the one returned. No network call
    is made.
- `src/app/api/stops/route.test.ts`, 1: the route passes `loadId` and
  `loadVersion` through.
- `src/components/edit/landed-save.test.tsx`, 14:
  - new load: on the created load; the next save carries its id, its stop's
    id and the returned version; a failed read leaves the form spent, then
    Retry;
  - existing load: a second save is accepted on the returned version; the
    returned version is held over the read's; Cancel and Esc close; an
    override in a spent form's draft keeps Save off; a reassign; the
    selected stop;
  - the flag refused, unanswered, and with a warning;
  - a save with nothing to say still closes;
  - `Clear now`.
- `src/components/edit/fill-outcome-save.test.tsx`: one test changed. Its
  warned save was answered without a load id, and its second save created
  again: the defect itself, pinned as passing. It now answers as the server
  does and checks that the second save edits the created load.

**Mutations,** each applied alone and reverted:

| broken | tests that fail |
|---|---|
| server: the version read before the overrides | 1 |
| server: the request's version returned | 3 |
| modal: "Unsaved" not emptied when spent | 1 |
| modal: Save not off when spent | 1, the override in a spent draft (it survived until that test was added) |
| modal: the read's version held, not the returned one | 1 |
| modal: the selected stop not carried | 1 |
| modal: no new editor per landing | 6 |
| modal: the old branches (warnings set, no `landOn`) | 12 |
| modal: `Clear now` leaves the override baseline | 1 |
| modal: the flag's throw not caught | 1 |
| modal: the strip shown on a spent form | 1 |
| modal: the reassign confirm left open | 1 |
| modal: `driverChanged` not off when spent | 1 |
| modal: `sendSave` not guarded | **0**: no path reaches it while the confirm closes first; it guards the one place a save is sent |

**What it does not cover:**

- **A create whose answer never arrives:** a network error after the server
  committed, or an answer that cannot be read. The modal says the save
  failed, and a second Save creates again. A server guard is needed: below.
- **Truck-level values on the new editor** (next stop, live override, active
  flag, drivers) come from the board row as refetched after the save. If that
  refetch failed, they come from the row before it. That changes what is
  shown; nothing is sent unless the dispatcher changes it.
  Wrong for the driver, which every save sent: see 3ag and 3ah (2026-10-19).
- **The 8 copies** are not cleaned up (all closed; out of scope).
- **The re-read costs one `GET /api/loads/:id`** per warned save (`read`
  limit: 60, refilling 2 a second).

**Proposal, NOT built: the smallest guard against a create sent twice.** It
needs a migration, so it is Alex's decision.

- **What it stores:** `loads.create_key uuid`, nullable, with a unique index
  where it is not null. The modal makes one key per new-load form and sends
  it with every create from that form.
- **The server:** the create inserts the key. A second create with the same
  key hits the index: nothing is written, and the answer is 409 with the
  existing load's id and version. The modal then lands on that load with
  `landOn`. The first attempt's warnings are lost, because they are not
  stored.
- **Migration 0031,** additive: `alter table loads add column create_key
  uuid;` and `create unique index loads_create_key_key on loads (create_key)
  where create_key is not null;`. Existing rows stay null. `loads` keeps its
  RLS and grants.
- **Rollback:** deploy the previous commit. The column can stay, because
  nothing else names it, or be dropped with the index.
- **What it covers that 3af does not:** a create retried from the same form
  after its answer was lost.
- **What it does not cover:** an edit of an existing load re-sent after a
  lost answer. That is refused as stale (§12.117), which is safe; the
  dispatcher reloads.

**Unverified:**

- The advisor's figures above, and that the copies came through a warned
  save.
- In a real browser. The modal is tested in happy-dom only, and e2e was not
  run: it signs in through hosted Supabase, which is a networked call this
  phase excludes.

**Questions for Alex (not decided here):**

1. **Build the create-key guard** (migration 0031, above)?
2. **Fix `Clear now`'s failure branch** in a small phase? It turns a refused
   clear into "Auto" with no message, and its thrown request is an unhandled
   rejection.
3. **Keep the re-read, or have the save return the load read itself?** The
   save could return the read from inside its own transaction
   (`loadForEdit(tx, …)`). That needs no second request and has no failed-read
   state, but every save's answer grows.

### Phase 3ag: Clear now that fails says so; the modal's driver is the read's (2026-10-19)

From the advisor's brief, after 3af was approved. No migration. Commits:

- `2af372f`: Clear now that fails;
- `578a1db`: the driver;
- one docs commit: this section, §9.5 and §12.127, the copy count and 3ae's
  push line.

NOT pushed, NOT deployed. 3af's build is unchanged except where named here.

**1. Clear now that fails** (found in 3af; the advisor confirmed it by
reading). The rule is in §9.5.

- **Before:** any answer to `DELETE /api/overrides` that was neither ok nor
  409 still set the draft to Auto, with no message. The form said the
  override was gone while it was live, and the next save sent the clear. A
  request that threw rejected unhandled (`void clearOverrideNow()`).
- **Now:** only an ok answer ends the override in the form. Any other
  answer, or a thrown request, leaves the draft as it was. Beside the button
  the form says "Nothing was cleared." with the reason: the server's error
  and reference, or "The server answered 502." when the answer cannot be
  read, or "The request failed: …". An ok answer with no readable version
  keeps the version held, so the next save is refused as stale and offers
  Reload (§12.117). The 409 branch is unchanged, except that it reads its
  body without throwing.
- **Not covered:** a request that throws after the server cleared the
  override (the answer was lost). The form then says nothing was cleared
  while it was. The next save is refused as stale, because the clear moved
  the version, and Reload shows it. This is the same lost-answer class as
  3af's create-key proposal.
- **Tests:** in `landed-save.test.tsx`, `Clear now`:
  - ok: unchanged, now also checking that the draft goes to Auto;
  - refused, 500;
  - refused, 502 with an HTML body;
  - thrown, with an `unhandledRejection` listener.

  On the previous code the three new ones fail. The thrown test's listener
  caught 1 rejection, `TypeError: Failed to fetch`.

**2. The modal's driver.** This was the advisor's reading of the code,
unverified until step 1.

- **Step 1: reproduced.** The test: `drivers` is the page's list (Ana on
  904, Bo unassigned) and is never refreshed, as in production, where it is
  rendered with the page (`src/app/page.tsx`, `loadAssignmentBoard`) and no
  save refreshes it. The test reassigns 904 to Bo with a warned save; the
  read of the saved load says Bo. On the previous code it failed:

  ```
  × the landed editor's driver (§12.127, phase 3ag) > after a warned reassign, is on the driver the save left, and a later save does not send the old one back
  AssertionError: expected 'Edit load — truck 904VT-3AF-7 · Ana E…' to contain 'VT-3AF-7 · Bo Example'
  ```

  The landed editor's text also read "Current assignment: Ana Example". With
  the header checks dropped from a scratch copy, its next save (a ZIP edit)
  sent `driverId` = Ana's id, no `previewToken`, and asked for no preview
  (1 preview request in all, the first save's):

  ```
  SECOND SAVE {"driverId":"99999999-9999-4999-8999-00000000000a","isA":true,"previewToken":null,"previews":1}
  ```

  **Worse than "offers to reassign back":** every save sends the form's
  driver, changed or not, so there was no offer at all. By reading
  `reassign.ts:209–248`, the server applies a change with no token when the
  driver is on no other truck. It would put Ana back unasked. The server
  half was read, not run.
- **Step 2:** when there is a read, the baseline is `read.assignment.driverId`.
  The list stays for names, the picker and its labels. A new load has no read
  and keeps the list.
- **Every other place in the modal that maps a truck to a driver through
  `drivers`:**

  | site | what it maps | verdict |
  |---|---|---|
  | `initialDriverId` (the baseline) | truck → driver | affected; fixed for a read. A new load (no read) still takes the list: question 1 |
  | `currentDriverName` (header; the picker's "Current assignment") | id → name | by id, so it follows the baseline. A driver missing from the list (for example, created in the picker this session) shows as "Unassigned": display only, the save sends the read's id |
  | the footer's "Reassigns truck … from … to …" | id → name | by id; as above |
  | `claimedBy` (the picker's "on truck N" labels) | driver → truck | stale after a reassign the page has not seen: display only. A driver change always goes through the server's preview and confirm (§9.10), which shows the real other truck. Not changed |
  | `initialFocus` and the picker's `autoFocus` | the baseline | follow the baseline, now the read's |
  | `DriverSelect`'s `selected` | id → driver | by id; safe |

  Outside the modal, the phone sheet's call button
  (`Console.tsx:952`, `drivers.find((d) => d.truckId === selectedRow.id)?.phone`)
  maps truck to driver through the same list: question 3.
- **Fixtures:** `loadReadFor` takes the truck's assignment (none unless
  given). `one-stop-body` and `landed-save` put a driver on the truck in
  `drivers`, and their reads now carry the same one. Before this, those
  suites opened on a read that said nobody drove the truck. With the read's
  baseline, they would have tested a state that cannot happen. The golden
  bodies are unchanged.
- **Tests:** in `landed-save.test.tsx`:
  - after a warned reassign, on the new driver, and the next save sends that
    driver with no preview;
  - opened on a read that disagrees with a stale list, the read wins;
  - a new load keeps the list's driver.

  The first two fail on the previous code; the third passes there, by design.

**3. Docs.**

- **The copy count, corrected** (the advisor, 2026-10-19; unverified here):
  8 extra loads, not 7. Changed in three places:
  - HANDOFF 3af, "Why", the first bullet;
  - HANDOFF 3af, "What it does not cover", "The 8 copies";
  - design-spec §12.127, "Why", the evidence paragraph.

  The 3af docs commit's message (`5739dd8`) still says 7; it is history.
- **3ae's push line:** `git branch -r --contains a801b7c` prints
  `origin/master`. "Neither is pushed" now says it is pushed (the local
  remote-tracking ref; no fetch).
- **Rules changed, so the spec changed:**
  - §9.5: `Clear now` that does not clear;
  - §12.127: the driver is the read's. Its "truck-level values" bullet named
    the driver list and said "nothing is sent unless the dispatcher changes
    it". Step 1 proved that wrong for the driver; the bullet is corrected.
    The same claim stands in HANDOFF 3af's "What it does not cover", left as
    written: question 4.

**~~Found, not explained: the copy with no stops.~~ Corrected 2026-10-19:
there is no such copy.** The advisor's read-only check (unverified here):
all four truck 116 loads of 2026-10-12 have one stop each. All four were
saved with a blank load number, and the first was given its number on
2026-10-13, which is why matching by number counted 7. "A copy has no stops"
was the advisor's guess. The reading of the code below, written against that
guess, still holds. The only load insert in
`src/` outside tests is `saveLoadEdit`'s. It writes 1 to 10 stops in the same
transaction (`LoadEdit`'s `.min(1)`, and the count check in `stop-edit.ts`).
The only other delete of stops is the demo-data sweep. So the code as it
stands does not make a load with no stops, and the warned-save path does not
explain that copy alone. Question 2.

**Tests:** before, 194 files and 3527 tests; after, 194 files and 3533 tests
(+6: 3 Clear now, 3 driver).

**Mutations,** each applied alone and reverted:

| broken | tests that fail |
|---|---|
| a refused Clear now falls through to Auto | 2 |
| no catch on Clear now | 1 |
| the Clear now message not shown | 3 |
| the driver from the list again (the previous code) | 2 |
| a new load without the list's driver | 1 |

**Unverified:**

- The advisor's corrected figures.
- The server's silent revert of the driver: read in `reassign.ts`, not run.
- Whether the console's own address changes (`router.replace`) re-render
  the page and refresh `drivers`: not checked. No save does.
- In a real browser: happy-dom only, and no e2e (it is networked).

**Questions for Alex (not decided here):**

1. **A new load still takes its driver from the page's list.** After a
   reassign the page has not seen, a new load's save sends the old driver
   back. The fleet query already selects `driver_id`, but `FleetRow` drops
   it (`fleet-query.ts:442`). Exposing it would give the modal a live driver
   with no read. It touches the fleet query, which the worker's status log
   also parses. Do it?
2. ~~**The copy with no stops, on truck 116:** the save cannot make one. Worth
   a read-only look at its audit rows?~~ Answered 2026-10-19 by the advisor's
   read-only check: there is no such copy (above, corrected).
3. **The phone sheet's call button** takes the phone from the same list. After
   a reassign the page has not seen, it would dial the previous driver.
   Change its source too?
4. **HANDOFF 3af** still says of truck-level values "nothing is sent unless
   the dispatcher changes it", which is wrong for the driver. Add a pointer
   to 3ag there, or leave the record as it is?

### Phase 3ah: a save sends the driver only when the dispatcher changed it (2026-10-19)

From the advisor's brief, after 3af and 3ag were approved. No migration.
Commits:

- `f6ad632`: the fix and its tests;
- one docs commit: this section, §9.10 and §12.127, and the corrections below.

NOT pushed, NOT deployed. 3af and 3ag are unchanged except where named here.

**Why.** 3ag found, and the advisor confirmed by reading, two things:

- every save sent the form's driver, changed or not;
- `applyReassignment` changes the truck's driver with no preview token when
  that driver is on no other truck.

So any stale baseline could silently put back a previous driver. 3ag fixed
the baseline when there is a read, but not for a new load, whose baseline
comes from the page's `drivers`.

The server half is now run, not only read: a scratch test, not committed, on
the test database. It sent the pre-3ah request for a new load (the list's
driver A, no token) on a truck the server had with B, and A on no truck. The
truck moved back to A, with no error:

```
SCRATCH {"assignmentWasB":true,"afterIsA":true,"afterIsB":false,"reassignmentReturned":true,"tokenSent":false}
```

It has not happened in production, by the advisor's read-only check of
2026-10-19 (unverified here): 5 driver moves through the edit modal ever
(2026-09-21 to 28), 1 assignment started in October, and no A→B→A on any
truck.

**The change** (`src/components/edit/EditStopModal.tsx`, `sendSave`):

- every request is built in `sendSave`'s `edits`, and `driverId` now goes in
  only when `driverChanged`, the same comparison the Save label and the
  preview use. Otherwise the key is absent (`loadEditFromStops` already
  omits an undefined one), and the server leaves the assignment alone;
- a real change still asks for the server's preview and is confirmed
  (§9.10);
- Unassigned, when there was a driver, still sends null;
- `stopEditOf` and `dirtyOf` are unchanged. They still compare the driver,
  so "assigned driver" in the unsaved banner works as before. Only what is
  SENT changed, so there was no reason to move both.

**Every path, confirmed:**

| path | how it sends | shown by |
|---|---|---|
| Save, and Cmd+Enter | `save()` → `sendSave` | 3ah "an existing load, no driver change"; golden `plain` |
| a new load | `save()` → `sendSave` | 3ah "a new load, no driver change"; 3ag "a new load has no read" |
| the reassign confirm | `ReassignConfirm` → `sendSave(token)` | 3ah "a real change", "Unassigned"; golden `reassign`, unchanged |
| the previous-load question (§12.92) | `answer` → `save(closes)` → `sendSave`, or the effect when none is open any more | golden `previous-load-close` |
| the reached stop, correction | `ReachedStopQuestion` → `save(undefined, answer)` → `sendSave` | golden `reached-correction` |
| the next trip | the same | golden `next-trip` |
| the landed editor (§12.127) | its own `sendSave` | 3ag "after a warned reassign", its second save |

There is no other request builder for `POST /api/stops` in `src/` outside
tests. A re-confirm after a stale preview (409 with a fresh preview) is the
reassign confirm path again; it was not tested separately.

**Tests:** before, 194 files and 3533 tests; after, 194 files and 3539 tests
(+6).

- `landed-save.test.tsx`, 4 new:
  - an existing load, no driver change: no `driverId`;
  - a new load, no driver change, with the page's list naming a driver: no
    `driverId`;
  - a real change: named unsaved, previewed, confirmed, driver sent;
  - Unassigned: sends null.
- `load-edit.test.ts`, 2 new: a save with no `driverId` leaves the
  assignment, on an existing load and on a new load.
- On the previous code the first two failed:

  ```
  × … > an existing load, no driver change: the request has no driverId
  AssertionError: expected { …(7) } to not have property "driverId"
  + Received: "99999999-9999-4999-8999-00000000000b"
  × … > a new load, no driver change: the request has no driverId, though the page's list names a driver
  AssertionError: expected { loadId: null, …(5) } to not have property "driverId"
  + Received: "99999999-9999-4999-8999-00000000000a"
  ```

  The existing load re-sent Bo's id (the read's; harmless). The new load
  sent Ana's, the page list's: the silent revert.
- Changed with the rule:
  - 3ag's three driver tests now expect no `driverId` on an unchanged save;
    their other checks are as they were;
  - four goldens (`plain`, `previous-load-close`, `reached-correction`,
    `next-trip`) lose exactly `"driverId":null,`. A word diff shows 4
    removals and nothing else; `reassign` is unchanged. This is the
    deliberate request change the golden suite asks to be shown.
- Mutations: always sending the driver fails 9; never sending it fails 4.

**Docs** (this commit):

- **The "copy with no stops" story was the advisor's guess, and it is
  corrected.** The advisor's read-only check, 2026-10-19 (unverified here):
  all four truck 116 loads of 2026-10-12 have one stop each. All four were
  saved with a blank load number, and the first was given its number on
  2026-10-13, so matching by number counted 7. Corrected, marked and not
  deleted, in:
  - HANDOFF 3af, "Why";
  - HANDOFF 3ag, "Found, not explained", and its question 2;
  - design-spec §12.127, "Why".
- **HANDOFF 3af** gains one pointer line under "nothing is sent unless the
  dispatcher changes it": wrong for the driver, see 3ag and 3ah. This answers
  3ag's question 4.
- **Rules changed, so the spec changed:**
  - §9.10: a save sends the driver only when the dispatcher changed it, a new
    bullet under "Behaviour";
  - §12.127: two sentences said every save sends the driver. They now say it
    did until 3ah, pointing to §9.10.

**Not covered:**

- **A new load's shown driver can still be stale.** The header and the
  picker show the page list's driver, but nothing is sent unless the
  dispatcher changes it. When they do, the server's preview names the real
  current driver. 3ag's question 1 (a live driver id on `FleetRow`) is
  narrowed to that display, and was out of scope here.
- **Found, not changed: a real change can skip the confirm.** In `save()`,
  when the preview request answers not ok, the code falls through to
  `sendSave` with no token. A change to a driver on no other truck is then
  applied without the confirm; a two-sided one is refused by the server,
  which answers with a fresh preview. If that request throws, the rejection
  is unhandled (`void save()`), which is CLAUDE.md's rule again.

**Unverified:**

- The advisor's figures.
- In a real browser: happy-dom only, and no e2e (it is networked).

**Questions for Alex (not decided here):**

1. **The preview that fails:** stop the save, say why, and catch the thrown
   request? That would be a small phase like 3ag's Clear now.
2. **Close the class at the server too?** `applyReassignment` could require a
   preview token for every change, not only a two-sided one. Then no client,
   stale or not, could change a driver unconfirmed. It changes §9.10's
   server rule; the save (`stop-edit.ts:411`) is its only caller in `src/`.

### Phase 3ai: a driver change is never applied unconfirmed (2026-10-19)

From the advisor's brief, after 3af to 3ah were approved. Alex approved
changing §9.10's server rule (2026-10-19). This answers both of 3ah's
questions. No migration. Commits:

- `867ad4e`: the client;
- `237f81c`: the server;
- one docs commit: this section and §9.10.

NOT pushed, NOT deployed.

**Why** (found in 3ah; the advisor confirmed by reading):

- in `save()`, a preview that answered with an error fell through to
  `sendSave` with no token, so a change to a driver on no other truck was
  applied without the confirm; a preview request that threw rejected
  unhandled (`void save()`);
- `applyReassignment` wanted a token only when another truck lost its
  driver, so any request naming a new driver without a confirm went through.

**1. The client** (`src/components/edit/EditStopModal.tsx`, `save()`): a
preview that is not ok, or that throws, stops the save. Nothing goes to
`/api/stops`, and the change stays in the form. The banner says "Nothing was
saved: the driver change could not be previewed." with the reason: the
server's error and reference, "The server answered 502." when the answer
cannot be read, or "The request failed: …". A preview that answers ok opens
the confirm as before.

- **Before:** on the previous code, a preview answered 500 still saved. A
  scratch copy of the test printed what that save carried:

  ```
  UNCONFIRMED SAVE {"driverId":"99999999-9999-4999-8999-00000000000b","isBo":true,"previewToken":null}
  ```

  The new tests on the previous code:

  ```
  × … > a preview answered 500 stops the save, and says nothing was saved and why
  AssertionError: expected [ { …(7) } ] to have a length of +0 but got 1
  × … > a preview with no readable answer says so with the status
  AssertionError: expected [ { …(7) } ] to have a length of +0 but got 1
  × … > a preview that never answers stops the save the same way, and rejects nothing unhandled
  AssertionError: expected "spy" to not be called at all, but actually been called 1 times
  Received: [TypeError: Failed to fetch]
  ```

- **Tests** (`landed-save.test.tsx`, 4): the three above, and the re-confirm
  path: a save answered 409 with a fresh preview keeps the confirm open on
  it, and confirming sends that token. The re-confirm test passes on the
  previous code too. It is existing behaviour, untested until now (3ah).
- **Mutations:** falling through to the save again fails 3; no catch fails 1.

**2. The server** (`src/server/reassign.ts`, `applyReassignment`): every
change of the truck's driver needs the token of the preview recomputed under
the lock. Not only a move off another truck: a driver on no other truck, and
Unassigned, too. Missing or stale, it is refused with `StalePreviewError` and
the fresh preview (409 from `POST /api/stops`), and nothing is written. The
same driver is still a no-op with no token. A save with no `driverId` still
leaves the assignment alone (3ah). Its only caller is `saveLoadEdit`
(`stop-edit.ts:411`); `scripts/` and `e2e/` do not call it.

- **Tests:**
  - `stop-edit.test.ts`, 3 new: a driver on no other truck with no token is
    refused with the preview, and the assignment is unchanged; with its
    preview's token it applies; a stale token, and clearing the driver with
    none, are refused. The same-driver test now also says it needs no token.
  - `load-edit.test.ts`, 1 new: such a save is refused and writes nothing.
    The version, the note, the audit count and the assignment are unchanged.
  - `route.test.ts`, 1 new: `StalePreviewError` answers 409 with the preview
    and `stalePreview: true`, which is what the modal's 409 branch opens the
    confirm on. It passes on the previous code too, because the mapping
    existed; it pins the contract.
- **On the previous server** the three refusal tests failed:

  ```
  × a driver change needs its confirm (phase 3ai) > a save naming a driver on no other truck, with no token, is refused …
  AssertionError: expected null to be an instance of StalePreviewError
  × reassignment > refuses a change to a driver on no other truck with no token: …
  AssertionError: expected 'applied' to be an instance of StalePreviewError
  × reassignment > refuses that change with a stale token, and clearing the driver with none
  AssertionError: expected 'applied' to be an instance of StalePreviewError
  ```

  The third failed on its second half, the clear; a stale token was already
  refused.
- **Set-up repaired.** Six existing `stop-edit` tests put a driver on a truck
  with `applyReassignment` and no token. They now use `assign()` or a
  confirmed move (a new `confirmedMove` helper). `load-edit`'s rollback test
  sends its preview's token, so the assignment is still written and then
  rolled back. Two of the six would otherwise have passed for the wrong
  reason, because their set-up threw the very error they expect: "refuses a
  confirmation whose preview went stale" and "refuses a two-sided move that
  was never confirmed at all".
- **Mutations:**

  | broken | tests that fail |
  |---|---|
  | no token check at all | 5, the two repaired tests among them |
  | the old rule (stale, or two-sided with none) | 3 |
  | refusing only a missing token, not a stale one | 2 |

**Deploying it.** The client and server ship together. A browser still on an
older bundle sends a driver change with its preview's token, as before. Only
its failed-preview fall-through, and a pre-3ah unchanged driver re-sent from a
stale baseline, are now refused. Both get a 409 with the preview, which that
bundle's 409 branch opens as the confirm. This was reasoned from the code,
not run.

**Not under this rule** (other writers of `assignments`, not changed):

- the assignment board's batch save (`POST /api/assignments`,
  `src/server/assignments.ts:331–340`) changes drivers with no preview token;
- adding a driver onto a truck (`drivers.ts:120`) refuses a truck that
  already has one;
- the driver merge (`drivers.ts:424`) moves history rows, not a truck's
  driver.

**Tests:** before, 194 files and 3539 tests; after, 194 files and 3548 tests
(+9: client 4, server 5).

**Docs:** §9.10 gains two bullets, "Every change of driver needs the preview
token" and "A preview that fails stops the save". Its 3ah bullet now says the
old server rule held until 3ai. §12.127's "the server needs no preview token
when the driver is on no other truck (§9.10)" describes the old rule; it is
left as written, because this brief allows nothing else in the file
(question 2).

**Unverified:**

- In a real browser: happy-dom only, and no e2e (it is networked).
- An older bundle against the new server: reasoned, not run.

**Questions for Alex (not decided here):**

1. **The assignment board's batch save** changes drivers with no preview
   token. Is the board itself the confirmation, or should it come under the
   same rule?
2. **§12.127's sentence on the old rule:** update it in the next docs pass?
3. **`StalePreviewError`'s message**, "The assignment changed while the
   confirmation was open.", is now also the answer to a change that was never
   confirmed. The modal does not show it (it opens the confirm), and there is
   no other caller. Reword it?

**Answered (the advisor, 2026-10-19; recorded in 3aj):**

1. The assignment board's batch save stays as it is. It sends only the rows
   changed on that screen, and the board is its own confirmation.
2. §12.127 gets a one-line fix. Done in 3aj: the sentence now says the
   server *then* needed no token, and that since 3ai every change of driver
   needs one.
3. `StalePreviewError`'s wording stays.

### Phase 3aj: scanned rate confirmations are read by OCR in the browser (2026-10-20)

From the advisor's brief. Alex approved building it (2026-10-20). It is
phase 4 of `llm-reader-design.md` §9, designed there as an interface only.
design-spec §12.128 is the full rule. No migration. Commits:

- `d9ea9d0`: the OCR core, its runs, the limits, self-hosting, and their tests;
- `737e1ec`: the strip, progress and Cancel, and the Check marks;
- `dcb11b0`: the e2e spec (written, NOT run);
- `cc410e3`: `npm run ratecon:scan-report`;
- one docs commit: this section, §12.128, §12.122, §12.127 and
  llm-reader-design §9.

NOT pushed, NOT deployed. Each commit passed `npm run check` on its own
content: the working tree was set to exactly that commit's files before it
was made, and the pre-commit hook ran the check.

**Why.** A PDF with under 40 characters of text was refused ("This is a
scan; there's no text to read."), and Alex typed those loads by hand. Counted
here (29 samples): 3 scans, samples 3, 5 and 6. That matches the advisor's
3 (of 28 then).

**1. The engine** (`read-pdf.ts`, `read-scan.ts`, `ocr-engine.ts`,
`ocr-browser.ts`):

- `linesFromPdf(bytes, pdfjs, scan?)`. When the text layer is under
  `PDF_LIMITS.minText` and a `ScanReading` is given, each page is drawn with
  the pdf.js that opened the file and read by OCR. Pages are drawn at
  300 dpi, held under 16 MP and 4096 px a side.
- The limits are checked first, as before.
- OCR reading under 40 characters is refused with "This is a scan, and no
  text could be read from it. Type the load from the PDF." An engine that
  will not start is refused with "This is a scan, and the scan reader did not
  work, so nothing was read. Type the load from the PDF."
- No `ScanReading` (the local scripts): refused as before.
- `PdfOutcome` gains `fromScan`.
- tesseract.js 7.0.0, English LSTM (`4.0.0_best_int`), automatic page
  segmentation, the same settings in the browser and in Node.
- A Cancel rejects the page being read at once. A terminated tesseract.js
  worker never settles the page it was reading; without this, a cancelled
  read hung and kept the pdf.js document open.
- **The interface differs from §9's sketch** (`linesFromScan(file)`): the
  scan path sits inside `linesFromPdf`, so a file is opened and its limits
  checked once.

**2. Positions** (`ocr-runs.ts`). OCR's word boxes are turned into the runs
pdf.js gives: PDF units, origin bottom-left, y up, through the page's
`viewport.convertToPdfPoint`. Then `linesFromRuns` runs unchanged.

- **The run rule.** A gap wider than about one capital's height
  (`CELL_GAP` = 0.97) starts a new run. That mirrors pdf.js's own
  `SPACE_IN_FLOW_MAX_FACTOR` (0.6 em between advances). The first rule tried
  was a median letter height, and it split runs at ordinary word spaces.
- **Another row.** A word whose top AND bottom are both off its line's
  baseline by more than half a capital, the same way, keeps its own row.
  Tried first: per-glyph boxes (wrong on skewed pages, where the LSTM's
  glyph boxes are approximations) and the top alone (fooled by a word the
  engine boxed 57 px tall).
- **Deskew.** The median slope of lines of three or more words is turned
  back when it is 0.1° or more.
- **The twin test, and its tolerance.** An invented PDF with a text layer
  is scanned in memory (300 dpi, JPEG) and OCR'd. The Stops section (2
  pages) and label rows give the same lines and cells, text equal with
  whitespace removed, and the same template read with the same values.
  Every run's start is within **2 PDF units (0.7 mm)** in x and y.
  Measured: **0.76 in x, 0.24 in y**. Whitespace is removed because pdf.js
  joins two touching runs with no space ("07:00 -Tuesday") where OCR sees
  one.
- **Skew.** Scanned 1° askew: the same lines (text) and the same read.
  Cells can split.
- **All five invented layouts, at 0°, 1°, −1.5° and 2.5° skew** (scratch
  runs, not in the suite):
  - every OCR'd document has the same line count as its text layer;
  - four of five layouts read by their template at every angle;
  - Pickup # / Delivery # columns never reads: its fixture draws "Driver
    Instructions:" over its own value (the label ends past the value's x), so
    on paper the two are garbled. That is the fixture, not OCR; it was not
    changed;
  - other misreads seen on the fixtures: "Load" as "|oad", "PRAIRIE7" as
    "PRAIRIE?", "lbs" as "Ibs" (at 200 dpi also "PU 1" as "PU1", "SO 2" as
    "S02").
- **Page segmentation.** Automatic (PSM 3) was kept. Sparse text (PSM 11)
  read sample 6 by the PU / SO template, which PSM 3 does not, and gave
  equal or higher confidence on the 3 scans. But on the invented layouts it
  dropped colons ("Address:" read as "Address") and broke the PU / SO and
  Route reads, 14 to 39 lines differing against 8 to 10. Counts only;
  question 4.

**3. The same path after OCR.** The OCR lines go through `take` as text
lines do: templates, then Read with AI on a miss. The redaction is
unchanged (`redact-2026-10-14.5`), and so are the templates, prompt, model,
verifier and caps. Only text is sent.

**4. Everything from a scan is marked Check** (`ratecon-fill.ts`,
`SCAN_CHECK`):

- "read from a scan; OCR can misread it. Check it against the PDF." goes on
  every field filled or left blank with a reason, template or AI, after the
  field's own check, and on the load number when filled or explained.
- The strip: "Filled 2 stops from …, read from a scan: every field is marked
  Check." For an AI read: "…read by AI from a scan…". Beside Read with AI:
  "Read from a scan, by OCR in this browser: every field it fills is marked
  Check."
- "Looks right" clears the AI's marks, not the scan's, so a two-stop scan
  starts at 13 fields to check (question 2).
- The outcome recorded after an AI read's save is unchanged (same fields,
  same blanks; tested). "From a scan" is not recorded (question 3).

**5. While reading** (`RateconStrip.tsx`):

- "Reading the scan — starting the reader…", then "Reading the scan — page
  2 of 3", with a Cancel. The Cancel was not in the brief; it is one button
  on the abort a closed modal needs anyway.
- The modal is never blocked. Typing folds the strip, but the read stays on
  it.
- A newer file, Cancel or closing the modal stops the read, and what it
  would have read is dropped.
- **Found and fixed:** a read that lands seconds later filled through the
  `onFill` captured at the drop, which held the form as it was then.
  Anything changed meanwhile (a driver, the status) would have been
  overwritten. The AI read had the same shape since 3m, so it was fixed once,
  in the strip's shared `fill`, which now calls the modal's latest `onFill`.
  Replace or Keep mine is now decided when the read lands, not at the drop.
  - **Mutations:** filling through the captured `onFill` fails 1 test;
    deciding Replace at the drop fails 1.
  - **Not tested:** the AI path's own case; it goes through the same `fill`.

**6. Self-hosted, loaded only for a scan** (`ocr-assets.ts`,
`scripts/ocr-assets.mts`, `scripts/copy-ocr-assets.mts`):

- `workerPath`, `corePath` and `langPath` are absolute URLs on the page's
  origin, under `/ocr/`, and `workerBlobURL` is off.
- `npm run build` and `npm run dev` run the copy first: written into the
  scripts themselves, not as `pre*` hooks, which npm's `ignore-scripts`
  skips. It copies the worker, the three LSTM core builds and the language
  data from `node_modules` into `public/ocr/` (git-ignored). No binary is
  committed.
- The language data may be kept in IndexedDB under `ocr-eng-4.0.0_best_int`.
- `ocr-assets.test.ts` (13) fails if:
  - any configured path is not same-origin (three origins);
  - tesseract.js's source holds a CDN default other than the three we set;
  - the served worker script holds other CDN URLs;
  - the browser engine is created with anything else;
  - a core build the worker can ask for is not served;
  - the copy differs from `node_modules`;
  - `public/ocr/` is not git-ignored;
  - anything imports tesseract.js, `ocr-engine` or `ocr-browser` eagerly.
- **Sizes:** worker 109 KB (33 KB gzipped); each core build about 3.8 MB
  (1.4 MB gzipped); language data 2.9 MB (already gzip). **A first scan
  fetches about 4.3 MB.**

**7. Tests.** Invented data only. Scanned PDFs are built at test time
(`tinyScanPdf`, `scan-pdf.ts`). @napi-rs/canvas draws pages in Node.

| File | Tests | What |
|---|---|---|
| `ocr-runs.test.ts` | 10 | invented boxes |
| `read-scan.test.ts` | 12 | real pdf.js, canvas and tesseract.js; about 7–10 s of the run |
| `ocr-assets.test.ts` | 13 | same-origin, eager imports |
| `ratecon-fill.test.ts` | +5 | the marks |
| `ratecon-scan.test.tsx` | 11 | the modal |

Covered: a scan read and filled with every field marked; a scan OCR cannot
read; a text PDF unchanged, with no OCR started; the limits unchanged and
checked before OCR; the twin test; the same-origin test.

- **Mutations** (each restored and checked with diff):

  | broken | tests that fail |
  |---|---|
  | no deskew | 1 |
  | one edge enough for "another row" | 1 |
  | every word on its line's baseline | 1 |
  | `CELL_GAP` 0.45 | 7, the twins among them |
  | no mid-page stop | 1 |

- **Test counts:** before, 194 files and 3548 tests (3ai); after, **198
  files and 3599 tests**.

**8. e2e** (`e2e/ratecon-scan.spec.ts`, 2 tests). **Written, NOT run**;
Alex runs it before the push.

- A label-rows scan is filled and marked, with progress shown.
- An unknown-layout scan goes to Read with AI with the fake vendor. Its
  scripted reply is pointed at the lines "Show what is sent" holds, so it
  verifies against the browser's own OCR text.
- **Origins:** the console already talks to Mapbox and hosted Supabase. The
  rule held is: no request during the read goes to an origin the page had
  not used before the drop, nor to a CDN. The `/ocr/` files must be seen
  coming from our origin, which proves the worker's requests are watched.
  Nothing under `/ocr/` is fetched before the drop.
- **The reader's limit:** three reads per user, then one a minute, in the
  server's memory. ratecon-ai.spec.ts spends three. If the two specs run
  within a minute, the AI test fails saying so.

**9. Local evaluation** (`npm run ratecon:scan-report`). This Mac, no
network, counts only, nothing printed but numbers.

| sample | pages | OCR ms per page | chars | lines | template | prepared | lines sent |
|---|---|---|---|---|---|---|---|
| 3 | 3 | 3419 / 1287 / 3046 | 6263 | 120 | not recognised | yes | 75 |
| 5 | 3 | 1428 / 3714 / 395 | 5233 | 90 | not recognised | yes | 85 |
| 6 | 2 | 2917 / 1476 | 3989 | 78 | not recognised | yes | 78 |

- Read with AI would be offered for all three. Nothing was sent.
- **First-scan cost:** about 4.3 MB from our origin. Starting the engine in
  Node from disk took 96 ms; in a browser it was not measured.
- tesseract's mean confidence was 91–95 per page.

**Packages** (npm registry; exact versions):

| Package | Version | Licence | Where |
|---|---|---|---|
| `tesseract.js` | 7.0.0 | Apache-2.0 | brings `tesseract.js-core` 7.0.0 (Apache-2.0) and small helpers: `bmp-js`, `idb-keyval`, `is-url`, `node-fetch`, `opencollective-postinstall`, `regenerator-runtime`, `wasm-feature-detect`, `zlibjs` |
| `@tesseract.js-data/eng` | 1.0.0 | MIT | the language data |
| `@napi-rs/canvas` | 0.1.100 | MIT | devDependency; already installed as pdf.js's optional dependency |

npm 11 did not run tesseract.js's `postinstall` (an opencollective notice)
under its install-scripts policy.

**Found in the design, not changed:**

- `ZIP_NOT_REAL` starts with "Check:", and `Field` adds "Check: " itself, so
  a placeholder ZIP shows "Check: Check: the PDF's ZIP…" (§12.122). Seen
  while writing the scan marks.
- The Pickup / Delivery columns fixture draws a label over its own value
  (above).

**Unverified:**

- **The build.** A local `next build` was not run: it fetches Google Fonts,
  and Sentry's build plugin sends telemetry, both network.
  - So tesseract.js in the client bundle, webpack's handling of its
    CommonJS entry, and the copy into `public/ocr/` under the real build are
    proved first by the e2e run, which builds with `npm run build`.
  - Vercel running `npm run build` (the script, so the copy) rather than
    `next build` directly is assumed, from its usual default, and unchecked
    (no network here). If it does not, `/ocr/` 404s, and a scan says "the
    scan reader did not work".
- **OCR in a real browser:** no timing, no first-scan download measured,
  and the progress text was not seen.
- **Playwright and the worker's requests:** whether `context.on('request')`
  sees requests made inside a dedicated worker. The e2e asserts it does
  (`/ocr/core/…` and `/ocr/lang/…` must appear), so a miss fails loudly.
- **Determinism elsewhere:** the twin's exact OCR text was measured on this
  Mac only. Another CPU or Skia build could misread a character and fail it.
- **The 3 real scans:** whether the misses are layout or OCR error. Reading
  the text would answer it, and nothing was printed.
- Skew beyond 2.5°, a page turned 90°, handwriting, photos: not tried.

**Not done** (the brief's scope): no change to redaction, templates,
prompt, model, verifier, caps, the outcome schema, the status engine or the
modal's save logic. No Content-Security-Policy. No push, deploy, e2e,
hosted database or paid call. The advisor's working-day "burst query" was
not run, because this brief allows no hosted database.

**Questions for Alex (not decided here):**

1. **A page cap for scans.** None below the 10-page limit. Here a page is
   0.4–3.7 s. On a slower office PC it may be several times that, so a
   10-page scan could take a minute. Cap scans (say, the first 3 pages), or
   leave it?
2. **"Looks right" and the scan marks.** A scan's marks stay until each
   field is edited, so a two-stop scan starts at 13 fields to check. Should
   "Looks right" on a stop also clear its scan marks?
3. **Record "from a scan" in the outcome counts?** It would need a
   migration (a column on `ratecon_ai_outcomes` or the counts row). Not done.
4. **Page segmentation.** Keep automatic (PSM 3), or try sparse text
   (PSM 11), which read sample 6 by template but loses colons on the
   invented layouts? A real comparison needs Alex to look at the filled forms
   for the three scans.

**Alex's answers (2026-10-20):** not now, to all four: no page cap, no
change to "Looks right", no outcome migration, no change of page
segmentation.

#### Addendum, 2026-10-20: the advisor's review, before e2e

From the advisor's review of 3aj. Commits:

- `6c4c89e`: "Check:" said once;
- `0564527`: `/ocr/` served without the login check;
- `06f8cca`: the scan spec's AI read answered in the browser;
- one docs commit: this addendum.

NOT pushed, NOT deployed, e2e still NOT run. Each commit passed `npm run
check` on its own content.

**1. The scan spec's AI test would have failed** (`06f8cca`). The e2e files
run one at a time in name order. ratecon-ai.spec.ts spends the user's three
reads, and ratecon-fill.spec.ts is one test of about 6 s. So the scan spec's
AI read came 10–30 s later, not a minute, and would have been refused ("Wait
a minute and try again."). This corrects item 8 above, which said a minute
would have passed. No retries or longer waits (Alex, 2026-10-16), and the
reader's limits are unchanged.

- **Kept, not dropped.** `ratecon-scan.test.tsx` proves the strip marks an
  AI fill from a scan, but on lines it is handed. Only this e2e puts the
  browser's own OCR text through the redaction, the request and the
  verifier.
- **How.** Its read is now answered inside the browser (`page.route`, in the
  route's answer shape, `{ ok: true, reads: [reply, reply] }`), so it never
  reaches the server or the per-user limit. The real route and the fake
  vendor stay ratecon-ai.spec.ts's to prove.
- **New check.** What leaves the page must equal "Show what is sent":
  numbered lines, no pages, no positions.
- **Unchanged:** the template-scan test and the other-origin check.
- **Pinned in Node.** The scan layout and the reply-pointing moved to
  `src/test/scan-ai-fixtures.ts`. `read-scan.test.ts` (+1) runs the same scan
  through OCR in Node: no template reads it, the masks are the same, and the
  pointed reply verifies, agrees, and fills with every field marked. Every
  quote of the reply was found in Node's OCR text. In the browser it is
  unverified until the e2e runs.

**2. `/ocr/` is served without sign-in** (`0564527`). Before this, every fetch
of `/ocr/…` (the worker, the core, the language data: about 4.3 MB on a first
scan) ran the middleware's Supabase `getUser()`. That was slower, and exposed
to the auth stalls 3ae measured. `/ocr/` is now left out of the middleware's
matcher, and nothing else is.

- **Why that is safe.** The files are byte-for-byte copies of three public
  npm packages (tesseract.js, tesseract.js-core, @tesseract.js-data/eng):
  open-source code and language data that anyone can download from npm. They
  hold nothing of ours and nothing secret. No document, no data and no route
  handler is under `/ocr/`, and a scan never leaves the browser. A signed-out
  visitor can now fetch those files, and nothing more.
- **Still checked:** pages and `/api/` (including `/api/ocr/…`), and a path
  that only starts with "ocr" (`/ocr`, `/ocrx`).
- **Test** (`middleware.test.ts`, 4): the matcher compiled by Next's own
  `getMiddlewareMatchers`, as the build compiles it. That function is
  internal: exported by Next 15.5's build, not by its types. If a later Next
  drops it, the test fails at load. Without the change, the `/ocr/` test
  fails.
- Not in design-spec §12.128 (this brief allowed HANDOFF only).

**3. "Check: Check:"** (`6c4c89e`). This was found in 3aj and listed under
"Found in the design, not changed"; it is fixed now. `ZIP_NOT_REAL` carries
"Check:", and `Field` added it again.

- **The fix.** `checkSaid()` (`src/components/edit/check-said.ts`) adds
  "Check: " unless the message starts with it. `Field` and the stop type's
  check in `StopForm`, the two places that prefix, both use it. No message
  text changed.
- **Tests:** `check-said.test.ts` (3); `ratecon-strip.test.tsx` (+1): a
  placeholder ZIP's check reads "Check: the PDF's ZIP…" once. On the
  previous `Field` it fails with "Check: Check: …".

**Tests:** before, 198 files and 3599 tests; after, 200 files and 3608 (+9:
check-said 3, strip 1, middleware 4, read-scan 1).

#### 3aj, second follow-up, 2026-10-20: the scan e2e test found a field by a word its neighbour's source line contains

From the advisor's brief. Test and docs only: nothing under `src/` changed.
Commits:

- `8055f20`: the rate-con specs find a field by its own label word;
- one docs commit: this section, and one sentence in design-spec §12.128
  (`/ocr/` is served without the login check).

NOT pushed, NOT deployed.

**Alex's two e2e runs at `8e2a177`** (the advisor read the run folders):

- `test-results/2026-10-20T16-56-50-118Z`: 247 passed, 2 failed
  (ratecon-scan.spec.ts:124, history.spec.ts:216), 1 did not run
  (phone-signout, which depends on the chromium project).
- `test-results/2026-10-20T17-38-20-382Z`: 3 failed (ratecon-scan.spec.ts:124,
  ratecon-fill.spec.ts:88, reopen-load.spec.ts:135).

**The scan failure was the test's, not the app's.** ratecon-scan.spec.ts:124
failed in both runs, the same way: `form.getByLabel('City')` was a
strict-mode violation that resolved to ZIP, City and State. `Field.tsx`
renders the field's check and its source line inside its `<label>` ("From
p.1: “CITY, STATE FARGO, ND 58102”"), and `getByLabel` matches a
case-insensitive substring of the whole label's text. The app filled the
right values: ZIP 58102, City Fargo, State ND (the page snapshot in each
run's `error-context.md`).

**The fix** (`8055f20`). `e2e/field.ts`: `field(scope, word)` finds the
`<label>` holding an element whose whole text is exactly the word, case and
all, and returns its input (`fieldLabel` returns the label). Only the label
word can match: a check starts "Check:", and a source line "From …" or "Read
by AI …".

- ratecon-scan, ratecon-fill and ratecon-ai use it for every address field
  and the load number they found by label, and the scan spec for the one
  label it found by `hasText`.
- Only the lookups changed; every assertion is the same. `Field.tsx` and
  `src/` are unchanged. The strip's own two inputs (an `aria-label`, no check
  or source) keep `getByLabel`.
- Checked before the run on a static copy of the failing form, in a local
  browser: `getByLabel('City')` matched 3; `field` matched exactly 1 for
  each of Load number, Street address, ZIP, City and State, filled and
  empty.

**The other three failures were server stalls, left unchanged.**
history.spec.ts:216 (run 1), ratecon-fill.spec.ts:88 and
reopen-load.spec.ts:135 (run 2). In each trace the server stopped
answering: requests with no answer for 10–20 s (the advisor, from the
traces). The advisor reads this as the known stall on the path to hosted
Supabase Auth: **unverified**, as no probe was run. The tests are left as
they are, per "The e2e flakes and the deploy gates" (Alex, 2026-10-16): no
retries, no longer waits or timeouts, no change to how login is checked, no
timing printout.

**This follow-up's run:** `npm run e2e -- ratecon-`, once, at `8055f20`
(`test-results/2026-10-20T18-20-10-143Z`): **7 passed** in 46.0 s (setup,
ratecon-ai 3, ratecon-fill 1, ratecon-scan 2), none skipped or failed. Its
build ran `copy-ocr-assets` first ("OCR assets: 5 files copied into
public/ocr/"). It is the first browser run of the scan specs: the template
scan read and marked (3.9 s), and the AI scan answered in the browser (5.2
s), each with the origin check. The logged "ratecon read failed … 503" is
ratecon-ai's planned failed second read. The full suite was not run.

**Tests:** vitest unchanged at 200 files and 3608 tests (the e2e files are
not vitest's). The e2e suite has the same tests; `e2e/field.ts` is a helper,
not a spec.

### Phase 3ak: a sixth template, "stop table", for a layout that arrives as a scan every week (2026-10-20)

From the advisor's brief. Commits:

- `2e32d6d`: the template, its invented fixture and its line-level tests;
- `f1d3ae9`: the same documents read both ways, as a text PDF and as a scan by OCR;
- `45eff73`: `npm run ratecon:score` reads a scan by OCR;
- one docs commit: this section, design-spec §12.122 and §12.128.

Pushed and deployed 2026-10-21 (see "Alex's answers" below). No migration:
layout ids are stored nowhere.

**Why.** Alex gets this layout every week, as an image-only PDF. In production
on 2026-10-20, OCR and Read with AI filled 12 of 13 fields of one; the first
stop's city was left blank, and the two AI reads disagreed on the stop count
(the advisor). A template is instant and free, sends nothing, and reads the
same lines whether OCR or a text layer gave them.

**Sample 30.** The second copy was not in `.samples/` when the phase started,
so it stopped and said so. Alex then attached it in chat; the file was found
in Downloads, checked by counts (3 pages, no text layer), and copied into
`.samples/rate-confirmations/` under the name the brief gave. The Downloads
copy is untouched. It sorts last, so no sample was renumbered.

**What it reads** (`readStopTable`, `templates.ts`; layout `stop-table`; the
rule is design-spec §12.122):

- **Recognised by** the table's two header lines, each a whole line in that
  word order: "Stop From To Name City St Ref Appt", "Address Phone Zip
  Contact Appt Ref".
- **Line A by column:** the city and the state are the cells that start under
  the "City" and "St" headings (within 4 PDF units). Before them, the stop's
  number, PU or Del, and the two dates are read by their shapes.
- **Line B in order:** the times, then the street up to the phone, then the
  ZIP, the five digits after the phone. The phone may be one token or two, in
  any of the shapes OCR gave ("(555) 010-0100", "555-010-0101",
  "(555)010-0102"). It is never read or quoted.
- **The appointment** runs from the From date and time to the To date and
  time; the fill's existing window rules decide APPT or FCFS. Times follow
  Route blocks' 24-hour rule.
- **The load number** is the number in the "LOAD NUMBER" box. A later page's
  "Load No" that differs leaves it blank with a check.
- **Never read:** the name, ref, Appt, contact, appt ref, phone, notes, rate,
  carrier, commodity.

**Decisions made here, each small and each listed as a question below:**

- **The year.** The dates print as M/D. The year is the one nearest the
  document's own date: the box's M/D/YYYY, else a "Load No" line's M/D/YY.
  So 1/2 on a document of 12/30/2026 is 2027-01-02. With no document date,
  the time is quoted as unreadable. The fill's existing checks (a date passed,
  or more than 30 days out) still apply.
- **One stop is read,** as one pickup. Two or more must end with a delivery,
  and the first must be a pickup.
- **The Appt column is not read,** as the brief said. The count is below.
- **The table must end at "Commodity" on its own page.** A table that breaks
  across pages is refused, because no copy shows what the break looks like.
- **Cells OCR runs together** are read only where the leading part has a
  fixed shape: the number and type, a date and the name, a time and the
  street, the state and the ref. Two free-text columns run together are
  never divided, so a name and a city in one cell are refused.

**Finding: the brief's "name, city and state are separate cells" holds for
sample 30, not for sample 5.** In sample 5's second stop, OCR gives the name
and the city as ONE cell, so nothing starts under "City".

- The name fills its column. Its last word ends 15 px (at 300 dpi) before
  the city's first word, which is a word space, and the city's first word
  starts under the "City" heading. OCR's word boxes show this, but the lines
  the templates read carry only where each cell starts.
- So sample 5 is recognised and refused whole, and goes to Read with AI as
  before.
- Reading it would need either a guess at where the name ends (the brief
  forbids it) or a change to 3aj's scan-to-runs step: split OCR's runs where
  a word crosses a known table's heading. That is out of scope; it is
  question 1.
- Sample 30's first stop has its To date and name in one cell. That is read,
  by the date's shape.

**Checked locally (counts only, by sample number):**

- **Ground truth:** entries for samples 5 and 30 were added to
  `expected.json`, which is git-ignored. The file as it was is beside it as
  `expected.json.before-3ak`.
  - Sample 30's entry was written from the PDF Alex attached in chat.
  - Sample 5's was written from its OCR text, read at the browser's 300 dpi
    and again at 400 dpi. The two reads agree on every field written.
  - `ratecon:check-expected`: both complete. Sample 5 is priority 1, since
    no template reads it (as sample 8 was in 3aa); sample 30 is priority 2.
- **The template on the two:**
  - Sample 30: 2 stops found (2 in the truth); 13 of 13 fields filled, and
    13 of 13 match the truth. Those are the load number, each stop's type,
    street, city, state and ZIP, and both appointments (FCFS receiving
    hours, marked).
  - Sample 5: refused, so 0 stops and 0 fields (above).
- **The Appt column** against the window rule's outcome (Yes taken as APPT,
  No as FCFS): 0 of 4 stops disagree. All four print "No" and are 8-hour
  windows.
- **Every other sample:** each sample's recognised layouts and read (layout,
  stop count, load number filled or not) compared with HEAD's, with the
  scans read by OCR. Only samples 5 and 30 changed. Every other template
  sample is read by exactly the template it was before; none is read by
  `stop-table`.
- **`npm run ratecon:score`:** the other samples' lines are identical. The
  bar is 15 of 15 (14 of 14 before); appointments silently wrong: none.

**`ratecon:score` reads scans** (`45eff73`). With the new truth entries, the
score failed both scans ("the PDF was not read"): it had no OCR.

- It now reads a scan by OCR in Node with the browser's settings
  (`src/test/ocr-node.ts`, as `ratecon:scan-report` does), and fills it as a
  scan.
- A text PDF is read as before.
- `npm run check` does not see `scripts/*.mts`, so the script was
  typechecked with a scratch tsconfig.

**Tests.** Invented fixtures only: `stopTable`, `TABLE_STOPS` and
`TABLE_MIDDLE` in `src/test/ratecon-fixtures.ts`. No name, place, street,
number or phone comes from the real PDFs; only the printed headings are the
layout's.

- **`templates.test.ts`, 21 new:**
  - 1, 2 and 3 stops; a note, and a note wrapped onto the next line;
  - the phone's shapes; OCR's run-together cells;
  - the load number disagreeing across pages, or no box;
  - the year across New Year, and no document date;
  - the 24-hour rule; the Appt column ignored;
  - the refusals: a name and a city in one cell (sample 5's shape), a city
    and a state in one cell, no phone, no ZIP, a street that does not start
    like one, another stop type, a state that is not one, stops out of
    order, a line A without its line B, a first stop that is not a pickup or
    a last that is not a delivery, a stray line, a note's wrap not under its
    text, no "Commodity", a heading not its own cell, a city or state not
    under its heading, pasted text;
  - nothing of the rate, phone, ref, name, note or carrier in the read.
- **`stop-table-scan.test.ts`, 5 new:** each document read as a text PDF
  through pdf.js and as its scan by OCR in Node, and both must give the
  expected values. The cases are one stop; two with a note, filled from the
  scan with every field marked Check (unchanged) and its windows filled by
  their rules; three, the phone in three shapes; the load number
  disagreeing; and a near miss (a line B with no phone) refused both ways.
  About 10 s.
- **`ratecon-fill.test.ts`:** `stop-table` was added to "a template read
  carries no AI check".
- **`npm run check`:** 201 files and 3634 tests, from 200 and 3608 before.

**Mutations** (`templates.test.ts`), each applied alone and reverted:

| Broken | Tests that fail |
|---|---|
| the city, or the state, starting under its heading | 1 each |
| a cell under "City" at all | 1 |
| the two-token phone | all: the shared read throws |
| the ZIP's shape; the street's shape; a US state | 1 each |
| the load numbers agreeing | 1 |
| the nearest year | 1 |
| stops numbered in order; first a pickup, last a delivery | 1 each |
| a note's wrap under its text | 2 |
| the 24-hour rule | 1 |
| the table ending on its page | 1 |
| a date run into the name | 1 |
| positions needed | 0 |

The positions guard is a second line of defence, as in 3aa: pasted lines
have no heading cells, so they are refused anyway. Two checks that no
mutation could fail were removed as redundant. One was that the headings are
in order, which the header's pattern already ensures. The other was that a
line B is not another line A; that cannot be read as a phone and ZIP, and
the numbering check would refuse it.

**Unverified:**

- That this broker always sends scans, and that two copies cover the layout.
  No copy has 3 or more stops, a table across pages, or an Appt "Yes": all
  four stops print "No".
- How often a long name will run into the city, as in sample 5: 1 stop of
  the 4 seen.
- Sample 5's truth came from OCR text, not from a look at the page. The two
  resolutions agree, but a character both misread would be in the truth too.
- In a browser: not run (no e2e, per the brief).

**Questions for Alex:**

1. Sample 5's shape is refused and goes to the AI. Splitting OCR's runs
   where a word crosses a known table's heading would read it. That changes
   3aj's scan-to-runs step for every scan: a phase of its own, or not?
2. A one-stop table is read as one pickup. Keep that, or refuse it?
3. The year rule (the year nearest the document's date): fine?
4. Sample 5's truth was written from OCR text. Is that acceptable, or will
   you check its four address fields and two appointments against the PDF?
5. When to push and deploy 3ak.

**Alex's answers (2026-10-21):**

1. Not now. At the week check, his saved PDFs of this broker go through the
   templates locally (free, counts only) to count how often a stop is refused
   as sample 5's is. If refusals are common, splitting OCR runs at a known
   table's headings becomes a phase of its own. Until then such a load goes
   to Read with AI, as today.
2. Keep it: a one-stop table is read as one pickup.
3. Keep the nearest-year rule (the year nearest the document's date): at the
   turn of the year, a rate con dated late December with a "1/2" delivery
   must get the next January, which a fixed "current year" would put in the
   past. No code change.
4. Acceptable for now. Before any paid AI run scores sample 5, its truth (the
   four address fields and two appointments) is checked against the PDF.
5. Pushed 2026-10-21 after `npm run e2e -- ratecon-` passed 7 of 7 at
   `1961b5e` (run folder test-results/2026-10-21T13-46-21-979Z, 46.9 s, no
   stalls). The Vercel production deploy of `1961b5e` reported success at
   2026-10-21 13:53:58 UTC (the advisor, from the GitHub deployments API;
   unverified here).

### Phase 3al, step 1: the assignment page reviewed (2026-10-21)

From the advisor's brief: a review and plan only, for `/assignments`, with the
design-taste-frontend skill (`references/app-screens.md` read whole, its
"Redesign, restyle or review" steps 1–2, `references/critique.md`). Commits:

- `4774817`: `.taste-skill/` ignored (the skill's working folder);
- one docs commit: this section.

No app code changed. Step 2 (building) waits for Alex's approval of the plan.

**The "before".** Alex's screenshot of 2026-10-21, not the skill's inspector:
`inspect.mjs` opens a browser that cannot sign in, and `/assignments` sends it
to `/login`. Measurements below are taken from the screenshot and the source.
The screenshot's grid lands on the code's columns at a scale of 1.25 (92 + 16
px of truck column = 135 image px; 216 = 270; 220 = 275), so it is about a
**1000 CSS px wide window at 125% display scaling** (inferred, unverified).
The skill's `lint.mjs --app` on the six source files: 0 FAIL, 1 WARN (6 em
dashes, in comments and in UI copy that e2e asserts by name).

**Why the picker list is narrow.** The table is `grid-cols-[92px_1fr_200px_220px]`
with a 16px gap, beside a 260px aside, inside `p-5` with a 20px gap. The driver
column is the only flexible one, so it gets what is left: **W − 880 px** for a
window W wide. At 1440 that is 560; at 1280, 400; at about 1000, 120 (the
screenshot: about 130). The list is `absolute left-0 right-0`, so it is exactly
as narrow, and its options do not stop names wrapping or tags shrinking. Below
about 880 the fixed columns alone overflow the section (arithmetic,
unverified in a browser). The edit modal is not the same case: its picker
column is about 313px at 1008px and up (`110px 1.6fr 1.3fr 1.1fr` in a 960px
modal), so the defect is mainly the board's.

**The screen's question:** which trucks have no driver, and who is free to put
on them? The board's own comment says "the gaps are the whole point". Its most
frequent job: pick a driver for a truck, then Save.

#### Critique, by area

ROUND 1 (before, Alex's screenshot), in critique.md §4's shape. The picture,
motion and live-thing caps are page rules and do not apply to an app screen
(app-screens §2.7).

```
Seen in one second: a long column of names in boxes, and a narrow dropdown of wrapped names.
Idea: none, as expected of an internal tool; the job is the screen's question above.
Live thing: n/a (app screen).
Layout words: header=bar / table=ruled list / side=two stacked boxes.
Scores: design 5.5 · usability 5 · creativity 5 · content 7 -> overall 5.4
Caps applied: content clipped off-screen (the picker's tags), usability <= 5.
Top three: 1. the picker list (every width under ~1300); 2. the driver column starved
by fixed columns; 3. Save below the fold.
```

- **Header.** Clear: title, counts (22 trucks, 18 drivers; they reconcile with
  the panels: 22 − 5 = 18 − 1 = 17 assigned), one way back. Nothing wrong
  enough to change. It does not stay on screen when the board scrolls, so the
  counts and the way back leave with it.
- **Table header row.** Muted micro caps, as the console does everywhere.
  Not sticky: after five rows the dispatcher no longer sees which column is
  "Currently" and which is the picker, which matters because both show a
  driver's name.
- **Truck column.** Bold tabular numbers, the right identity. 92px for a
  three-digit number is about 60px more than it needs, taken from the driver
  column.
- **Driver column.** The column the job happens in is the narrowest one at a
  narrow window (about 130px). Names fit today, but a long one truncates in
  the input with nothing to show the rest. An empty truck's input says
  "Unassigned" in grey, the same weight as every other cell, so the gaps the
  screen exists for do not stand out. §12.37's table says the closed input is
  tagged No ELD; it is not: the row's tag comes from the Currently column.
- **Currently.** On every unchanged row (every row in the screenshot) it
  repeats the picker's name, so each assigned row says one name twice, 18
  times down the page. It carries information only on a changed row (what the
  truck had before). On an empty truck it says "Unassigned" a second time,
  which §12.18 ruled out on the console ("said once").
- **Driver's phone.** The number reads well. Edit and Add are 10.5px muted
  caps with no padding: a hit area of roughly 30 by 11 px. In the screenshot
  trucks 128 and 135 show the same number (a question, below).
- **"Drivers with no truck".** Readable. The list item carries `truncate`,
  whose `white-space: nowrap` is inherited by the phone editor inside it, so
  "Blank clears the number." and a refusal message cannot wrap in the 236px
  panel and are cut (from the code; not seen in the screenshot, unverified in
  a browser).
- **"Trucks with no driver".** Five numbers stacked one per line in a
  260px box: the answer to the screen's question, set as the quietest block
  on it, and it does nothing when clicked.
- **The picker list** (the known defect). As wide as the input (about 130px):
  names wrap onto two or three lines, "on truck N" and NO ELD are clipped, a
  horizontal scrollbar appears, and "Unassigned — clear this truck" wraps.
  Every driver already on a truck is in muted grey, which at day one is
  nearly the whole list; the free driver the dispatcher is looking for is not
  first. Its first row uses `text-status-neutral-fg`, a status colour, for an
  action that is not a status.
- **Footer (not in the screenshot).** `main` is `min-h-dvh`, not `h-dvh`, so
  the middle region never scrolls on its own: the page scrolls, and the
  footer with Save, Discard and "N rows changed" sits below the last of 22
  rows. While editing, the dispatcher cannot see the count of changes or
  why Save is disabled ("a driver is on two trucks", which does not say
  which).

#### The three changes that would help most

1. **The picker list sized to its content**, not its input.
2. **The driver column given the width**, the fixed columns narrowed, and
   Currently quiet on unchanged rows.
3. **Save kept in view**: header and footer fixed, the board scrolling
   between them, its header row sticky.

#### The full ordered list

Each uses existing tokens only. Widths are Tailwind arbitrary values (layout
constants, not colours).

1. **Picker list.** `DriverSelect.tsx`. The `ul` keeps `left-0 top-[38px]`
   and drops `right-0` for `min-w-full w-max max-w-[min(420px,calc(100vw-2rem))]`.
   Each option `whitespace-nowrap`; the name `min-w-0 truncate` with a `title`;
   NO ELD and the truck tag `shrink-0`; the truck tag right-aligned. No
   horizontal scroll. "Unassigned — clear this truck" (text unchanged, e2e
   clicks it by name) in `text-text-secondary` instead of
   `text-status-neutral-fg`. Risk: the same list in the edit modal; there it
   starts about 140px into a 928px body and a 420px list ends inside it
   (arithmetic, to check in step 2). Low.
2. **Columns.** `AssignmentBoard.tsx`, both grid rows:
   `grid-cols-[64px_minmax(240px,1.5fr)_minmax(140px,1fr)_minmax(180px,220px)]`
   (proposed values, to settle on screen). A truck shown by its Samsara name
   (no number) truncates with a `title`. Risk: low; a layout change only.
3. **Currently on changed rows only** (needs Alex, question 1). Unchanged:
   empty. Changed: "was" and the saved driver, struck through, as §9.10
   writes the losing side. The row's NO ELD tag moves beside the picker
   input, which §12.37's table already asks for. `AssignmentBoard.tsx`,
   `DriverSelect.tsx` (a tag after the input, inside the same box), existing
   `NoEldTag`. Risk: medium; `AssignmentBoard.test.tsx` counts tags (2) and
   must still count 2.
4. **Save in view.** `AssignmentBoard.tsx`: `main` from `min-h-dvh` to
   `h-dvh`, so the existing `min-h-0 flex-1 overflow-auto` region scrolls
   between header and footer; the table's header row `sticky top-0
   bg-surface-base z-10`; the aside `sticky top-0 self-start`. The double-booked
   message names the trucks ("a driver is on trucks 124 and 130"). Risk: low
   to medium; the below-768px message lives in the same `main` (check it still
   centres), and e2e clicks Save (Playwright scrolls; it is now always in view).
5. **Empty trucks look empty.** Rows with no driver in the draft take
   `bg-row-unassigned` (the console's own "marginally sunken, inert, not
   urgent" ground, design 4a); changed (`bg-row-selected`) and conflicted
   (`bg-status-late-bg`) still win. Currently shows an em dash, not
   "Unassigned" (§12.18). Risk: low.
6. **"Trucks with no driver" as a row.** The numbers wrap in one line
   (`flex flex-wrap gap-x-3 gap-y-1`, tabular). If Alex wants it (question
   3), each is a button that scrolls to and focuses that truck's picker:
   programmatic focus, so the list stays shut by the existing rule. Risk: low;
   medium with the jump.
7. **Panel truncation.** `Panel`'s `li` drops `truncate`; the name alone
   truncates. Risk: low.
8. **Edit / Add / Retire targets.** Same type tokens; `inline-flex h-7
   items-center px-1.5` for a hit area about 28px tall. `DriverPhone.tsx`,
   `AssignmentBoard.tsx`. Risk: low; the row height may grow by a few px.
9. **Narrow desktop** (needs Alex, question 5). Below about 1100px the two
   panels sit above the table as one row instead of beside it, giving the
   table the full width. Risk: medium; a layout change at one breakpoint.
10. **Picker order** (needs Alex, question 2). Drivers with no truck first,
    then the rest; the 40-match cap counts after the sort. Risk: medium; it
    changes what the arrow keys reach first.

#### Tokens

None of the above needs a new token or changes a shared one. The skill would
change two shared things, which are questions, not part of the plan:
`text-micro` is 10.5px and `text-body` 12.5px, under the skill's 11px floor
and 13–16px body (question 4); and the skill gives what floats (the picker
list) a shadow, which would be a new `boxShadow` token beside `modal`
(question 6).

#### Behaviour that must survive unchanged, and what guards it

- The picker opens on click, typing, arrows and Tab keyup, never on
  programmatic focus: `DriverSelect.test.tsx` (4 tests), `e2e/driver-picker.spec.ts`.
- Enter picks, arrows move, Escape closes without clearing, Backspace on an
  empty search clears the truck: `DriverSelect.tsx` handlers. Escape is
  pressed once inside the ArrowDown test, to close between steps; no test
  found for Backspace-to-clear.
- "Unassigned — clear this truck" (`e2e/dispatch.spec.ts` clicks it by that
  name); "+ Add … as a new driver" and AddDriverInline (`DriverSelect.test.tsx`
  4, `AddDriverFlow.test.tsx` 5); the 40-match cap (`slice(0, 40)`; no test
  found, unverified).
- The merge prompt (`MergePrompt.test.tsx` 7); phone edit and add
  (`DriverPhone.test.tsx` 7, `e2e/driver-phone.spec.ts`); Retire, admin only,
  confirmed (`AssignmentBoard.test.tsx` 2).
- Below 768px, "Assignments are on the desktop console." (§12.106;
  `e2e/driver-phone.spec.ts`).
- The reassignment confirm (§9.10) is the edit modal's: only
  `EditStopModal.tsx` calls `/api/assignments/preview`. On the board a move
  is both sides in one save, Save refused while a driver is on two trucks
  (`e2e/dispatch.spec.ts`). The board's comment at `AssignmentBoard.tsx`
  313–319 says the two-sided confirm "takes over on Save"; the board calls no
  preview (question 7).
- Also: the draft rebase (§12.38), the beforeunload guard, Cmd/Ctrl+Enter.

#### Tests

Unit: `AssignmentBoard.test.tsx` (5), `DriverSelect.test.tsx` (9),
`DriverPhone.test.tsx` (7), `MergePrompt.test.tsx` (7), `AddDriverFlow.test.tsx`
(5): 33. E2e: `dispatch.spec.ts` (the board: combobox "Driver for truck N",
options by role, the clear button by name, "Save assignments", "Saved"),
`driver-phone.spec.ts` (`/assignments` at 1440×900, viewer, phone width; its
`shot()` files are run output, not compared baselines), `driver-picker.spec.ts`
(the modal's picker). **No screenshot baseline shows `/assignments`, and none
shows the picker list open.** The edit-modal baselines show the closed picker:
`7-edit-stop-*` (6 widths), `7b`, `7c` (2), `7d`, `7e`, `7f`: 12 files. They
change only if the closed input changes (change 3's tag, and only for an
ELD-less driver in the fixture: unverified which). Re-saving them is Alex's
run. Step 2 would add tests for what has none: Backspace-to-clear, the 40
cap, and the list's width.

#### Skill conflicts (the project wins in each)

1. The inspector cannot sign in, so there is no measured "before" or "after";
   the screenshot and e2e runs stand in.
2. Tracked uppercase labels (table header, buttons, tags) are the console's
   type (§2); the skill allows one per screen and bans uppercase table
   headers. Kept.
3. Type sizes: `micro` 10.5 and `body` 12.5 against the skill's 11 floor and
   13–16 body; the header is 15px tracked caps against an 18–32px h1. Kept.
4. Radius 0 against the skill's 4–8; the accent-filled Save against its
   near-black primary; no product mark in a shell (this is a console page).
   Kept.
5. The lint's em-dash WARN: the dashes are in comments and in UI copy that
   e2e matches by name. Kept.
6. `draw.mjs` not run: with palette and type kept and the console's grid
   fixed, a dealt app style has nothing left to deal that the review needs.

**Unverified:** the 125% scaling and the 1000px window; the panel's clipped
help text and the overflow below 880px (both from the code); the 420px list
fitting the modal; which fixture driver would put a tag in the 12 modal
baselines.

**Questions for Alex:**

1. Currently: keep it on every row, show it only on a changed row as "was …"
   (with the NO ELD tag moved beside the picker), or drop it?
2. The picker: list drivers with no truck first?
3. "Trucks with no driver": should a number jump to its row?
4. Raise `text-micro` and `text-body` across the console to the skill's
   floors? It changes every screen; not proposed here.
5. Below about 1100px, the panels above the table instead of beside it?
6. A shadow on the open picker list (a new `boxShadow` token)?
7. The board has no §9.10 confirm (a move is both sides in one save), while
   its comment says the confirm takes over on Save. Is the comment wrong, or
   should the board confirm too?
8. In the screenshot trucks 128 and 135 show the same phone number: two
   drivers sharing one, or a typo?
9. Which window width should step 2 hold at (about 1000 at 125%?), and should
   step 2 add an `/assignments` baseline (a new baseline is your run)?

**Alex's answers (2026-10-21):**

1. Currently is shown only on rows changed in the draft, as "was" and the
   saved driver, struck through as §9.10 writes the losing side. Unchanged
   rows: empty. The row's NO ELD tag moves beside the picker input (§12.37's
   table).
2. Picker order: drivers with no truck first, then the rest. The 40-match
   cap applies after the sort.
3. "Trucks with no driver": no jump to the row; only item 6's one-line wrap.
4. No change to `text-micro`, `text-body` or any shared type token.
5. Narrow desktop: yes. Below about 1100px the two panels sit above the
   table as one row; step 2 settles the breakpoint and says why.
6. No shadow on the picker list. No new tokens of any kind.
7. Already decided in 3ai: the board's batch save stays, "the board is its
   own confirmation". The comment at `AssignmentBoard.tsx` 313–319 is wrong;
   correct the comment only, no behaviour change.
8. Trucks 128 and 135 sharing a phone: open, Alex's to check. Data, not
   code: nothing changes for it.
9. The page must look right at Alex's usual window (about 1000 CSS px,
   unverified) and at full desktop widths. Step 2 adds an `/assignments`
   screenshot baseline spec.

### Phase 3al, step 2: the assignment page built (2026-10-21)

From the advisor's brief: items 1–10 of step 1's ordered list, as answered
above. NOT pushed, NOT deployed; e2e verified 2026-10-21 (see below), ready
to push. No migration, no server code, no new token.

Commits:

- `1e00be6`: the picker list as wide as its names (item 1);
- `71e3987`: the board's columns and Save kept in view (items 2 and 4);
- `66dbf01`: below 1100px the panels above the table (item 9);
- `b1c2655`: Currently only on a changed row; the No ELD tag in the picker
  (item 3);
- `cf5736d`: empty trucks on their own ground, the panels, the small
  buttons (items 5–8);
- `e6856f5`: drivers with no truck first, the cap after the sort (item 10);
- `7708500`: three comments that said the board had a reassignment confirm;
- `1f604f1`: `e2e/assignments-baseline.spec.ts` (written, not run);
- one docs commit: this section, step 1's answers, design-spec §12.129–§12.132.

Each commit passed `npm run check` in the pre-commit hook. Between `71e3987`
and `66dbf01` a window under about 1050px scrolled the table sideways; the
next commit closed it.

**How the layout was checked.** Not with the skill's inspector, which cannot
sign in. A local render, kept out of the repo: the real `AssignmentBoard` and
`LoadStrip` bundled with esbuild (`next/navigation` and `next/link` stubbed),
the app's own Tailwind build and its self-hosted fonts from the last `.next`
build, an invented board (22 trucks, 18 drivers, 555-01xx phones), shot in
Playwright's cached Chromium on `file://` with every other request aborted.
Before and after at 768, 1000, 1024, 1099, 1100, 1280, 1440 and 1920; the
picker open; the board scrolled; two changed rows; the phone editor with a
refusal; the modal's picker open. It is not the app (no Next runtime, no
server data), so the baseline spec below is the real check.

**What was built, per item.**

1. **Picker list** (`DriverSelect.tsx`). `min-w-full w-max max-w-[420px]`,
   capped before paint by `listMaxWidth`: the nearest clipping ancestor's
   right edge and the viewport less 16px, from the input's left edge.
   Options `whitespace-nowrap`, names truncate with a title, tags whole.
   "Unassigned — clear this truck" in `text-text-secondary`, not
   `status-neutral`. At 1000 the list went from 120px with three-line names
   to one line per driver with both tags.
2. **Columns** (`AssignmentBoard.tsx`, one `COLUMNS` constant):
   `64px minmax(240px,360px) minmax(150px,240px) minmax(220px,1fr)`. Settled
   on screen against two others: picker `2fr` ran 845px wide at 1920;
   Currently `1fr` left a 900px empty band between each name and its phone.
   Capped picker and Currently, phone taking the slack, puts the space at the
   row's end. Minimums sum to 722 with gaps, closing at 768 (it was 732 with
   Currently at 160, 4px over). A Samsara-name truck truncates with a title.
3. **Currently** only on a changed row: "was" and the saved driver struck
   through, "was —" for a truck that had nobody (the confirm's own
   fallback). The strike is on `DriverName`'s box; a wrapper's
   `line-through` did not render through its inline-flex in the local
   render. The row's tag is now in the picker's field, at its right end
   (`pr-16`), hidden while open, a click on it opens the list.
4. **Save in view.** `main` `h-dvh`; the column-header row and the panel
   column sticky. The scroll region lost its top padding (a scrolled row
   showed through above the sticky headers in the local render); the sticky
   elements carry `pt-5`, and the merge prompt keeps its 20px in an
   `empty:hidden` wrapper. The footer names the trucks: "a driver is on
   trucks 137 and 143".
5. **Empty trucks** take `bg-row-unassigned` (changed and conflicted grounds
   win). With answer 1, an unchanged empty truck's Currently is empty; the
   em dash appears as "was —" on a changed row whose truck had nobody, so
   "Unassigned" is said once, by the picker (§12.18). (Reconciling item 5
   with answer 1; question 1.)
6. **No-driver numbers** on one wrapping line, tabular, no click.
7. **Panel items** lose `truncate`; the driver's name truncates on its own.
   A refusal in the panel's phone editor now wraps (seen at 1440 in 236px).
8. **Targets.** Edit / Add (`DriverPhone.tsx`) and Retire are
   `inline-flex h-7 px-1.5`; the phone line's gap 8 → 2 and Retire's
   `-mr-1.5` keep the words where they were.
9. **Narrow desktop.** Below 1100px the panels are `order-first`, a 2-column
   grid stretched to one bottom edge, above the table; from 1100 beside it,
   260px, sticky. Why 1100: side by side needs 1042px with the picker at its
   minimum; 1100 gives it about 270. At 1000 the picker is 360. DOM order
   kept (table first) for the keyboard.
10. **Picker order.** No-truck drivers first (`claimedBy` has no entry), then
    the rest, each in its own order; `slice(0, 40)` after.

**The comment fix.** `AssignmentBoard.tsx`'s comment on `assignToTruckId` now
says the change goes out with the board's batch Save, its own confirmation
(3ai), and that §9.10's confirm is the modal's. `AddDriverInline.tsx` and
`DriverSelect.tsx` said the same of the same prop; corrected. Comments only.

**In the edit modal** (the shared `DriverSelect`), exactly: the open list's
width rule (at 1008 and up its options already fit the 313px column, so it
looks the same; at 768 it stays inside the body, ending at x=727 of 743);
options on one line; the clear row's colour; no-truck drivers first by the
saved assignments; `No ELD` in the closed field for a driver with no ELD.
Nothing else in the modal changed.

**Tests.** 3,634 → 3,657, 201 files. `DriverSelect.test.tsx` +14: the width
rule against hand-placed rectangles (the modal body at 768, the floor, the
420 ceiling, the viewport gutter, no layout) and the one-line classes; the
closed field's tag, hidden while open, opening the list; the order and the
cap after it; step 1's gaps, Backspace on an empty search clears, Backspace
in a search does not, Escape closes and keeps the driver.
`AssignmentBoard.test.tsx` +9: the footer naming 137 and 143 with Save
refused; Currently empty, "was" with the struck driver, "was —", gone when
undone; the tag in the ELD-less driver's picker only (the board still counts
exactly 2); the unassigned ground and a changed row's winning; the wrapped
no-driver line and no truncated panel item. Run against step 1's source
(`7404595`) of the four components, 17 of the 23 fail (one of them, the
unfiltered cap, only because it reads names through a span the new markup
adds); the other 6 pin behaviour that already held (Backspace twice,
Escape, "was" gone when undone, the field's tag hidden while open, a changed
row's ground winning).

**What the test DOM cannot prove** (happy-dom, no layout): any width, wrap
or truncation; that the list stays inside the modal or the viewport (the
test feeds `listMaxWidth` rectangles by hand); sticky headers and panels;
`h-dvh`; the 1100 breakpoint; the strike-through actually drawing; the
stretched panels. The local render showed each; the baseline spec is the
check in the app.

**Baselines.**

- New: `e2e/assignments-baseline.spec.ts`, 7 shots (`assignments-768` …
  `-1920`, `assignments-picker-open-1024`), its own invented seed (trucks
  401–438, three empty; four hand-entered drivers; one on no truck; 555-01xx
  phones), clock frozen; the page renders no live value. Listed (7 tests),
  not run, no PNG. Until Alex creates them, a full `npm run e2e` reports
  these 7 as missing.
- Existing: none should change. The twelve edit-modal shots (`7-edit-stop-*`
  ×6, `7b`, `7c` ×2, `7d`, `7e`, `7f`) show the picker closed, and the only
  closed-field change is the `No ELD` tag for a driver with no ELD. The e2e
  fixture's drivers are inserted with a name only, so `source` is 'samsara'
  and `isEldBacked` is true: no tag. No baseline shows the list open.
  Unverified until run.

**Alex's commands** (each signs in through hosted Supabase Auth):

```
# (a) create the new baseline, then check it holds still
npm run e2e -- assignments-baseline --update-snapshots=missing
npm run e2e -- assignments-baseline --update-snapshots=none --repeat-each=3

# (b) the specs that touch this page and the picker, with the new one
npm run e2e -- dispatch driver-phone driver-picker assignments-baseline --update-snapshots=none

# (c) existing baselines: expected unchanged; check, and re-save only if a
#     7-series shot differs and its diff is the change described above
npm run e2e -- desktop-baseline --update-snapshots=none
npm run e2e -- desktop-baseline --update-snapshots=changed
```

**Unverified:** Alex's window (about 1000 CSS px at 125%, from step 1); the
board in the real app at any width (the local render only); the fonts in the
render came from the last `.next` build; the twelve modal baselines
unchanged; `ReassignConfirm`'s struck names (same wrapper the board's did not
draw through; that component was not rendered).

**Questions for Alex:**

1. Item 5 and answer 1 overlap: an unchanged empty truck's Currently is
   empty, and the em dash shows as "was —" on a changed row whose truck had
   nobody. Is that what you meant?
2. The column is still headed "Currently" while its cells say "was …". Keep
   the header, or rename it?
3. `ReassignConfirm` strikes its old driver names with the same wrapper that
   did not draw on the board; the confirm's names are probably not struck.
   Fix in a later phase?
4. `AddDriverInline` tells the board "This truck already has a driver, so
   the change is confirmed when you save." Saving is the confirmation there,
   so it is not wrong; keep it?
5. Below 1100px the panels scroll away with the board (sticky only beside
   it). Fine?
6. Trucks 128 and 135's shared phone number: still yours to check.

**Alex's answers (2026-10-21):**

1. Agreed: an unchanged empty truck's Currently stays blank; "was —" only on
   a changed row.
2. Keep the header "Currently".
3. Yes, a small follow-up phase AFTER this is live: `ReassignConfirm`'s
   struck names (a wrapper's `line-through` does not reach into an
   inline-flex). Check it in a browser first.
4. Keep `AddDriverInline`'s "…the change is confirmed when you save."
5. Fine: below 1100px the panels scroll away with the board.
6. Trucks 128 and 135 sharing a phone: still open, Alex's to check. Data, not
   code.

**e2e (Alex, 2026-10-21):**

- `assignments-baseline --update-snapshots=missing` (run
  2026-10-21T15-09-45-415Z) wrote the 7 PNGs. Playwright marks a missing
  snapshot as failed while writing it. Committed as written in `9f40488`
  (each opened first: only the spec's invented seed).
- `--repeat-each=3 --update-snapshots=none` (run 2026-10-21T15-15-10-616Z):
  22 passed.
- `dispatch driver-phone driver-picker assignments-baseline` (run
  2026-10-21T15-15-50-926Z): 14 passed.
- `desktop-baseline --update-snapshots=none` (run 2026-10-21T15-16-31-292Z):
  12 of 13 passed. "a stop the truck has left, at 1440px" timed out waiting
  for the console header: the trace shows GET / answered 307 to /login after
  2.9 s, i.e. the middleware's hosted-Auth getUser returned no user once. The
  same stored session worked for the 12 other tests, including the next one
  (a hosted-Auth stall, as in 3ae).
- That one test alone (run 2026-10-21T15-22-55-667Z): passed. Every existing
  baseline is unchanged.

### Phase 3am, step 1: the assignment page, second pass (2026-10-21)

From the advisor's brief: a second review of `/assignments` now that 3al is
live (production since 2026-10-21 15:50 UTC), with the design-taste-frontend
skill (`app-screens.md` and `critique.md`, both read whole this session and
unchanged since). Review and plan only; no app code changed. One docs
commit: this section. Step 2 waits for Alex's approval.

**Alex's points.** None this time: no screenshot or notes came with the brief.

**The "before".** The seven committed baselines
(`e2e/__screenshots__/assignments-baseline.spec.ts/`, invented seed), each
opened. They show no changed row, no conflict and no open phone editor, so
those states were looked at in the local render 3al used (the real
components, the app's CSS and fonts, invented data, `file://` with every
other request aborted, no sign-in). Measured there at 1440: rows on a 53px
pitch; the truck number's text box centred 1px above the field's. The
skill's `lint.mjs --app` on the six source files: 0 FAIL, 1 WARN (11 em
dashes, in comments and UI copy).

```
ROUND 2 (after 3al: the seven baselines, plus the local render for states they do not show)
Seen in one second: a column of fourteen boxed names, and a wide empty band to their right.
Idea / live thing: n/a (app screen; app-screens §2.7).
Layout words: header=bar / panels=two boxes / table=ruled list / footer=bar.
Scores: design 6.5 · usability 7 · creativity 5 · content 7 -> overall 6.4
Caps applied: none (nothing clipped; Save in view).
Top three: 1. every row is a bordered box, so the column reads as a form, not a list;
2. the Currently column is empty on every row at rest, so a 240px dead band sits
between each driver and their phone; 3. at 1440 and up the rows stretch across the
canvas with their content in the left half.
```

#### Critique, by area

- **Header** (all widths). Clear: title, counts, one way back. Nothing to
  change.
- **Panels.** Beside the table (1280–1920) they read well. Below 1100 (768,
  1024, picker-open-1024) the two panels stretch to one bottom edge and the
  trucks panel has about 50px empty under its one line of numbers: the
  drivers panel is tall because each entry is two lines (name; phone and Add
  on a 28px target), in a panel about 480px wide that could hold both on one.
- **Table header.** "Currently" heads a column that is empty on every row
  at rest (all seven pictures), and it sits between Driver and Driver's
  phone. A dispatcher's eye goes from a name to its phone across 240px of
  nothing.
- **Rows.** 53px pitch, the top of the skill's 36–53 range; 14 rows on a
  900px screen. The console has its own 44px row (`spacing.row-comfortable`,
  §14.4); at 44 the real fleet of 22 trucks is about 4 rows closer to one
  screen. The truck number's alignment with the field text is within 1px:
  nothing worth changing.
- **Picker field.** Every row is a bordered, sunken box (fourteen stacked in
  every picture), so the board reads as a form to fill in rather than a list
  to scan. The No ELD tag inside the field's right end works.
- **Picker list** (picker-open-1024). Fixed in 3al. Two rough edges: the
  free driver's tag says "UNASSIGNED" one line under "Unassigned — clear this
  truck", the same word for a driver with no truck and a truck with no
  driver; and nothing marks where the free drivers end and the drivers on a
  truck begin.
- **Currently "was" rows** (local render only). "was" and the struck name
  read right, but the strike also runs through the No ELD tag, which is
  provenance, not part of what changed.
- **Phone column.** Number and Edit/Add read well. At 1920 the phone sits at
  x≈732 and its row's rule runs on for another 900px.
- **Footer.** Always in view now. At rest Discard (45% of a hairline border
  and secondary ink) is barely there, which is right for a control with
  nothing to do. When rows change, the count ("2 rows changed · a driver is
  on trucks…") stays in secondary ink: the one sentence that matters while
  editing is no louder than "No changes.".
- **Empty rows.** The unassigned ground marks them at every width. Nothing
  to change.
- **768.** Fits (minimums 722 of 728). 12 rows visible under the panels.
  The trucks panel's empty band is the visible flaw.
- **1920.** Rows run 1600px wide with their content in the first 840; the
  gaps panel sits about 900px from the phone column. The skill's §4.2:
  "Narrow blocks do not span the canvas", and a table of four columns is one.

#### The ReassignConfirm finding (§9.10, the edit modal's confirm)

**Broken, confirmed in the local render** (invented preview, Chrome): "From"
and "Was" show the old drivers' names unstruck. `ReassignConfirm.tsx` lines
61 and 86 wrap `DriverName` in `<span className="line-through">`, and the
strike does not reach into `DriverName`'s inline-flex box: 3al's finding,
same markup. Only the fallbacks ("Unassigned", "—"), which `DriverName`
renders as plain text, are struck: the opposite of what matters.

Also found: the gaining side's "To" line is a bare name (`toDriverName`), so
a driver with no ELD is not tagged there, though §12.37's table says
ReassignConfirm's gaining side is tagged; the preview carries no source for
the incoming driver (a server field). And the footer still says "Reversible
from truck N's history — history ships in v2." while the driver history page
has shipped (§12.101); whether a reassignment can be reversed from it is
unverified. No unit test, e2e spec or baseline renders ReassignConfirm, which
is how the strike went unseen.

**The fix (item 1 below):** a `struck` prop on `DriverName` that strikes the
name and the fallback and leaves the No ELD tag unstruck. ReassignConfirm
drops its two wrappers and passes `struck`; the board's "was" uses it too
(so its tag stops being struck). Closing it at `DriverName` rather than at
each caller, so a third site cannot repeat it. A render test for
ReassignConfirm (both sides struck, the tag not).

#### The three changes that would help most

1. **Quiet picker fields on the board** (question 1): the name as text, the
   box appearing on hover and focus.
2. **Phone beside its driver** (question 2): Truck | Driver | Driver's phone
   | Currently.
3. **The table no wider than its content at wide windows** (question 4).

#### The full ordered list

| # | Change | Files; classes or tokens | Risk | Baselines that change |
|---|---|---|---|---|
| 1 | `DriverName` `struck` prop; ReassignConfirm and the board's "was" use it | `DriverName.tsx` (`line-through` on the name span and the fallback), `ReassignConfirm.tsx`, `AssignmentBoard.tsx`; tests for both | Low | None (no baseline shows a changed row or the confirm) |
| 2 | Column order Truck, Driver, Driver's phone, Currently | `AssignmentBoard.tsx` `COLUMNS` → `64px minmax(240px,360px) minmax(220px,260px) minmax(150px,1fr)`, header and cell order; minimums unchanged (722) | Low; e2e finds cells by role and data attribute | All 7 |
| 3 | Cap the table at wide windows | `section` `min-[1100px]:max-w-[1000px]`; the panel column follows it | Low; empty ground to the right at 1440 and up | `-1440`, `-1680`, `-1920` |
| 4 | Quiet picker fields on the board | `DriverSelect.tsx` a `quiet` prop: `border-transparent bg-transparent hover:border-line-hair focus:border-line-hair focus:bg-surface-sunken`; the modal unchanged | Medium: the field must still read as editable (header, hover, cursor; a viewer's disabled state kept) | All 7 |
| 5 | Rows at the console's 44px | Row `min-h-row-comfortable py-1`; field `h-8` on the board via a `size` prop (list `top-[34px]`, tag box `h-8`); the modal keeps `h-9` | Medium: a shared component's prop; the phone editor is already `h-8` | All 7 |
| 6 | Picker list: "no truck" for a free driver; a rule after the free drivers | `DriverSelect.tsx`: the option tag text; `border-t border-line-soft` on the first option on a truck when free ones come before it | Low; the modal shows it too | `picker-open-1024` |
| 7 | The count in primary ink while rows are changed | `AssignmentBoard.tsx` footer status `text-text` when dirty, `text-text-secondary` at rest | Low | None (no baseline is dirty) |
| 8 | Below 1100, a free driver's entry on one line | `AssignmentBoard.tsx` drivers panel entry `min-[1100px]:flex-col` / one row below | Low | `-768`, `-1024`, `picker-open-1024` |
| 9 | A baseline with changed rows | `e2e/assignments-baseline.spec.ts`: one shot at 1440 with a "was" row, a "was —" row and a double-booking (conflicted ground, footer naming the trucks) | Low; a new PNG, Alex's run | New: one PNG |

Every item uses existing tokens only. Items 2–5 and 8 change the board only;
items 1 and 6 also show in the edit modal (the confirm's strike; the list's
tag text and rule).

#### Behaviour that must survive unchanged

From 3al step 1: the picker opens on click, typing, arrows and Tab keyup,
never on programmatic focus; Enter, arrows, Escape, Backspace-to-clear;
"Unassigned — clear this truck" (text unchanged, e2e clicks it); "+ Add … as
a new driver" and AddDriverInline; the 40-match cap; the merge prompt; phone
edit and add; Retire (admin only, confirmed); the below-768px message
(§12.106); the edit modal's §9.10 confirm; the draft rebase (§12.38), the
beforeunload guard, Cmd/Ctrl+Enter. From 3al step 2: the list's width rule
(§12.129) and its order (free first, cap after); the closed field's No ELD
tag, hidden while open, opening the list; Currently only on a changed row,
"was" struck, "was —"; Save in view, sticky headers and panel column; the
footer naming double-booked trucks; the unassigned ground; the 1100px
layout; the 28px targets; the board's save request, same rows and payload.

#### Skill conflicts (the project wins)

1. The inspector cannot sign in: the "before" is the baselines and the local
   render, not `inspect.mjs`.
2. Tracked uppercase labels, the 10.5px micro and 12.5px body, square
   corners, the accent-filled Save: the console's spec. Kept (Alex, 3al Q4).
3. The skill gives what floats (the open list) a shadow; that would be a new
   token (Alex, 3al Q6: none). Kept without.
4. Item 4 goes against the skill's own §8.1 ("inputs stay … with a 1px
   border") and with its §7 ("tables are rules and alignment"). The board is
   an editable table, so §7 is the one followed; it is a judgement, hence
   question 1.
5. The lint's em-dash WARN: comments and UI copy e2e matches. Kept.

**Unverified:** every state outside the seven baselines was seen only in the
local render, not the app; the confirm's footer claim about reversing from
history; Alex's window (about 1000 CSS px). Not re-proposed: type tokens, a
list shadow, jump-to-row, Currently's place and header, a confirm on the
board, the panels scrolling away below 1100.

**Questions for Alex** (one decision each; the recommendation first):

1. Picker fields on the board quiet (the name as text; the box on hover and
   focus), the edit modal unchanged? Recommended: yes.
2. Columns Truck, Driver, Driver's phone, Currently (phone beside its
   driver; "was" last)? Recommended: yes.
3. Rows at the console's 44px (`row-comfortable`) instead of 53? Recommended:
   yes.
4. The table capped at about 1000px from 1100 up, the panels right after it,
   empty ground beyond at 1440 and up? Recommended: yes.
5. In the picker list, a free driver tagged "no truck" instead of
   "unassigned", and a rule after the free drivers? Recommended: yes.
6. Fix ReassignConfirm's strike with a `struck` prop on `DriverName` (name
   struck, No ELD tag not), used by the board's "was" too? Recommended: yes,
   in step 2.
7. Tag the confirm's "To" driver No ELD (needs the preview to carry that
   driver's source: a server field)? Recommended: yes, but as its own small
   phase, since it touches server code.
8. The confirm's footer "history ships in v2": reword it? Recommended: yes,
   once you confirm what a dispatcher can actually do from the history page.
9. Add a changed-rows baseline (new PNG; your run)? Recommended: yes.
10. Below 1100px, a free driver's entry on one line in its panel?
    Recommended: yes.

**Alex's answers (2026-10-21):**

1. Quiet picker fields on the board: yes (item 4), board only. The field
   must still read as editable: a visible border and ground on hover and
   focus, a text cursor, and a viewer's disabled state unchanged. The edit
   modal's fields are unchanged.
2. Column order Truck, Driver, Driver's phone, Currently: yes (item 2).
3. Rows at the console's 44px (`row-comfortable`): yes (item 5), board only
   via a size prop; the modal keeps h-9.
4. Table capped at about 1000px from 1100px up: yes (item 3).
5. Picker: "no truck" tag for a free driver, and a rule after the free
   drivers: yes (item 6).
6. `DriverName` `struck` prop, used by ReassignConfirm ("From", "Was") and
   the board's "was": yes (item 1). The strike on the name and the fallback,
   not on the No ELD tag. Render tests for both.
7. The "To" driver's No ELD tag in ReassignConfirm: not now (needs a server
   field). Backlog.
8. ReassignConfirm's footer "Reversible from truck …'s history — history
   ships in v2." becomes "You can change it back on the assignment board."
   Copy only.
9. A changed-rows baseline: yes (item 9), one shot at 1440 with a "was" row,
   a "was —" row and a double-booking, invented seed only.
10. Below 1100px, a free driver's panel entry on one line: yes (item 8).

Also item 7 (the changed-rows count in primary ink while dirty), as listed.

### Phase 3am, step 2: the assignment page, second pass built (2026-10-21)

From the advisor's brief: items 1–9 of 3am step 1's list, as answered above,
and the confirm's footer copy. NOT pushed, NOT deployed; e2e verified
2026-10-21 (see below), ready to push. No migration, no
server code, no new token.

Commits (each passed `npm run check` in the pre-commit hook):

- `db8de4b`: `DriverName` `struck`; the confirm's names struck (item 1);
- `a6d6fce`: the confirm's footer copy (answer 8);
- `d0e6d98`: the phone beside its driver; the table capped at 1000px
  (items 2, 3);
- `aa32eec`: quiet picker fields and 44px rows (items 4, 5);
- `c00677e`: "no truck" and the rule after the free drivers (item 6);
- `4df607e`: the count in primary ink; a free driver on one line below
  1100px (items 7, 8);
- `a88f287`: the changed-rows baseline shot, written, not run (item 9);
- one docs commit: this section, step 1's answers, design-spec
  §12.133–§12.135.

**Checked how.** As in 3al: a local render of the real components (esbuild,
the app's Tailwind build and fonts, invented data, Playwright's Chromium on
`file://`, every other request aborted, no sign-in). Seen there: the
confirm's names struck and the tag not; the board at 768, 1024, 1099, 1100,
1280, 1440 and 1920 with no sideways scroll (the picker 243–360px); the
table stopping at 1000px at 1920; the quiet fields at rest, a hovered field
boxed, a viewer's board boxed at 45% as before; the 44px pitch and the text
cursor (measured); the list's "no truck" and its rule; both narrow panels
73px tall; and item 9's clicks reaching the same states and footer text.

**Per item.**

1. **Struck names.** `DriverName.tsx`: `struck` puts `line-through` on the
   name's element (or wraps the fallback in one), never on the tag.
   `ReassignConfirm.tsx` drops both wrappers and passes `struck`;
   `AssignmentBoard.tsx`'s "was" passes it instead of a className, so its tag
   is no longer struck.
2. **Column order.** `COLUMNS` =
   `64px minmax(240px,360px) minmax(220px,260px) minmax(150px,1fr)`; header
   and cells reordered. Minimums unchanged (722, closing at 768).
3. **The cap.** `section` `min-[1100px]:max-w-[1000px]`; the panels follow.
4. **Quiet fields.** `DriverSelect` `quiet`: at rest `border-transparent
   bg-transparent cursor-text`; `hover:`/`focus:` `border-line-hair
   bg-surface-sunken`; boxed while open; a viewer's locked field (disabled
   with a reason) boxed as before; disabled during a save, still quiet. The
   "Driver" header `pl-2.5`, over the names. (Least surprising choices:
   quiet during a save, so the column does not flash boxes on every Save;
   the header over the names.)
5. **44px rows.** `DriverSelect` `size="row"`: field `h-8`, list
   `top-[34px]`, tag box `h-8`; rows `min-h-row-comfortable py-1`. 44px
   measured (was 53).
6. **List.** A free driver's tag "no truck"; `border-t border-line-soft` on
   the first driver on a truck after the free ones (`data-first-on-a-truck`).
7. **Footer.** The status in `text-text` while dirty, `text-text-secondary`
   at rest.
8. **Free driver's entry.** A grid: one row of name, phone, Retire below
   1100px; from 1100 up, name and Retire over the phone, as before. (The
   one-line order, name then phone then Retire, is my choice; question 2.)
9. **Baseline.** `assignments-changed-1440`: 410 takes the free driver
   ("was —"), 404 takes 401's driver (struck "was" with its tag), 401 and 404
   conflicted, the footer naming both, asserted before the shot.

**The confirm's copy.** "You can change it back on the assignment board."
for a move that affects another truck; the one-truck line is unchanged. No
test or e2e spec matched the old text.

**In the edit modal**, exactly: the reassignment confirm's "From" and "Was"
names now struck (tags not), and its footer copy; the picker list's "no
truck" tag and the rule after the free drivers. The modal's closed field is
unchanged (boxed, 36px; neither `quiet` nor `size` is passed).

**Tests.** 3,657 → 3,682, 201 → 203 files (`DriverName.test.tsx` and
`ReassignConfirm.test.tsx` are new). +8 struck (DriverName 3, the confirm 4,
the board's "was" 1), +2 the confirm's footer, +2 column order, +8 quiet
fields and rows, +3 the list's tag and rule, +2 the footer's ink and the
free driver's entry. Each commit's new tests were run against its old
source: 17 of the 25 fail there (5, 1, 2, 5, 2, 2 by commit); the other 8
pin behaviour that already held
(a viewer's boxed field, the modal's defaults, "To" and "Becomes" unstruck,
the one-truck footer line, and the like).

**What the test DOM cannot prove** (happy-dom draws nothing): that a strike
draws through the name and not the tag (the tests check which element
carries the class; the browser's behaviour with a wrapper is why); that the
box appears on hover; the 44px pitch; the column widths and the 1000px cap;
the one-line entry fitting; the list's rule showing. The local render showed
each; the baselines hold them in the app.

**Baselines** (none run, none created or changed here):

| PNG | Changes? | Why |
|---|---|---|
| `assignments-768` | yes | column order, quiet fields, 44px rows (more rows), "Driver" indent, the one-line free-driver entry (panels 73px) |
| `assignments-1024` | yes | the same |
| `assignments-1280` | yes | column order, quiet fields, 44px rows, "Driver" indent (the cap does not bite: the table is 960) |
| `assignments-1440` | yes | the same, and the 1000px cap with the panels after it |
| `assignments-1680` | yes | the same as 1440 |
| `assignments-1920` | yes | the same as 1440 |
| `assignments-picker-open-1024` | yes | all of 1024's, plus "no truck" and the rule in the list |
| `assignments-changed-1440` | new | item 9 |
| `desktop-baseline` (all) | no, expected | the modal's closed picker renders the same classes (boxed, 36px); no shot shows the list open or the confirm; `DriverName` unstruck renders as before. Unverified until run |
| `history-*` | no, expected | nothing on the history page changed |

**Alex's commands** (hosted sign-in; after the advisor has looked at the
diffs of the seven):

```
# 1. see the diffs (7 differ, 1 missing): the report's actual/expected/diff images
npm run e2e -- assignments-baseline --update-snapshots=none
# 2. once approved, re-save the seven and write the new one, then check they hold
npm run e2e -- assignments-baseline --update-snapshots=changed
npm run e2e -- assignments-baseline --update-snapshots=none --repeat-each=3
# 3. the specs that touch the page and the picker; the console's baselines, expected unchanged
npm run e2e -- dispatch driver-phone driver-picker assignments-baseline --update-snapshots=none
npm run e2e -- desktop-baseline --update-snapshots=none
```

**Backlog.** The confirm's "To" driver No ELD tag: the preview needs the
incoming driver's source (a server field, `reassign.ts`), then `DriverName`
on the "To" line (Alex, answer 7).

**Unverified:** every picture above outside the local render, until Alex's
run; `desktop-baseline` and `history-*` unchanged; Alex's window (about
1000 CSS px).

**Questions for Alex:**

1. On a quiet field, the No ELD tag sits at the field's right end, so on the
   board the tags line up as a column about 300px from short names. Keep it
   there (recommended: it marks the field's edge when the box shows), or put
   it right after the name (it would need the name's width measured)?
2. Below 1100px a free driver's entry reads name, phone, Retire. Keep that
   order (recommended), or Retire before the phone?

**Alex's answers (2026-10-21):**

1. Keep the No ELD tag at the quiet field's right end. Noted by the advisor:
   with the phone now beside the driver, the tag sits about 20px from the
   phone number and can read as the phone's. Cosmetic; revisit only if Alex
   finds it confusing on the live page.
2. Keep a free driver's narrow-panel entry as name, phone, Retire.

**e2e (Alex, 2026-10-21):**

- `assignments-baseline --update-snapshots=none` (run
  2026-10-21T17-00-02-607Z): 7 differed as expected, 1 missing. The advisor
  reviewed the actual images (768, 1024, 1920, picker-open-1024, and the
  changed-rows state) before any was saved.
- `--update-snapshots=changed` (run 2026-10-21T17-07-53-911Z): 9 passed; the
  7 re-saved and the new one written. The advisor confirmed the 7 saved files
  are byte-identical to the reviewed actual images. Committed as written in
  `ad3ee3b` (each opened first: only the spec's invented seed).
- `--repeat-each=3 --update-snapshots=none` (run 2026-10-21T17-08-18-025Z):
  25 passed.
- `dispatch driver-phone driver-picker assignments-baseline` (run
  2026-10-21T17-08-45-964Z): 15 passed.
- `desktop-baseline --update-snapshots=none` (run 2026-10-21T17-09-18-597Z):
  13 passed. Every existing console baseline is unchanged.

### Phase 3an, step 1: three design directions for the assignment page (2026-10-21)

From the advisor's brief, after Alex (2026-10-21): "Redesign this whole page
to look better and feel better: premium, as much as possible." Three
directions as static mockups with the design-taste-frontend skill. No app
code changed; nothing under `src/`, `e2e/`, the Tailwind config or a baseline
was touched. One docs commit: this section. Building waits for Alex's choice.

**How.** `app-screens.md` read whole this session. For this phase only, NOT
bound to the console's palette, type or tokens (no `--keep`). Styles were
dealt with `draw.mjs --app --screens list --options 3`: kind `markets` dealt
two dark styles (`data-terminal`, `true-black-flat`), and kinds `support`
and `commerce` dealt the same two light ones (`achromatic-ledger`,
`framed-sheet`). Three were chosen and dealt in full. One generator
(`.taste-skill/3an/build.mjs`) writes all fifteen pages, so the three share
the same data and copy; `shared/layout.css` holds the structure (no look),
and each direction has its own `style.css`.

**Data.** Invented only: `e2e/assignments-baseline.spec.ts`'s seed (trucks
401–438, 14 trucks, 12 drivers, four with no ELD, 708-555-01xx phones,
every third driver with no phone). The copy is the app's own, word for word
("Unassigned — clear this truck", "no truck", "on truck N", "was —", "Blank
clears the number." and its refusal, the viewer's lock reason). The user is an
admin in four states (so Retire shows) and a viewer in the fifth.

**The screen's question** (3al step 1): which trucks have no driver, and who
is free to put on them? Most frequent job: pick a driver, then Save.

**Departures from the dealt sheets, with reasons.**

- **Shell.** All three keep the page's own header bar (title, counts, Back to
  console). Each dealt shell (an icon rail, a ruled T-frame sidebar, an
  open-plane sidebar) adds navigation the page does not have, and the brief
  invents nothing. `framed-sheet` was not chosen for the same reason: its move
  is the tinted frame around a sidebar.
- **No shadow on the open list**, in any direction. The first inspection
  failed it (`heavy-shadow`, all three), and Alex ruled it out in 3al (Q6).
  The list floats on a tone step and a 1px edge.
- **The board is capped at 940px, not §12.135's 1000px, and centred with its
  panels** from 1100px up. At 1000, Currently (empty on every unchanged row,
  §12.130) left a band about 270px wide, and the inspector warned
  `hero-void`. At 940 the band is about 174px. Centring gives equal outer
  margins instead of all the spare ground on the right. Below 1100 nothing
  changes. This is question 5.
- **Lamp black's rows are 52px**, not the sheet's 80. The sheet's 80 is for
  two-line rows with media; the board's rows are one line (app-screens §7.1:
  36–53).

#### The three directions

**1. Night desk** (`data-terminal`, seed 319739052, dark). The board as a
terminal for long shifts. Every selection is the same 1px blue line, every
figure is in a monospace so truck numbers and phones stack, and an empty
truck is an empty slot (a dashed box).

- **Palette.** Ground #171719, with cards darker than the ground (#131217).
  Raised #212023, rules #1f1e23, text #fff and #c9cacd, muted #8a8c92.
  Negative #e5566f on #2c1a20. The accent #4a8ad6 appears as 1px lines only:
  focus, the open field, the list's cursor, a changed row's left edge and
  Save's outline.
- **Type.** Public Sans 400–700 for text, and IBM Plex Mono 400/500 for truck
  numbers, phones and counts. Both are SIL OFL 1.1 and on Google Fonts, so
  `next/font/google` can self-host them at build, as it does Barlow today.
  Sizes: 11/12/13/14/20/22.
- **Density.** Dense. Rows 42px (measured), 13px body, 30px fields. About 17
  of the fleet's 22 rows fit on a 900px-tall window (arithmetic from the
  measured pitch).
- **Why it feels premium.** One thin line means "this" everywhere, figures
  line up like a timetable, and nothing is coloured except that line and a
  conflict.
- **Risks.** Monospace phones read as technical (lint `mono` WARN, the style's
  own choice). A 1px left edge is a light mark for a changed row. The 13px
  body and 11px tags are small for all-day use, though both are larger than
  the console's 12.5 and 10.5. The outlined Save is quieter than today's
  filled one.
- **Inspector.** All five pages, 1440 and 1024: 0 FAIL, 0 WARN. Fonts
  loaded: Public Sans and IBM Plex Mono. Tabular figures on every number
  (share 1.0). Coloured pixels about 0%. One panel radius (6).

**2. Lamp black** (`true-black-flat`, seed 1681495852, dark). The yard at
night. A cool near-black ground, surfaces lifted by lightness alone, soft
20px cards and pill controls. One sodium-lamp amber falls only on the empty
trucks: their numbers on the board, the panel's numbers and "no truck" in
the list.

- **Palette.** Ground #0c0d0f, card #15171a, raised #24272c and #2f3339,
  rule #1f2226, text #fff, greys #b4b4b4 and #949494. The hue #f2b33d is on
  data only. Negative #e5566f on #2c1a20. Save is a white pill with black
  text (primary by inversion), and Discard a grey pill.
- **Type.** Inter 400/500/600: SIL OFL 1.1, on Google Fonts, self-hostable
  with next/font. Sizes 12 to 21.
- **Density.** Medium. Rows 52px (measured), 14px body, 36px pill fields.
  About 13 of 22 rows fit on 900px.
- **Why it feels premium.** The softest of the three. Depth comes from
  lightness, nothing is outlined, and the gaps are the only warm thing on the
  screen.
- **Risks.** Fewest rows per screen: 13 of 14 at 1440×900 and 8 at 1024×768
  (measured). The amber sits near the console's warning and late colours, so
  console-wide it would need care. Inter is the skill's own "kit" face. The
  large radius and pills are the furthest from the console's square,
  condensed look.
- **Inspector.** All five pages: 0 FAIL, 0 WARN. Font loaded: Inter.

**3. Day ledger** (`achromatic-ledger`, seed 375706953, light). A printed
fleet ledger: white sheets on a blue-grey ground, everything in ink, a
near-black Save, and one blue that marks only the gaps.

- **Palette.** Ground #f2f4f7, sheets #fff, rules #eff0f2, edges #e3e5e8,
  text #0a0a0a and #3d3d3d, muted #646464. The hue #1d5fbf on #eef3fb marks
  the gaps only. Negative #831c1e on #ffedea. Save #141414; secondary grey
  #e5e5e5. A changed row carries a 6px ink dot by its number (app-screens
  §7.4).
- **Type.** Geist 400–700: SIL OFL 1.1, on Google Fonts, self-hostable with
  next/font. Sizes 12/13/14/16/21/24.
- **Density.** Sparse to medium. Rows 44px (the console's `row-comfortable`),
  14px body, 32px fields. About 16 of 22 rows fit on 900px.
- **Why it feels premium.** The calm of paper, and the clearest hierarchy of
  the three.
- **Risks.** It is a light page inside a dark console, so Back to console
  jumps from white to black, and it would be the only light screen used all
  day. The open list is white on a white table, held apart by its 1px edge
  alone. The changed ground (#f5f6f8) and the empty ground (#f7f8fa) are
  close, so the dot and the blue number carry the difference.
- **Inspector.** 0 FAIL on all five pages. One WARN, on the viewer page at
  1440: `hero-void`, 660×540 at x 780. That block is the empty Currently
  column plus the ground under the short panel column. Kept: Currently is
  empty at rest by Alex's decision (3al Q1), and app-screens §4.2 rules out
  stretching a card over space it cannot fill. Font loaded: Geist.

**Checks on all fifteen pages.**

- **Inspector.** `inspect.mjs --app --widths 1440,1024`: 0 FAIL on every
  page, and the one WARN above. The first run had 8 FAILs: the list's shadow
  (all three), and Day ledger's Back to console edge drawn as a shadow
  (`button-fx`, on all five of its pages). It also had 4 WARNs: disabled
  Edit at 3.7 and 4.3:1, a list tag at 4.3:1, and the void. All fixed except
  the void kept above.
- **Margins.** Measured canvas margins differ by about 17px (Night desk at
  1440: 108 left, 125 right). That is the scroll region's classic scrollbar
  in headless Chrome; the layout's margins are equal.
- **Layout.** No sideways scroll at 1440 or 1024, and the picker field is
  360px in all three at both widths (measured on the at-rest pages).
- **Lint.** `lint.mjs --app` on the sources: 0 FAIL. Its WARNs are `mono`
  (Night desk's face), `shadow` (the viewer's tooltip, which floats, and Lamp
  black's inset input edges) and `em-dash` (the app's own copy that e2e
  matches).
- **Focus.** A Playwright script tabbed through each direction's at-rest and
  phone-editor pages (28 and 30 controls). Every control showed an outline;
  the screenshots were looked at.
- **Fixed after looking at the screenshots.** A long free-driver name
  truncated its No ELD tag away in the 260px panel, and the Currently cell
  clipped its tag. In both, the name now truncates and the tag stays whole.

**Behaviour.** The mockups are static, so behaviour is not in them; they
show its copy and its states. Every direction keeps the lists in 3al step 1
("Behaviour that must survive unchanged, and what guards it") and 3am step 1
("Behaviour that must survive unchanged"), as written there. A build changes
classes, tokens and fonts, not handlers, the save payload or the tests'
selectors. The structure the mockups keep: the window-height page with
header and footer fixed, the sticky header row and panel column, the panels
above the table below 1100px, table first in the DOM, the column order and
minimums, the list's width rule and order, the closed field's No ELD tag,
"was" struck with its tag not, the footer naming double-booked trucks, and
the below-768 sentence.

**Found while doing this (not changed).** The viewer's lock reason
("Your role is viewer. Assignments need dispatcher.") is only a `title`, so
it appears on hover and never for a keyboard user. The mockups draw it as a
hover tooltip, today's behaviour. 3am's note still holds in all three
directions: the No ELD tag sits at the field's right end, 16px from the
phone column.

#### Where they are, and how Alex opens them

Local only: `.taste-skill/` is git-ignored, so nothing here is committed.
Each direction's folder holds five pages: `index.html` (at rest),
`picker.html`, `changed.html`, `phone.html` and `viewer.html`.

```
open /Users/donda/vin-fleet-tracker/.taste-skill/3an/index.html            # all 15, one click each
open /Users/donda/vin-fleet-tracker/.taste-skill/3an/night-desk/index.html
open /Users/donda/vin-fleet-tracker/.taste-skill/3an/lamp-black/index.html
open /Users/donda/vin-fleet-tracker/.taste-skill/3an/day-ledger/index.html
```

Or in a browser: `file:///Users/donda/vin-fleet-tracker/.taste-skill/3an/index.html`.
Look at a desktop width (1000–1440px), and press Tab to see focus. The
pages fetch their fonts from Google Fonts; offline they fall back to system
fonts. To rebuild: `node .taste-skill/3an/build.mjs`.

#### What adopting one would change

All sizes below are estimates (unverified).

**A. This page only.**

- New colours as tokens (no hex in components): a page-scoped set in
  `src/design/tokens.ts` and the Tailwind config, or a class on the page's
  `main` that redefines CSS variables.
- The font loaded with `next/font/google` in the `/assignments` route only.
- Components: `AssignmentBoard` and `DriverPhone`. `DriverSelect`,
  `DriverName` and the No ELD tag are shared with the edit modal, the console
  rows, the map popup and the phone sheet. The board's look must be a prop or
  a scope; otherwise those change too, and so do the console baselines.
- Baselines: the 8 assignments PNGs are re-saved. The other 72 (desktop 60,
  history 6, history-phone 6) stay unchanged if the shared parts are scoped.
- Size: one phase, about 5–7 commits, roughly 400–800 changed lines.
- Cost: the page stops looking like the console it belongs to. Least for
  Night desk (dark, square, close to today's layout); most for Day ledger
  (light inside dark).

**B. The whole console.**

- The palette in `src/design/tokens.ts`, which is also read outside Tailwind:
  map layers and markers, toasts, the chip flip, the row flash, the history
  page, the manifest and `trail.ts`.
- Tailwind's font families, its six sizes (§2), the radius (0 today) and
  every component's classes.
- design-spec §2, §3 and §14.4 rewritten, and the status colours remapped
  with their contrast checked again.
- Every baseline: 80 PNGs.
- Size: several phases (tokens and type; the console list and map; modals;
  history and phone; baselines), weeks rather than days.
- A light console is larger still: the map style and every status ground
  were designed dark.

#### Recommendation

**Night desk, on this page first.**

- It is dark, which suits a console used all day.
- It is the densest: about 17 of 22 trucks on one screen.
- Each of its devices serves the job rather than decoration: the empty slot
  answers the screen's question at a glance, stacked figures make numbers
  easy to scan, and one line marks what is selected.
- It adds no new colour to the console: the accent is only a 1px line.
- It is the closest to the console's square, dark character, so a page-only
  build clashes least and a later console-wide move is the smallest.

Lamp black looks the most luxurious, at the cost of four fewer rows and an
amber that would fight the console's status colours. Day ledger is the
calmest, but it is light.

**Questions for Alex** (one decision each; the recommendation first):

1. Which direction: Night desk, Lamp black, Day ledger, or none (keep
   today's)? Recommended: Night desk.
2. This page only (scoped, so the edit modal and the other screens do not
   change), or the whole console? Recommended: this page only; decide the
   console after a week of using it.
3. Dark or light? Recommended: dark.
4. If Night desk: truck numbers and phones in IBM Plex Mono (its face), or in
   the text face's tabular figures? Recommended: Plex Mono.
5. From 1100px up, the board capped at 940px and centred with its panels,
   instead of §12.135's 1000px on the left? Recommended: yes.
6. If Night desk: Save as an accent-outlined pill instead of today's filled
   accent? Recommended: yes. It is the only primary on the screen, and the
   footer is always in view.
7. The open list stays without a shadow (your 3al answer 6) in the chosen
   direction? Recommended: yes.
8. The viewer's lock reason stays a hover-only `title`, as today? A visible
   line would be new interface, so it is outside this redesign. Recommended:
   keep it for now, and raise it as its own small item if keyboard users
   matter.

**Alex's answers (2026-10-21):**

1. Direction: Night desk.
2. This page only. The console, the history page, the edit modal, the map
   popup, the phone sheet and every other surface look exactly as today.
   The rest of the console is decided after a week of use.
3. Dark.
4. Truck numbers and phone numbers in IBM Plex Mono; text in Public Sans.
5. From 1100px up, the board capped at 940px and centred together with its
   panels.
6. Save is not an outlined pill. It is a solid, filled button in Night desk's
   accent (as a token) whenever there is something valid to save. It is
   disabled at rest and while Save is refused (a double-booking): visibly
   disabled, but readable. Discard stays the quieter, outlined button.
7. The open list has no shadow (as decided in 3al).
8. The viewer's lock reason stays a hover tooltip, as today.

Also: in "Drivers with no truck", the mockup cut a long name off ("…") at
1440. Give the name room, so a normal-length name shows whole; truncate only
a truly long one, with the full name in a title.

### Phase 3an, step 2: Night desk built on the assignment page (2026-10-21)

From the advisor's brief: build direction 1, Night desk, on `/assignments`
only, as answered above. **NOT pushed, NOT deployed; e2e verified 2026-10-21 (see below), ready to push.** No migration, no
server code, no API route, no handler, no change to the save request (same
rows, same payload). No e2e spec changed; no baseline PNG created, changed
or deleted; e2e not run.

Commits (each passed `npm run check` in the pre-commit hook):

- `b0673a9`: the tokens and the fonts, scoped to the page (no existing token
  changed); the contrast of every Night desk pair (+17 tests);
- `63fa1e2`: a `look` prop on DriverSelect and DriverName / NoEldTag,
  defaulting to the console; the scope test (+15);
- `1762660`: the board, its rows and its panels in Night desk; DriverPhone;
  the source scan (+3); +5 board tests; three class assertions follow;
- `8ee6493`: the footer, with a solid Save and an outlined Discard (+4); one
  class assertion follows;
- `3c38517`: 20px sides from 1100 to 1279, so the rows fit beside the panels;
- one docs commit: this section, Alex's answers above, design-spec §12.136.

#### The scope: a prop, not a CSS scope

The parts the page shares take `look?: 'console' | 'nightDesk'`, defaulting
to `'console'`, as 3am did with `quiet` and `size`:

- `DriverSelect`: the edit modal's picker, in `LoadStrip`.
- `DriverName` and `NoEldTag`: every driver name, in TruckRow, MapPopup,
  TruckSheet, ReassignConfirm and LoadStrip.

Only `AssignmentBoard` passes `'nightDesk'`; DriverName also passes it on to
its own tag, inside its Night desk branch.

Why a prop: the default path is then the old code itself. A scope on the
page's root (a data attribute with CSS variables) would leave the old
classes in place plus selectors that must never match anywhere else, which
only a browser can check.

**Proof that the other surfaces are unchanged.** `look-scope.test.tsx` pins
the markup of nine cases exactly as the pre-3an source rendered it (captured
from `b0673a9`, where those components had not changed): the tag; a name,
struck and not; a struck fallback; the modal's picker closed, empty and open
with its list; the quiet row field; a viewer's locked field. Each still
renders character for character, and `look="console"` equals no `look`. A
source scan finds `look="nightDesk"` only in AssignmentBoard and DriverName,
the faces' variables only in `src/app/assignments/layout.tsx`, and
LoadStrip's DriverSelect passing no look.

`DriverPhone` and `MergePrompt` are rendered by the board only (grep), so
they need no prop. DriverPhone is restyled directly. **MergePrompt and
`AddDriverInline`** (the "Add a driver" form inside the picker's list, shared
with the modal) **keep the console look**: they are left out of this phase
(question 1).

#### Tokens added (no existing value changed)

All are in `src/design/tokens.ts` (`palette.nightDesk`) and
`tailwind.config.ts`.

| Token | Value | Role |
|---|---|---|
| `nightDesk.ground` | #171719 | the page |
| `nightDesk.surface` | #131217 | cards (the rows, the panels, the footer): darker than the ground |
| `nightDesk.raised` | #212023 | a changed row; the open list; a disabled Save |
| `nightDesk.raisedHigh` | #2a292d | the open field; the list's cursor row |
| `nightDesk.rowHover` | #18171c | a resting row on hover |
| `nightDesk.border` | #26252a | card and header edges; a viewer's locked field |
| `nightDesk.rule` | #1f1e23 | between rows |
| `nightDesk.control` | #3a3a3e | control edges; the empty truck's dashed slot; a field's hover line |
| `nightDesk.controlHover` | #55555b | a control's edge on hover |
| `nightDesk.ink` | #ffffff | names, truck numbers, the changed count |
| `nightDesk.inkSecondary` | #c9cacd | phone numbers; a driver on a truck in the list |
| `nightDesk.muted` | #96989e | headers, "Unassigned", Edit / Add, "was", disabled labels |
| `nightDesk.tagInk` | #a3a5aa | the No ELD tag's word |
| `nightDesk.accent` | #4a8ad6 | the 1px line (focus, open field, cursor, changed row) and Save's fill |
| `nightDesk.accentHover` | #6ea2e0 | Save on hover |
| `nightDesk.onAccent` | #131217 | Save's label (white on the accent is 3.56) |
| `nightDesk.negative` | #e5566f | a double-booked truck's number and line; refusals |
| `nightDesk.negativeBg` | #2c1a20 | a double-booked row; the conflict and failure notes |

- **Font sizes:** `nightDesk-title` 22, `-gap` 20, `-data` 14, `-body` 13,
  `-small` 12, `-tag` 11.
- **Font families:** `nightDesk` (Public Sans) and `nightDesk-mono` (IBM
  Plex Mono), read through CSS variables.
- **Other keys:** radius `nightDesk` 6px; spacing `row-nightDesk` 42px.
- **One departure from the mockup:** `muted` is #96989e, not #8a8c92. The
  mockup's value measured 4.30:1 on the list's cursor row; #96989e measures
  5.01 there, its worst ground. All 17 pairs the page draws are in
  `contrast.test.ts`.

#### Fonts

- `src/app/assignments/layout.tsx` loads Public Sans (400/500/600) and IBM
  Plex Mono (400/500) with `next/font/google`, self-hosted at build like
  Barlow, so no runtime CDN request. Both are SIL OFL 1.1.
- The route's layout is the only place they load, so no other page downloads
  them. They reach the page as `--font-nightdesk-sans` and
  `--font-nightdesk-mono` on a `display: contents` wrapper.
- They are read through the variables because next/font renames the family it
  self-hosts (`'__Public_Sans_…'`; see next's `postcss-next-font.js`).
- Plex Mono sets truck numbers (the rows and the "Trucks with no driver"
  panel) and phone numbers (shown and while editing). The header's counts and
  all other text are Public Sans (answer 4 names truck and phone numbers only;
  question 3).

**Found, not changed.** The console's own Tailwind family is the literal
`'Barlow'` (`tailwind.config.ts`), not next/font's variable
(`--font-barlow`, read only by HistoryPage's print style). For the reason
above, the console may be drawing Barlow from a locally installed copy or a
fallback rather than the self-hosted file. Unverified; question 5.

#### Per area

- **Page** (`AssignmentBoard.tsx`).
  - `main` sits on the page's ground, in its face and ink.
  - One `FRAME` column (max 1288px) for header, board and footer. From
    1100px up, the 940px board and the 260px panels are centred together
    (answer 5).
  - 32px sides below 1100 and from 1280; 20px from 1100 to 1279, because
    beside the panels 32px ran the rows up to 4px past their card at
    1100–1103 (a local render; commit `3c38517`).
  - Below 1024 the gaps and padding tighten so 768 still closes: 674 + 36 +
    12 + 2 = 724 in 728.
  - The below-768 message is in Night desk, with its text unchanged.
- **Header.** "Assignments" at 22/600 in sentence case (it was condensed caps
  by CSS; the text is the same). Counts in muted Public Sans. Back to console
  is an outlined pill.
- **Rows.**
  - The rows sit on one card darker than the ground, on a 42px pitch.
  - Truck numbers are Plex Mono 14/500, muted when the truck is empty and in
    the negative when double-booked.
  - A changed row is one step lighter with a 1px accent line on its left
    edge. A double-booked row is on the negative ground with the line in the
    negative.
  - An empty truck has no ground of its own: its field is the dashed empty
    slot.
  - The column header is muted 12px sentence case, sticky as before.
- **Picker field** (`DriverSelect` `look="nightDesk"`, still `quiet` and
  `size="row"`).
  - No box at rest; a 1px line under it on hover; the accent line and one
    step of lightness when focused or open.
  - An empty truck's field is a dashed box.
  - A viewer's locked field keeps a box (§12.134) in the quieter edge, with
    muted ink and a not-allowed cursor; its reason is still the title
    (answer 8; question 2).
  - The No ELD tag is in sentence case in a 4px box.
- **Open list.**
  - No shadow (answer 7): a tone step and a 1px control edge, 6px corners.
  - The cursor row is one step lighter with a 1px accent line on its left.
  - A free driver is in ink with "no truck"; a driver on a truck in
    secondary ink with "on truck N".
  - The rule after the free drivers is kept. The width rule, the order and
    the cap after the sort are untouched (§12.129).
- **Phone** (`DriverPhone`).
  - The number is in Plex Mono, secondary ink; "No phone" is in muted Public
    Sans; Edit / Add are 12px sentence case on the same 28px targets.
  - Disabled for a viewer it stays readable: muted at 6.46:1 and a
    not-allowed cursor, not 45%.
  - In the editor, the field is Plex Mono with a negative edge on a refusal,
    and the refusal is in the negative.
  - The editor's Save is a solid accent fill too (question 4), and Cancel an
    outline.
- **"Currently".** "was" is muted. The struck name truncates before its No
  ELD tag (`DriverName` `look="nightDesk"` lets the name shrink), so the tag
  is never the part cut off.
- **Panels.**
  - Cards, with titles at 14/600.
  - The no-driver trucks are Plex Mono 20/500, wrapping as before.
  - From 1100 up, a free driver's name has the whole first line, and Retire
    sits beside the phone under it (Alex's panel fix). Measured at 1440:
    "Lior Mbeki-Saarinen" and its tag show whole.
  - A truly long name truncates, whole in its title. Below 1100 the entry is
    one line, as before.
- **Footer.**
  - The count is in ink while dirty and muted at rest.
  - Save is a solid accent fill with `onAccent` text whenever it is enabled.
    Disabled (at rest, for a viewer, while a double-booking refuses it), it
    has no fill, a control edge, the `raised` ground and muted text at
    5.62:1, not 45% (answer 6).
  - Discard is an outlined pill.
  - The server's conflict list and a failure sit on the negative ground.
- **Focus.** Every control on the page carries `ND_FOCUS`: 1px of the
  accent, 2px out, drawn inside the list. Measured in the local render
  below.

#### Tests

- Counts: 203 → 204 files, 3,682 → 3,726 tests (+44): contrast +17,
  `look-scope.test.tsx` +18 (new file), AssignmentBoard +9.
- **Changed assertions**, all in `AssignmentBoard.test.tsx`, all class checks
  for classes this phase replaces. No behaviour assertion changed.
  1. "marks a truck with nobody as an empty slot" (was "puts a truck with
     nobody on the unassigned ground"): `bg-row-unassigned` becomes the
     field's `border-dashed`, on the empty truck only.
  2. "puts a changed row on its own ground, with the accent line, over the
     empty slot" (was "lets a changed row's ground win over the empty
     one"): `bg-row-selected` and not `bg-row-unassigned` become
     `bg-nightDesk-raised`, `before:bg-nightDesk-accent` and not the
     resting hover.
  3. "sits each row on Night desk's 42px row" (was "the console's 44px
     row"): `min-h-row-comfortable` becomes `min-h-row-nightDesk`.
  4. The footer's count: `text-text-secondary` / `text-text` become
     `text-nightDesk-muted` / `text-nightDesk-ink`.
- `DriverSelect.test.tsx`, `DriverName.test.tsx`, `ReassignConfirm.test.tsx`
  and every other test file: unchanged. They render the default look, and
  pass as they are.

**What the test DOM cannot prove** (happy-dom draws nothing):

- that the faces load (in the app, next/font at build);
- any colour as seen, any width, the 940 cap and the centring;
- that the dashed slot, the 1px lines and the focus ring draw;
- the 42px pitch;
- that a long name truncates before its tag;
- that nothing scrolls sideways.

The scope test proves markup, not pixels: the pixels of the other surfaces
are the 72 baselines' to hold.

**Seen in a local render** (as in 3al and 3am; `.taste-skill/3an/render/`,
git-ignored):

- **Setup.** The real AssignmentBoard bundled with esbuild (`next/link` and
  `next/navigation` stubbed, `fetch` answering no merge candidates), the
  app's own Tailwind build, and the e2e seed. Both faces were loaded from
  Google Fonts for that render only, since the app self-hosts them. Opened
  in Playwright's Chromium on `file://`; no server, no DB, no sign-in.
- **States checked.** At rest, the picker open, changed rows with a
  double-booking, the phone editor with a refusal, a viewer, focus, and a
  valid change.
- **Measured.**
  - Row pitch 42.
  - No sideways scroll and no row past its card at 768, 1024, 1099, 1100,
    1279, 1280, 1440 and 1920.
  - Picker 242px at 768, 250 at 1100, 360 elsewhere.
  - Equal outer margins (76/76 at 1440, 316/316 at 1920).
  - Faces loaded: Public Sans and IBM Plex Mono.
  - Save with a valid change: fill rgb(74,138,214), label rgb(19,18,23).
- **Inspector.** `inspect.mjs --app` on that render at 1440 and 1024:
  0 FAIL, 1 WARN (`hero-void` at 1440, the same block defended in step 1).
  Sizes 11/12/13/14/20/22.

#### Baselines

| Group | PNGs | Expected | Why |
|---|---|---|---|
| `assignments-baseline` | 8 | **all change** | the whole page's look |
| `desktop-baseline` | 60 | unchanged | it never visits `/assignments`; the modal's picker, every DriverName and every No ELD tag render the pre-3an markup (look-scope.test.tsx); new tokens only add classes; the faces load on `/assignments` only |
| `history-baseline` | 6 | unchanged | nothing on the history page changed |
| `history-phone-baseline` | 6 | unchanged | the same |

All of these are expectations, unverified until Alex's run. The e2e specs
that visit the page (`dispatch`, `driver-phone`, `assignments-baseline`)
select by role and text, and no text changed.

**Alex's commands** (hosted sign-in; the advisor looks at the diffs of the
eight before any is saved):

```
# 1. see the diffs (8 differ)
npm run e2e -- assignments-baseline --update-snapshots=none
# 2. once approved, re-save them and check they hold
npm run e2e -- assignments-baseline --update-snapshots=changed
npm run e2e -- assignments-baseline --update-snapshots=none --repeat-each=3
# 3. the specs that touch the page and the picker; the other 72, expected unchanged
npm run e2e -- dispatch driver-phone driver-picker assignments-baseline --update-snapshots=none
npm run e2e -- desktop-baseline history-baseline history-phone-baseline --update-snapshots=none
```

**Unverified:**

- the faces self-hosted by next/font at build (typechecked; no `next build`
  was run here; Vercel's build is the check);
- the page in the app at any width (local render only);
- the 72 baselines unchanged, until Alex's run;
- MergePrompt and the "Add a driver" form as they look on the page (not
  rendered: no merge candidate, no search with no match).

**Questions for Alex** (one decision each; the recommendation first):

1. MergePrompt and the "Add a driver" form inside the picker keep the
   console's look (condensed caps, square boxes) on this page. Restyle them
   in Night desk in a small follow-up? Recommended: yes, a small follow-up.
2. A viewer's locked field stays boxed (§12.134) in Night desk's quiet edge
   and muted ink, rather than the mockup's line under it. Keep?
   Recommended: keep. A box with muted ink reads as locked; a line reads
   like an ordinary field.
3. The header's counts ("14 active trucks · 12 active drivers") are in
   Public Sans, since answer 4 names truck and phone numbers only. Fine?
   Recommended: yes.
4. The phone editor's own Save is a solid accent fill too, like Save
   assignments. Keep? Recommended: yes, for one meaning of a filled accent
   on the page.
5. Found: the console's Tailwind font is the literal `'Barlow'`, which
   next/font's renamed, self-hosted family does not match. Check in a small
   phase of its own whether the console really draws the self-hosted Barlow?
   Recommended: yes; nothing was changed here.

**Alex's answers (2026-10-21):**

1. Yes: restyle MergePrompt and the picker's "Add a driver" form in Night
   desk, as a small follow-up phase.
2. Keep a viewer's locked field boxed, with a quiet edge and muted text.
3. Header counts in Public Sans: fine.
4. The phone editor's Save is also a solid accent button: keep, so a filled
   accent always means "save".
5. The console's literal 'Barlow' vs next/font's renamed family: check it in
   its own small phase, later. Confirmed by the advisor: layout.tsx loads
   Barlow with `variable: '--font-barlow'`, while tailwind.config.ts asks for
   the literal family 'Barlow'. Unverified what the console actually
   renders. A fix would change every console page and its baselines, so it
   needs its own decision.

**e2e (Alex, 2026-10-21):**

- Two first attempts did not start: ports 3199 (`e2e/sentry-sink.mjs`) and
  3100 (`next start`) were held by processes left from an interrupted run
  started 20:45 CEST, likely from VS Code's Playwright extension (its
  test-server had run since 19:33). Alex stopped them; nothing ran.
- `assignments-baseline --update-snapshots=none` (run
  2026-10-21T18-47-23-554Z): all 8 differed, as expected. The advisor
  reviewed the actual images (768, 1024, picker-open-1024, changed-1440,
  1920) before any was saved.
- `desktop-baseline history-baseline history-phone-baseline dispatch
  driver-phone driver-picker --update-snapshots=none` (run
  2026-10-21T18-47-51-529Z): 31 passed. All 72 other baselines unchanged;
  the page's e2e specs pass.
- `--update-snapshots=changed` (run 2026-10-21T18-58-45-899Z): 9 passed, 8
  re-saved. The advisor confirmed all 8 saved files are byte-identical to
  the reviewed actual images. Committed as written in `37d21fa` (each opened
  first: only the spec's invented seed).
- `--repeat-each=3 --update-snapshots=none` (run 2026-10-21T18-59-09-894Z):
  25 passed.
- Not shown by any baseline: Save's solid accent (no shot has a valid,
  savable change). Alex to check it live after deploy.

### Phase 3an, reverted: the assignment page back to the 3am look (2026-10-21)

Alex, 2026-10-21, after seeing Night desk live: "I don't like it because
it's not looking the same as the rest of the app, we go back to old style."

**NOT pushed, NOT deployed.**

Night desk was live in production from 19:10 UTC (`bf9c647`) until this
revert is deployed. The code and the baselines go back; the record stays.
The docs commits `7021ede` (step 1), `f5dd5d0` (step 2) and `bf9c647` (step
2's answers and e2e) are kept, and design-spec §12.136 stays with a
"Reverted" note under its heading.

**Commits:**

- `387a051`: `git revert --no-commit 37d21fa 3c38517 8ee6493 1762660 63fa1e2
  b0673a9` (newest first), one commit. It reverts the baselines (`37d21fa`),
  the 1100–1279 padding (`3c38517`), the footer and Save (`8ee6493`), the
  board, rows and panels (`1762660`), the `look` prop and its scope test
  (`63fa1e2`), and the tokens and fonts (`b0673a9`). No conflicts; nothing
  resolved by hand.
- one docs commit: this section and the §12.136 note.

**Proof** that src/, e2e/ (specs and baselines) and the config equal
`011872b`, the 3am look. Both print nothing (the second, 0 bytes):

```
$ git diff 011872b -- src e2e tailwind.config.ts package.json package-lock.json
$ git diff --cached 011872b -- src e2e tailwind.config.ts package.json package-lock.json | wc -c
       0
```

`npm run check` after the revert: 203 files / 3,682 tests, the counts at
`011872b`.

The stale `.next-e2e/types` (generated 20:59 local with Night desk's
layout) blocked the check and was deleted; it is rebuilt by the next e2e run.

**The mockups** stay local in `.taste-skill/3an/` (git-ignored) for
reference: the three directions, and the local render of the built board in
`.taste-skill/3an/render/`.

**Cancelled:** step 2's follow-up, MergePrompt and the picker's "Add a
driver" form in Night desk (step 2's answer 1).

**Still stands:**

- The Barlow check: the console's Tailwind family is the literal 'Barlow',
  while next/font self-hosts it under a renamed family. What the console
  actually renders is unverified; it gets its own small phase, later (step
  2's answer 5).
- Backlog: the confirm's "To" driver No ELD tag (3am step 1, answer 7).

### Phase 3ao: the assignment page from Alex's Claude Design, part 1 (2026-10-22)

From the advisor's brief. Part 1 of 2: everything the page can do with the
data it already has. Live status and position in "Currently" is part 2
(3ap) and is not built here. **NOT pushed, NOT deployed; e2e verified 2026-10-22 (see below), ready to push.** No server, API,
migration or worker change. No new dependency, font, colour or token. The
save request is unchanged.

**The design reference.** Alex's approved Claude Design,
https://claude.ai/artifact/8EqEuAvNDTYrVHjpGYqUe1. Invented data only
(trucks 401–438, 555-01xx numbers), in the console's own style. Read as
data and unpacked locally for its markup; no hex value was copied from it.
The lesson of 3an applied: existing tokens, type and the console's own
chip and search styles.

**Commits** (each passed `npm run check` in the pre-commit hook):

- `a660720`: search and filter tabs (`boardView.ts`, pure, with its tests);
- `a3e4af7`: columns and row states (ELD column, "was" under the name, left
  edges, "+ Assign driver", the pencil);
- `35510e7`: a shared phone, by driver (row warning, third panel);
- `7ddd5a6`: the panels and "Assign to";
- `c1ebba8`: a viewer's board says VIEW ONLY;
- `95bd704`: Save is the primary action only when it can save;
- `2afa90e`: the baseline seed shares one phone (written, not run);
- `acad7df`: the header fits at 768 (an estimate, below);
- one docs commit: this section and design-spec §12.137–§12.141.

**What was built, per item** (`src/components/assignments/`; lines as of
`acad7df`):

1. **Header.** Title and counts as before; on the right the search
   (`AssignmentBoard.tsx:415`), "Truck, driver or phone" with a `/` cap,
   in the console's search-field classes. It matches a truck's number, the
   draft driver's name, or the phone's digits with punctuation ignored
   (`boardView.ts:90–98`). `/` focuses it unless typing in another field
   (`:323–332`, the console's `isTypingTarget`); Escape clears. Below 1100px
   the box is 160px without its cap (commit `acad7df`).
2. **Tabs** (`:458–488`): All · No driver · No phone · No ELD · Shared
   phone, counted from the draft (`boardView.ts:50–85`), in the console's
   chip style. Tab and search combine; "N of M trucks" while either
   narrows; "No trucks match." (`:683`). The save still reads every truck,
   so a hidden changed row is counted and saved.
3. **Columns** (`COLUMNS`, `:63`): Truck · Driver · ELD · Driver's phone.
   - ELD (`:662`) is the `NoEldTag`. The picker's field no longer carries it
     on the board: `DriverSelect` `fieldTag` (`DriverSelect.tsx:112`,
     default true for the modal).
   - "was" under the name (`:644`), struck via `DriverName` `struck`, or
     "was —".
   - Left edge (`:546–556`): late ink on conflict, accent on changed, muted
     on empty.
   - "+ Assign driver" (`:623–633`) opens that row's picker through
     `DriverSelect`'s new handle (`ref`, `open()`, `DriverSelect.tsx:186`).
     The empty field is 104px beside it and takes the column while focused
     (`peer-focus-within`).
   - Pencil "Edit phone for truck N" (`DriverPhone.tsx:75–98`); "No phone"
     and Add as before.
   - Shared phone: icon and "also 433" after the number
     (`DriverPhone.tsx:64–74`).
   - Conflict as before, plus its edge; the footer names the trucks as
     before.
4. **Panels** (`:693–837`): "Drivers without a truck" and "Trucks without a
   driver" with counts. Under each free driver, "Assign to" and a button
   per truck empty in the draft (`:752`), which calls `editDraft`, the
   same call a pick makes. The trucks are non-interactive chips (3al
   question 3). "Shared phone number" only when there is one (`:801–836`).
   Below 1100px all panels in one row above the table (`grid-flow-col
   auto-cols-fr`).
5. **Footer**: as before, fixed; Save solid accent only when savable
   (`:184`, `:885–902`), outlined and muted otherwise.
6. **View only** (`:397–411`): a "View only" badge with the reason as its
   title. No "+ Assign driver", "Assign to", pencil, Add or Retire; the
   pickers stay locked; search and tabs work. `DriverPhone` lost its unused
   `lockedReason`.

**The shared-phone rule, and why** (§12.138). Shared means two or more
DIFFERENT active drivers have the number, by digits. It is grouped by
driver (`boardView.ts:40–48`), never by row. One driver on two trucks is a
double-booking: one person, one phone, already named by the footer. The
mock counted rows and flagged that case ("also 404/410", tab 2 → 4). Not
reproduced; a test pins it.

**How the edit modal and other pages are shown unchanged.**

- `git diff 9fd86f7 --stat` touches only `src/components/assignments/*` and
  two e2e specs.
- Outside the page, only the modal's `LoadStrip` imports `DriverSelect`. It
  passes neither new prop: `fieldTag` defaults to true, and
  `useImperativeHandle` with no ref does nothing, so its markup is the same.
- `DriverName`, `NoEldTag`, `ReassignConfirm` and every console file are
  untouched.
- The save block (`fetch('/api/assignments', … changes: changed.map(…))`)
  has no diff line.
- A test pins the modal's defaults (the field's tag kept, no handle
  needed).

**Tests.** 203 files / 3,682 → 204 / 3,727 (+45):

- `boardView.test.ts`, new, 11: search, tabs and counts, the shared rule
  including a double-booking.
- `AssignmentBoard.test.tsx`, 21 → 50: search, "/", tabs from the draft,
  combined, a hidden changed row counted and saved with the same payload;
  ELD column, "was" under the name, edges; "+ Assign driver" opens that
  row's picker with the same list and saves as a pick; shared by driver
  (both rows, the panel, a free driver, a double-booking with no warning,
  following the draft); panels, "Assign to" draft only with a payload
  equal to a pick, chips do nothing; view only; Save's look; header at
  narrow widths.
- `DriverSelect.test.tsx`, 32 → 35: `fieldTag={false}`, the handle opens,
  the handle does nothing while disabled.
- `DriverPhone.test.tsx`, 7 → 9: the pencil named for the truck, the
  shared warning; the viewer test now expects no control.

**What the test DOM cannot prove** (happy-dom draws nothing):

- any width, wrap or truncation: the four columns at 768–1920, three panels
  in one row at 768, the 104px empty field and the list opening from it;
- the header at 768: the 330 + 300px split is an estimate, not a
  measurement, so `acad7df` is a guess the 768 baseline checks;
- the button stepping aside when the field has focus, and that a click on
  it is not lost to that (the tests call `open()` through a click event,
  not a real pointer);
- the 3px edges and the risk ink drawing;
- sticky headers and panels, and Save's look on screen.

Compiling the app's Tailwind confirmed every new class is generated and
that the left-edge colours come after `border-line-soft`. No local render
was made this phase.

**e2e** (written, NOT run; no PNG created or updated):

- `e2e/assignments-baseline.spec.ts`: Juno (436) is seeded with Gus's (425)
  invented number, so the warning and its panel are in every shot.
- `e2e/driver-phone.spec.ts`: Ana's row pencil is "Edit phone for truck
  101" (was "Change the phone for Ana Petrovic"). The viewer test now
  expects no phone button and the badge with its reason (was: Add disabled
  with "…Phone numbers need dispatcher.").

**Baselines expected:**

| PNGs | Change? | Why |
|---|---|---|
| `assignments-768`, `-1024`, `-1280`, `-1440`, `-1680`, `-1920` | yes | search, tabs, columns, edges, "+ Assign driver", pencils, shared warning, panels with counts, "Assign to", chips, the third panel, Save outlined |
| `assignments-picker-open-1024` | yes | the same, the empty field 104px wide while closed |
| `assignments-changed-1440` | yes | "was" under the names, the edges, Save outlined (a double-booking) |
| `desktop-baseline` (all) | no | the modal's picker renders as before; nothing else on the console changed |
| `history-*`, `history-phone-*` | no | untouched |

**Alex's commands** (hosted sign-in; the advisor looks at the diffs first):

```
npm run e2e -- assignments-baseline --update-snapshots=none
npm run e2e -- assignments-baseline --update-snapshots=changed
npm run e2e -- assignments-baseline --update-snapshots=none --repeat-each=3
npm run e2e -- dispatch driver-phone driver-picker assignments-baseline --update-snapshots=none
npm run e2e -- desktop-baseline history-baseline history-phone-baseline --update-snapshots=none
```

**Deferred:**

- "Currently" with live status and position: 3ap.
- Truck chips stay non-interactive per 3al question 3 (question 1 below).
- Also not built from the mock: retiring as a draft with Undo ("Retires on
  save"), and a phone change shown as "was <old number>". Today both save
  at once (MUST NOT CHANGE), so building them would change behaviour.

**Found wrong or left out in the design:**

1. The shared-phone warning on a double-booking (above).
2. The truck chips as buttons, against 3al question 3.
3. In view only, the mock drops the footer. Kept as before (Save disabled
   with its reason), since the brief keeps the footer.

**Unverified:** every picture until Alex's run; the header at 768 (see
above); `desktop-baseline` and `history-*` unchanged; Alex's window (about
1000 CSS px).

**Questions for Alex:**

1. The trucks in "Trucks without a driver" are chips that do nothing (3al
   question 3). A bordered chip can look clickable. Keep them, or have a
   click open that row's picker, as "+ Assign driver" does?
2. View only hides the controls (the design) instead of disabling them with
   a reason (§12.14, still the rule on the console and in the modal). The
   badge says why once. Confirm for this page?
3. A driver who shares a number with someone on no truck reads "also"
   followed by that driver's name, since there is no truck to name. Fine?
4. Drivers on no truck count toward a shared number (they are on the
   board). Or only drivers on a truck?
5. With a shared number, below 1100px three panels share the row, about
   230px each at 768, and a free driver's name truncates sooner. Fine, or
   put the shared panel on its own line?
6. The Shared phone tab shows with 0 when there is none (the design hides
   it). Keep it always?
7. Trucks 128 and 135's shared number (3al question 6) will now show as a
   warning if it is still in the data. Still yours to check.

**Alex's answers (2026-10-22):**

1. The truck chips in "Trucks without a driver" become CLICKABLE. A click
   opens that truck's row picker exactly as its "+ Assign driver" does:
   scroll the row into view, focus the field, open the list. If a filter or
   the search hides the row, the filter goes back to All and the search is
   cleared first. A viewer's chips stay non-interactive. The accessible name
   is "Assign a driver to truck N". This replaces 3al question 3's "no jump
   to the row" for these chips: Alex's decision, 2026-10-22.
2. Keep view only as built: no edit controls, and the "View only" badge with
   the reason. This departs from §12.14 on this page only, by Alex's
   decision. The advisor's 3ao prompt asked for hidden controls without
   noting §12.14; the build flagged it (question 2) and Alex confirmed it.
3. "also" plus the other driver's name, when that driver has no truck: keep.
4. Drivers with no truck count toward a shared phone: keep.
5. Three panels in one row below 1100px when a phone is shared: keep.
6. The "Shared phone" filter tab ALWAYS shows, with its count, even at 0.
7. Trucks 128 and 135 sharing a phone: data, Alex's to check. No code.

**The follow-up** (`51dc177`, code and tests; one docs commit):

- **Answer 1.** `AssignmentBoard.tsx`: the chips are buttons for whoever may
  assign, and inert spans for a viewer, as before. A click calls
  `openPickerFor`, which, when the row is hidden, sets the tab to All and
  clears the search in a `flushSync`, so the row and its picker exist, then
  calls the same `open()` as "+ Assign driver". `DriverSelect.tsx`'s
  `open()` now also scrolls the field into view, centred so the sticky
  column headers do not cover it. The edit modal does not use the handle.
- **Answer 6.** No code change: 3ao already rendered all five tabs. A test
  now pins Shared phone at 0.
- **Tests** 3,727 → 3,732, 204 files. `AssignmentBoard.test.tsx` +5:
  - a chip scrolls, focuses and opens, reaching the same `open()` and list
    as "+ Assign driver";
  - a hidden row is brought back (All, search cleared) and opened;
  - a visible row's tab is left alone;
  - a viewer's chips have no button role and open nothing;
  - the Shared phone tab reads 0.

  "Chips that do nothing" now checks the chip's ground and text.
- **Not verifiable here** (happy-dom has no layout): the scroll itself (the
  test checks `scrollIntoView` is called on the field) and the chip's hover
  border.
- **Baselines.** The 8 assignments PNGs are still expected to change; the
  others are not. In the pictures the chips look as before at rest (same
  classes, plus hover and disabled states). Still NOT pushed, NOT deployed;
  e2e not run.

**Polish (2026-10-22).** Four visual fixes, found in the advisor's review of
Alex's e2e run 2026-10-22T13-02-42-813Z (the actual images), before the
baselines are saved. One code commit (`4f2fa4a`) and one docs commit:

1. **Save's disabled look.** At rest and when refused (a double-booking),
   Save is drawn as a disabled Discard: `line.hair` border, secondary ink,
   45% (`AssignmentBoard.tsx:954`). It looked bright and clickable beside
   the dimmed Discard. It keeps the real `disabled` attribute. The solid
   primary when savable is unchanged.
2. **Search placeholder.** It was cut to "Truck, driver or phon" in the
   160px box at 1024 and 768. It is now drawn by two `aria-hidden` spans
   after the field (`:458`, `:465`), shown by `peer-placeholder-shown`:
   "Search" below 1100, "Truck, driver or phone" from 1100 up. The real
   placeholder is a space (`:452`). CSS only, so no width read and no
   server/client mismatch. Accessible name: "Search trucks, drivers or
   phones".
3. **Left edge vs truck number.** The number touched a marked row's 3px
   edge ("|410"). Every truck number, and the "Truck" header, now has
   `pl-2` (`:560`, `:601`), so the numbers still line up.
4. **Free driver's name below 1100.** With three panels in the row the name
   was cut ("Lior Mb…"). The entry is now name and Retire, then the phone
   on its own line, then "Assign to", at every width (`:750–797`). The
   name's title is the whole name. This replaces 3am's one-line entry below
   1100 (§12.135, Alex's answer 2 there), for the room three panels need.

**Tests** 3,732 → 3,735, 204 files. `AssignmentBoard.test.tsx` +3:

- Save `disabled`, with Discard's disabled classes, at rest and on a
  double-booking;
- the placeholder spans and the accessible name;
- `pl-2` on every row's number and on the header.

Two existing tests follow the changes: the free driver's layout, and
Save's look at rest.

**What happy-dom cannot show:** that "Search" and the long hint fit
uncut, which one is visible at a given width, the 8px gap, and the name
showing whole at 230px. The 8 assignments baselines (still expected to
change; the others not) are where these are seen. No PNG was touched.
Still NOT pushed, NOT deployed.

**e2e (Alex, 2026-10-22):**

- `assignments-baseline --update-snapshots=none` (run
  2026-10-22T13-02-42-813Z): 8 differed, as expected. The advisor's review
  of them found the four flaws fixed in "Polish".
- `desktop-baseline history-baseline history-phone-baseline dispatch
  driver-phone driver-picker --update-snapshots=none` (run
  2026-10-22T13-03-13-938Z): 31 passed, including the changed driver-phone
  viewer test on its first run. Every other baseline is unchanged.
- After the polish, `assignments-baseline --update-snapshots=none` (run
  2026-10-22T13-21-07-693Z): 8 differed. The advisor reviewed the actual
  images (768, 1440, changed-1440, and the others listed) and confirmed all
  four fixes.
- `--update-snapshots=changed` (run 2026-10-22T13-23-33-775Z): 9 passed, 8
  re-saved. The advisor confirmed all 8 saved files are byte-identical to
  the reviewed images. Committed as written (each opened first: only the
  spec's invented seed).
- `--repeat-each=3 --update-snapshots=none` (run 2026-10-22T13-23-58-170Z):
  25 passed. During it the server logged "DRIVER-GET failed" once
  (reference DRIVER-GET-500-MVJKOJXV), on the merge-candidates query
  (`src/app/api/drivers/route.ts`). The test passed. 3ao did not touch that
  route or MergePrompt's request. Likely a test-DB reset racing an
  in-flight request between tests; unverified, because the log omits the
  underlying Postgres error. A watch item, not investigated.
- Not shown by any baseline: Save's solid look on a valid, savable change.
  Alex checks it live after the deploy.

**Fix (2026-10-22): No phone and Add on one line.** Alex, on the live page
at `f8d31b1`, reported that "No phone" and "Add" do not sit on one line.

- **Cause.** `DriverPhone.tsx`'s phone line was `flex items-center`.
  Centring a `text-body` span beside a 28px `inline-flex` button with
  `font-cond text-micro uppercase` puts the two boxes' middles level, not
  their text, so ADD stood visibly higher. It showed in the table rows and
  in the "Drivers without a truck" panel (same component).
- **Fix** (`50efcbd`). With no number the line is `items-baseline`. Add's
  word, centred inside its unchanged `h-7` target, then stands on "No
  phone"'s baseline. With a number the line stays `items-center`, so the
  pencil (an icon, no text baseline) stays centred on the number, and
  "also N" is as before. Only `DriverPhone.tsx` changed; the panel needed
  nothing else.
- **Tests** 3,735 → 3,736: one `DriverPhone.test.tsx` test pins the
  classes (`items-baseline` without a number, `items-center` with one, the
  28px targets). happy-dom does not lay out, so the baselines themselves
  are not measured.
- **Baselines.** All 8 assignments PNGs will change (each has a "No phone"
  and Add); the others will not. No e2e run, no PNG touched.
- NOT pushed, NOT deployed; e2e verified 2026-10-22, ready to push.
- **e2e (Alex, 2026-10-22):**
  - `--update-snapshots=none` (run 2026-10-22T14-11-29-528Z): 8 differed,
    by about 550 pixels each (only the Add words). The advisor compared
    enlarged crops of the table row and the panel, before and after, and
    confirmed Add now stands on "No phone"'s baseline.
  - `--update-snapshots=changed` (run 2026-10-22T14-13-15-069Z): 9 passed,
    8 re-saved, byte-identical to the reviewed images (the advisor).
    Committed as written in `ca316f3` (each opened first: only the spec's
    invented seed).
  - `--repeat-each=3 --update-snapshots=none` (run
    2026-10-22T14-13-38-898Z): 25 passed, no server errors.

### Phase 3aq: unexpected route errors reach Sentry (2026-10-28)

From the advisor's brief, after the read-only health check of 2026-10-28.
**NOT pushed, NOT deployed.** No migration, UI, dependency, env var or
Sentry setting changed, and no route returns anything different. The reader
(`src/app/api/ratecon/*`, `src/server/ratecon-reader/*`) and the worker are
untouched.

**Why.**
- 16 of the 18 `src/app/api/**/route.ts` files handled an unexpected error
  the same way, each with its own copy: a reference `<PREFIX>-500-<base36
  time>`, a `console.error` with `error.message`, a 500 JSON with the
  reference.
- No production code called Sentry for these. The only `captureException`
  in `src/` was in a test, and `sentry.server.config.ts` has no console
  integration. Only uncaught errors reach Sentry (`onRequestError =
  Sentry.captureRequestError`, `src/instrumentation.ts`), and these were
  caught. So Sentry's 0 "DRIVER-GET failed" in 14 days said nothing.
  (DRIVER-GET-500 was seen once in a local e2e run, 2026-10-22, 3ao.)
- Vercel's runtime logs cannot be read from this machine (no CLI, no
  token). Sentry is the only error channel we can read.

**Commits.** Each passed `npm run check` in the pre-commit hook, on its own
content:
- `785b40e`: the reader's scrubber shared as `withoutText` (behaviour
  unchanged);
- `1c25538`: `unexpectedFailure` (`src/server/route-failure.ts`) and its
  tests;
- `6088e5d`: the 16 routes use it, plus the drivers route test, plus a
  corrected comment in `src/instrumentation.ts`;
- `4b89154`: the guard;
- `c6ab786`: the e2e spec;
- one docs commit: this section, design-spec §12.142, "What is live".

**What a route does now** (§12.142). After its 4xx cases it calls
`return unexpectedFailure(error, { prefix, log, message })`:
- The reference, console line and 500 JSON are the same as before, byte for
  byte. Each route passes its own prefix, label and message.
- One Sentry event goes too: the type and stack, never the message.
  - Sentry is handed a stand-in: an Error with the same name and stack
    frames, and its causes in the same form. The message is also cut out of
    the stack text. **Found by trying it** with the installed SDK: Sentry
    parses every line of the stack text, and a message line holding " at "
    became a frame. A Drizzle message's `params: Meet at dock …` arrived as
    a frame's file name. Dropping the value alone, as `scrubReaderEvent`
    does, would have sent it.
  - No own property is copied (`detail`, `where`, `query`, `parameters`).
  - Then `withoutText`, the reader's scrubber, shared, removes the value,
    message, `extra`, request data, and breadcrumb text and data. The
    route's own console line is one of those breadcrumbs.
  - Tags: `route_prefix`, `reference`, and `sqlstate` when a postgres.js
    error is the error or one of its causes. Drizzle 0.44 wraps every query
    error in `DrizzleQueryError`, whose message is `Failed query:
    <sql>\nparams: <values>`, with the PostgresError as `cause`. Only a
    five-character code is tagged.
  - `PostgresError` and `DrizzleQueryError` are named by class. In the e2e
    build postgres.js is bundled and minified (`class o extends
    Error{…this.name=this.constructor.name…}`), so its errors are named
    "o". Drizzle's never sets a name ("Error").
- 4xx answers report nothing. Sentry never holds or fails the response. A
  throw or a rejected flush is one console line, `route error not reported
  to Sentry { reference }`.

**Routes covered:** 16 files, 19 prefixes. PREVIEW, ASSIGN-GET,
ASSIGN-POST, BULK, DRIVER-GET, DRIVER-POST, FLEET, HEALTH, HISTORY, LOAD,
OVERRIDE, CLEAR, REOPEN-GET, REOPEN-POST, STOP, TIMELINE, TRAIL, LISTS,
TRUCK.

**Delivery on Vercel: the flush, and what is unverified.** From
`node_modules` only (Sentry v11.0.0):
- Every route handler in the build is wrapped:
  `.next-e2e/server/app/api/drivers/route.js` contains
  `wrapRouteHandlerWithSentry(…parameterizedRoute:"/api/drivers"…)`. The
  wrapper's `finally` runs `waitUntil(flushSafelyWithTimeout())`
  (`@sentry/nextjs` `build/cjs/common/wrapRouteHandlerWithSentry.js:70–72`;
  `captureRequestError.js:31` does the same).
- `waitUntil` calls `vercelWaitUntil` (`common/utils/responseEnd.js:16–22`).
  That returns at once unless `typeof EdgeRuntime === "string"`
  (`@sentry/core` `build/cjs/utils/vercelWaitUntil.js:6–8`). Our routes run
  on Node, so it registers nothing.
- On Node the transport starts sending at capture, and `flush(2000)` only
  waits for it. When `VERCEL` is set, the Node SDK also flushes for 200 ms on
  SIGTERM (`@sentry/node` `build/cjs/sdk/index.js:114–118`).
- The helper does what the SDK does on Node: it starts `Sentry.flush(2000)`
  and does not await it. A hang test and a mutation show the response does
  not wait.
- **Unverified:** whether Vercel keeps a Node function alive long enough to
  finish that send after the response. The same holds for every event the
  SDK sends from a route itself, `onRequestError` included. Next's own
  mechanism does reach the platform: `after()` takes `waitUntil` from
  `Symbol.for('@next/request-context')` on any runtime
  (`next/dist/server/after/builtin-request-context.js:24–29`,
  `base-server.js:1071–1077`). It is not used here (question 1).

**Tests**, 3,736 → 3,779 (204 → 207 files). All data is invented.
- `src/server/route-failure.test.ts` (13). A real Sentry client, configured
  as the server config, with an in-memory transport.
  - The sentinel is made at run time, so it never appears in the source
    lines Sentry attaches. It goes into the message, `detail`, `where`,
    `hint`, a bound value and a frame-shaped message line, and is absent
    from every envelope.
  - One event per error; types `PostgresError`, `DrizzleQueryError`; tags
    exact.
  - No SQLSTATE for a non-database error or a code that is not a SQLSTATE.
  - Sentry throwing, a flush that hangs, a flush that rejects.
- `src/app/api/drivers/route-failure.test.ts` (8). The real handler, with the
  database failing for real: the test cluster with a `search_path` naming no
  schema, so 42P01 comes back through Drizzle.
  - The same 500 and one event, tagged `DRIVER-GET` + reference + `42P01`.
    None of "Failed query", "params:" or "does not exist" is sent.
  - A body that is not JSON (the e2e's request): one `SyntaxError` event,
    and the quoted sentinel is absent.
  - 429, 401, 403, a `DriverError`, a bad body: answered as before, nothing
    reported.
  - With every flush hung, the 500 still answers.
- `src/test/route-failure-guard.test.ts` (22). 16 routes checked, the 2
  exclusions exist, plus 4 guard-on-the-guard cases.

**Mutations.** Each was applied alone, then reverted and checked with `cmp`
against the saved file:

| Mutation | Result |
|---|---|
| Message sent: the raw error captured, not the stand-in | 5 failed |
| Message sent: the scrubbing event processor removed | 6 failed |
| 4xx reported: the drivers route reports an AuthError, then answers 401 | 2 failed |
| Capture awaited before the response | 5 failed (helper tests). The route's hang test passed at first: the helper's own flush used up its one-shot hang. It now hangs every flush, and fails (1 failed). |
| The guard ignores a raw console line | 2 failed |
| The reference tag differs from the response's | 2 failed |

**e2e.** `npm run e2e -- route-failure-sentry sentry-traces`, run
2026-10-28T13-39-11-285Z: setup passed and sentry-traces passed.
**route-failure-sentry failed**, with 400 instead of 500.
- Cause: the body was passed to Playwright as a string. With a JSON content
  type, Playwright JSON-encodes a string that does not parse
  (`playwright-core` `lib/coreBundle.js:59335–59338`, v1.63). The route got a
  valid JSON string and refused it as a bad body, before any Sentry code
  ran.
- Not a hosted-auth stall, so not rerun: the brief allows one run.
- Fixed: the body is now a Buffer, sent as written. Checked against a
  loopback echo server: the string arrived JSON-encoded, the Buffer as
  typed. The drivers vitest case above is the same request through the real
  handler.
- **The fixed spec has not run.**
- **Second run, after Alex's yes (answer 6):** same command, run
  2026-10-28T13-52-21-651Z. **3 passed**: setup, route-failure-sentry,
  sentry-traces. It passed on its first try, so there was no rerun and no
  spec change. The machine stayed awake.
  - The server logged `DRIVER-POST failed` with reference
    `DRIVER-POST-500-MVS6C6OG`.
  - The sink got exactly one error event from DRIVER-POST. Its tags were
    exactly `route_prefix` and `reference` (the spec checks with `toEqual`,
    so the SDK added no tag of its own). Its type was `SyntaxError` and its
    value the placeholder.
  - Neither the sentinel nor "is not valid JSON" appeared anywhere the sink
    received.

**Item 6, report only.**

(a) **The reader's failures do not reach Sentry today.** "ratecon read
failed" and "ratecon outcome not recorded" are caught in `handle-read.ts`
and `handle-outcome.ts`. Each logs one line through `log.ts` (reference,
code, errorName, and vendorStatus for the read) and returns its own 500.
Nothing calls Sentry, and no console integration turns the line into an
event.
- Would the helper suit them? Not as it is. Its console line carries
  `error.message`, which the reader's frozen rule forbids. Its body shape
  (`{ error, reference }`) is not theirs (`{ ok: false, code: 'error',
  reference }`, reference `RATECON-500-…`).
- Its Sentry half would suit them. The stand-in plus `withoutText` sends
  type, stack and tags only, and `scrubReaderEvent` would then scrub the
  event a second time, harmlessly. A reader phase would export that half
  (say `reportUnexpected(error, prefix, reference)`) and call it beside
  `logReadFailure`/`logOutcomeFailure`.
- `scrubReaderEvent` alone has the frame gap above: an exception thrown in
  the reader route with a frame-shaped message line would send that line as
  a frame.

(b) **What an uncaught error carries today**, from the code and the SDK
source. The API routes no longer let any error escape, so this means pages,
server components and the login server action. `src/app/page.tsx`,
`history/page.tsx` and `assignments/page.tsx` load from the database on the
server.
- `captureRequestError` (`captureRequestError.js:7–32`) sets request headers
  and method as processing metadata, a `nextjs` context (request path,
  router kind, route path, route type) and the transaction name, then calls
  `captureException(error)` with mechanism unhandled.
- `beforeSend` is `scrubReaderEvent`, which leaves every non-reader event
  untouched, so **the exception value is the error's message.**
  - A PostgresError's message would reach Sentry.
  - A query through Drizzle would send `Failed query: <sql>\nparams: <bound
    values>` as the value, plus the PostgresError's message as a linked
    exception (linkedErrors is a default integration).
  - A frame-shaped line in either would also arrive as a frame.
  - Breadcrumbs carry that request's console lines, messages included.
- `detail`, `where`, `query` and `parameters` are not sent. No default
  integration serialises an Error's own properties (there is no
  ExtraErrorData). A probe on `@sentry/node`'s defaults confirmed `detail`
  and `where` absent from the envelope. The Next server adds Http,
  distDirRewriteFrames and the use-cache integration
  (`server/index.js:77–90`), and none of them reads those properties. That
  last part is from reading, not run.
- Headers: `dataCollection.httpHeaders: false` should keep them out of
  `normalizedRequest`. Unverified in this code path.

**Found wrong along the way:**
- `src/instrumentation.ts` said `onRequestError` made the routes'
  references findable in Sentry. The routes catch their errors, so it never
  saw them. Corrected in `6088e5d`.
- 3ao says the DRIVER-GET log "omits the underlying Postgres error". Half
  right: the console line has Drizzle's message (SQL and bound values), not
  the PostgresError's. Since 3aq the Sentry event has its type and SQLSTATE.
- In the brief, "if the error is a postgres.js PostgresError" would rarely
  match as written: through Drizzle the error is a `DrizzleQueryError`, with
  the PostgresError as its `cause`. The helper looks through causes.
- In the brief, the guard as worded (a raw `console.error` only) would pass
  a route that answered a 503 or logged with `console.warn`. The guard built
  here fails any console line and any 5xx.

**Questions for Alex:**
1. Delivery on Vercel is unverified (above). Accept the SDK's own footing,
   or a small later phase that hands the flush to Next's `after()`? A check
   that needs no code: after the deploy, the next real 500 should appear in
   Sentry with its reference tag.
2. Should the reader's two 500s report too (item 6a)? That needs a phase
   inside the frozen reader code.
3. Uncaught errors (pages, server components, the login action) send their
   message today, and through Drizzle that means SQL and bound values (item
   6b). Scrub every server event the same way? That is a change to
   `beforeSend` in `sentry.server.config.ts`.
4. A body that is not JSON gets a 500 from the routes that parse inside
   `try`, and since 3aq each one is a Sentry event. Our console never sends
   one, and the address limit caps a bot. Make it a 400? That changes what
   the routes return.
5. The console line still carries `error.message` into Vercel's logs, as
   before; for a Drizzle error that is SQL and bound values. Drop it, as the
   reader's line does?

**Alex's answers, 2026-10-28:**
1. Delivery: accept the SDK's own footing. No `after()` phase.
2. Reader 500s: no. The reader stays frozen.
3. Uncaught errors: **yes**, scrub every server error event the same way.
   This is the next phase, **3ar**. The advisor's finding (read-only,
   counts only): 5 of the 9 Sentry issues from 2026-10-14/15 (Page Server
   Component `/`) carry "Failed query" and bound parameters in the
   exception value.
4. Malformed JSON stays a 500 for now.
5. **Yes**, the console line drops the error message and keeps only the
   class name and SQLSTATE, like the reader's line. In 3ar, not now.
6. One e2e run of the fixed spec: yes. It passed (see "e2e" above).

### Phase 3ar: no server error event carries text; the console line drops the message (2026-10-28)

From the advisor's brief, after Alex's 3aq answers 3 and 5. **NOT pushed,
NOT deployed**, built on 3aq, which is not pushed either (origin's master is
`ad04eb9`; Alex: fine, build on top). No route returns anything different. No
migration, UI, dependency, env var or Sentry setting changed. The reader's
code and log lines, the worker and the browser are untouched.

**Why.**
- 3aq made a caught route error reach Sentry as type and stack only.
  Uncaught server errors still sent their message. The advisor's read-only
  count, 2026-10-28: 5 of the 9 Sentry issues from 2026-10-14/15 ("Page
  Server Component /") carry "Failed query" and "params:" in the exception
  value.
- `sentry.server.config.ts` scrubbed the reader route only, and
  `sentry.edge.config.ts` scrubbed nothing.
- The route console line wrote `error.message` (SQL and bound values) into
  Vercel's logs. Alex decided to drop it (3aq answer 5).

**The design changed before any code, agreed with Alex 2026-10-28.** The
brief asked for a stand-in handed to `onRequestError`. But Sentry's wrapper
around every page captures the RAW error first
(`@sentry/nextjs` `common/wrapServerComponentWithSentry.js:35`; present on
every page in the e2e build). That is exactly the leaking path. Probed on
the installed SDK:
- `beforeSend` can drop the value, but a message line holding " at " is a
  frame filename by then.
- A stand-in in `onRequestError` is a second event: Sentry dedupes by object
  identity (`@sentry/core` `client.js:149`).

So instead there is one early hook. Alex's conditions:
1. Rebuild the whole list, causes included, the same in either order with
   linkedErrors, tested both ways.
2. Error events only; with no Error, the backstop strips the text.
3. A real-client test of a page-style error.

**What was built** (§12.143):
- `src/lib/sentry-server-errors.ts` (new, no Node import, the only copy):
  `typeAndStack` (moved from `route-failure.ts`), `errorType`, `sqlstateOf`,
  `rebuildException`, `textlessErrors()`, `scrubServerEvent`.
  - `textlessErrors` registers a `preprocessEvent` listener in
    `afterAllSetup`, so it runs after linkedErrors wherever it sits, and
    before `processEvent` (source context, the frame rewrite for source
    maps). It replaces the whole `exception.values` from `typeAndStack(hint.
    originalException)`, with linkedErrors' ordering and mechanism fields,
    and frames parsed as Sentry parses them (`stackParser(stack, 1)`,
    `utils/eventbuilder.js:8–9`). It never swaps `hint.originalException`:
    span attribution (`utils/errorSpanAttribution.js:19`) and Next's
    control-flow filter read it later.
  - PostgresError and DrizzleQueryError are recognised by shape, not
    `instanceof`. The e2e build bundles postgres.js once per layer (the
    routes use chunk 5800, the pages chunk 6668), and minifies its class to
    `o`.
- `sentry.server.config.ts`, `sentry.edge.config.ts`: `beforeSend:
  scrubServerEvent` (reader events exactly as `scrubReaderEvent` leaves
  them; others through `withoutText`), and
  `Sentry.addIntegration(textlessErrors())` after `init`. Added after init
  so the `integrations:` line the reader test pins is unchanged;
  `addIntegration` runs `afterAllSetup` (`client.js:328–336`).
- `src/instrumentation.ts`: `onRequestError` stays
  `Sentry.captureRequestError` with the raw error, on purpose. Next hands it
  the same object the page wrapper captured
  (`next/dist/server/app-render/create-error-handler.js`, `getProperError`),
  so it dedupes. Comment only.
- `src/server/route-failure.ts`: uses the shared stand-in. The console line
  is now `{ reference, errorName, sqlstate? }`. The "not reported" line is
  unchanged.
- The placeholder for all non-reader events is now `[removed: a server error
  never reports its text]`; 3aq's route text is gone.
- `src/lib/sentry-reader.ts`: `isReaderEvent` exported.
  `src/lib/sentry-reader.test.ts`: the wiring regex now expects
  `scrubServerEvent` (one line). Its behaviour tests are unchanged, and a new
  test shows reader events come out identical.

**Commits.** Each passed `npm run check` in the pre-commit hook, on its own
content:
- `37da6a3`: the shared module, the hook, the backstop in both configs, and
  their tests;
- `6355375`: the console line drops the message;
- `30df300`: e2e, a page's uncaught error;
- one docs commit: this section, design-spec §12.143 (plus a pointer at the
  top of §12.142), "What is live".

**Tests**, 3,779 → 3,795 (207 → 209 files):
- `src/lib/sentry-server-errors.test.ts` (14):
  - The real `wrapServerComponentWithSentry` throws a Drizzle error (bound
    value "Meet at dock <sentinel>", a cause with a frame-shaped line and a
    minified class), then the real `onRequestError` gets the same error. One
    event, no sentinel, types `PostgresError`/`DrizzleQueryError`, real
    frames with line numbers, no frame from the message.
  - A direct capture with `extra` and a breadcrumb, and a captured message:
    no text.
  - A transaction untouched by the hook. The backstop on route, edge, page
    and reader events. The names, and the stand-in.
  - Both configs' wiring, with no `beforeSendTransaction`/`beforeSendSpan`.
  - One implementation: no other file cuts a message out of a stack.
- `src/lib/sentry-linked-errors-order.test.ts` (1): the integration first
  and last in the list, on two real clients: identical lists, no sentinel.
- `src/server/route-failure.test.ts` (+1, and the console assertions
  rewritten): the console line exact for a Drizzle error, a thrown string
  and a minified postgres.js error, and the sentinel in no console call.
- `src/app/api/drivers/route-failure.test.ts` (rewritten console
  assertions): the real database failure logs `{ reference, errorName:
  'DrizzleQueryError', sqlstate: '42P01' }`, and the non-JSON body logs `{
  reference, errorName: 'SyntaxError' }`.

**Mutations.** Each was applied alone, then reverted and checked with `cmp`:

| Mutation | Result |
|---|---|
| Integration removed from the server config | 1 failed (wiring) |
| Integration removed from the client (its behaviour) | 2 failed (the page path, a direct capture) |
| The brief's design: a stand-in handed to `captureRequestError` | 1 failed: **2 events instead of 1** |
| `beforeSend` removed on edge | 1 failed |
| `beforeSend` applied to transactions (`beforeSendTransaction` added) | 1 failed |
| Integration applied to transactions (type guard removed) | 1 failed |
| The message back on the console line | 8 failed |
| A second copy of the stand-in (in `route-failure.ts`) | 1 failed |
| Hooked at setup, in list order, instead of `afterAllSetup` | 1 failed (the order test) |
| Only the error's own value rebuilt, causes left as linkedErrors made them | 2 failed |

**e2e.** `npm run e2e -- route-failure-sentry sentry-traces`, run
2026-10-28T14-18-29-267Z: **4 passed on the first run** (setup, the route
test, the new page test, sentry-traces). No rerun. The machine stayed awake.
- The new test needs no switch in the app. For the test only, `truck_lists`
  in the e2e database becomes a view over a function that raises (SQLSTATE
  P0001) with a sentinel twice, once on a frame-shaped line. `/history`
  reads it through Drizzle. It is restored in `finally`, and it was
  restored: afterwards `truck_lists` is a plain table, with no view or
  function left. The SQL was rehearsed first in a rolled-back transaction.
- The sink got exactly one server error event: types `PostgresError`,
  `DrizzleQueryError` (named by shape in the minified build), values the
  placeholder. The sentinel and `evil.js` were nowhere in anything the sink
  received, browser events included.
- The server logged `DRIVER-POST failed { reference: 'DRIVER-POST-500-…',
  errorName: 'SyntaxError' }`.
- **Next's own log is not clean:** for the page error the server printed `⨯
  Error: Failed query: …` with the cause's fields and the raised message
  (question 1).

**Report only: the worker** (`src/worker/*`, from the code).
- **Yes, a worker event carries a Drizzle message with bound values.**
  `captureWorkerError` calls `Sentry.captureException(cause)` with the raw
  error (`src/worker/sentry.ts:139`). The worker queries through Drizzle
  (`createDirectDb`, `src/worker/index.ts:139`), so a failed query's value is
  `Failed query: <sql>\nparams: <values>`, and linkedErrors adds the
  PostgresError's message. Frame-shaped lines become frames.
- Its `init` has `dataCollection` but no `beforeSend` and no rebuild.
- `captureWorkerError` also does `scope.setContext('fields', fields)`, and
  callers pass `error: message` (`index.ts:182`, `:237`, `:308`). So the
  message is also in `contexts.fields.error`, which `withoutText` does not
  touch.
- The logger's JSON line goes to `console.error`, and so into a console
  breadcrumb.
- A fix would touch `src/worker/sentry.ts`: add `scrubServerEvent` and
  `textlessErrors` (the module has no Node import, so it can be shared), and
  stop putting `error: message` into the `fields` context, or scrub
  `contexts`. Possibly the logger's callers too. It is a separate Sentry
  project and a separate deploy to the droplet.

**Report only: the browser** (`src/instrumentation-client.ts`, from the
code).
- **It can carry such data:** its `init` has `dataCollection` but no
  `beforeSend` and no rebuild. An uncaught browser error's message, its
  frame-shaped lines, console breadcrumbs, and click breadcrumbs (element
  selectors and some attributes) go as the SDK builds them.
- In today's code, nothing found puts data there:
  - The one client `Error` built from a template holds a status code
    (`MergePrompt.tsx:39`).
  - The four client `console.error` calls log a cause's message, and
    `DriverPhone.tsx:141` leaves the number out on purpose.
  - Sixteen client files call `.json()`, whose parse error quotes about ten
    characters of a non-JSON body (a proxy's error page, not our data).
- Unverified: third-party errors in the browser (pdf.js, OCR, maps) and
  whether any quotes document text; whether any click target's attributes
  carry a name.
- A fix would need a browser-aware cut: the `^\s+at ` frame filter is V8's,
  and would drop every frame from Firefox and Safari stacks.

**Found wrong in the brief:**
- "Expected: 3aq pushed, HEAD 41b10ab = origin/master": origin's master is
  `ad04eb9`. Alex: build on top.
- Item 1 (a stand-in in `onRequestError`) and the mutation "raw error to
  `captureRequestError`" assumed `onRequestError` is where uncaught errors
  are captured. The page wrapper captures first. Replaced as agreed; the
  brief's design, run as a mutation, gave 2 events.
- "Its tests must pass unchanged" for the reader: one reader test pins the
  config's `beforeSend: scrubReaderEvent`, so it cannot stay unchanged when
  `beforeSend` changes. One line changed; the behaviour tests did not.
- "Every ERROR event (not transactions/spans) passes through
  `withoutText`": `beforeSend` only ever sees error events. The hook that
  does see transactions is `preprocessEvent`, so that is where the guard and
  its mutation are.
- "Share `typeAndStack`" carried 3aq's `instanceof` naming. That cannot work
  on edge (no postgres.js import) or across bundle layers, so the names are
  by shape.

**Questions for Alex:**
1. Next prints an uncaught render error in full to the server log (Vercel's
   logs): SQL, bound values, the PostgresError's fields. Our line is clean;
   Next's is not. Look into it in a later phase, or accept it?
2. The worker leaks the same way (above). A worker phase, with its own
   deploy?
3. The browser: add a scrub now (it needs a browser-aware stack cut), or
   leave it, since nothing found carries data today?
4. Push 3aq and 3ar together, when you are ready? Nothing is pushed.

### Phase 3as: the worker sends no error text to Sentry (2026-10-28)

From the advisor's brief, after 3ar's worker report. **NOT pushed, worker
NOT deployed**: the deploy is a separate step, after Alex's yes. Built on
3ar (origin's master `86084fd` at the start). No change to the app, the
browser or the reader; no change to sampling, the DSN, env vars,
`dataCollection`, the crash handlers in `index.ts`, the journald line,
migrations or dependencies. No e2e (the worker has no browser path).

**Why.**
- `captureWorkerError` captured the raw cause (`src/worker/sentry.ts:139`).
  For a failed Drizzle query that sends the SQL and its bound values as the
  value, and the PostgresError's message through linkedErrors.
- It also set `contexts.fields` to the logger's fields, which hold the
  message again (`error: message` at `index.ts:182`, `:237`, `:250`, `:264`,
  `:308`, `:352`). 3ar's `withoutText` does not touch `contexts`.
- Warnings and info became breadcrumbs carrying their fields, and the
  console integration turned every JSON log line into a breadcrumb.
- **Found while building:** outgoing requests also became breadcrumbs with
  their query string (`@sentry/node` `utils/outgoingFetchRequest.js:144–154`,
  with `urlQueryParams` on). The HERE routing URL carries the trip's origin
  and destination coordinates (`src/server/routing/provider.ts:172–178`).
  Its `apiKey` was already sent as `[Filtered]`: the name contains "key",
  which is on Sentry's own list (`@sentry/core`
  `utils/data-collection/filtering-snippets.js:4–24`).

**What was built** (§12.144):
- `src/lib/sentry-server-errors.ts`, extended, not copied:
  - `workerFields`: a value leaves only as a number, a boolean, null, a UUID,
    an ISO-8601 date or timestamp, a SQLSTATE under `sqlstate`/`code`, or a
    truck number under `truck`/`truckNumber`/`truck_number`. Anything else
    becomes the placeholder.
  - `scrubWorkerEvent`: `withoutText`, then three things put back safely —
    the logger's literal message, the `fields` context through
    `workerFields`, and the worker's own breadcrumbs (literal message, data
    through `workerFields`). Every other breadcrumb keeps its category and
    time only.
  - `WORKER_BREADCRUMB`: the category, shared with `src/worker/sentry.ts`.
- `src/worker/sentry.ts`: `textlessErrors()` added to its integrations;
  `beforeSend: scrubWorkerEvent`; a `sqlstate` tag from the cause (what is
  left of a database error once its message is gone).
- The fingerprint `['worker', message]` is unchanged, and so is the journald
  line.

**Commits.** Each passed `npm run check` in the pre-commit hook, on its own
content:
- `dd16f35`: the literal-message guard;
- `bc0b1de`: the worker scrub and its real-client tests;
- one docs commit: this section, design-spec §12.144, "What is live".

**Tests**, 3,795 → 3,824 (209 → 211 files):
- `src/worker/sentry-scrub.test.ts` (17). The real `initWorkerSentry`, the
  real logger and @sentry/node's own HTTP transport, posting to a loopback
  ingest in the test. No option was added to the worker for it.
  - A Drizzle error is logged as `logger.error('routing sweep failed', {
    cause, error: message, truckNumber: 128, stopId })`, with a sentinel in
    a bound value ("Meet at dock …"), in the cause's message (a frame-shaped
    line), and in `detail`. Result: one event, the sentinel nowhere, types
    `PostgresError`/`DrizzleQueryError` and real frames, `fields` `{ error:
    <placeholder>, truckNumber: 128, stopId }`, the fingerprint, tags
    `service: worker` and `sqlstate: 23505`.
  - A real `fetch` first, so its breadcrumb is there without the
    coordinates. The console breadcrumbs are there, without text.
  - A warning with the sentinel in string fields, then an error: the
    warning's breadcrumb keeps its literal message and safe fields only, and
    the error event (a message event, no cause) keeps `prune failed`.
  - The field shapes, one by one, including a ZIP-like value under a non-truck
    key (removed).
- `src/worker/logger-literal-guard.test.ts` (12). 51 calls found, all
  literal, in `index.ts`, the four sweeps, the singleton, ingest and the
  Samsara client. Ten guard-on-the-guard cases.
  - **Found by checking the count:** the first version keyed on the word
    `Logger` found 40 calls. The sweeps take narrowed loggers
    (`SweepLogger`, `WarnLogger`), so the guard now matches any `…Logger`
    type and every file in `src/worker` and `src/samsara`.

**Mutations.** Each was applied alone, then reverted and checked with `cmp`:

| Mutation | Result |
|---|---|
| `textlessErrors` not added | 1 failed |
| `beforeSend` removed | 2 failed |
| Any string field kept | 4 failed |
| The worker's breadcrumb data kept unfiltered | 1 failed |
| The guard accepts a template literal | 4 failed |
| A second copy of the stand-in, in `src/worker/sentry.ts` | 1 failed (3ar's one-implementation test) |
| The guard keyed on `Logger` alone (the first version) | 1 failed |

**What a 3am reader loses in Sentry**, and where it still is:
- **The error's text.** The SQL, the bound values, Postgres's own sentence
  ("duplicate key…", "relation … does not exist") and any JavaScript error's
  message.
  - Kept: the type chain (`DrizzleQueryError` → `PostgresError`), the stack
    frames (file and line), the `sqlstate` tag (23505 is a duplicate, 42P01
    a missing relation, 57014 a timeout) and the logger's message (what
    failed).
- **Every free-text field.** `error` (the message again), `reason` (the lock
  lost), `signal`, `cursor`, a string `orgId`, rule and source names
  (`from`, `arrivedSource`), and any object or array (the feed-health
  `detail`, `capped`).
  - Kept: counts, durations, flags, truck and stop ids, timestamps, dates
    and truck numbers.
- **The text of every console line, and every outgoing request's URL,
  method and status.** These breadcrumbs stay as a category and a time, so
  the trail still shows that a request or a log line happened. The worker's
  own warn and info breadcrumbs stay with their literal message and safe
  fields, which is the readable trail.
- **The full text is still on the droplet:** the journald line is unchanged.
  For startup and roster failures it is also in `feed_health.last_error`
  (`src/worker/ingest.ts:449`, up to 1,000 characters), which the worker
  writes and nothing in the app reads.

**For the deploy step: what the worker runs that changed since its last
deploy.** The worker runs `tsx src/worker/index.ts`
(`deploy/vin-fleet-worker.service:24`). Its runtime import graph from there
is 37 files (type-only imports left out); computed from the sources, with
`git log` since 2026-10-15 00:00 UTC.
- **The deployed commit is not recorded.** The worker went live on
  2026-10-15 at 23:35 UTC (3ad; advisor's check, unverified here). The
  two 3ad commits touching it (`5341943`, `2db9c3c`, both at 17:50 UTC:
  `src/db/schema.ts`, `src/worker/index.ts`, `eta-marks.ts`,
  `status-changes.ts`) came before that, so they are taken as deployed.
- **Changed since:**
  - `src/worker/sentry.ts`: `bc0b1de` (3as).
  - `src/lib/sentry-server-errors.ts`: `37da6a3` (3ar), `bc0b1de` (3as). New
    to the worker: it imports this only since 3as.
  - `src/lib/sentry-reader.ts`: `785b40e` (3aq), `37da6a3` (3ar). New to the
    worker the same way, through `sentry-server-errors.ts`. It imports only
    types from `@sentry/core`, so it adds no package at run time.
  - Every other file the worker runs is unchanged since 2026-10-15.
- **Dependencies:** the droplet deploys with `git checkout --detach <sha>`
  and `npm ci --omit=dev` (`deploy/README.md:119–120`).
  - Since 2026-10-15, 3aj (`d9ea9d0`) added `tesseract.js` 7.0.0 and
    `@tesseract.js-data/eng` 1.0.0 as production dependencies (and
    `@napi-rs/canvas`, dev only, skipped).
  - The worker never imports them, but `npm ci --omit=dev` will install them
    on the 961 MiB droplet. The README already calls that memory tight.
- Checked locally: `src/worker/sentry.ts` and the logger load under tsx with
  no DSN (`initWorkerSentry` returns false, as before).

**Found wrong in the brief:**
- "Expected HEAD 86084fd = origin/master" was right this time. "What is
  live" still said 3aq/3ar were not pushed; corrected by an added line.
- "Every `logger.error(` call in src/worker" was too narrow. The message also
  leaves through the worker's breadcrumbs (`warn`, `info`), and through calls
  under other names: the Samsara client's `this.log` and the sweeps'
  narrowed loggers. The guard covers all 51.
- The brief's list of what leaks did not include outgoing requests'
  breadcrumbs, whose query string carried trip coordinates (the key itself
  was already filtered by Sentry).
- "Fingerprint unchanged" holds for events with a cause. An event without a
  cause never had a fingerprint; it groups by its literal message, as
  before.
- Pre-existing, not changed: `flushWorkerSentry` has a silent `catch { }`
  (`src/worker/sentry.ts`), against "no silent catches" (question 3).

**Questions for Alex:**
1. Deploy the worker at `bc0b1de` or later? It also installs 3aj's
   tesseract packages on the droplet (above), which the worker never loads.
2. Outgoing-request breadcrumbs now say only that a request happened. Keep
   them like that, or drop them from the worker altogether?
3. `flushWorkerSentry`'s silent catch: give it one console line in a later
   phase?
4. `feed_health.last_error` stores up to 1,000 characters of a startup or
   roster failure's message (possibly SQL and bound values) in the hosted
   database, read by nothing. Leave it, or store only the type and
   SQLSTATE?

#### 3as, step 2: the silent catch fixed, pushed, the worker deployed (2026-10-28)

Alex authorised, for this step only, one `git push` and one worker deploy.
Questions 1 and 3 above are answered by it; 2 and 4 stay open.

**Code** (`17865af`). `flushWorkerSentry`'s silent `catch {}` now writes
one journald line, `sentry flush failed { errorName }`: the error's type,
never its text. It still never blocks the exit.
`src/worker/sentry-flush.test.ts` (1): a rejecting flush resolves, the line
holds the type, and the sentinel is in no console call. It fails with the
message put back on the line, and with the catch silent. `npm run check`:
212 files / 3,825 tests. Forbidden-files grep: nothing.

**Pre-flight on the droplet** (read-only, one ssh call):
- **ROLLBACK_SHA** `918af63c9dd93a16c311b7103f2402bb27734857`, a docs commit
  of 2026-10-15 23:04 UTC. It includes 3ad, which settles the deployed
  commit that 3as could not find recorded.
- Worker `active`.
- Disk on `/`, which holds `/opt`: 24G, 4.9G used, 19G free (21%).
- Memory: 961 MB total, 552 available; swap 1,023 MB, 76 MB used. The stop
  rule (no swap and under 600 MB available) did not apply.

**Push:** `86084fd..17865af`; local master equal to origin afterwards.

**Deploy** (`scripts/deploy.sh`, HEAD `17865af`), first run, exit 0. No
rerun and no rollback were needed.
- Gate 1, `npm run check`: 212 files / 3,825 tests passed.
- Gate 2, `npm run preflight`: passed (6 ok, 1 note: "prepared statements
  stall under concurrency, as expected"). The singleton lock was refused to
  the preflight while the old worker held it.
- Gate 3, `npm run db:verify`: "OK — schema, RLS and grants are as
  specified" (anon/authenticated grants 0, feed_health singleton 1).
- Gate 4, `npm run e2e`: **260 passed** in 19.1 min (run
  2026-10-28T14-54-04-253Z); the machine stayed awake.
- Stopped (`inactive`), then checked out `17865af`. `npm ci --omit=dev`
  added 185 packages in 56 s.
  - npm reported 6 vulnerabilities (5 high, 1 critical), not examined here.
  - It also warned that `tesseract.js` and `esbuild` have install scripts
    "not yet covered by allowScripts". The worker runs regardless: tsx ran in
    the verify.
- `SENTRY_RELEASE` was set by the script's own sed. Started: `active`.

**Verify** (the script's own output):
- running commit `17865afc85d8eb901a8731d91dc76b8ba2c6ffa4`, restarts since
  start 0;
- the singleton guard refused a second instance ("another worker is already
  running — this one will not start"; the holder connected since 15:14:21
  UTC);
- most recent poll at 15:14:24 UTC: `poll: ingested`, vehicles 8, readings
  91, inserted 91, route calls this month 978 of 5,000.

**Feed check** (hosted DB, read-only: the session's first statement `set
session characteristics as transaction read only;`, then
`transaction_read_only` printed `on`). At 15:16:53 UTC, 2.5 min after the
start: **0.5 min since the last poll, 0.5 min since the newest position**.
OK.

**Not checked here:** Vercel's deploy of the pushed app commits; whether
the deployed worker's next real error reaches the worker's Sentry project
in its new shape (no error has happened, and none was provoked).

**Questions 2 and 4 answered** (Alex, via the advisor, 2026-10-28; recorded
in 3at):
- 2: the worker's request breadcrumbs stay as they are, a category and a
  time.
- 4: `feed_health.last_error` stays as it is. It is our own database, not a
  third party.

### Phase 3at: dependency security patches, non-major only (2026-10-28)

From the advisor's brief, after `npm audit --omit=dev` of 2026-10-28 found 6
vulnerabilities (5 high, 1 critical). Built on `feb7968`, 1 ahead of
origin's `17865af`. Alex authorised one `git push` for this phase only, if
every gate passed. No worker deploy. No change to code, env, migrations or
Sentry. drizzle-orm and zod stay on their majors.

**Changed.** `package.json` has one line changed, and the lockfile changed
38 package versions. Nothing was added or removed.
- `next`: `^15.5.0` → `^15.5.28`, installed 15.5.25 → 15.5.28. That is the
  newest 15.5.x (npm's `backport` tag). With it, `@next/env` and the eight
  `@next/swc-*` binaries went to 15.5.28.
- `sharp` 0.35.4 → 0.35.5. It is next's optional dependency, whose range is
  now `^0.34.3 || ^0.35.5`. Its 16 `@img/sharp-*` packages went to 0.35.5
  and the 10 `@img/sharp-libvips-*` to 1.3.4.
- `source-map-js` 1.2.1 → 1.2.2 (`npm update source-map-js`).
- Made with explicit installs, not `npm audit fix`. Its dry run would also
  have bumped three dev-only packages the brief did not name: `happy-dom`
  20.14.5 → 20.14.6, `drizzle-kit` 0.31.10 → 0.31.11 and
  `postcss-selector-parser` 6.1.4 → 6.1.5.

**`npm audit --omit=dev` afterwards:** 4 vulnerabilities (1 moderate, 3
high, 0 critical).
- Gone:
  - next's own four: GHSA-2464-fhr4-w9xw (critical), GHSA-p3m5-59mp-jv5r,
    GHSA-4jqv-mc3x-m676 and GHSA-mcj8-r9mp-w47p.
  - sharp: GHSA-wq5f-xc86-pv6w.
  - source-map-js: GHSA-68fv-2mgg-jv7q.
- Left: postcss (high) and next (moderate), which are one finding.
  - The flagged postcss is the copy inside next,
    `node_modules/next/node_modules/postcss` 8.4.31. next 15.5.28 pins it
    exactly (`"postcss": "8.4.31"`), so no 15.5 release fixes it. npm's only
    fix is next 16.4.3, a major. next's own "moderate" is that same postcss,
    inherited.
  - Our own postcss (dev, for Tailwind) is 8.5.28, above the affected range
    (≤ 8.5.22).
  - Only next's build code loads the pinned copy: the webpack CSS block, the
    resolve-url loader, next-font's loader and the CSS minimizer, all under
    `next/dist/build/webpack/`, plus the compiled AMP optimizer, which we do
    not use. It processes our own CSS at build time.
  - An `overrides` entry would replace a version that next pins exactly.
    Not done; question 1.
- Left: drizzle-orm (high) and zod (high). Their fixes are majors. Report
  below.

**drizzle-orm < 0.45.2 (GHSA-gpj5-g38j-94v9, SQL identifiers escaped
wrongly): report only.**
- `sql.identifier` is not used in `src`, `scripts` or `e2e`.
- `sql.raw` outside tests: every argument is a module constant or a column
  expression written in the same file. No caller passes input.
  - The `ISO` format constant: `src/server/override.ts:77` (constant at
    `:34`), `src/server/appointment.ts:142`, `:143` and `:231` (constant at
    `:57`).
  - `iso(column)`, `src/server/load-read.ts:26`, called with literal columns
    only (`:50`–`:67`).
  - `FINISHED`, `src/server/timeline.ts:110` (constant at `:87`).
  - `epochMs(column)`, `src/worker/eta-marks.ts:44`, with literal columns at
    `:129`, `:134`, `:137`, `:317`, `:319` and `:358`.
  - Statement timeouts from constants: `src/worker/eta-marks.ts:114`,
    `:313`, and `src/worker/status-changes.ts:88`.
  - `STATUS_IN`, `src/db/schema.ts:809`.
  - `scripts/test-db-migrate.mts:17` runs a SQL file from the repo.
- postgres.js `.unsafe(` appears only in scripts, the fixtures and e2e, with
  constants. `e2e/fixtures.ts:70` builds a table list from the catalog's
  names, filtered by `/^[a-z_][a-z0-9_]*$/` and quoted.
- Table and column names always come from the schema objects. Every
  `orderBy` takes a schema column, for example
  `src/server/assignments.ts:87`. No `.as(` takes a non-literal.
- **No SQL identifier is built from input.**
- Unverified: the advisory's exact affected API. Only npm's title was read.

**zod < 4.6.6 (GHSA-mrhx-c7xc-m3w5, memory on oversized constrained
collections): report only.**
- **How zod 3 behaves.** In 3.25.76, `ZodArray` records a `.max` as an
  issue and then still parses every element
  (`node_modules/zod/v3/types.js:1788`–`1811`). A `.max` caps what is
  accepted, not the work done.
- No `z.record`, `z.set` or `z.map` anywhere.
- **Request bodies.** Every array in a body schema has a `.max`. Every route
  checks the role before reading the body: 13 `request.json()` sites, each
  after `requireRole` or `requireUser`. The exception is
  `src/app/api/drivers/route.ts:93`, which parses first (rate-limited by
  address), but its schema has no array.
  - The capped arrays: `src/lib/override.ts:147` and `:163` (40),
    `src/lib/truck-lists.ts:172` (200), `src/lib/assignments.ts:23` (500),
    `src/lib/load-edit.ts:77` (20) and `:84`–`85` (10), and
    `src/lib/stop-edit.ts:261` (20).
  - The reader's two bodies are capped in bytes before parsing, by
    `bodyWithin` (`src/server/ratecon-reader/handle-read.ts:98`):
    - 64 KiB, `READ_BODY_LIMIT_BYTES` (`src/lib/ratecon/read-codes.ts:16`);
    - 4 KiB, `OUTCOME_BODY_LIMIT_BYTES`
      (`src/lib/ratecon/outcome-codes.ts:21`).

    Both use `zod/v4`, the copy shipped inside zod 3.25.76.
  - The other bodies have no byte cap of ours. The bound is the platform's
    request-body limit (Vercel's documented 4.5 MB, not checked here).
  - So a signed-in user can send a very long array and make one function
    instance build an issue per element. A signed-out user cannot reach
    this.
- **Arrays from the network with no `.max`.** All are vendor responses:
  - Samsara: `src/samsara/schemas.ts:50` (`gps`) and `:92` (`data`);
  - HERE: `src/server/routing/provider.ts:98`, `:101` and `:121`;
  - Census: `src/server/geocode.ts:274`.

  The model's answer, `src/lib/ratecon/model-read.ts:85`, has `.max(20)`.
- Every other `z.array` parses rows from our own database.

**What the two majors would touch:**
- drizzle-orm 0.44 → 0.45: 91 files import it, 42 of them tests or e2e.
  19 are under `src/worker`, so this bump also means a worker deploy.
- zod 3 → 4: 45 files, none of them tests. 4 are under `src/worker`.
  - 39 files import `zod` and 6 already import `zod/v4`.
  - `@anthropic-ai/sdk` 0.133.0 accepts `^3.25.0 || ^4.0.0`.

**Worker reach.** None of the updated packages is loaded by the worker.
- Method: esbuild bundled `src/worker/index.ts` in memory (nothing written
  to the repo) and its metafile was read.
- The graph has 37 of our files, the same count as 3as. Its packages are
  `@opentelemetry/api`, six `@sentry/*`, `dotenv`, `drizzle-orm`,
  `postgres` and `zod`.
- No next, `@next/*`, sharp, `@img/*`, postcss or source-map-js.
- The droplet's next `npm ci --omit=dev` will install the new next and
  sharp, because they are production dependencies, but the worker never
  loads them.
- Limit: esbuild follows static imports and literal dynamic imports only.

**Gates:**
- `npm run check`: 212 files / 3,825 tests passed; typecheck and lint clean.
- Forbidden-files grep
  (`\.pdf|expected\.json|samples|eta-data|taste-skill`): printed nothing.
- `npm run build`: passed, `▲ Next.js 15.5.28`.
- `npm run e2e` (full, once): **260 passed** in 19.2 min, run
  2026-10-28T15-40-52-391Z, `.last-run.json` "passed". No stall, no rerun,
  no baseline image differed. The machine stayed awake.

**Commits:** `408b2df` (the dependencies) and `e815dc5` (this section).
Each passed `npm run check` in the pre-commit hook (212 / 3,825).

**Push:** `17865af..e815dc5` at 16:01:51 UTC. It carried `feb7968`, 3as's
deploy note, as well. Local master equalled origin afterwards.

**Vercel deploy** (GitHub deployments API, filtered by the full sha):
deployment `7390624178`, environment Production, sha `e815dc5…`, state
**success** at 16:04:53 UTC, 3 min after the push. The record appeared on
the fourth poll. The live site was not opened. This note is a later docs
commit and is not pushed.

**Found wrong in the brief:**
- "postcss … non-major fixes": true for our own postcss, which is already
  fixed at 8.5.28. Not true for the flagged copy, which next pins, so its
  only fix is next 16.
- "fixed after 15.5.27" is consistent with what was seen: at 15.5.28, npm's
  data lists none of next's own four advisories. 15.5.26 and 15.5.27 were
  not tried.

**Questions for Alex:**
1. The postcss inside next: leave it until next 16, or add an `overrides`
   entry for next's copy at 8.5.32? An override goes against next's exact
   pin and would need its own build and e2e. Recommended: leave it. It
   runs only at build time, on our own CSS.
2. zod: the exposure is signed-in only. A smaller fix than zod 4 would be
   a byte cap on the 13 `request.json()` handlers (10 route files) through
   the reader's existing `bodyWithin`. That is one shared layer, and it would also help after
   zod 4. Make it a phase?
3. drizzle 0.45 and zod 4: their own phases later? drizzle is not exposed,
   since no identifier comes from input. It needs a worker deploy.

### Phase 3ap: live status and position in "Currently" on /assignments (2026-10-28)

From the advisor's brief. This is part 2 of Alex's Claude Design (part 1 is
3ao). **NOT pushed, NOT deployed.** Built on `ebcb8d3`. No change to the
console, the status engine, the fleet query, the worker, Sentry,
dependencies, env or migrations. The save request, the search, the tabs,
the panels and the phone editor are unchanged. Rules: design-spec §12.145.

**Commits** (each passed `npm run check` in the pre-commit hook, on its own
content):
- `677a09c`: the column, the page's fleet, the tests;
- `5f8c4cf`: the baseline seed;
- one docs commit: this section and §12.145.

**What was built.**
- `src/components/assignments/Currently.tsx`, new:
  - `consoleChip` gives the console row's chip props: a stale feed means
    Stale GPS with its age and no "forced"; a truck's own Stale GPS shows
    its age; an upcoming load shows its day.
  - `Currently` draws `StatusChip` with those props, then the position.
    - No driver: "—". No open load: the position only.
    - No row in the poll: nothing.
- `AssignmentBoard.tsx`:
  - a required `initialFleet` prop, and `useFleet(initialFleet)`, the
    console's hook and its 20s;
  - whichever is newer of the polled fleet and the page's own;
  - a map by truck id;
  - the fifth column in `COLUMNS`, from 840px;
  - the header "Currently".
- `src/app/assignments/page.tsx`: `loadFleet()` beside
  `loadAssignmentBoard`. Its viewer comment said §12.14 ("never hidden"),
  which §12.141 replaced on this page; it is corrected.

**`cityState` is the POSITION's** (the brief asked):
- `toFleetRow` sets `cityState: cityState(raw.formatted_location)`
  (`src/server/fleet-query.ts:451`). `formatted_location` is the truck's
  latest fix, Samsara's `gps.reverseGeo.formattedLocation`.
- `cityState()` (`src/samsara/schemas.ts:142`) detects and drops the zip,
  then keeps the last two parts. It returns the whole string when it cannot.
- The console's row uses it (`TruckRow.tsx:471`) with `formattedLocation` on
  hover (`:673`). The phone sheet prefers the whole string (`TruckSheet.tsx:156`).
- So the design's "City, ST" already exists as a position field. The cell
  uses it as the row does: "Last seen …" when stale, and the whole string
  in its title. No parsing, geocoding or new field.

**The width budget** (the full comment is on `COLUMNS`).
- The columns from 840px:
  `64px minmax(240px,360px) 64px minmax(220px,260px) minmax(120px,1fr)`.
- Why each minimum:
  - The picker's 240 holds an empty row's 104px field, an 8px gap and
    "+ Assign driver" (92px).
  - The phone's 220 holds its editor.
  - Currently's 120 holds the widest chip whole, "Arrived · forced" at
    111px. The widest unforced chip is "Tomorrow", 79px.
  - The chip widths were measured with `@napi-rs/canvas` and the built Barlow
    Condensed (600, 10.5px, .08em tracking, the chip's padding, icon and
    border).
- With 4 gaps of 16 and the 3px edge, the minimums come to 775.
- The pixel widths below are worked out from the grid's rules: free space
  goes to the capped picker and phone first, and Currently's `1fr` gets
  what is left. The pictures agree with them.

| Window | Table | Currently |
|---|---|---|
| 1440 and up | 1000 (cap), panels beside | 185 |
| 1100–1279 | 780–959, panels beside | 120–145 |
| 1024 | 984, panels above | 169 |
| 840–1099 | 800–1059, panels above | 120 and up |
| 768 | 728 | hidden: 47 short |

At 768 nothing else can give 47px, so below 840 Currently is hidden and the
row is §12.140's four columns (639). The console shows the same chip.

**Rate limit.** The brief said the page uses the `read` bucket. It uses
`read.heavy`, as the console does: `/api/fleet` spends it
(`src/app/api/fleet/route.ts:21`), 40 at once and then 1 a second, which is
60 a minute per user.
- Each open tab polls 3 times a minute. The console and this page together
  cost 6 a minute, a tenth of the limit.
- With the console's truck trail open (`/api/trail`, also `read.heavy`,
  20s), the total is 9.
- The per-address backstop is 240 a minute.
- The page's first paint costs nothing: `loadFleet()` runs in the server
  render, which no limit counts.
- A refresh after a save also runs `loadFleet()` in the render. Its result
  is shown without a request (the newer-of rule).

**Tests** 212 files / 3,825 → 213 / 3,862 (+37, `Currently.test.tsx`):
- The console row and Currently are rendered for the same row, in 13
  cases: each status, a later day and tomorrow, forced, its own Stale GPS,
  and the feed stale with each kind. The chip's `outerHTML` is equal, and
  so are the position text and title.
- The words and marks per status. The upcoming day ("Sat 10/31"). "Late ·
  forced".
- No driver: "—" with no chip, even with a load and status UNASSIGNED.
- No load: the position only. A stale feed: the dotted chip with the age,
  and "Last seen". No fix: "—". No row: nothing.
- The server's status is shown as given, when the row's own facts would
  compute another.
- On the board:
  - the join by id: a fleet row for a truck not on the board is ignored,
    and a board truck missing from the poll is empty;
  - a draft clear and a draft pick leave Currently as it was (the "was"
    lines prove the draft took);
  - a viewer sees the column, with nothing pressable in it;
  - a stale feed on every row;
  - the 20s poll on fake timers: one `/api/fleet` request, and the cell
    follows it;
  - a newer refreshed fleet wins, and an older one does not.
- Guards:
  - no "off duty", "off-duty" or "parked" in the board's output (dispatcher
    and viewer, feed fresh and stale), nor in the page's sources;
  - no `evaluate`, `applyStatus`, `isFeedStale`, `needsRecompute`,
    `statusConfig`, `STATUS_DEFAULTS` or `parseFleetRows` in the page's
    code. Comments are stripped first: the first version tripped on a
    comment naming `applyStatus`.
- Harness: `src/test/assignment-board.ts` mounts the board in a fresh query
  client, with an empty fleet unless given one. The 10 mounts in
  `AssignmentBoard.test.tsx` and `AddDriverFlow.test.tsx` use it, so their
  assertions are unchanged.
  - The two column-order tests now expect five columns.

**Mutations.** Each was applied alone, the 7 assignment suites run, then the
file restored and checked with `cmp`:

| Mutation | Result |
|---|---|
| Unassigned chip on a no-driver row (the "—" branch removed) | 3 failed |
| A chip on a no-load row | 3 failed |
| Colour kept when the feed is stale (`status: row.status`) | 5 failed |
| Status from the draft (the row's driver taken from the draft) | 2 failed |
| A second status computation (`applyStatus` run in the board) | 8 failed: the source guard by its assertion; the board tests by a `RangeError` from running the engine on the test rows, not by a different status |
| (extra) The refreshed fleet ignored (`fleet = polled`) | 1 failed |

**e2e.**
- The seed moved to `e2e/assignments-seed.ts`. It adds positions, loads, an
  override and a fresh `feed_health` row, all invented.
  - Before this phase the seed left `feed_health` empty. With no row the
    feed counts as stale, so every chip would have been withdrawn.
- The status comes from the SERVER's real clock, which the browser's frozen
  clock does not reach. So every load is one whose status cannot move with
  the date, as desktop-baseline's are:
  - Late: a past appointment and a fresh fix;
  - Upcoming "Tue 6/4": 2030;
  - Arrived;
  - No appt;
  - "Late · forced": an override until 2030;
  - Stale GPS: a fix 60h before the seed, so the chip reads "2d" on every
    run and nothing needs hiding;
  - two position-only rows, three with no driver, and one with no fix.
- On time and At risk depend on the time of day, so the unit tests hold
  them.
- A dry run of the seed against the local `fleet_e2e`, through the
  server's own `LATEST_POSITION_SQL`, `parseFleetRows` and `applyStatus`,
  printed exactly those statuses before the real run.
- `npm run e2e -- assignments-baseline --update-snapshots=none` (run
  `2026-10-28T19-12-49-229Z`): 2 passed (setup and `assignments-768`), 7
  differed. Every failure is a pixel comparison: 8,190 to 10,829 pixels,
  ratio 0.01.
  - **768 did not change**, as predicted: Currently is hidden there.
  - The brief expected 8.
- `npm run e2e -- desktop-baseline history-baseline history-phone-baseline
  dispatch driver-phone driver-picker --update-snapshots=none` (run
  `2026-10-28T19-14-02-924Z`): **31 passed**. Nothing else changed, and no
  hosted-auth stall.
- **No baseline was re-saved.** The images for the advisor, under
  `test-results/2026-10-28T19-12-49-229Z/` (each folder holds `-actual.png`,
  `-diff.png` and `-expected.png`):
  - `assignments-baseline-assig-6dc01-1024px-matches-its-baseline-chromium/assignments-1024-*`
  - `assignments-baseline-assig-fa99c-1280px-matches-its-baseline-chromium/assignments-1280-*`
  - `assignments-baseline-assig-e9b7b-1440px-matches-its-baseline-chromium/assignments-1440-*`
  - `assignments-baseline-assig-23d0f-1680px-matches-its-baseline-chromium/assignments-1680-*`
  - `assignments-baseline-assig-5e8bf-1920px-matches-its-baseline-chromium/assignments-1920-*`
  - `assignments-baseline-chang-60bb4-1440px-match-their-baseline-chromium/assignments-changed-1440-*`
  - `assignments-baseline-the-d-34455-1024px-matches-its-baseline-chromium/assignments-picker-open-1024-*`
- Seen in the actual images:
  - the chips are the console's, with their words;
  - 404's "Tue 6/4";
  - 420's "2D" and "Last seen Kankakee, IL";
  - "—" on the empty trucks;
  - in the changed shot, 404's Currently stays on the saved truck while
    its driver is Ada in the draft, and 410 stays "—".
  - At 1024 and 1280 the longer positions are cut: "Champaig…" and "Last
    seen Kank…" (question 1).

**Found wrong in the brief or the design:**
- The `read` bucket: it is `read.heavy` (above).
- "The 8 assignments PNGs differ": 7 do. 768 cannot show the column.
- The console builds the chip's props in three places: the row, the phone
  card and the phone sheet. The board's `consoleChip` is a fourth copy,
  pinned to the row by the parity test because the console was out of
  scope. One shared helper would close that.
- Found, not changed (the console): `MapPopup.tsx:218` draws `row.status`
  and never withdraws colour on a stale feed. §5.9 says fleet-wide.
- The design's "Joliet, IL · Door 9" puts the stop's door in Currently. The
  cell shows the truck's position, never the stop's, so no door.

**Questions for Alex:**
1. At about 1000–1280 (Alex's window is about 1000) Currently is 145px,
   and positions over about 9 characters after a chip are cut. The free
   space first fills the picker to its 360 cap. A 300 cap would give
   Currently 205 there, which by the same arithmetic (not rendered) cuts
   nothing in the seed. Lower it?
2. A truck with a driver and no fix shows "—", like a truck with no
   driver. Fine, or should it say something else, such as "No position"?
3. A truck the last poll did not carry (for example, added since) shows an
   empty cell until the next poll. Fine?
4. Below 840 the column is hidden. Fine, or should it show the chip only
   from some narrower width?

#### 3ap follow-up: Alex's answers, the picker cap, the baselines (2026-10-28)

**Alex's answers** (2026-10-28, via the advisor):
1. Yes: the driver column's maximum goes from 360 to 300.
2. A driver with no fix showing "—" is fine.
3. A new truck empty for up to 20s is fine.
4. Currently hidden below 840px is fine.

**The advisor's review of run 2026-10-28T19-12-49-229Z.** The chips, the
"—" rows, the position-only rows and the saved-not-draft rule are correct
in the images. Positions were cut at 1280 ("Bloomingt…", "Cham…") and
partly at 1024. That is what answer 1 fixes.

**Later, own phase (not now):**
- `MapPopup.tsx:218` does not withdraw colour on a stale feed (§5.9).
  Done in 3av (`4415dbf`): the popup takes `feedStale`.
- One shared helper for the chip's props, which are built in four places.
  Done in 3av (`4415dbf`): `chipProps`, at all five sites.

**The cap** (`c829e86`). In `COLUMNS` the picker is `minmax(240px,300px)`,
in both the four-column template (below 840) and the five-column one. The
width-budget comment is redone. The widths, worked out from the grid's
rules and matched in the new pictures:

| Window | Table | Picker | Phone | Currently |
|---|---|---|---|---|
| 1440 and up | 1000 | 300 | 260 | 245 (was 185) |
| 1280, and a window of about 1000 | 960 | 300 | 260 | 205 (was 145) |
| 1100 | 780 | ~242 | ~222 | 120 |
| 1024 | 984 | 300 | 260 | 229 (was 169) |
| 768, four columns | 728 | 300 (was 329) | 249 (was 220) | hidden |

- No test pinned `COLUMNS`, so none changed. `npm run check`: 213 files /
  3,862 tests.
- design-spec §12.145's column line now says 300, with this reason.

**The open picker** (the brief asked). `listMaxWidth`
(`DriverSelect.tsx:46`) lets the list run past its field up to the nearest
clipping edge or the viewport, at most 420. The list is `w-max min-w-full`:
as wide as its widest entry, never narrower than the field.
- So the cap narrows the field, not the list.
- In `assignments-picker-open-1024.png` the list is 300px wide, the field's
  width, because every entry fits. Each visible entry is whole: name, No ELD
  tag and "ON TRUCK 401".
- The entries scrolled below the list's fold are not in the picture.

**e2e:**
- `npm run e2e -- assignments-baseline --update-snapshots=changed` (run
  `2026-10-28T19-25-21-778Z`): 9 passed, **8 re-saved**.
  - `assignments-768` changed too: the cap applies to its four-column row
    (picker 329 → 300, phone 220 → 249). Currently is still hidden there.
- `--repeat-each=3 --update-snapshots=none` (run
  `2026-10-28T19-25-54-718Z`): **25 passed**.
- `desktop-baseline history-baseline history-phone-baseline dispatch
  driver-phone driver-picker --update-snapshots=none` (run
  `2026-10-28T19-26-29-451Z`): **31 passed**.
  - `git status` afterwards showed only the 8 assignments PNGs.
  - No hosted-auth stall in any of the three runs.
- **Each saved PNG was opened before the commit:** only the spec's invented
  seed. At 1024, 1280 and 1440 "Bloomington, IL", "Champaign, IL" and "Last
  seen Kankakee, IL" are whole.
- Committed in `bc158b7`, under
  `e2e/__screenshots__/assignments-baseline.spec.ts/`:
  - `assignments-768.png`
  - `assignments-1024.png`
  - `assignments-1280.png`
  - `assignments-1440.png`
  - `assignments-1680.png`
  - `assignments-1920.png`
  - `assignments-changed-1440.png`
  - `assignments-picker-open-1024.png`

**Commits:** `c829e86` (the cap), `bc158b7` (the PNGs), and one docs commit
(this section and §12.145). NOT pushed.

### Phase 3au: a stop allowance, measured — report only (2026-10-28)

From the advisor's brief. Alex (2026-10-28) relies on the ETA at every
distance, and approved modelling stops from our own positions for this
report. REPORT ONLY: no engine, worker, migration, env, dependency or UI
change, and no design-spec change (nothing is built into the board). Built
on `3778153` (= origin), clean.

**The boundary** (CLAUDE.md, "Never build"): nothing from Samsara but the
positions the worker already stores; no rule constants in code or docs; the
thing is a "stop allowance". The stopped rule is the scorer's, the bins are
the data's quantiles, and the allowance is what the windows say.

**Why** (the advisor's read-only `eta:score`, 2026-10-28): far out the
as-seen error is stops, and the 52 mph cap partly cancels them, so removing
the cap alone makes the far-out ETA more optimistic. This measures HERE's
uncapped duration plus a stop allowance, never the cap removed alone.

**What was built:**
- `scripts/eta-trips.mts`: `eta:score`'s database read and its trip
  selection (log, then positions, then the first recompute), moved
  unchanged out of `eta-score.mts`, which now imports them. So the report
  replays exactly the scorer's rows; a copy of "which prediction counts at
  100 miles" could drift from the scorer without either failing.
  - Proof: the original and the refactored `eta:score` run back to back on
    the same data printed identical output, apart from the read-time line
    (277 lines). A first comparison differed: a new arrival was detected
    between the two runs (45 → 46 detected).
  - In the final run below, the report's `current` and `here-raw` lines are
    character for character `eta:score`'s as-seen `shown` and `here-raw`
    lines at 200, 100, 50 and 25 mi (`eta:score` run right after it).
- `scripts/eta-stops.mts`: the pure parts. `src/test/eta-stops.test.ts`: 22
  tests, invented tracks only.
- `scripts/eta-stops-report.mts`, `npm run eta:stops`: the read and the print.
  - One `begin read only` transaction; the first line printed is the
    database's own `transaction_read_only` (`on`). `DIRECT_URL` never
    printed.
  - Counts and truck numbers only. Checked: the output grepped against every
    city, address line and driver name in the database (154 strings, sent
    only to a scratch file): 0 matches. The same check finds 144 in
    `eta:score`'s output, so it works.
  - No network but the database; no HERE call. The command files are
    typechecked ad hoc (a scratch tsconfig, `allowImportingTsExtensions`):
    clean.

**How the allowance was fitted:**
1. **Stops.** The scorer's rule by construction: each interval between two
   fixes is asked of `stoppedMinutes` alone (`stationary`), and a run of
   stationary intervals of 10+ min is a stop. A test holds the stops' total
   equal to `stoppedMinutes` over a whole track. Stops cut by the window's
   ends are counted but left out of every figure.
2. **Positions.** Every truck, every fix from `now()` minus
   `POSITION_RETENTION_DAYS`. The prune keeps each truck's newest fix
   regardless of age, so a truck that reports again after months has one
   old fix that would make one interval of months; the window keeps it out.
   It also leaves out the fixes between the last prune and the cutoff (at
   most one prune interval).
3. **Legs.** Each track is cut at every stop that starts within 0.35 mi
   (`ARRIVAL_DEFAULTS.radiusMiles`) of a known stop point (any real stop with
   coordinates, DEMO and E2E excluded as in `eta:score`), and at cut stops.
   A trip the board projects ends at a stop, so a window never runs through
   one.
4. **Windows.** Along each leg's driving clock (time not in a stop), a start
   every 15 min of driving. For each R on the same 15-min grid, up to the
   longest HERE remaining duration among the scored rows (7.5 h), the
   minutes stopped in [start, start + R). A stop at the first instant counts,
   one at the last does not (that is the arrival). A window that would run
   past its leg's end is not counted.
5. **The allowance at R** is the median over all windows, then a running
   maximum (a longer drive cannot expect fewer stopped minutes), linear
   between grid points from 0 at 0. Past the curve's end it is held and
   flagged (0 rows were).
6. **Leave-one-truck-out.** One fit per truck with a scored row (16), each
   without any window of that truck. The all-trucks fit is printed for
   reading only.
7. **Replay.** For each row `eta:score` scores (400 mi added, as the log
   keeps it): the ETA shown, HERE raw, and HERE raw plus the allowance at
   HERE's remaining duration from the fit without the row's truck. All three
   on the same rows (every row has HERE's duration).

**Choices made here** (any can be changed):
- **Median, not mean.** The mean at R = 4 h is 335 min against a median of
  41: multi-day parks. Both are printed.
- **Legs cut at known stops**, as in 3 above.
- **"Long", for the relation,** is the upper quartile of complete stops (151
  min in this run). The driving bins are the quartiles of the driving.
- **Both 60-minute tails are printed.** The brief asked for "the share of
  trips where the new ETA is later than the arrival by 60+ min (the
  dangerous direction: it hides LATE)". By `eta:score`'s sign the direction
  that hides LATE is the other one: the ETA 60+ min BEFORE the arrival
  (error +60 or more). The report prints both, named by what they do: "60+
  late" (hides LATE) and "60+ early" (a LATE that is not).
- **400 mi** is printed with its n (16).

**The run.** It was run four times while being built: the first stopped on
a stack overflow (`Math.min` over 631,000 fixes) before printing a figure;
between the three full runs, figures moved by 1 or 2 as the 7-day window
rolled. This is the last, read 2026-10-28T20:25:08Z, unedited:

```
ETA stop allowance — descriptive, not a verdict. Read 2026-10-28T20:25:08.590Z.
transaction_read_only: on
error = actual − predicted, minutes; + means the truck arrived AFTER the ETA (hides LATE). "within" is ±5 min. Counts and truck numbers only.

## 1. Stop episodes from positions

Stopped = the scorer's rule: reported speed ≤ 3 mph (and, across a gap, a displacement that agrees) for 10+ min. Shorter stationary runs are driving.
Positions: 631251 fixes, 24 trucks with a track, 2026-10-21 20:24 to 2026-10-28 20:24 UTC (read from 2026-10-21 20:24, the 7-day retention).
Known stop points: 64 (every real stop with coordinates); a stop starting within 0.35 mi of one is AT a known stop.
Stops: 501 complete on 20 trucks; 28 more cut by the window's ends (length unknown, not in the figures). Driving 924 h, stopped 2008 h (complete stops).

Stop minutes, complete stops:
  all             n= 501  p10   12 / p25   17 / median   39 / p75  151 / p90  613 / max  4614
  at a known stop n=  81  p10   13 / p25   21 / median   39 / p75   73 / p90  278 / max   621
  elsewhere       n= 420  p10   12 / p25   17 / median   39 / p75  191 / p90  640 / max  4614
  doubling from 10 min (the definition's floor, not a rule):
    10–20: 154   20–40: 101   40–80: 85   80–160: 38   160–320: 24   320–640: 57   640–1280: 18   1280–2560: 17   2560–: 7

152 stops begin within 10 min of driving after the previous one: often one park the rule reads as two, sometimes two stops close together. The rule is not changed here.
3 gaps of 10+ min, 9.8 h in all, are counted as DRIVING by the rule although the displacement is under 3 mph: an end fix reads above 3 mph. Not reclassified.

Per truck:
  truck   fixes  stops  at known  cut  driving h  stopped h  legs
    113   50004     34         9    1       72.2       94.2    10
    116   23761     16         6    2       33.1      106.5     7
    122     721      1         0    1        1.4       25.5     1
    124   10058      8         2    1       14.0      136.6     3
    125      12      0         0    1        0.0        0.0     0
    128   58386     37        12    1       82.8       85.0    13
    130      53      0         0    1        0.0        0.0     0
    132   17035     20         3    1       27.4       99.5     4
    133   49137     38         7    1       72.3       94.8     8
    134     874      0         0    2        0.0        0.0     1
    135   44871     38         6    2       67.7       90.6     7
    136   28588     28         0    0       46.2       92.1     1
    137   45457     29        10    1       71.8       95.9    11
    138   36066     37         0    1       53.1      114.4     1
    139   55727     31         4    1       76.5       91.3     5
    141   13424     14         0    2       16.4      105.1     1
    142    3595      8         0    2        4.5       92.3     1
    143   25649     17         4    1       35.3      129.2     5
    144   45138     34         0    0       69.1       98.9     1
    145   22900     21         3    1       35.3      105.4     4
    146   36485     31         0    2       51.0      109.9     1
    147   13203     29         6    1       21.9      144.5     7
    246     347      0         0    2        0.0        0.0     1
    247   49760     30         9    0       72.0       96.0    10

Driving since the last long stop, and the next stop:
  "long" = the upper quartile of complete stops: 151+ min. Bins = quartiles of the driving. 461 stops with a long stop before them on the same track; 40 with none seen (not binned).
  driving since (h)   n   next stop min: median   p75   p90   next is long   at a known stop
    0.0 –   1.0    116                    54   161   613            26%               21
    1.0 –   3.0    115                    34    76   165            10%               13
    3.0 –   7.9    115                    28    53   257            11%               25
    7.9 –  29.8    115                   116   515   641            49%               17

## 2. The stop allowance

Legs: each track cut at its stops AT a known stop and at the window's ends (103 legs). A window starts every 15 min of driving; for R of driving still to do it counts the minutes stopped before R is driven. The allowance is the median over all windows, made non-decreasing in R. R runs to 7.5 h, the longest HERE duration among the scored rows.
Leave-one-truck-out: 16 fits, one per truck with a scored row; each leaves all of that truck's windows out.

All trucks in (for reading; no trip is scored with this one), at each whole hour of R:
   R h  windows  trucks  allowance  median   mean   p75   p90  no stop  from the 11 trucks with no known stop   folds: allowance min–max
   1.0     3431      20          0       0    101    16   178      71%                                         27%      0 –    0
   2.0     3170      19          0       0    180    62   601      51%                                         29%      0 –    0
   3.0     2948      19         21      21    256   244   653      36%                                         30%     20 –   25
   4.0     2738      19         41      41    335   520   770      24%                                         32%     37 –   43
   5.0     2547      18         80      80    415   619   847      16%                                         33%     77 –  103
   6.0     2372      18        235     235    502   646   980       9%                                         35%    184 –  263
   7.0     2210      17        465     465    596   693  1539       5%                                         36%    436 –  478

## 3. Replay on the trips eta:score scores

46 detected arrivals; 14 never observed beyond 25 mi. Rows without HERE's duration: 0; rows whose fold has no data: 0. The three ETAs are compared on the same rows.
  current = what the board showed (52 mph cap, no stops). here-raw = HERE's duration, no cap. + allowance = here-raw plus the allowance at HERE's remaining duration, fitted without the trip's truck.
  "60+ late" = the ETA was 60+ min BEFORE the arrival (hides LATE); "60+ early" = 60+ min AFTER it (a LATE that is not).

400 mi  (10 log, 0 pos, 6 rec)
  HERE's remaining driving: median 6.9 h (5.4–7.4); allowance added: median 443 min (126–504); past the curve's end: 0
  minutes actually stopped, where known (n=10): median 141; stopped − allowance median -315
  current          n=16  median   +306  med|e|    306  worst10%    859  late/within/early 11/0/5   [12 pl, top-2  38%, eff  9.1]   60+ late 11/16  60+ early 3/16
  here-raw         n=16  median   +421  med|e|    421  worst10%    951  late/within/early 16/0/0   [12 pl, top-2  38%, eff  9.1]   60+ late 13/16  60+ early 0/16
  + allowance      n=16  median     -8  med|e|    309  worst10%    671  late/within/early 8/0/8   [12 pl, top-2  38%, eff  9.1]   60+ late 7/16  60+ early 8/16

200 mi  (10 log, 0 pos, 7 rec)
  HERE's remaining driving: median 3.6 h (2.7–4.1); allowance added: median 34 min (17–44); past the curve's end: 0
  minutes actually stopped, where known (n=10): median 43; stopped − allowance median +12
  current          n=17  median     +6  med|e|     44  worst10%    762  late/within/early 9/2/6   [13 pl, top-2  35%, eff 10.0]   60+ late 6/17  60+ early 0/17
  here-raw         n=17  median    +63  med|e|     63  worst10%    800  late/within/early 16/1/0   [13 pl, top-2  35%, eff 10.0]   60+ late 10/17  60+ early 0/17
  + allowance      n=17  median    +39  med|e|     39  worst10%    763  late/within/early 11/0/6   [13 pl, top-2  35%, eff 10.0]   60+ late 7/17  60+ early 0/17

100 mi  (18 log, 0 pos, 9 rec)
  HERE's remaining driving: median 2.0 h (1.4–2.5); allowance added: median 1 min (0–15); past the curve's end: 0
  minutes actually stopped, where known (n=18): median 7; stopped − allowance median +5
  current          n=27  median    +14  med|e|     24  worst10%    612  late/within/early 16/1/10   [21 pl, top-2  26%, eff 15.5]   60+ late 9/27  60+ early 0/27
  here-raw         n=27  median    +37  med|e|     37  worst10%    633  late/within/early 21/5/1   [21 pl, top-2  26%, eff 15.5]   60+ late 10/27  60+ early 0/27
  + allowance      n=27  median    +33  med|e|     33  worst10%    632  late/within/early 20/3/4   [21 pl, top-2  26%, eff 15.5]   60+ late 10/27  60+ early 0/27

50 mi  (21 log, 0 pos, 9 rec)
  HERE's remaining driving: median 0.9 h (0.7–1.4); allowance added: median 0 min (0–0); past the curve's end: 0
  minutes actually stopped, where known (n=21): median 0; stopped − allowance median 0
  current          n=30  median     +1  med|e|     10  worst10%    608  late/within/early 14/9/7   [22 pl, top-2  30%, eff 14.1]   60+ late 7/30  60+ early 0/30
  here-raw         n=30  median     +8  med|e|     10  worst10%    621  late/within/early 20/7/3   [22 pl, top-2  30%, eff 14.1]   60+ late 7/30  60+ early 0/30
  + allowance      n=30  median     +8  med|e|     10  worst10%    621  late/within/early 20/7/3   [22 pl, top-2  30%, eff 14.1]   60+ late 7/30  60+ early 0/30

25 mi  (22 log, 0 pos, 10 rec)
  HERE's remaining driving: median 0.5 h (0.3–0.9); allowance added: median 0 min (0–0); past the curve's end: 0
  minutes actually stopped, where known (n=22): median 0; stopped − allowance median 0
  current          n=32  median     +6  med|e|      6  worst10%    514  late/within/early 17/14/1   [24 pl, top-2  28%, eff 15.5]   60+ late 7/32  60+ early 0/32
  here-raw         n=32  median     +7  med|e|      7  worst10%    514  late/within/early 23/9/0   [24 pl, top-2  28%, eff 15.5]   60+ late 7/32  60+ early 0/32
  + allowance      n=32  median     +7  med|e|      7  worst10%    514  late/within/early 23/9/0   [24 pl, top-2  28%, eff 15.5]   60+ late 7/32  60+ early 0/32

Per truck (each truck’s rows, all marks; allowance from the fit without it):
  truck  rows  current median  here-raw median  + allowance median   60+ late now → with allowance
    113    19              +4              +22                  +4              6 → 6
    116     8              -6               +5                  +5              0 → 0
    124    10            +105             +173                  +0              5 → 4
    128    18              +6              +14                 +12              4 → 4
    132     3             +39              +52                 +52              0 → 0
    135    12              +2               +7                  -1              2 → 1
    136     5            +154             +155                +155              5 → 5
    137     6              +4               +7                  +5              0 → 0
    138     5              +6              +19                  +7              1 → 1
    139     5              -2              +11                 +10              0 → 1
    141     4            +667             +677                +676              3 → 3
    142     5             +36              +57                 +53              1 → 1
    143     9              -3               +7                  +5              0 → 0
    145     5            +484             +514                +503              5 → 4
    146     5           +1036            +1056               +1056              5 → 5
    247     3            +608             +622                +622              3 → 3

## 4. What this cannot support

- 32 arrivals on 16 trucks to 24 destinations; n per distance is above.
  Medians on n < 30 describe these trips, not the fleet; worst-10% under n = 10 is the worst trip.
- The distances within one trip are not independent: one long stop counts at every distance before it.
- The fit sees one window of positions (7 days, one weekend at most). A fit on another week could differ.
- The windows overlap (one every 15 min of driving), so "windows" is not a count of independent drives.
- Leave-one-truck-out keeps a truck's own windows out of its fit, but not its lanes or customers: other trucks drive them
  too, and the fit's week overlaps the scored trips' own days.
- The allowance depends on remaining driving only. It cannot know whether this truck will stop for the night on this trip —
  the long stops that make the worst 10% — only how much trucks stop over that much driving, typically.
- The fit's R is a truck's driving time; the replay's R is HERE's duration, which runs short of the truck when it drives.
- A stop at a pickup or delivery that is not in our stops (another load, a yard) counts as a stop on the road. For the
  11 trucks with no stop near any known point that is every one of theirs; their share of windows is in section 2.
- The stopped rule: 3 gaps (9.8 h) are driving to it although nothing moved, and 152 stops
  begin within 10 min of driving after another. Both are the scorer's rule as it stands, here and in eta:score.
- "Driving only" in eta:score needs positions; rows here use HERE's duration and need none, so n is eta:score's as-seen n.

```

**What the run shows** (a reading, not a decision):
- **Close in, nothing changes.** At 50 and 25 mi HERE's remaining driving
  is at most 1.4 h, and 51–71% of 1–2 h windows have no stop, so the
  allowance is 0 and "+ allowance" is HERE raw, a little more optimistic
  than the board (+8 against +1 at 50 mi, +7 against +6 at 25).
- **100 mi:** the allowance is a median 1 min. Median +33 against the
  board's +14; med|e| 33 against 24.
- **200 mi:** a median 34 min. Median +39 against +6; med|e| 39 against
  44; worst 10% 763 against 762; "60+ late" 7 of 17 against 6.
- **400 mi:** a median 443 min; the curve climbs from 80 min at 5 h to 465
  at 7 h. The median goes from +306 to −8, but med|e| stays (309 against
  306), the worst 10% falls (671 against 859), "60+ late" falls from 11 to
  7 of 16 and "60+ early" rises from 3 to 8. On trips that drove through,
  the new ETA is now hours after the arrival; on those that stopped
  longer, it is still hours before it.
- So **no distance shows a clear gain** over the board as it is. One
  number per remaining driving time cannot say which trip will include a
  long stop, and the worst 10% is those trips. HERE raw alone is more
  optimistic than the board at every distance, as the advisor's run said.
- **The relation** (section 1) is the one place the data separates trips:
  after 7.9 h or more of driving since a long stop, the next stop is long
  49% of the time; between 1 and 7.9 h, 10–11%. The allowance does not use
  it.

**Found, not changed** (the scorer's stopped rule, which `eta:score`, the
prediction log's `stopped_minutes` and this report share):
- **3 gaps of 10+ min, 9.8 h in all, count as driving although the truck
  did not move.** `stationaryBetween` (`src/lib/eta-marks.ts`) asks that
  both end fixes read 3 mph or less before it looks at the displacement,
  and here one end reads above 3 mph. Whether any scored trip contains one
  is unverified.
- **152 of 529 stops start within 10 min of driving after another one**:
  often one park read as two. Minutes stopped in a window barely move, but
  the relation's "long stop" can be split.
- **11 of 24 trucks have no stop near any known stop point**, so each of
  their pickups and deliveries counts as a stop on the road. They supply
  27–36% of the windows (section 2). Why they have none (no loads of
  theirs, or stops away from where they park) is unverified.

**Questions for Alex** (none decided here):
1. **Leave the board as it is?** On this week's trips, HERE raw plus this
   allowance is no better than the current ETA at any distance (above).
2. **A second report, with two inputs** (the driving still to do AND the
   driving since the last long stop, both from our positions and learned
   the same way)? It would test whether the board can tell which trips
   will make a long stop. It models how long a truck has driven without
   one, which is nearer the CLAUDE.md line than this report, so it needs
   your explicit yes, and it would be report only again.
3. **The stopped rule's two findings:** change them in their own phase?
   That would change `eta:score`'s "driving only" figures and the worker's
   `stopped_minutes` (a worker change).
4. **Run `npm run eta:stops` again on a later week** before any decision?
   It sees only the 7 days the database keeps.

**Unverified:**
- The fit's sensitivity to the 15-min grid, the 0.35 mi radius and the leg
  cuts: one setting of each was run.
- Time of day at the 400 mi crossings (whether the trips that drove
  through started early in a shift) was not looked at.
- The three points under "Found, not changed" marked unverified.

**Tests:** 22 in `src/test/eta-stops.test.ts`: stops by the scorer's rule
and its total over a track, an ignition-off rest, a feed gap on the road,
cut stops, the parked gap, legs, windows and their ends, the median and
running maximum, leave-one-truck-out, interpolation, the relation and its
bins, the replay's arithmetic and the two tails.

**`npm run check`:** 214 files, 3,884 tests (213 / 3,862 before).

**Mutations** of `scripts/eta-stops.mts`, each applied alone and reverted:

| Broken | Tests that fail |
|---|---|
| no running maximum | 1 |
| the left-out truck kept in | 4 |
| a stop at the window's last instant counted | 1 |
| a stop at the window's first instant not counted | 1 |
| windows past the leg's end counted | 3 |
| a stop of exactly 10 min dropped | 2 |
| known stops do not cut legs | 1 |
| the allowance's sign | 1 |
| short stationary runs not counted as driving | 2 |
| "past the curve's end" never flagged | 1 |

**Commits:** `9fb2d97` (`eta-trips.mts`, the refactor), `c7d0624` (the
report, its module, tests and `npm run eta:stops`), and one docs commit
(this section). NOT pushed. No design-spec change.

### Phase 3av: the map popup withdraws colour on a stale feed; one helper for the chip's props (2026-10-29)

From the advisor's brief, out of 3ap's "Later, own phase". A small console
fix. **NOT pushed, NOT deployed.** Built on `a0df574`. No change to the
status engine (`src/lib/status.ts`), the server, the fleet query, the
worker, migrations, env or tokens. No design-spec change: no rule changed.

**The bug.** `MapPopup.tsx:218` drew `status={row.status}` and
`forced={row.override !== null}`, and the popup had no `feedStale`. On a
dead feed it could show a green "On time", or a forced "Late", over a row
showing the dotted Stale GPS. `FleetMap` had `feedStale` (`FleetMap.tsx:70`)
and did not pass it.

**The four copies, checked against each other before the merge.** They
agreed in behaviour:
- `TruckRow.tsx:780` and `PhoneCardList.tsx:123` (`ChipFlip`),
  `TruckSheet.tsx:90` (`StatusChip`) and Currently's `consoleChip`
  (`Currently.tsx:31`), all three props:
  - status: `feedStale ? 'STALE_GPS' : row.status`;
  - forced: `!feedStale && row.override !== null`;
  - label: the fix's age when the feed or the truck is stale; else the day
    of an upcoming load; else none.
- The `!feedStale &&` before TOMORROW (TruckRow `:786`, PhoneCardList
  `:128`) sat in the branch where `stale` is false, so the feed was already
  fresh there. It changed nothing; TruckSheet and Currently do not have it.
- The age's reference: TruckRow's `reference` (`:462`) is
  `fetchedAt ? new Date(fetchedAt) : undefined`, the expression the other
  three write inline. TruckSheet's `age` uses the same (`:60`).
- So no copy differed, and nothing was chosen between them.

**The popup differed in a second way**, which the brief did not name. On a
FRESH feed, a truck whose own status is Stale GPS got no label (only
TOMORROW had one), so its popup chip said "Stale GPS" while its row said
the age, "2h 40m". §5.1 gives Stale GPS one chip word everywhere: the
elapsed age. With the helper the popup prints the age too. That is the one
visible change on a fresh feed, where the brief expected none. It is a
§5.1 fix; question 1. No baseline holds it (e2e below).

**What was built** (`4415dbf`).
- `src/components/console/chip-props.ts`, new: `chipProps(row, feedStale,
  fetchedAt)` returns `{ status, forced, label }`. It is `consoleChip`'s
  logic and doc comment, moved. The third argument is `fetchedAt`, the
  poll's instant as the sites hold it, rather than a `Date`: the helper
  makes the reference as every copy did.
- Used at all five sites, spread into the chip:
  - `TruckRow.tsx:779` (`ChipFlip`). Its `reference` local, used only by
    the chip, is gone.
  - `PhoneCardList.tsx:120` (`ChipFlip`). Its `stale` local, used only by
    the chip, is gone.
  - `TruckSheet.tsx:90` (`StatusChip`). `stale` and `age` stay: the
    Position and GPS age lines use them.
  - `Currently.tsx:47`. `consoleChip` and `ConsoleChip` are removed; nothing
    else imported them. The parity test in `Currently.test.tsx` still
    renders the console's row beside the cell and compares the two chips.
  - `MapPopup.tsx:227` (`StatusChip`).
- `MapPopup` takes `feedStale: boolean`, required (`MapPopup.tsx:149`).
  `FleetMap.tsx:473` passes it. The one other caller,
  `two-stop-surfaces.test.tsx`, passes `false`; that test was always a
  fresh feed. The typecheck named it.

**geo.ts is left as it was** (`geo.ts:30` and `:66`). The markers take the
status alone, with no "forced" and no label. `chipProps(…).status` would
build an age for every marker on every render for nothing, and `:66` needs
its own change, so it is not one line. The guard allows geo.ts by name.
Also left, the same rule for something that is not a chip: the row's
stripe, `TruckRow.tsx:593` (`feedStale ? RAIL.STALE_GPS : RAIL[row.status]`).
The guard's pattern does not match it.

**Tests** (`726fd68`). 214 files / 3,884 → 216 / 3,926 (+42). Every instant
is derived from the run's own clock; the ages are offsets from it.
- `src/components/console/chip-props.test.ts`, 23:
  - a stale feed: each of the 8 statuses becomes the dotted Stale GPS with
    the fix's age, not forced; an override is not forced; an upcoming load
    (tomorrow, and a later day) gets the age, not the day; no fix keeps the
    word;
  - a fresh feed: a truck's own Stale GPS shows its age ("2h 40m"); an
    upcoming load shows "Tomorrow", or the weekday and date (worked out
    with `Intl.DateTimeFormat`, not by `upcomingLabel`); no day, no label;
    an override is forced and keeps its status; the other five statuses
    are plain;
  - the age is measured from the poll's instant: with the clock moved five
    hours on, it still reads "48m";
  - the guard: no file under `src/components` but `chip-props.ts` and
    `map/geo.ts` matches `/feedStale\s*\?\s*['"`]STALE_GPS['"`]/`. It
    expects exactly those two, so the regex is shown to match. A regex, so
    the test file does not contain what it looks for.
- `src/components/console/map/MapPopup.test.tsx`, 19:
  - a stale feed: On time, and a forced Late, each give a chip equal to
    `<StatusChip status="STALE_GPS" label="48m" />`: dotted, "48m", no
    hand (the override glyph), no "forced", not its own colour; an upcoming
    load shows the age;
  - a fresh feed, as before: "On time"; "Late · forced" with the hand;
    "Tomorrow"; and a truck's own Stale GPS: its age (the change above);
  - the popup's chip equals the console row's in 12 cases (each status,
    upcoming with and without a day, forced, own Stale GPS, and three with
    the feed stale).

**Mutations.** Each was applied alone, the chip suites run
(`chip-props`, `MapPopup`, `Currently`, the phone suites,
`two-stop-surfaces`), then the file restored and checked with `cmp`:

| Mutation | Result |
|---|---|
| The popup ignores `feedStale` (`chipProps(row, false, …)`) | 6 failed; the received chip was the green "On time" |
| `forced` without `!feedStale` | 2 failed |
| The day before the age (TOMORROW checked first) | 2 failed |
| A site back to its inline copy (`TruckRow.tsx` restored from `a0df574`) | 1 failed: the guard, naming `TruckRow.tsx` |

**e2e.**
- Which baselines show the popup or a stale feed: `desktop-baseline` only.
  - `4-selected-with-popup-*` (6 page shots, 6 popup shots) is truck 101 on
    a FRESH feed (positions re-stamped 90s old), with an upcoming load. Its
    chip, "Tue 6/4", comes out of the helper unchanged.
  - `3-feed-down-*` (6) is the stale feed with no popup open. The rows'
    chips were already withdrawn there.
  - So no baseline shows a popup on a stale feed, or a popup for a truck
    whose own GPS is stale. Zero diffs were expected.
- `assignments-baseline` too: Currently is one of the five sites (its own
  Stale GPS chip, "2d").
- `npm run e2e -- --project=chromium desktop-baseline assignments-baseline
  feed.spec map-popup /phone.spec --update-snapshots=none` (run
  `2026-10-29T16-40-18-096Z`, on `726fd68`): **62 passed** in 7.2 min
  (setup 1, assignments-baseline 8, desktop-baseline 12, feed 2,
  map-popup 14, phone 25).
  - No `-diff.png` or `-actual.png` in the run's folder. No baseline was
    re-saved; `git status` was clean afterwards. No hosted-auth stall.

**Found wrong in the brief or the design:**
- "No visual change on a fresh feed anywhere": there is one, the popup's
  own Stale GPS chip (above, question 1).
- "TruckRow's `reference` vs `fetchedAt`": the same instant (above).
- Found, not changed (the brief fenced it out): the popup's other lines on
  a stale feed, against §5.9:
  - `MapPopup.tsx:231`, Position: the whole string, with no "Last seen"
    and no "frozen". The list's head says "Position (frozen)"
    (`FleetList.tsx:200`); the phone sheet says "Last seen"
    (`TruckSheet.tsx:146`).
    Done in 3aw: "Last seen", as the sheet says.
  - `MapPopup.tsx:256`, Projected: the full line ("412 mi · ETA 14:18 CDT
    · …"). §5.9 says every ETA cell reads "stale"; the row's does. The
    phone sheet keeps the ETA and adds "Feed down: built on positions we
    no longer trust." (`TruckSheet.tsx:123`).
    Done in 3aw: the ETA and the Feed down line, as the sheet has them.
  - `MapPopup.tsx:295`: "Computed" (in the at-risk amber) and "Forced by"
    still show, under a chip that no longer says "forced".
    Done in 3aw: both stay, Computed muted, on the popup and the sheet.

**Questions for Alex:**
1. On a working feed, the popup's chip for a truck whose own GPS is stale
   now shows its age ("2h 40m"), as its row and the phone already do
   (§5.1), instead of the words "Stale GPS". Keep it? The popup's "GPS
   age" line also shows the age, so the popup now says it twice.
2. The popup's Position, Projected and Computed/Forced-by lines on a dead
   feed (above): fix them in their own small phase, to match the phone
   sheet?

**Commits:** `4415dbf` (the helper and the five sites), `726fd68` (the
tests), and one docs commit (this section, 3ap's "Later" list, the "What
is live" line). NOT pushed.

### Phase 3aw: the map popup's lines on a dead feed read as the phone sheet's (2026-10-29)

From the advisor's brief: 3av's "Found, not changed" list. A small console
fix. **NOT pushed, NOT deployed.** Built on `9e688d8`, which was
`origin/master` at the start (3av pushed; its deploy is not checked here).
No change to the chip (`chipProps`), the row, the phone card, `geo.ts`,
Currently, the status engine, the server, the fleet query, the worker,
migrations, env or tokens. Rule: design-spec §12.146 (new).

3av's question 2 is answered by this brief (fix the lines, as the sheet
reads). Question 1 (the popup's own-stale chip shows the age) is not
answered in it; the chip is unchanged.

**What changed** (`6e69df2`). The phone sheet was the model.
- `MapPopup.tsx:103`, new: `FEED_DOWN_ETA`, the words "Feed down: built on
  positions we no longer trust." The sheet had them inline
  (`TruckSheet.tsx:123` at `9e688d8`); both surfaces now use the constant
  (`MapPopup.tsx:282`, `TruckSheet.tsx:128`).
- `MapPopup.tsx:111`, new: `computedInk(feedStale)`. It returns
  `text-text-muted` on a dead feed, otherwise `text-status-risk-fg` (the ink
  both surfaces used before). Both surfaces use it (`MapPopup.tsx:322`,
  `TruckSheet.tsx:170`).
- The popup:
  - Position (`:252`): "Last seen …" when `feedStale || row.status ===
    'STALE_GPS'` (`:208`), as the sheet (`TruckSheet.tsx:150`) and the row
    say. Its fallback stays `formattedLocation ?? '—'`. The sheet's has
    `cityState` between the two, but `cityState()` is null whenever
    `formattedLocation` is (`samsara/schemas.ts:143`), so the text is the
    same.
  - Projected (`:277`): the ETA line as before, then the Feed down line in
    `block text-status-risk-fg`, as the sheet has it, on a dead feed only.
  - Computed (`:321`): the ink from `computedInk`. Forced by is unchanged
    and still printed.
- The sheet: Computed's ink from `computedInk`; the Feed down line from the
  constant. Nothing else.

**Every visible change on a live feed: one.** A truck whose OWN GPS is
stale now reads "Last seen 1 Broadway, …" in the popup's Position, as its
row and the sheet already did. Checked, not argued: a throwaway test
rendered both surfaces for seven rows, on a live and a dead feed, at
`9e688d8` and with the change, and the markup was compared (the test was
deleted, not committed):
- Rows: on time, forced (Late over On time), a ZIP-centre ETA, upcoming,
  no load, no fix, its own Stale GPS.
- Live feed: 13 of 14 renders byte-identical. The one that differs is the
  popup for its own Stale GPS: "Last seen" only.
- Dead feed:
  - The popup: "Last seen" on all seven, including "Last seen —" with no
    fix, as the sheet and the row say. The Feed down line on the six with
    a stop (no load means no Projected line). Computed muted on the forced
    row.
  - The sheet: Computed muted on the forced row, and nothing else.

**Tests** 216 files / 3,926 → 216 / 3,939 (+13). Every instant is derived
from the run's clock.
- `MapPopup.test.tsx` (+11):
  - a dead feed: Position "Last seen …"; Projected "140 mi · ETA hh:mm …"
    and exactly one Feed down line, `block text-status-risk-fg`, its words
    pinned in the test; Computed "On time" in `text-text-muted` (no status
    class); Forced by "Test Dispatcher — Receiver confirmed detention";
  - a live feed: the position, no Feed down line, Computed in
    `text-status-risk-fg`; a truck's own Stale GPS: "Last seen", and no
    Feed down line;
  - parity with the sheet in five cases (dead feed forced, own stale, no
    fix; live feed forced, own stale): the same Position text, the same
    Feed down line (`outerHTML`, one on a dead feed, none on a live one),
    the same Computed class;
  - a guard: no file under `src/components` but `MapPopup.tsx` contains
    "Feed down: built on" (tests left out).
- `TruckSheet.test.tsx` (+2): Computed `text-text-muted` on a dead feed,
  `text-status-risk-fg` on a live one, Forced by printed in both.

**Mutations.** Each was applied alone, the popup and sheet suites run
(`MapPopup`, the phone suites, `two-stop-surfaces`, `OvernightDisplay`),
then the file restored and checked with `cmp`:

| Mutation | Result |
|---|---|
| The popup drops "Last seen" | 6 failed |
| The popup drops the Feed down line | 4 failed |
| Computed keeps the amber on a dead feed: the popup | 3 failed |
| Computed keeps the amber on a dead feed: the sheet | 3 failed |
| The Feed down words changed in one place: the sheet back to its own copy ("…we do not trust.") | 4 failed: the guard and 3 parity cases |
| The Feed down words changed in one place: the shared constant | 1 failed: the pinned words |

**e2e.**
- Which baselines show the popup or the sheet: the popup only, in
  `desktop-baseline`'s `4-selected-with-popup-*`. That is truck 101 on a
  live feed with a fresh fix and an upcoming load, which this phase does
  not change. No baseline shows the truck sheet, and none shows a popup on
  a dead feed (3av). Zero diffs were expected.
- `npm run e2e -- --project=chromium desktop-baseline feed.spec
  --update-snapshots=none` (run `2026-10-29T17-15-17-855Z`, on `6e9f814`):
  **15 passed** in 3.3 min (setup 1, desktop-baseline 12, feed 2).
  - No `-diff.png` or `-actual.png` in the run's folder. No baseline was
    re-saved; `git status` was clean afterwards.
  - The run reported "the Mac slept 1 minute during this run". Two widths
    took about 37s instead of about 18s (768 and 1440); both passed.

**Found wrong in the brief or the design:**
- §5.9 says every ETA cell reads "stale" on a dead feed. The popup and the
  sheet keep the projection and add the Feed down line (the brief, and the
  sheet before it). That holds for the row's ETA cell, which reads
  "stale". But no section of design-spec records the popup and sheet
  keeping their ETA under a caveat. §12.146 covers Computed only, as the
  brief asked.
- §9.5: "Showing and Computed … both carry their own status colour". On a
  live feed the popup and the sheet print Computed in the at-risk amber
  whatever the computed status is ("On time" in amber). That is older than
  this phase and unchanged.
- Found, not changed (out of scope): the edit modal draws the computed
  status as a coloured chip with no knowledge of the feed
  (`OverrideBlock.tsx:120`; `StopForm.tsx:159` for the next stop), so on
  a dead feed it still shows schedule colour. Not looked at: the other
  status colours a dead feed may leave (the filter chips, the Today strip,
  the timeline).

**Questions for Alex:**
1. The edit modal's Computed chip (above) keeps its colour on a dead feed.
   Withdraw it there too, in its own small phase?

**Commits:** `6e69df2` (the popup and the sheet), `6e9f814` (the tests),
and one docs commit (this section, 3av's list, the "What is live" line,
design-spec §12.146). NOT pushed.

### Phase 3ax: templates for the layouts that still go to the AI, stopped after the first (2026-10-29)

From the advisor's brief: a template for each of six layouts that go to Read
with AI, built in the order d7, d1, d6, d4, d5, d2. Local only: no AI call,
no network, no paid call. **Stopped at the brief's gate after template 1:**
the new template changed an existing sample's result (sample 17). **NOT
pushed.** Built on `951815b`, which was `origin/master` at the start, with a
clean tree. No change to the AI reader, redaction, the routes, the DB,
migrations, the worker or env.

**Commits:** `b1b23b7` (template 1, `stop-detail`: code, fixture, tests)
and this docs commit. Design-spec §12.147 is not written yet: it lists the
new layout ids, and the rule for a street on two lines depends on Alex's
answers to questions 1 and 3.

**The ten files.** Copied from Alex's new folder into
`.samples/rate-confirmations/` as `zzz_3ax-d1.pdf` to `zzz_3ax-d10.pdf`, in
the name order of `sampleFiles()`; his folder is untouched. They sort after
every existing sample, so no number shifted. Name order puts d10 before d2,
so the sample numbers are: d1 31, d10 32, d2 33, d3 34, d4 35, d5 36, d6 37,
d7 38, d8 39, d9 40.

**Ground truth.** Ten entries added to `expected.json` (git-ignored). The
file as it was is beside it as `expected.json.before-3ax`; the old entries
were compared and are unchanged. Written from the PDFs, each page looked at
as an image; d1's from its OCR text, as 3ak did for sample 5. Priority 1 for
d1, d2 and d4 to d7 (no template read them), 2 for d3, d8, d9 and d10.
`ratecon:check-expected`: all ten complete. Judgment calls:

- d6, stop 1: the street line goes on after a comma with "c/o" and the
  stop's own name. The truth is the street without that.
- d7, stop 2: the street wraps in its cell, and the PDF runs two of its
  words together across the break. The truth has them apart, as a dispatcher
  would type them (question 3).
- d2, stop 2: "HH:MM - HH:MM" with no AM/PM, on a document that has AM/PM
  elsewhere (a note and the signature's time). Couldn't read, with its date,
  by the how-to's rule. The note gives a time too; notes are never read.
- d3, stop 3: the street as printed, ending in a short unit word.

**Per d-number:**

- **d1: skipped.** Not a new layout: it is `stop-table`'s (3ak), recognised
  by its header and refused. The one reason, found in a scratch run with no
  code changed: stop 2's phone is printed as three groups separated by
  spaces, a shape `TABLE.phone` does not accept, so where that street ends
  is not known. With only that cell given dashes, the scratch run read all
  of d1 with `stop-table`. Changing an existing template is outside this
  phase (question 4). It stays on the AI.
- **d7: built**, layout `stop-detail` (below).
- **d6, d4, d5, d2: not built**: the phase stopped first. Their headings
  were searched for in every sample's text layer: d6, d4 and d5 have no
  older copy; d2's layout is also samples 7 and 11, so a d2 template meets
  the same gate.

**`stop-detail`** (`readStopDetail`, `templates.ts`):

- **Recognised by** the page header "CARRIER RATE CONFIRMATION PAGE n of m",
  "STOP DETAIL", and the table's header lines "Type … Name and Address …
  Commodity … Reference #" and "Arrival … Departure … Dims". None is a
  "label:" or a broker's name.
- **Read by column.** Each cell belongs to the heading that starts nearest
  to it: the address column is centred, the columns beside it are not.
- **One row a stop.** PU or SO in the type column; under "Scheduled
  Arrival" exactly "Arrival", M/D/YY and HH:MM, read as an appointment at
  that time (24-hour by Route blocks' rule); "Scheduled Departure" must be
  N/A. The address cell: the name's lines, then the street from its one line
  that starts like a street, then "City, ST 12345" last.
- **A street on two lines** is joined with a space and marked
  (`WRAP_CHECK`).
- **Stops:** the first must be PU and the last SO, read as the delivery. An
  SO before the last is read as a delivery and says so: `STOP_OFF_CHECK`,
  PU / SO blocks' message, now one constant for both (its text unchanged).
- **The load number** is the one under "Load Confirmation", the same on
  every page; one that differs leaves it blank with a check.
- **Refused:** pasted text; a table that leaves its page; a stray line in
  the type column; any other arrival or departure; a name that starts like a
  street, two street-like lines, no name; a last line that is not a city
  line, or a state that is not one; a city line in another column; a first
  stop that is not PU or a last that is not SO.

**The gate.** `ratecon:score`, its output saved before any change:

- Before: the bar 15 of 15. With the ten truths, before any template: 19
  of 19, and samples 1 to 30 identical line for line.
- After template 1: 19 of 21, and sample 17's lines changed. That is the
  stop.
- **Samples 16 and 17 are older copies of d7's layout.** Both priority 1,
  scored before as "ground truth for the AI evaluation only".
  - Sample 17 is now read, 2 stops: load number, stop count, order and
    type, ZIP, city, state and both appointments (exact) right; **both
    streets FAIL**. Each is printed on two lines, the second its street-type
    word. The template reads both lines, joined and marked; the truth has
    the first line only (question 1).
  - Sample 16 is recognised and refused, as before: its arrival is a window
    (a time with " -", a second time below), a shape the template refuses
    (question 5). Its score line is unchanged.
- **d7 (sample 38):** read, 2 stops; every field right but stop 2's street,
  filled as printed (the two words run together) and marked.
- **Every other sample:** recognised layouts and read (layout, stop count,
  load number filled or not) compared with HEAD's, scans read by OCR: only
  samples 16, 17 and 38 changed.

**The existing templates on d3, d8, d9 and d10:** each read by the template
it matched (`route-blocks`, 3 stops; `stops-section`; `pu-so-blocks` twice).
Every field right. Appointments, 9 stops: 5 exact, 4 marked and filled as
the PDF says, none WRONG.

**Tests.** Invented fixture `stopDetail` and `DETAIL_STOPS` in
`src/test/ratecon-fixtures.ts`: no name, street, number or place from the
real PDFs; only the printed headings are the layout's. 15 new in
`templates.test.ts`: recognised as this layout only, and no other layout's
fixture as it; the load number, agreeing and not; the stops and their
sources; the wrapped street, marked; the time and the 24-hour rule; three
stops and an SO before the last; the refusals above; pasted text; nothing
of the name, commodity, weight, reference or rate in the read.

**Mutations** (`templates.test.ts`), each applied alone and reverted:

| Broken | Tests that fail |
|---|---|
| a name line required; one street-like line only | 1 each |
| departure N/A; the word "Arrival"; three arrival cells | 1 each |
| the wrap marked; the SO before the last marked | 1 each |
| first stop PU; last stop SO | 1 each |
| a US state; no city line in another column | 1 each |
| the table on its page; only a heading ends it | 1 each |
| the 24-hour rule; the load numbers agreeing | 1 each |
| positions needed | 0 |

Three first survived (a second street-like line, the word "Arrival", a
first stop that is not PU): their tests refused for another reason, and a
case for each was added. Positions needed is a second line of defence, as
in 3aa and 3ak: pasted lines have no heading cells.

**Checks.** `npm run check`: 216 files and 3954 tests (216 and 3939
before). The forbidden-files grep printed nothing. Real data: 172 terms
(the ten new truth entries' streets, cities, ZIPs and load numbers, the
names in the ten PDFs, and samples 16 and 17's entries), 0 hits in the
commit's added lines and in its message. E2e: not run, as the phase stopped
before its end.

**Found wrong in the brief:**

1. d1 is not a new layout. It is `stop-table`'s, refused by one phone.
   `readRatecon` says "not recognised" both when no layout matches and when
   one matches and refuses; `recognisedLayouts` tells the two apart.
2. "Each a different layout" holds among the ten, but d7's layout is also
   samples 16 and 17, and d2's is also samples 7 and 11. A template that
   reads an older copy of its own layout changes that sample's score line,
   so the gate stops the phase even when the read is the point.
3. The ten sort after every existing sample, as the brief says, but d10
   sorts before d2: d-numbers and sample numbers do not run in step.

**Questions for Alex:**

1. Sample 17's truth gives both streets without their second printed line,
   the street-type word. Correct the truth to the whole printed street (then
   `stop-detail` reads sample 17 right), or read only a street's first line?
   Recommended: correct the truth, and keep joining and marking.
2. May a new template read older samples of its own layout (17 now; 7 and
   11 for d2), each such sample's result reported, without stopping the
   phase? If yes, the next session builds d6, d4, d5 and d2.
3. d7, stop 2: the template fills the street as printed, two words run
   together, and marks it; the truth has them apart, so that field fails the
   bar. Keep the truth as a dispatcher types it, or write it as printed?
4. d1: accept a phone printed as three groups separated by spaces in
   `stop-table` (a change to an existing template), as a phase of its own,
   or not?
5. Sample 16's arrival is a window. Read it as one in `stop-detail` (sample
   16 would then be scored), or keep refusing it?

**Alex's answers (2026-10-29, through the 3ay brief):**

1. Correct sample 17's truth: each street includes its second printed line,
   joined with one space. Done in 3ay (`expected.json.before-3ay` beside it).
2. Yes: a new template may read older samples of its own layout. The gate
   becomes: ALLOWED, and reported per sample, a sample going from "not a
   template layout" to read by a new template of its own layout. STOP on any
   field wrong and not marked Check, any change of layout or field result for
   a sample an existing template reads, or any sample going from read to
   refused.
3. d7, stop 2 (sample 38): the truth stays as a dispatcher would type it.
   The field stays FAIL in the score, reported as "wrong, marked Check".
4. Yes: `stop-table` accepts a phone printed as digit groups separated by
   spaces, so d1 (sample 31) reads; its own commit; samples 5 and 30 score as
   before.
5. Yes: `stop-detail` reads a time window (sample 16) as the other templates
   read windows; a clock or window it cannot read with certainty stays
   unreadable or refused; sample 16 with no unmarked wrong field.

### Phase 3ay: 3ax continued, four more templates, and stop-table reads d1 (2026-10-29)

From the advisor's brief, on Alex's answers to 3ax (recorded under "Phase
3ax"). Local only: no AI call, no network, no paid call. **NOT pushed.**
Built on `0d4e463`, two ahead of `951815b`, clean. No change to the AI
reader, redaction, the routes, the DB, migrations, the worker or env.
Rule: design-spec §12.147 (new).

**Commits:**

- `22fb664`: `stop-detail` reads a window under "Scheduled Arrival" (answer 5);
- `f0d5752`: `stop-table` finds a phone printed as three spaced digit groups
  (answer 4);
- `dbb27b6`: an eighth template, `pickup-drop-blocks` (d6's layout);
- `07970df`: a ninth, `location-blocks` (d4's), with `stamp` and
  `stampedTime`, one reading of "MM/DD/YYYY HH:MM" for it and the eighth;
- `d63451b`: a tenth, `stop-rows` (d5's);
- `5cde16b`: an eleventh, `origin-destination` (d2's, and samples 7 and 11);
- one docs commit: this section, 3ax's answers, the "What is live" line,
  design-spec §12.147.

**Ground truth.** Sample 17 corrected (answer 1): each street now ends with
its second printed line, joined with one space. The added word was taken
from the PDF's own line by a scratch script, in normal case, not typed. The
file as it was is beside it as `expected.json.before-3ay`; one entry changed.
`ratecon:check-expected`: every written entry complete. No other entry was
touched, priorities included (question 2).

**The gate.** `ratecon:score` saved at the start, before the truth fix (the
bar 19 of 21). `ratecon:score` prints FAIL for a wrong field whether or not
it is marked, so a scratch scorer, the same pipeline, also split each wrong
field into marked or unmarked. After each commit both were compared with the
saved run.

| Commit | Samples that changed | Result |
|---|---|---|
| `22fb664` | 16 (new), 17 (truth) | 16: AI → `stop-detail`, 13 of 13; 17: 13 of 13 |
| `f0d5752` | 31 (d1) | AI → `stop-table`, from its scan, 13 of 13, every field marked as a scan's |
| `dbb27b6` | 37 (d6) | AI → `pickup-drop-blocks`, 13 of 13 |
| `07970df` | 35 (d4) | AI → `location-blocks`, 13 of 13; 37 unchanged |
| `d63451b` | 36 (d5) | AI → `stop-rows`, 13 of 13 |
| `5cde16b` | 33 (d2), 11, 7 | AI → `origin-destination`: 33 and 11 13 of 13; 7 12 of 13, one wrong and marked |

No sample an existing template read changed (samples 5 and 30 included), and
none went from read to refused. No field is wrong and unmarked anywhere.

**Per sample at the end** (fields right of 13, or 19 for three stops; the
load number and six a stop):

| Sample | d | Layout | Right | Wrong, marked Check |
|---|---|---|---|---|
| 7 | — | `origin-destination` | 12 | 1: stop 2's appointment (below) |
| 11 | — | `origin-destination` | 13 | 0 |
| 16 | — | `stop-detail` | 13 | 0 |
| 17 | — | `stop-detail` | 13 | 0 |
| 31 | d1 | `stop-table`, a scan | 13 | 0 |
| 32 | d10 | `pu-so-blocks` | 13 | 0 |
| 33 | d2 | `origin-destination` | 13 | 0 |
| 34 | d3 | `route-blocks` | 19 | 0 |
| 35 | d4 | `location-blocks` | 13 | 0 |
| 36 | d5 | `stop-rows` | 13 | 0 |
| 37 | d6 | `pickup-drop-blocks` | 13 | 0 |
| 38 | d7 | `stop-detail` | 12 | 1: stop 2's street (answer 3) |
| 39 | d8 | `stops-section` | 13 | 0 |
| 40 | d9 | `pu-so-blocks` | 13 | 0 |

`ratecon:score`: the bar 28 of 29 (19 of 21 at the start, 15 of 15 before
3ax). Its one FAIL is sample 38's marked street; no appointment is WRONG.
Every sample not in the table above is identical to the start, line for line.

**Sample 7, stop 2.** Its time is an hour under 13 with no leading zero, and
the document has a PM elsewhere (its signature's time). By the 24-hour rule
(§12.122, and the ground-truth how-to since 2026-10-15) that is not a time
anyone can enter, so the template fills the date, leaves the time blank and
marks it "Couldn't read". The truth, Alex's, gives the time as an
appointment (question 1).

**The new templates** (what each recognises: §12.147):

- **`pickup-drop-blocks`.** A block from its "Pickup" or "Drop" heading to
  its own INSTRUCTIONS row, on one page; the right column starts at
  "Earliest:". Earliest to Latest is the window. The street row's ", c/o "
  is left out only when the stop's own name follows it; any other "c/o" is
  refused, any other comma kept. Load number: the "ORDER" line, when
  "Service for Load #" agrees.
- **`location-blocks`.** A block from its label to the next or the end of
  its page; the dates and times beside "Pickup:", or on the line under
  "Delivery Date and Time:", and nowhere else. A label line with anything
  more on it is refused. Load number: the "Load Number:" line, the same on
  every page.
- **`stop-rows`.** A row between the full-width rows that start left of the
  location column; number and type on one line, two AM/PM times. The blank
  the layout prints as "null" is no value. Every stop's line in the document
  must be this table's, and nothing after the last row may be a time or a
  city line. Known limit: a stray line just above a row's name cannot be told
  from the name's first line, and is read as part of the name, which is
  never filled. Load number: after "Order #", the same everywhere.
- **`origin-destination`.** Two panels, each with "Date:", "Time:", "From:"
  and "Email:" once; the address from "From:" to the line before "Email:".
  The weekday must be the date's. Notes are not read (d2's destination has
  one). Load number: after "Load #".
- **`stop-detail` windows:** "HH:MM -" with the end on the line under it, on
  the same date; any other shape refused.
- **`stop-table`'s spaced phone:** three tokens of 3, 3 and 4 digits. With
  parentheses, or other group lengths, a spaced phone is still refused. The
  ZIP must still follow.

**Tests.** Invented fixtures only (`stopDetail` widened; `pickupDropBlocks`,
`locationBlocks`, `stopRows`, `originDestination` and their stops, in
`src/test/ratecon-fixtures.ts`). 58 new in `templates.test.ts`: 3, 1, 15, 13,
13 and 13 by commit. Each new layout's block checks that its fixture is
recognised as it alone and that no other layout's fixture is recognised as
it; the earlier blocks check their own the same way.

**Mutations** (`templates.test.ts`), each applied alone and reverted:

| Commit | Applied | Fail a test | Not failed |
|---|---|---|---|
| `22fb664` | 5 | 5 | — |
| `f0d5752` | 4 | 4 | — |
| `dbb27b6` | 19 | 18 | positions needed |
| `07970df` | 15 | 14 | positions needed |
| `d63451b` | 17 | 16 | positions needed |
| `5cde16b` | 13 | 12 | positions needed |

Positions needed is a second line of defence, as in 3aa and 3ak. First runs
left survivors whose tests refused for another reason: a case was added for
each. Five checks that no mutation could fail were removed, as 3ak did:
INSTRUCTIONS before the next heading (`pickup-drop-blocks`, which now also
counts "Earliest:" once, not twice); the "Page n of m" stop
(`location-blocks`); only "null" beside a row (`stop-rows`); the heading
cells' text and the labels' order (`origin-destination`). What each guarded
is refused by another rule, named in the code. `07970df`'s message says 16
mutations and 15 failing: the sixteenth was the "Page n of m" stop, removed
in that commit, so 15 and 14 is right.

**Checks.** `npm run check`: 216 files and 4012 tests (216 and 3954 at the
start). The forbidden-files grep printed nothing. Real data: 192 terms (the
3ax entries, sample 17 as corrected, samples 7, 11 and 16, and the names in
those PDFs); 89 were excluded as already in the repo before 3ax; 0 hits in
the added lines and messages of all seven commits. E2e, once:
`npm run e2e -- ratecon-`, 7 of 7 passed in 45.0 s, run folder
test-results/2026-10-29T18-59-49-904Z, the machine awake throughout.

**Found wrong in the brief:**

1. The gate's "wrong and not marked Check" cannot be read off
   `ratecon:score`: it prints FAIL for a wrong field marked or not, and
   "Appointments silently wrong: see FAIL above" whenever any field fails,
   even with no appointment WRONG (as now). A scratch scorer did the split
   (question 3).
2. The report list is samples 16, 17 and 31 to 40, but the d2 template also
   reads samples 7 and 11 (rule 2). They are in the table above.

**Questions for Alex:**

1. Sample 7, stop 2: keep its truth (an appointment at the printed time), so
   the field stays wrong and marked; or write it as "couldn't read" with its
   date, as the how-to's 24-hour rule gives?
2. Set priority 2 on every sample a template now reads (7, 11, 16 and 17;
   31, 33 and 35 to 38)? With priority 1, if a template later stopped
   reading one, `ratecon:score` would print "ground truth for the AI
   evaluation only" instead of FAIL.
3. `ratecon:score`: print a wrong field that carries a Check as "FAIL
   (marked)", and "none" for silently wrong appointments when none is WRONG?
   A small script change, in a phase of its own or not.
4. When to push 3ax and 3ay.

## Next

Rewritten 2026-10-15. Every claim names the phase it comes from; "unverified"
means no phase section says it. **Sample numbers:** 3w added a sample, so
phases before 3w use the old numbers, and old 22 to 28 are 23 to 29 now.

### 1. Where things stand

- **The reader is ON in production since 2026-10-15** (off until then;
  `LLM_READER_ENABLED` is still set in no env file in the repo, 3m, 3s, and
  the e2e server sets it itself, with the fake vendor, 3m). Who reported what
  ("the advisor" is the assistant reviewing for Alex, outside this repo):
  - **Alex reports:** `npm run gate` passed before the push, e2e 248 passed
    (the output's tail). Master was pushed at `cc0e60d` (55 commits; this
    repo's `git status` agrees: up to date with `origin/master`). A separate
    production key was created and added in Vercel as `LLM_READER_API_KEY`,
    Production only. The Anthropic spending limit is set. The reader is on:
    Alex used it live, and the AI strip appeared. Alex's first read of one
    broker PDF left a stop's appointment blank and marked because the two
    reads differed; a second drop of the same PDF filled it.
  - **The advisor verified:** GitHub's deployments API shows a Production
    deployment for `cc0e60d` with status "success" (curl). All 30 migrations
    (0000 to 0029) were applied to the hosted database before the push
    (read-only query: 30 applied, the layout column present). Counts only,
    read-only: 3 rows in `ratecon_ai_reads`, all outcome `ok`, vendor
    `anthropic`, the same input each time (31 lines, 6,652 input tokens);
    1 outcome row so far.
  - **Unverified:** the vendor, model and flag values in Vercel (Alex reports
    them; the advisor saw only that the key exists); which workspace the
    spending limit is on; whether the worker on the droplet needs a redeploy
    (it was not redeployed; the only worker-area file changed in the 55
    commits is `src/db/schema.ts`, new tables and a column only). 3 counts
    rows against two drops reported: not reconciled (a counts row is one
    pair, 3s).
- **Run 10 met the bar** (3u): 36 of 36 runs scored, zero WRONG on all seven
  bar fields, merged and in each read alone; 72 calls, $0.1191, on the 12
  unrecognised files.
- **It covers 12 of 25 files** (3u; 26 have a text layer since 3w and 3y), 3
  runs each, one model (Haiku 5.5, 3u), and the six control files have not
  been re-run since 3e (3u).
- **Code changed after run 10:** rule C, redaction `.5` (3w; the 12 files'
  sent text is byte-identical, so 3u's result stands for it), the verifier
  (3x) and the appointment check (3v). Run 11 (3z) ran under them; the bar was met.
- **All 30 migrations are applied to the hosted database, and master is
  pushed at `cc0e60d`** (2026-10-15; see the first bullet).

### 2. Open risks

1. **The silent WRONG appointment (3u): sample 10, run 2, stop 1** (type, time,
   end time). Both reads gave the same wrong parts and agreed, so nothing
   marked it; appointments are not on the bar, which does not see it (3u).
   **What 3v changed:** a filled appointment on a model read now always
   carries "Check: the AI filled this appointment. Confirm the date and time
   against the PDF." (not for a template read, a blank, "No date or time",
   "Couldn't read", or one the pair blanked), so the silent-WRONG category
   cannot occur by construction (3v). It does not make the appointment right,
   and no run has measured it. **Its cost** (3v): every AI read leaves at least
   one "field to check" per filled appointment, and "Looks right" does not
   clear it; "Looks right" could clear this one check, not done.
2. **The 3q question (3r, 3u): agreement compares the quoted values before the
   fill strips trailing punctuation** (3q strips it in the form only). Sample
   12's four streets differ between the reads in two of three runs again (3u)
   and the merge blanks them. The counts cannot say the difference is only a
   trailing mark (3r). Comparing after the same punctuation and case rules is
   small and needs its own decision (3r). Not changed.
3. **The blanks the zero still contains (3u):** 24 ZIP cell-runs (samples 4, 7,
   9, 10, 11, one stop, every run; sample 12, stops 2 to 4, every run), 8
   street (sample 12, all four stops, runs 1 and 2) and 2 city-and-state
   (sample 7 stop 2 and sample 11 stop 2, run 1). All marked, left for the
   dispatcher. **3w found the cause for the ZIPs on samples 7 and 11:** the
   label rule masks a city line that follows a five-letter label, so the model
   never sees that ZIP. It was the redaction, not the model. **The fix is not
   planned: redaction is frozen at `.5`** (decision, 2026-10-15, "The AI reader's use and redaction"); the 3w finding stays as a
   known limit.
4. **Ground truth and comparability after 3x (3x):** an entry written as a
   couldn't-read for a bare time in a 24-hour document is now stale and would
   score the AI's correct time as WRONG; `expected.json` was not read. **It
   matters only for a scored run:** no new ground truth is required, and the
   check is Alex's comparison of the filled form to the PDF and, after launch,
   the outcome counts (3s queries) (decision, 2026-10-15, "The AI reader's use and redaction"). Appointment numbers on 24-hour
   documents are not comparable across 3x.

### 3. The decision for Alex: turn the reader on or not

**Turned on in production on 2026-10-15** (Alex; section 1). The settings
are in Vercel, Production, server only (names only, no values here):
`LLM_READER_ENABLED`, `LLM_READER_VENDOR`, `LLM_READER_MODEL`,
`LLM_READER_API_KEY`; the caps `LLM_READER_USER_DAILY_CAP` and
`LLM_READER_DAILY_CAP` default to 25 and 100 when unset (2b). **Rollback:**
unset `LLM_READER_ENABLED` or set it to `false`, and redeploy (unset, `false`
or `0` is off: `src/env/schema.ts:391` to `395`). What each answer needed,
kept as the record:

**Keep it off.** Nothing further is needed. The pair (3m), the outcome
recording (3s, only for a read that filled the form) and the layout
fingerprint (3y) stay built and unused.

**Turn it on.** It needs all three of these:

1. **Open decision #1, answered** (see "Open decisions", above):
   - EU processing: **settled.** Not required (decision, 2026-10-15, "The AI
     reader's use and redaction").
   - Flagged content: **settled.** Alex accepts Haiku 5.5 with default
     retention (decision, 2026-10-15, "The AI reader's use and redaction"); before it, 3h and 3u had accepted the default for
     those runs only.
   - The basis for "sending is allowed": **settled.** Business judgment, not
     the brokers' confidentiality clauses (decision, 2026-10-15, "The AI
     reader's use and redaction").
   - Still unread from open decision #3: data-processing agreements,
     sub-processors, what "flagged" means in practice, SOC 2/ISO reports.
     Not decided here.
2. **The migrations, in production, before the code that names them: 0026,
   0027, 0028 and 0029.** 0026 is the counts table (2a) and 0027 adds the `anthropic`
   vendor and `vendor_capped` outcome (2b), which the route's rows use; 0028 adds the outcome tables (3s); 0029 adds the layout
   column to 0028's table (3y), so it comes after 0028. **0029 goes to
   production first, then the code** (3y, approved 2026-10-15): the insert
   names the column, and a database without it answers every outcome post
   with a 500 (3y). **Done:** all 30 migrations (0000 to 0029) were applied
   to the hosted database before the push, 2026-10-15 (the advisor, read-only
   query; section 1).
3. **The settings** (server only; "Language-model reader", 2b): the flag on,
   `LLM_READER_VENDOR=anthropic`, `LLM_READER_MODEL` (`claude-haiku-5-5`, or
   `claude-sonnet-5-5` by env only), `LLM_READER_API_KEY`. The daily caps stay
   25 a user and 100 a day, counting reads; at the cap about $0.33 a day on
   Haiku (3m). The account spending limit is set (decision, 2026-10-15,
   "The AI reader's use and redaction"); which account or workspace it is on:
   unverified (2b records the evaluation key's). A separate production key:
   created 2026-10-15 and added in Vercel as `LLM_READER_API_KEY`, Production
   only (Alex reports; section 1).

**Whether the six controls get a re-run first** is a separate question under
"turn it on":

- **Why it might matter:** they were run in 3b and 3e, before most of the code
  (3r), and 3u says they have not been re-run since 3e. The six are samples 1,
  18, 19, 23, 24 and 28 now (3w's renumbering of 1, 18, 19, 22, 23, 27).
  Template-read files are read by templates, not by the reader (3r).
- **What a re-run needs:** a new written approval naming the files (3b; a
  sent-text hash named in an earlier approval is void, 3u, 3w), and the
  script's ceilings of $1.00 and 75 calls (3b-prep, 3u). At about $0.0033 a
  pair (3m, 3u), 18 pairs is about $0.06 (arithmetic, not a measurement).
  **Ground truth and a redaction review are no longer prerequisites:** the
  check is Alex's comparison of the filled form to the PDF and, after launch,
  the outcome counts (3s queries) (decision, 2026-10-15, "The AI reader's use and redaction"). A scored run, if Alex wants
  one, has the ground truth the six already had (3b, 3e).
- **Without one,** the reader goes on with the six unmeasured since 3e.

### 4. Also open

- **Full e2e, 2026-10-14:** 246 passed (3a). The 2b follow-up's reader specs
  ran in it too.
- **The two intermittent hangs** (3b-prep: truck-lists "Adding…", timeline
  "Loading…"). Either can fail `npm run gate`; each may want its own small
  phase.
- **One live smoke call is left** of 2b's five (2b); no later phase records
  another. The evaluation calls since then are each under their own written
  approval, in their own phase (3b, 3e, 3h, 3j, 3k, 3l, 3n, 3p, 3r, 3u).
- **The dropped-stop cue folds away at the first keystroke** in the load (3c,
  3d): on a real dropped stop the warning can be gone after one keystroke.
  Not changed; worth Alex's view (3c).
- **Sample 27, stop 1** (old numbering; 28 now): the template agrees with the
  ground truth, and the AI's appointment is marked in all three runs of 3e. No
  phase records Alex reading its lines in the viewer: unverified.
- **The verifier never reads a day-first named date or a numeric date range**
  (3z): `16-Oct-2026`, `16 Oct 2026`, `16OCT26` or `10/16-10/17` leaves the
  date null, the appointment blank and marked "Couldn't read", and the
  dispatcher enters it. Sample 21's blanks are likely this: unverified (3z).
  A stop whose truth is FCFS at 120 minutes or less is filled as APPT with a
  window and cannot score "same" (3z). Not changed; day-first parsing would
  be a new phase, and is Alex's decision.
- **ZIP+4 (3ab):** the verifier now fills the five digits of a ZIP+4 the city
  line prints (`aa9c5b2`). Not deployed, and no run measures it; the 15 of
  run 11's 24 blank ZIPs it may explain are inferred from line counts.
- **Route blocks reads a middle stop, split and marked (3ac, `ce654db`):** a
  template change. 3aa, 3ab, 3ac and 3ad are pushed (`origin/master` at
  `9a475ca`); whether they are deployed is unverified (no network call here).
- **Status change log (3ad, `5341943`, `2db9c3c`):** a worker change, pushed
  and deployed. The worker went live on 2026-10-15 at 23:35 UTC: the first
  row in `eta_status_changes` (the advisor's read-only check, 2026-10-19;
  unverified here). Migration 0030 is applied to the hosted database (3ae).
  Four questions for Alex are in 3ad.
- Other open decisions are above ("Open decisions, waiting on Alex").

### 5. Watch for a week

From 2026-10-15. After about a week, Alex runs the three "Reading the
numbers" queries of 3s on the production database and `npm run
ratecon:layouts-report` (3y; it reads `DIRECT_URL`, or `LAYOUTS_REPORT_URL`
when set), and pastes the counts here. Counts only, no values. What to read:

- **How often an appointment is left blank, so a second drop is needed:**
  query 1's `appointment` row (`blank_filled`, `blank_left`). A second drop
  in one modal leaves the first read with no outcome (3s, "Two reads in one
  modal"), so it counts in query 2's gap between reads answered and reads
  saved, together with loads typed another way or abandoned. Alex's first
  live read was one such case (section 1).
- **Which layouts recur:** the layouts report's groups of similar layouts
  (3y).
- **How often a filled field is changed:** query 1's `changed` and `cleared`
  against `kept` (`pct_kept`), by field; query 3's reads saved untouched.

Nothing is decided here: any change these counts suggest is Alex's call.

### The old "Next" list, item by item

| Old item | Now | Phase |
|---|---|---|
| "Run 1 is done: the bar is NOT met" | Superseded: the bar is met | 3u (3r: 0 WRONG in 35 of 36) |
| Stop count WRONG, sample 22 run 3 | Superseded | 3e, 3r, 3u |
| Appointment WRONG, sample 27 stop 1 | Superseded: marked in 3e; by construction in 3v | 3e, 3v |
| 1. Review the redaction | Done for the twelve (five in 3h, all twelve under `.4` in 3u; text unchanged under `.5`). Controls: unverified. Unmasked patterns: known limits | 3h, 3u, 3w, 3t |
| 2. The labelled-name gap | Done | 3a-3 |
| 3. Write ground truth | Done for the twelve, sample 12 included (scored with its four stops), and for the six controls (scored in 3b, 3e). Stale entries after 3x matter only for a scored run; no new ground truth is required (decision, 2026-10-15) | 3h, 3u, 3b, 3e, 3x |
| 4. Approve step 1 in writing | Done per run; each run needs its own | 3b, 3h, 3u |
| 5. Dropped-stop cue | Narrowed; "outlast the first keystroke" still open | 3c, 3d |
| 5. Wire in the pair, or keep single reads | Done: wired, and a failed pair fails whole | 3m, 3f |
| 5. Per-read appointment diagnostics | Done | 3f |
| 5. The exit code | Done | 3c |
| "Must approve before step 1": vendor, model, settings | Used in every run; for production, item 3 above | 3b-prep, 3u |
| Retention | Accepted per run (3h, 3u); the default accepted for use by the decision of 2026-10-15. EU processing and the basis for sending are decided too (not required; business judgment) | 3h, 3u |
| Files by number; runs per file | Superseded: each run's approval names its files | 3b, 3h, 3u |
| Spend ceiling $1.00 and 75 calls | Enforced by the script; used in 3u | 3b-prep, 3u |
