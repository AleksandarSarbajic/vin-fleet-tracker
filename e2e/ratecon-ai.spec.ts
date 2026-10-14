import { writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { normalizeAddress } from '../src/lib/address';
import { CHAIN_VERSION } from '../src/server/geocode';
import { MODEL_REPLY, UNKNOWN_LAYOUT } from '../src/test/model-read-fixtures';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * "Read with AI" end to end (docs/llm-reader-design.md §8.1): the real
 * modal, the real POST /api/ratecon/read, the real counts table — and the
 * FAKE vendor, which answers from a script. A read is a PAIR (Alex,
 * 2026-10-14): the script holds two steps per read, one for each call. No real vendor, no network call
 * to one, no real document: the text is invented, every line carries the
 * sentinel, and no screenshot is taken.
 *
 * NEEDS the e2e server started with:
 *   LLM_READER_ENABLED=true
 *   LLM_READER_VENDOR=fake
 *   LLM_READER_FAKE_SCRIPT=e2e/.fake-reader.json
 * Without them the strip offers no button and this test says so first.
 */

/** Read by the server for every read; written here, before the click. Git-ignored. */
const FAKE_SCRIPT = 'e2e/.fake-reader.json';
const TRUCK = TRUCK_NUMBERS.chicago;
/** The invented unknown layout, as pasted: 23 lines. */
const CLIP = UNKNOWN_LAYOUT.map((l) => l.text).join('\n');

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

/** The same step for both calls of a pair. */
const USAGE = { inputTokens: 3200, outputTokens: 540 };
const answered = { reply: MODEL_REPLY, usage: USAGE };
/** The same reply with stop 2's appointment "none": an AI fill the dispatcher can save as it is. */
const SAVEABLE = { ...MODEL_REPLY, stops: [MODEL_REPLY.stops[0]!, { ...MODEL_REPLY.stops[1]!, appointment: { kind: 'none' } }] };
const savable = { reply: SAVEABLE, usage: USAGE };

/** The invented stops' places, in the geocode cache, so a Save here calls no outside service. */
const PLACES = [
  { addressLine: '4001 Main St', city: 'Fargo', state: 'ND', zip: '58102', lat: 46.88, lng: -96.79 },
  { addressLine: '220 Harbor Rd', city: 'Duluth', state: 'MN', zip: '55802', lat: 46.78, lng: -92.1 },
];

/**
 * Writes the script; opens the new-load modal and pastes the invented layout.
 * Skips, and says why, when the e2e server runs with the reader off (no
 * button) rather than failing the gate. It asks the strip, not the route: a
 * probe of the route would spend one of the user's three reads a minute
 * (LIMITS.llm), and this file makes exactly three.
 */
async function pasteInvented(page: Page, context: BrowserContext, script: unknown[]) {
  writeFileSync(FAKE_SCRIPT, JSON.stringify(script));
  await resetWorld();
  await db(async (sql) => {
    await sql`delete from stops where load_id = ${IDS.loadChicago}`;
    await sql`delete from loads where id = ${IDS.loadChicago}`;
    await sql`delete from ratecon_ai_reads`;
    for (const p of PLACES) {
      await sql`
        insert into geocode_cache (normalized_address, lat, lng, precision, confidence,
                                   matched_address, provider)
        values (${normalizeAddress(p)}, ${p.lat}, ${p.lng}, 'street', ${'census:exact'},
                ${`${p.addressLine.toUpperCase()}, ${p.city}, ${p.state}, ${p.zip}`}, ${CHAIN_VERSION})
        on conflict (normalized_address) do nothing`;
    }
  });
  // The paste goes through the real clipboard, as paste-address.spec.ts's does.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator(`[data-row-id="${IDS.truckChicago}"]`).click();
  await page.keyboard.press('Enter');
  await stopForm(page).waitFor();

  const strip = editModal(page).locator('[data-ratecon-strip]');
  await page.evaluate((text) => navigator.clipboard.writeText(text), CLIP);
  await strip.getByLabel("Or paste the rate confirmation's text").focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(strip.getByText('Layout not recognised, nothing filled.')).toBeVisible();
  test.skip(
    !(await strip.getByRole('button', { name: 'Read with AI' }).isVisible()),
    'The e2e server runs with the reader off. Start it with LLM_READER_ENABLED=true, LLM_READER_VENDOR=fake, LLM_READER_FAKE_SCRIPT=e2e/.fake-reader.json.',
  );
  return strip;
}

test('after a template miss, Read with AI makes a PAIR through the route and the fake vendor, and fills only what both reads agree on and follows from the text', async ({
  page,
  context,
}) => {
  const strip = await pasteInvented(page, context, [savable, savable]);

  const readWithAi = strip.getByRole('button', { name: 'Read with AI' });
  await expect(readWithAi, 'the e2e server must run with the reader on and the fake vendor (see the header)').toBeVisible();
  await expect(strip).toContainText('sends 23 lines, with rates, contacts, phones, emails and driver names removed');
  await strip.getByText('Show what is sent').click();
  await expect(strip.locator('[data-ratecon-sent] pre')).toContainText('L3 Booked by: [REMOVED]');
  await expect(strip.locator('[data-ratecon-sent] pre')).not.toContainText('dispatch@example.com');

  const sent = page.waitForRequest((r) => r.url().endsWith('/api/ratecon/read') && r.method() === 'POST');
  await readWithAi.click();
  const body = (await sent).postDataJSON() as { lines: Record<string, unknown>[] };
  expect(body.lines).toHaveLength(23);
  expect(Object.keys(body.lines[0]!).sort()).toEqual(['n', 'text']);

  await expect(strip.locator('[data-ratecon-said]')).toHaveText(
    'Filled 2 stops, read by AI. Check each stop against its quote, then press Looks right. Nothing is saved until Save.',
  );
  await expect(editModal(page).getByLabel('Load number')).toHaveValue('EX-40417');
  const form = stopForm(page);
  await expect(form.getByLabel('Street address')).toHaveValue('4001 Main St');
  await expect(form.locator('[data-field-ai]').first()).toContainText('Read by AI from the pasted text');
  await expect(strip.locator('[data-ai-to-confirm]')).toHaveText('2 stops read by AI to confirm');

  await form.getByRole('button', { name: 'Looks right' }).click();
  await expect(strip.locator('[data-ai-to-confirm]')).toHaveText('1 stop read by AI to confirm');

  // Counted ONCE, as a read that answered — two calls, so both calls' tokens; nothing saved, because Save was not pressed.
  const [rows, stops] = await db((sql) =>
    Promise.all([
      sql<{ outcome: string; lines_sent: number; input_tokens: number; output_tokens: number }[]>`
        select outcome, lines_sent, input_tokens, output_tokens from ratecon_ai_reads`,
      sql<{ n: number }[]>`select count(*)::int as n from stops where load_id = ${IDS.loadChicago}`,
    ]),
  );
  expect(rows).toEqual([{ outcome: 'ok', lines_sent: 23, input_tokens: 6400, output_tokens: 1080 }]);
  expect(stops[0]!.n).toBe(0);
  // Nothing about what was done with the read is recorded until the load is saved.
  expect(await db((sql) => sql`select 1 from ratecon_ai_outcomes`)).toHaveLength(0);

  // Save as it is: the fill is kept whole. Then, and only then, the counts — per field name, never a value.
  await editModal(page).getByRole('button', { name: 'Save' }).click();
  await expect(editModal(page)).toBeHidden({ timeout: 20_000 });
  await expect.poll(async () => (await db((sql) => sql`select 1 from ratecon_ai_outcomes`)).length, { timeout: 10_000 }).toBe(1);

  const outcome = await db((sql) => sql<
    { field: string; kept: number; changed: number; cleared: number; blank_filled: number; blank_left: number; read_outcome: string; input_tokens: number }[]
  >`
    select f.field::text as field, f.kept, f.changed, f.cleared, f.blank_filled, f.blank_left,
           r.outcome::text as read_outcome, r.input_tokens
      from ratecon_ai_outcome_fields f join ratecon_ai_reads r on r.id = f.read_id
     order by f.field::text`);
  const counts = (field: string) => outcome.find((o) => o.field === field);
  expect(outcome.map((o) => o.field).sort()).toEqual(['appointment', 'city', 'load_number', 'state', 'stop_type', 'street', 'zip']);
  expect(counts('street')).toMatchObject({ kept: 2, changed: 0, cleared: 0 });
  expect(counts('load_number')).toMatchObject({ kept: 1 });
  expect(counts('appointment')).toMatchObject({ kept: 1, blank_left: 1 });
  // The outcome sits with its read's cost.
  expect(outcome.every((o) => o.read_outcome === 'ok' && o.input_tokens === 6400)).toBe(true);
  // Counts only: no value, and no second record on a later save.
  expect(JSON.stringify(outcome)).not.toMatch(/Main|Fargo|Duluth|EX-40417|58102/);
  expect((await db((sql) => sql<{ n: number }[]>`select count(*)::int as n from stops where load_id is not null`))[0]!.n).toBeGreaterThanOrEqual(2);
});

test('a pair whose second read fails fills nothing, says the AI read did not complete, and is still one read against the cap', async ({
  page,
  context,
}) => {
  const strip = await pasteInvented(page, context, [answered, { fail: 'unavailable', vendorStatus: 503 }]);
  await strip.getByRole('button', { name: 'Read with AI' }).click();

  await expect(strip.locator('[data-ratecon-said]')).toHaveText(
    'The AI read did not complete. The AI reader is not available right now. Nothing was filled.',
  );
  // Read A answered and stood; it is not used.
  await expect(editModal(page).getByLabel('Load number')).toHaveValue('');
  await expect(stopForm(page).getByLabel('Street address')).toHaveValue('');
  await expect(strip.getByRole('button', { name: 'Read with AI' })).toBeVisible();

  const rows = await db((sql) => sql<{ outcome: string; input_tokens: number }[]>`select outcome, input_tokens from ratecon_ai_reads`);
  expect(rows).toEqual([{ outcome: 'unavailable', input_tokens: 3200 }]);
});

test('a pair whose reads differ fills what both said, blanks and marks what they did not, and says so', async ({ page, context }) => {
  const other = structuredClone(MODEL_REPLY);
  other.stops[0]!.zip = { value: '58103', quote: { line: 13, text: 'Fargo, ND 58102' } };
  const strip = await pasteInvented(page, context, [answered, { reply: other, usage: USAGE }]);
  await strip.getByRole('button', { name: 'Read with AI' }).click();

  await expect(strip.locator('[data-ratecon-notice]')).toHaveText('The two AI reads differed on 1 field; each is left blank and marked.');
  const form = stopForm(page);
  await expect(form.getByLabel('Street address')).toHaveValue('4001 Main St');
  await expect(form.getByLabel('ZIP')).toHaveValue('');
  await expect(form.getByText('The two AI reads differed. Enter it by hand.')).toBeVisible();
});
