import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { MODEL_REPLY, UNKNOWN_LAYOUT } from '../src/test/model-read-fixtures';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * "Read with AI" end to end (docs/llm-reader-design.md §8.1): the real
 * modal, the real POST /api/ratecon/read, the real counts table — and the
 * FAKE vendor, which answers from a script. No real vendor, no network call
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

test('after a template miss, Read with AI goes through the route and the fake vendor, and fills only what follows from the text', async ({
  page,
  context,
}) => {
  // The route answers 404 when the reader is off: then this is skipped, and says why, rather than failing the gate.
  const probe = await page.request.post('/api/ratecon/read', { data: {} });
  test.skip(
    probe.status() === 404,
    'The e2e server runs with the reader off. Start it with LLM_READER_ENABLED=true, LLM_READER_VENDOR=fake, LLM_READER_FAKE_SCRIPT=e2e/.fake-reader.json.',
  );

  writeFileSync(FAKE_SCRIPT, JSON.stringify([{ reply: MODEL_REPLY, usage: { inputTokens: 3200, outputTokens: 540 } }]));
  await resetWorld();
  await db(async (sql) => {
    await sql`delete from stops where load_id = ${IDS.loadChicago}`;
    await sql`delete from loads where id = ${IDS.loadChicago}`;
    await sql`delete from ratecon_ai_reads`;
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

  // Counted once, as a read that answered; nothing saved, because Save was not pressed.
  const [rows, stops] = await db((sql) =>
    Promise.all([
      sql<{ outcome: string; lines_sent: number }[]>`select outcome, lines_sent from ratecon_ai_reads`,
      sql<{ n: number }[]>`select count(*)::int as n from stops where load_id = ${IDS.loadChicago}`,
    ]),
  );
  expect(rows).toEqual([{ outcome: 'ok', lines_sent: 23 }]);
  expect(stops[0]!.n).toBe(0);
});
