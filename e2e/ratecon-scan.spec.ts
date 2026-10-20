import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { LABEL_ROWS } from '../src/test/ratecon-fixtures';
import { replyPointedAt, unknownLayoutPages } from '../src/test/scan-ai-fixtures';
import { nodePdfjs, scanOf } from '../src/test/scan-pdf';
import { tinyPdf, type TinyRun } from '../src/test/tiny-pdf';
import { field, fieldLabel } from './field';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * §12.128. A scanned rate confirmation, read by OCR in the real browser: the
 * real modal, the browser's pdf.js drawing each page, tesseract.js from OUR
 * origin (`/ocr/…`, copied there by `npm run build`, served without the
 * login check), then the same path as a text PDF — a template, or Read with
 * AI. Every scan is made here, in memory, from invented text (`scanOf`);
 * none is a file, and no screenshot is taken.
 *
 * Origins. The console already talks to Mapbox and to hosted Supabase, so
 * "nothing but our origin" would fail on the map, not the scan. The rule
 * held instead: while the scan is read, NO request goes to an origin the page
 * had not already used before the drop, and none to a CDN; and the OCR files
 * are seen coming from our origin, which proves the worker's own requests
 * are watched at all. Before the drop, nothing under `/ocr/` is fetched.
 *
 * The AI test's read is answered IN THE BROWSER (`page.route`), with the
 * route's own answer shape: it never reaches the server, so it spends none of
 * the user's reads (three, then one a minute, `LIMITS.llm`), which
 * ratecon-ai.spec.ts has just spent — the files run in name order, a few
 * seconds apart (3aj follow-up). The real route and the fake vendor are that
 * file's to prove. This one proves the browser's half on a scan: its own OCR
 * text, the redaction, exactly what leaves the page, and the fill. The same
 * reply against the same scan is checked in Node (`read-scan.test.ts`).
 *
 * NEEDS, for the AI test only, the server to offer Read with AI, as
 * `npm run e2e` starts it (LLM_READER_ENABLED=true, a vendor).
 */

const TRUCK = TRUCK_NUMBERS.chicago;
/** The first scan fetches about 4.3 MB and starts a WebAssembly engine before its first page. */
const FIRST_SCAN = 90_000;
/** Where tesseract.js and its data are published: its defaults, and the usual mirrors. */
const CDN = /jsdelivr|unpkg|cdnjs|githubusercontent|tessdata|naptha/i;

const editModal = (page: Page) =>
  page.getByRole('dialog', { name: new RegExp(`^(Edit|New) load for truck ${TRUCK}$`) });
const stopForm = (page: Page) => editModal(page).getByRole('tabpanel');

