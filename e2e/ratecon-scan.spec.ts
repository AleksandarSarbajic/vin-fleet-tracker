import { writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { MODEL_REPLY, UNKNOWN_LAYOUT } from '../src/test/model-read-fixtures';
import { LABEL_ROWS } from '../src/test/ratecon-fixtures';
import { nodePdfjs, scanOf } from '../src/test/scan-pdf';
import { tinyPdf, type TinyRun } from '../src/test/tiny-pdf';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * §12.128. A scanned rate confirmation, read by OCR in the real browser: the
 * real modal, the browser's pdf.js drawing each page, tesseract.js from OUR
 * origin (`/ocr/…`, copied there by `npm run build`), then the same path as a
 * text PDF — a template, or Read with AI through the real route and the FAKE
 * vendor, as e2e/ratecon-ai.spec.ts runs it. Every scan is made here, in
 * memory, from invented text (`scanOf`); none is a file, and no screenshot
 * is taken.
 *
 * Origins. The console already talks to Mapbox and to hosted Supabase, so
 * "nothing but our origin" would fail on the map, not the scan. The rule
 * held instead: while the scan is read, NO request goes to an origin the page
 * had not already used before the drop, and none to a CDN; and the OCR files
 * are seen coming from our origin, which proves the worker's own requests
 * are watched at all. Before the drop, nothing under `/ocr/` is fetched.
 *
 * The AI test makes one read. The reader allows a user three, then one a
 * minute (`LIMITS.llm`, in the server's memory), and ratecon-ai.spec.ts
 * spends three: run in the usual order, a minute has passed by then. Run
 * straight after that file, this one can be refused ("Wait a minute and try
 * again."), and the test says that is why rather than failing on a blank form.
 *
 * NEEDS, for the AI test only, the e2e server started as `npm run e2e`
 * starts it (LLM_READER_ENABLED=true, LLM_READER_VENDOR=fake,
 * LLM_READER_FAKE_SCRIPT=e2e/.fake-reader.json).
 */

const FAKE_SCRIPT = 'e2e/.fake-reader.json';
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
    await sql`delete from ratecon_ai_reads`;
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

  await expect(editModal(page).getByLabel('Load number')).toHaveValue('550123');
  const form = stopForm(page);
  await expect(form.getByLabel('Street address')).toHaveValue('4001 Main St');
  await expect(form.getByLabel('City')).toHaveValue('Fargo');
  await expect(form.getByLabel('ZIP')).toHaveValue('58102');
  for (const check of await form.locator('[data-field-check]').all()) await expect(check).toContainText('read from a scan');
  await expect(form.locator('[data-field-check]')).toHaveCount(4);
  await expect(form.locator('[data-appointment-check]')).toContainText('Check: read from a scan');
  await expect(strip.locator('[data-to-check]')).toHaveText('13 fields to check');
  // Nothing is saved until Save.
  expect((await db((sql) => sql<{ n: number }[]>`select count(*)::int as n from stops where load_id = ${IDS.loadChicago}`))[0]!.n).toBe(0);

  expectOnlyKnownOrigins(page, requests, droppedAt);
});

/** The invented unknown layout as a page of a PDF: each line's cells where `pdfLine` put them, a line every 14 points. */
function unknownLayoutPages(): TinyRun[][] {
  const pages = new Map<number, TinyRun[]>();
  for (const line of UNKNOWN_LAYOUT) {
    const runs = pages.get(line.page!) ?? [];
    const y = 740 - 14 * new Set(runs.map((r) => r.y)).size;
    for (const cell of line.cells) runs.push({ x: cell.x!, y, text: cell.text });
    pages.set(line.page!, runs);
  }
  return [...pages.keys()].sort().map((n) => pages.get(n)!);
}

/**
 * The scripted reply, its quotes pointed at the lines the browser's OCR is
 * about to send — read from "Show what is sent", so the reply verifies
 * against exactly that text. A quote the OCR did not give back fails here,
 * naming it: that is an OCR miss on this page, not the reader's.
 */
function replyFor(sent: string): typeof MODEL_REPLY {
  const lines = sent.split('\n').flatMap((l) => {
    const m = /^L(\d+) (.*)$/.exec(l);
    return m ? [{ n: Number(m[1]), text: m[2]! }] : [];
  });
  const point = (quote: { line: number; text: string }) => {
    const at = lines.filter((l) => l.text.includes(quote.text));
    if (at.length === 0) throw new Error(`The scan's OCR sent no line with “${quote.text}”.`);
    const nearest = at.reduce((a, b) => (Math.abs(a.n - quote.line) <= Math.abs(b.n - quote.line) ? a : b));
    return { line: nearest.n, text: quote.text };
  };
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>;
      if (typeof o.line === 'number' && typeof o.text === 'string') return point(o as { line: number; text: string });
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  return walk(MODEL_REPLY) as typeof MODEL_REPLY;
}

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
    'The e2e server runs with the reader off. Start it with LLM_READER_ENABLED=true, LLM_READER_VENDOR=fake, LLM_READER_FAKE_SCRIPT=e2e/.fake-reader.json.',
  );

  await strip.locator('[data-ratecon-sent] summary').click();
  const sent = (await strip.locator('[data-ratecon-sent] pre').textContent()) ?? '';
  // The same redaction as for text: the labelled name and the email do not go.
  expect(sent).toContain('Booked by: [REMOVED]');
  expect(sent).not.toContain('dispatch@example.com');
  const reply = replyFor(sent);
  writeFileSync(FAKE_SCRIPT, JSON.stringify([0, 1].map(() => ({ reply, usage: { inputTokens: 3200, outputTokens: 540 } }))));

  await strip.getByRole('button', { name: 'Read with AI' }).click();
  const answered = strip.locator('[data-ratecon-said]').filter({ hasText: /Filled|did not complete|Wait a minute/ });
  await expect(answered).toBeVisible({ timeout: 20_000 });
  expect(
    await answered.textContent(),
    'the reader’s per-user limit (three, then one a minute) was spent by ratecon-ai.spec.ts less than a minute ago',
  ).not.toContain('Wait a minute');
  await expect(strip.locator('[data-ratecon-said]')).toHaveText(
    'Filled 2 stops, read by AI from a scan: every field is marked Check. Check each stop against its quote and the PDF, then press Looks right. Nothing is saved until Save.',
    { timeout: 20_000 },
  );
  await expect(editModal(page).getByLabel('Load number')).toHaveValue('EX-40417');
  const form = stopForm(page);
  await expect(form.getByLabel('Street address')).toHaveValue('4001 Main St');
  await expect(form.locator('label', { hasText: 'Street address' }).locator('[data-field-check]')).toContainText('read from a scan');
  await expect(strip.locator('[data-ai-to-confirm]')).toHaveText('2 stops read by AI to confirm');

  expectOnlyKnownOrigins(page, requests, droppedAt);
});
