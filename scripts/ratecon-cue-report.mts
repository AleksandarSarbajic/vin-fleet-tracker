/**
 * The dropped-stop cue, measured OFFLINE (no model, no network):
 * `npm run ratecon:cue-report`. Counts only, per file by number; never a
 * line of text, a value or a file name.
 *
 * Per text-layer sample, on exactly what would be sent:
 *   - how many sent lines look like a US city, state and ZIP
 *     (`looksLikeAddressLine`, the cue's own test);
 *   - the known stop count: the template's read, and the ground truth's
 *     where it is complete;
 *   - for a file a template reads, how many of those lines the TEMPLATE
 *     did not read from. That is the cue on a read that dropped nothing and
 *     cited what the template used: it would fire if any is left. A model
 *     cites quotes, not whole lines, so this is an estimate;
 *   - of those, how many come after the first line a stop was read from: a
 *     possible narrowing (a header's address comes before the stops), only
 *     measured here, not built into the cue.
 */
import { readFileSync, existsSync } from 'node:fs';
import { looksLikeAddressLine } from '../src/lib/ratecon/address-cue';
import type { Line } from '../src/lib/ratecon/lines';
import { prepareForReading, selectPages } from '../src/lib/ratecon/redact';
import { readRatecon, type RateconRead, type Source } from '../src/lib/ratecon/templates';
import { EXPECTED_PATH, readSample, sampleFiles } from './ratecon-corpus.mts';
import { ExpectedFile, inspect } from './ratecon-expected.mts';

/** The six control files of evaluation run 1. */
const CONTROL = new Set([1, 18, 19, 22, 23, 27]);

/** Every line a template read took a value from; `stopsOnly` leaves out the load number's. */
function sourcesOf(read: RateconRead, stopsOnly = false): Source[] {
  const out: Source[] = [];
  if (read.loadNumber && !stopsOnly) out.push(read.loadNumber.source);
  for (const stop of read.stops) {
    out.push(stop.type.source);
    for (const f of [stop.street, stop.city, stop.state, stop.zip]) if (f) out.push(f.source);
    if (stop.time.source) out.push(stop.time.source);
  }
  return out;
}

/**
 * Indexes in `chosen` of the lines the template read from: by page and by
 * text, the whole line's or one cell's (the columns layout cites a cell).
 */
function citedIndexes(chosen: readonly Line[], sources: readonly Source[]): Set<number> {
  const cited = new Set<number>();
  for (const s of sources) {
    chosen.forEach((l, i) => {
      if (l.page === s.page && (l.text === s.text || l.cells.some((c) => c.text === s.text))) cited.add(i);
    });
  }
  return cited;
}

async function main() {
  const files = sampleFiles();
  if (files.length === 0) {
    console.info('No .samples/rate-confirmations/ PDFs here, so nothing to report.');
    return;
  }
  const expected = existsSync(EXPECTED_PATH) ? ExpectedFile.safeParse(JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'))) : null;
  const truth = (name: string): number | null => {
    if (!expected?.success) return null;
    const entry = expected.data.files[name];
    if (entry === undefined) return null;
    const r = inspect(entry);
    return r.state === 'complete' && 'stops' in r.entry ? r.entry.stops.length : null;
  };

  console.info('Counts only. "uncited by the template": address-like sent lines the template read nothing from.\n');
  console.info(
    ['sample', 'template', 'stops (template)', 'stops (ground truth)', 'lines sent', 'address-like sent', 'uncited by the template', 'cue with nothing dropped', 'uncited after the first stop (a narrowing, not built)'].join(' | '),
  );
  let controlFired = 0;
  let controlSeen = 0;
  let templateFired = 0;
  let templateSeen = 0;
  let controlNarrowFired = 0;
  let templateNarrowFired = 0;
  for (const [i, name] of files.entries()) {
    const n = i + 1;
    const pdf = await readSample(name);
    if (!pdf.ok) continue;
    const prepared = prepareForReading(pdf.lines);
    if (!prepared.ok) {
      console.info(`${n} | — | — | — | not sendable (${prepared.reason}) | — | — | —`);
      continue;
    }
    const addressLike = prepared.lines.filter((l) => looksLikeAddressLine(l.text)).length;
    const template = readRatecon(pdf.lines);
    const known = truth(name);
    let uncited: number | '—' = '—';
    let fires = '—';
    let narrow: number | '—' = '—';
    if (template.ok) {
      const chosen = selectPages(pdf.lines);
      const cited = citedIndexes(chosen, sourcesOf(template.read));
      const firstStop = Math.min(...citedIndexes(chosen, sourcesOf(template.read, true)));
      const left = prepared.lines.map((l, k) => k).filter((k) => !cited.has(k) && looksLikeAddressLine(prepared.lines[k]!.text));
      uncited = left.length;
      narrow = left.filter((k) => k > firstStop).length;
      fires = uncited > 0 ? 'FIRES' : 'silent';
      templateSeen += 1;
      if (uncited > 0) templateFired += 1;
      if (narrow > 0) templateNarrowFired += 1;
      if (CONTROL.has(n)) {
        controlSeen += 1;
        if (uncited > 0) controlFired += 1;
        if (narrow > 0) controlNarrowFired += 1;
      }
    }
    console.info(
      [n, template.ok ? template.read.layout : 'not recognised', template.ok ? template.read.stops.length : '—', known ?? '—', prepared.lines.length, addressLike, uncited, fires, narrow].join(' | '),
    );
  }
  console.info(`\nWith no stop dropped (the template's citations), the cue would fire on ${controlFired} of the ${controlSeen} control files (1, 18, 19, 22, 23, 27), and on ${templateFired} of the ${templateSeen} template-read files.`);
  console.info(`Narrowed to lines after the first stop (not built): ${controlNarrowFired} of ${controlSeen} control files, ${templateNarrowFired} of ${templateSeen} template-read files.`);
}

await main();
