# Handoff

State on 2026-10-14. Phases 3a and 3a-2 of the language-model reader are
done, local only: the evaluation PREP, and a second redaction pass that lets
all 25 text-layer samples be prepared. Nothing was sent anywhere and the API
key was not used. Phase 2b and its follow-up are built: the Anthropic
adapter, behind `LLM_READER_ENABLED` (off by default, and OFF in production;
nothing went to Vercel). It has been called live only with invented text.
See "Language-model reader" below. `npm run check` passed on 2026-10-14
(170 files, 2503 tests).
`git log` has the newest; the deploy is checked with the curl calls under
"How to run the checks".

Read `CLAUDE.md` first. Build from `docs/design-spec.md`; each feature below
names its § there.

## What is live

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

## Open decisions, waiting on Alex

1. **The language-model reader's vendor: Anthropic** (decided
   2026-10-13/14; see above). Still open with it:
   - **EU processing:** is it required? If so, Anthropic's own API is out
     today.
   - **Flagged content:** is the vendors' retention of flagged inputs
     acceptable (up to 2 years at Anthropic)?
   - **The basis for "sending is allowed":** the brokers' confidentiality
     clauses, or a business judgment? Write down which.
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

**Phase 2b is built:** the Anthropic adapter. Still OFF in production, and
nothing was deployed.

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

## Next

**Evaluation run 1 (phase 3b) is done: the bar is NOT met.** That was 18
calls on the six control files, at $0.0280.

- **Stop count WRONG:** sample 22, run 3.
- **Appointment WRONG:** sample 27, stop 1, all 3 runs.

The reader stays off. Nothing was fixed; what to change is Alex's call (the
proposals below).

**What Alex does next, in this order:**

1. **Review the redaction** of each text-layer file:
   `npm run ratecon:review-redacted <n>`, then open the URL it prints.
   - Start with the 12 unrecognised files: 2, 4, 7, 8, 9, 10, 11, 12, 16,
     17, 21, 28. All 25 text-layer files now pass the re-scan, so nothing
     is highlighted.
   - Look first at the lines that hit before 3a-2 (the table in "Phase
     3a-2"): are they masked as they should be?
   - Look at the lines the 3a-3 person pass masked (the table in "Phase
     3a-3"): a name taken, or something the read needs?
   - Still not caught: a name sharing a cell with a non-name word after its
     label's cell, a name on the next line, and a name after a phone label.
   - For every file, say what is NOT masked that should be: a name, a phone,
     anything. Describe the pattern in invented words; it is fixed with an
     invented test case and step 0 re-run. Or sign the file off.
2. ~~Decide the labelled-name gap~~: decided (fix it) and closed in 3a-3.
3. **Write ground truth,** per `docs/ground-truth-howto.md`.
   - Priority 1 first, then priority 2.
   - `npm run ratecon:check-expected` shows what is left.
   - Decide sample 12: give its entry stops (it changes an existing entry),
     or leave it out of the evaluation.
4. ~~Approve step 1 in writing~~: approved 2026-10-14 for the six control
   files and run once (phase 3b). The next run, on the unrecognised files,
   needs its own written approval naming them.
5. **Decide what to do about run 1's findings:**
   - **A dropped stop:** the cue is narrowed (3d): 1 of 6 control files
     with nothing dropped, and it misses a dropped first stop. Still to
     decide: whether it should outlast the first keystroke.
   - **Two-read agreement** (3d, not wired). Run 2 (3e, paired) made no
     WRONG and turned sample 27's silent appointment WRONG into a marked
     blank in 3 of 3 runs. But it blanked 3 appointments the model reads
     right in run 1, and no stop was dropped to test the case it was built
     for. Decide:
     - wire it in (a pair is one read against the cap; decided in 3f);
     - keep single reads with the cue;
     - or first add per-read appointment diagnostics and run again.
     ~~Also decide what a pair with one failed read does~~: decided in 3f.
     It fails as a whole.
   - **Sample 27, stop 1:** Alex reads its appointment lines in the viewer
     and says whether the ground truth or the read is right. The template
     agrees with the ground truth there.
   - ~~The exit code~~: done in 3c.

**What Alex must approve before step 1** (design §8.2). The figures are
proposals:

- **Vendor, account and settings:**
  - Anthropic, `claude-haiku-5-5`, effort `low`, no thinking parameter,
    `inference_geo: global`, one attempt per call. Sonnet 5.5 only if named.
  - **Retention:** the account's default is deletion within 30 days, and
    flagged content kept up to 2 years. Zero retention is by agreement only.
    Is the default acceptable for redacted text?
  - The key in `.env.local`, in its own workspace, with a spend limit.
- **Files, by number:** only those that pass all three of these: residue 0
  after step 0, Alex's redaction sign-off, complete ground truth.
  - **The test group, unrecognised:** 2, 4, 7, 8, 9, 10, 11, 12, 16, 17,
    21 and 28 all pass step 0 since 3a-2. Sample 12 has no stops in its
    ground truth.
  - **The control, template-read,** which the AI is run on too: 1, 13, 14,
    15, 18, 19, 20 and 22–27 all pass step 0. Complete ground truth today:
    1, 18, 19, 22, 23, 27 only.
- **Runs per file:** proposed 3. With no temperature the model is not
  deterministic, so one run could mislead.
- **The spend ceiling:**
  - **Estimate:** the smoke read was 3117 in and 1565 out on 20 lines
    ($0.0011). The largest file sends 285 lines; call it 15k in and 3k out,
    about $0.003 a run on Haiku.
  - **Worst case:** 25 files × 3 runs is 75 calls, at most about $0.23 on
    Haiku, or about $4.50 on Sonnet.
  - **Proposed:** a hard ceiling of **$1.00** and **75 calls**, both enforced
    by the script, which stops before a call would pass either. Built so
    (3b-prep); the most 75 calls could cost at their bounds is about $0.55.

**Also open:**

- **Full e2e, 2026-10-14:** 246 passed. The 2b follow-up's reader specs ran in it too.
- **The two intermittent hangs above** (truck-lists "Adding…", timeline
  "Loading…"). Either can fail `npm run gate`; each may want its own small
  phase.
- **One live call is left** of 2b's five. None was made in 3a, 3a-2, 3a-3
  or 3b-prep. Phase 3b made the 18 approved evaluation calls, and no
  others.
- **Before the route can count in production,** migrations 0026 and 0027
  must be applied there.
- Other open decisions are above.
