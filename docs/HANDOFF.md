# Handoff

State on 2026-10-13. Phase 2a of the language-model reader is built: the
route, the counts table, the UI and the Sentry hardening, through a FAKE
vendor only, behind `LLM_READER_ENABLED` (off by default). See
"Language-model reader" below. `npm run check` passed on 2026-10-13
(167 files, 2348 tests).
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

1. **The language-model reader's vendor.** Not chosen. Build nothing
   vendor-specific until it is. Still open with it:
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

**Env (server only):** `LLM_READER_ENABLED`, `LLM_READER_VENDOR` (`fake`
only; refused in production), `LLM_READER_MODEL`, `LLM_READER_API_KEY`
(refused if any `NEXT_PUBLIC_*` equals it), `LLM_READER_FAKE_SCRIPT`,
`LLM_READER_USER_DAILY_CAP` (25), `LLM_READER_DAILY_CAP` (100).

**Not applied anywhere but the local test cluster:** migration 0026. It must
be applied to production before the route can count there.

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
  header's dot, and the baseline does not. The first poll lands before the
  shot.
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
- **It blocks `npm run gate`:** on a bad draw, the gate's e2e step fails.
- **Not fixed and not re-saved.** It needs its own small phase.

## Next

- **Phase 2a waits for Alex's approval.** It is built, and its e2e runs and
  passes.
- **A small phase for the "Synced 0s ago" baseline flake,** above. Until it
  lands, `npm run gate` can fail on it.
- **Phase 2b (one real adapter)** needs the vendor chosen first.
- **Before the route can count in production,** migration 0026 must be
  applied there.
- Other open decisions are above.
