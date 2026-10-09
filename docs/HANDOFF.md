# Handoff

State on 2026-10-09. Last code commit: `99365d0` (stale-poll "Not updating",
§12.123), deployed to production (Vercel deployment 6959715840, success).
`master` and `origin/master` match; the working tree is clean.

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

## Waiting on Alex

1. **Fourth layout** (a 4-stop, 9-page confirmation; correctly refused today):
   is "Route #" the load number; what does "Scheduling: Open" mean; can more
   samples from that broker be had? Nothing is built until answered.
2. **Language-model reader** for layouts and scans the templates miss.
   Proposal given in the session of 2026-10-09: send only the page text (or
   page images for scans) of the stop pages, with rates and contacts removed
   in the browser first. Needs a vendor decision after reading their
   retention, training and sub-processor terms. Nothing chosen, nothing sent.
3. **Sleep check:** Alex runs e2e, closes the lid mid-run, and confirms the
   end-of-run line names the sleep.
4. **Sentry read token** (`SENTRY_READ_TOKEN` in `.env.local`) now returns
   401 "Invalid token". A new read-only token is needed before any Sentry
   question can be answered, including the tracing report (re-run once there
   are 10+ real sign-ins).
5. **Stage 4 scope:** the window-order and date-range checks cover filled
   stops only. Should typed stops get them too?

## Open problem: React error #418 on production

A hydration mismatch, seen in Alex's console. Not confirmed in Sentry (token
above). The likely cause is found in code: `HeaderClocks`
(`src/components/console/HeaderStatus.tsx`) reads the viewer's time zone
while rendering. The server renders in UTC, and a browser in Europe renders
in its own zone. The "YOU" clock text and its title differ on every load of
the board and the history page. That code dates from phase 3 (2026-09-17),
so the mismatch is older than `99365d0`. E2e cannot see it: the test server
and the browser share the machine's zone.

Proposed fix (not built): render the viewer clock only after mount. Keep the
zone in state as `null` on the first render, set it in an effect, and show
the "YOU" clock and title once known. The same change should keep
"Not updating" off until mount. Today it compares the server's fetch instant
with the browser's clock, so a browser clock more than 60 s behind would also
mismatch.

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

1. On Alex's OK: fix #418 as above, with a test that renders on the server in
   one zone and hydrates in another.
2. Then, in the order Alex picks: Stage 4 scope, the fourth layout, the
   language-model reader.
