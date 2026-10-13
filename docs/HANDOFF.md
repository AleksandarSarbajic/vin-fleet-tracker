# Handoff

State on 2026-10-14. Phase 2b of the language-model reader is built: the
Anthropic adapter, behind `LLM_READER_ENABLED` (off by default, and OFF in
production; nothing went to Vercel). It has been called live only with
invented text. See "Language-model reader" below. `npm run check` passed on
2026-10-14 (169 files, 2431 tests).
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

**Env (server only):** `LLM_READER_ENABLED`, `LLM_READER_VENDOR` (`fake` —
refused in production — or `anthropic`), `LLM_READER_MODEL`
(`claude-haiku-5-5` or `claude-sonnet-5-5`, nothing else),
`LLM_READER_API_KEY` (refused if any `NEXT_PUBLIC_*` equals it),
`LLM_READER_FAKE_SCRIPT`, `LLM_READER_USER_DAILY_CAP` (25),
`LLM_READER_DAILY_CAP` (100). Now listed in `.env.example`.

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

A 400 bills nothing; run 4 cost about $0.001 at Haiku's rates.

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

- **`vendor_capped` covers two more cases than the 400 named:** the 429 of a
  tier's monthly cap (`enforced_spend_limit_reached`) and a 402. Both mean
  "no money, an admin must act", per Anthropic's docs. A prepaid balance
  run dry is not covered: its wording is not documented; it shows as
  `unavailable`, with the status in the log.
- **Migration 0027 adds an outcome too** (`vendor_capped`), not only the
  vendor: the counts row stores the outcome as an enum.
- **`inference_geo: 'global'` is sent.** The prompt listed what to send and
  did not name it; design §6 requires the region set in code. `global` is
  the default and costs 1× (`us` is 1.1×). Anthropic has no EU option and
  no per-request no-storage option.
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

**Proposed, not built: a `.next/static` scan for the key's value.** It
needs a production build with the key in the environment. The e2e run
already builds once; a step after that build could grep `.next-e2e/static`
for `LLM_READER_API_KEY`'s value and fail on a hit. Waiting on Alex: it
would put the real key in the e2e build's environment.

**Found, not fixed:** a BLANK `LLM_READER_USER_DAILY_CAP=` or
`LLM_READER_DAILY_CAP=` is read as 0 and refuses boot (the caps are not
wrapped in `blankIsAbsent`). `.env.example` leaves them commented out.

Every way the build differs from the design, phases 1 and 2a, is listed in
`llm-reader-design.md` §11.

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

## Next

- **Phase 2b waits for Alex's approval.** Built, `npm run check` green,
  one successful live call with invented text. Not deployed; the reader is
  off in production.
- **Decisions for Alex from 2b:**
  - An unlisted `LLM_READER_MODEL` refuses to boot the WHOLE app, as an
    unknown vendor already does (every route imports `serverEnv`). A
    missing one only turns the reader off. Keep, or make an unlisted id
    turn the reader off too?
  - The `.next/static` key scan (above): worth the real key in the e2e
    build's environment?
  - `inference_geo`: `global` (1×) or `us` (1.1×)?
- **The two intermittent hangs above** (truck-lists "Adding…", timeline
  "Loading…"). Either can fail `npm run gate`; each may want its own small
  phase.
- **Phase 3** (real samples, §8.2) needs its own go-ahead. Compare
  `EFFORT`/`THINKING` there; Sonnet 5.5 has not been called yet.
- **Before the route can count in production,** migrations 0026 and 0027
  must be applied there.
- Other open decisions are above.
