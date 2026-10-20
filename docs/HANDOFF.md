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
