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
