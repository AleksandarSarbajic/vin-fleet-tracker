# Handoff

State on 2026-10-09. Last code commit: `2eba5a1` (React #418 fixed,
§12.124), deployed to production (Vercel deployment 6962860702, success).
After it: the hydration e2e now runs in a browser zone the server is not in,
and this document plus `docs/llm-reader-vendors.md`. `git log` has the newest.

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

PDF fill reads three layouts (label rows, stops section, PU/SO blocks). It
never sends the file anywhere. Real use so far: 5 loads, 2 filled, 1 scan
with no text layer, 2 "layout not recognised".

## Rules for rate confirmations (from Alex, standing)

- Real PDFs live only in `.samples/` (git-ignored). Never commit, copy, upload,
  log or screenshot them. Tests use invented fixtures only
  (`src/test/ratecon-fixtures.ts`, `src/test/tiny-pdf.ts`).
- No report prints a rate, broker contact, phone, email or driver name.
- No real document goes to any outside service. Do not choose a vendor.
- `git ls-files | grep -iE "\.pdf|expected\.json|samples"` must print nothing.

## Open decisions, waiting on Alex

1. **Language-model reader: yes or no.** It would cover layouts and scans
   the templates miss. Proposal (2026-10-09): send only the text of the stop
   pages (scans: read with OCR in the browser first), with rates and contacts
   removed in the browser, through our server. Nothing is built, nothing has
   been sent, and no vendor is chosen.
2. **Broker confidentiality.** Rate confirmations often carry
   confidentiality clauses. These may rule out sending even redacted text to
   any vendor. This has to be answered before the vendor question matters.
3. **Vendor terms**, if the answer to 1 is yes. Researched 2026-10-09; see
   [`llm-reader-vendors.md`](llm-reader-vendors.md) (vendor defaults, may
   change, not legal advice). In short:
   - Every vendor read says no training on API data by default, except
     Mistral, which is unconfirmed.
   - Anthropic's own API has no EU processing option today.
   - AWS Bedrock stores no prompts by default, except for some models.
   - Azure, OpenAI and Google offer EU processing, each with conditions.
   - Still to read: data-processing agreements, sub-processors, what
     "flagged" means in practice, and SOC 2/ISO reports.
4. **Sentry read token.** `SENTRY_READ_TOKEN` in `.env.local` returns 401
   "Invalid token". A new read-only token is needed before any Sentry
   question can be answered, including confirming that #418 has stopped and
   the tracing report (re-run once there are 10+ real sign-ins).
5. **Sleep test.** Alex runs e2e, closes the lid mid-run, and confirms the
   end-of-run line names the sleep.
6. **The "worker feeding knowledge" question**, as Alex named it on
   2026-10-09. It isn't written down in any session so far: get the question
   from Alex before doing anything with it.
7. **Fourth layout** (a 4-stop, 9-page confirmation; correctly refused
   today): is "Route #" the load number; what does "Scheduling: Open" mean;
   can more samples from that broker be had?
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
- Not yet confirmed in Sentry (item 4).

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

## Next

Nothing is in progress. Wait for Alex on the open decisions above, then work
in the order Alex picks.