async function db<T>(body: (sql: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const sql = connect();
  try {
    return await body(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Every request the context makes, from the page or any of its workers, with when it was made. */
function watch(context: BrowserContext) {
  const seen: { at: number; url: URL }[] = [];
  const on = (r: Request) => seen.push({ at: Date.now(), url: new URL(r.url()) });
  context.on('request', on);
  return {
    before: (at: number) => seen.filter((s) => s.at < at),
    since: (at: number) => seen.filter((s) => s.at >= at),
  };
}

/** A new load's modal on an empty truck, the page and its requests watched from the first load. */
async function openNewLoad(page: Page, context: BrowserContext) {
  await resetWorld();
  await db(async (sql) => {
    await sql`delete from stops where load_id = ${IDS.loadChicago}`;
    await sql`delete from loads where id = ${IDS.loadChicago}`;
  });
  const requests = watch(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator(`[data-row-id="${IDS.truckChicago}"]`).click();
  await page.keyboard.press('Enter');
  await stopForm(page).waitFor();
  return { strip: editModal(page).locator('[data-ratecon-strip]'), requests };
}

/** What the page fetched while the scan was read: only from origins it already used, none a CDN; the OCR files from ours. */
function expectOnlyKnownOrigins(page: Page, requests: ReturnType<typeof watch>, droppedAt: number) {
  const ours = new URL(page.url()).origin;
  const known = new Set(requests.before(droppedAt).map((s) => s.url.origin));
  known.add(ours);
  const during = requests.since(droppedAt);
  expect(during.filter((s) => CDN.test(s.url.hostname)).map((s) => s.url.href), 'a CDN').toEqual([]);
  expect(during.filter((s) => !known.has(s.url.origin)).map((s) => s.url.href), 'an origin new to the page').toEqual([]);
  const ocr = during.filter((s) => s.url.pathname.startsWith('/ocr/'));
  expect(ocr.every((s) => s.url.origin === ours)).toBe(true);
  expect(ocr.map((s) => s.url.pathname)).toEqual(
    expect.arrayContaining(['/ocr/worker.min.js', '/ocr/lang/eng.traineddata.gz', expect.stringMatching(/^\/ocr\/core\/tesseract-core-[a-z-]*lstm\.wasm\.js$/)]),
  );
}

async function dropScan(strip: ReturnType<Page['locator']>, pages: TinyRun[][]) {
  const pdfjs = await nodePdfjs();
  const scan = await scanOf(tinyPdf(pages), pdfjs, 300);
  const at = Date.now();
  await strip.getByLabel('Rate confirmation PDF').setInputFiles({ name: 'invented-scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(scan) });
  return at;
}

test('a scan is read by OCR from our own origin, with its progress shown, and fills the load with every field marked Check', async ({
  page,
  context,
}) => {
  test.setTimeout(FIRST_SCAN + 45_000);
  const { strip, requests } = await openNewLoad(page, context);
  // Nothing of the scan reader on the console's first load.
  expect(requests.before(Date.now()).filter((s) => s.url.pathname.startsWith('/ocr/'))).toEqual([]);

  const droppedAt = await dropScan(strip, LABEL_ROWS);
  await expect(strip.locator('[data-ratecon-scanning]')).toContainText('Reading the scan — ');
  await expect(strip.locator('[data-ratecon-said]')).toHaveText(
    'Filled 2 stops from label rows (PICKUP DATE / SHIPPER / CONSIGNEE), read from a scan: every field is marked Check. Nothing is saved until Save.',
    { timeout: FIRST_SCAN },
  );

  await expect(field(editModal(page), 'Load number')).toHaveValue('550123');
  const form = stopForm(page);
  await expect(field(form, 'Street address')).toHaveValue('4001 Main St');
  await expect(field(form, 'City')).toHaveValue('Fargo');
  await expect(field(form, 'ZIP')).toHaveValue('58102');
  for (const check of await form.locator('[data-field-check]').all()) await expect(check).toContainText('read from a scan');
  await expect(form.locator('[data-field-check]')).toHaveCount(4);
  await expect(form.locator('[data-appointment-check]')).toContainText('Check: read from a scan');
  await expect(strip.locator('[data-to-check]')).toHaveText('13 fields to check');
  // Nothing is saved until Save.
  expect((await db((sql) => sql<{ n: number }[]>`select count(*)::int as n from stops where load_id = ${IDS.loadChicago}`))[0]!.n).toBe(0);

  expectOnlyKnownOrigins(page, requests, droppedAt);
});

test('a scan no template reads goes to Read with AI as any template miss does, the redaction unchanged, and what it fills is marked Check', async ({
  page,
  context,
}) => {
  test.setTimeout(FIRST_SCAN + 60_000);
  const { strip, requests } = await openNewLoad(page, context);
  const droppedAt = await dropScan(strip, unknownLayoutPages());
  await expect(strip.getByText('Layout not recognised, nothing filled.')).toBeVisible({ timeout: FIRST_SCAN });
  await expect(strip.locator('[data-ratecon-scan]')).toHaveText('Read from a scan, by OCR in this browser: every field it fills is marked Check.');
  test.skip(
    !(await strip.getByRole('button', { name: 'Read with AI' }).isVisible()),
    'The e2e server runs with the reader off. Start it as `npm run e2e` does (LLM_READER_ENABLED=true, a vendor).',
  );

  await strip.locator('[data-ratecon-sent] summary').click();
  const sent = (await strip.locator('[data-ratecon-sent] pre').textContent()) ?? '';
  // The same redaction as for text: the labelled name and the email do not go.
  expect(sent).toContain('Booked by: [REMOVED]');
  expect(sent).not.toContain('dispatch@example.com');

  // The read, answered here as the route answers: a pair, both the scripted reply pointed at this OCR's lines.
  const reply = replyPointedAt(sent);
  const bodies: { redactionVersion?: unknown; lines: Record<string, unknown>[] }[] = [];
  await page.route('**/api/ratecon/read', async (route) => {
    bodies.push(route.request().postDataJSON() as (typeof bodies)[number]);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reads: [reply, reply] }) });
  });
  await strip.getByRole('button', { name: 'Read with AI' }).click();
  await expect(strip.locator('[data-ratecon-said]')).toHaveText(
    'Filled 2 stops, read by AI from a scan: every field is marked Check. Check each stop against its quote and the PDF, then press Looks right. Nothing is saved until Save.',
    { timeout: 20_000 },
  );

  // What left the page is exactly "Show what is sent": numbered lines, no pages, no positions.
  expect(bodies).toHaveLength(1);
  const shown = sent.split('\n').flatMap((l) => {
    const m = /^L(\d+) (.*)$/.exec(l);
    return m ? [{ n: Number(m[1]), text: m[2]! }] : [];
  });
  expect(bodies[0]!.lines).toEqual(shown);
  expect(typeof bodies[0]!.redactionVersion).toBe('string');

  await expect(field(editModal(page), 'Load number')).toHaveValue('EX-40417');
  const form = stopForm(page);
  await expect(field(form, 'Street address')).toHaveValue('4001 Main St');
  await expect(fieldLabel(form, 'Street address').locator('[data-field-check]')).toContainText('read from a scan');
  await expect(strip.locator('[data-ai-to-confirm]')).toHaveText('2 stops read by AI to confirm');

  expectOnlyKnownOrigins(page, requests, droppedAt);
});
