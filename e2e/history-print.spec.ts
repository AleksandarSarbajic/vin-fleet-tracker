import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { connect } from './fixtures';
import {
  HISTORY_NOW,
  LONG_WEEK,
  LONG_WEEK_DRIVERS,
  longWeekNumbers,
  seedHistory,
  seedLongWeek,
} from './history-seed';
import { pdfToImages, readPdf, type PdfPage } from './pdf';
import { SIZES, onPhone } from './phone-helpers';

/**
 * §12.103 — the driver history page, printed. Not a screenshot in print
 * media at a desktop width (that is how §12.101 missed this): the browser's
 * own print to PDF, at the paper's width, read back as text and as images.
 *
 * `preferCSSPageSize` and no margins of our own: the page's `@page` rule
 * decides orientation and margins, as it does behind the Print button and
 * Ctrl/Cmd+P. Background graphics off, the print dialog's default.
 */

/** Text with every space removed and lower-cased: letter-spaced labels extract as "D R I V E R". */
const flat = (s: string) => s.replace(/\s+/g, '').toLowerCase();

async function signedInName(): Promise<string> {
  const sql = connect();
  try {
    const [p] = await sql<{ full_name: string }[]>`
      select full_name from profiles where id = ${process.env['E2E_USER_ID']!}`;
    return p!.full_name;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function openWeek(page: Page, week: string, ready = 'main') {
  await page.goto(`/history?week=${week}`);
  await page.locator(ready).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1300);
}

async function print(page: Page, info: TestInfo, name: string, format: 'Letter' | 'A4' = 'Letter') {
  const bytes = await page.pdf({ format, preferCSSPageSize: true });
  writeFileSync(info.outputPath(`${name}.pdf`), bytes);
  return { bytes, pages: await readPdf(bytes) };
}

/** Every load number the desktop table holds, folded ones included. */
const tableNumbers = (page: Page) =>
  page
    .locator('main [data-load]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-load')!).filter((n) => n !== 'no number'));

function expectPrinted(pages: PdfPage[], label: string) {
  expect(pages.length, `${label}: page count`).toBeGreaterThan(0);
  for (const [i, p] of pages.entries()) {
    expect.soft(p.width, `${label} p${i + 1}: landscape`).toBeGreaterThan(p.height);
    expect.soft(flat(p.text), `${label} p${i + 1}: page label`).toContain(flat(`Page ${i + 1} of ${pages.length}`));
  }
  const all = flat(pages.map((p) => p.text).join(' '));
  expect(all.length, `${label}: text`).toBeGreaterThan(200);
  // The console chrome is not printed.
  for (const chrome of ['Jump to this week', 'Filter list', 'Sign out', 'Choose a week']) {
    expect.soft(all, `${label}: no "${chrome}"`).not.toContain(flat(chrome));
  }
  // Print never truncates: no ellipsis anywhere on paper.
  expect.soft(all, `${label}: truncated text`).not.toContain('…');
  return all;
}

test.beforeEach(async ({ page }) => {
  await seedHistory();
  await page.clock.setFixedTime(HISTORY_NOW);
  await page.setViewportSize({ width: 1440, height: 900 });
});

for (const [week, kind, range] of [
  ['2026-W40', 'normal', 'Sep 28 – Oct 4, 2026'],
  ['2026-W38', 'empty', 'Sep 14 – 20, 2026'],
  ['2026-W39', 'busy', 'Sep 21 – 27, 2026'],
] as const) {
  test(`prints a ${kind} week: title block, every load, landscape on Letter and A4`, async ({ page, browser }, info) => {
    const name = await signedInName();
    await openWeek(page, week);
    const numbers = await tableNumbers(page);
    for (const format of ['Letter', 'A4'] as const) {
      const { bytes, pages } = await print(page, info, `${kind}-${format}`, format);
      const label = `${kind} ${format}`;
      const all = expectPrinted(pages, label);
      // The title block, on page 1: the week, the printed time and who printed it.
      const first = flat(pages[0]!.text);
      expect(first).toContain(flat(`Driver history · ${range}`));
      expect(first).toContain(flat(`printed Fri, Oct 2, 2026 10:42 CDT by ${name}`));
      expect(first).toContain(flat('Read-only record'));
      // Every load row, in full: no "+N more".
      expect(numbers.filter((n) => !all.includes(n)), `${label}: loads missing from the PDF`).toEqual([]);
      expect(all).not.toMatch(/\+\d+more/);
      if (kind === 'empty') expect(all).toContain(flat('No loads recorded this week'));
      else expect(numbers.length, `${label}: load rows`).toBeGreaterThan(10);
      if (kind === 'busy') expect(numbers).toEqual(expect.arrayContaining(['48151', '48153', '48155']));
      if (format === 'Letter') await pdfToImages(browser, bytes, info.outputPath(`${kind}-${format}`));
    }
  });
}

test('the normal week is two pages: "Page 1 of 2" and "Page 2 of 2"', async ({ page }, info) => {
  await openWeek(page, '2026-W40');
  const { pages } = await print(page, info, 'normal-pages');
  expect(pages).toHaveLength(2);
  expect(flat(pages[0]!.text)).toContain(flat('Page 1 of 2'));
  expect(flat(pages[1]!.text)).toContain(flat('Page 2 of 2'));
});

test('a week too long for one page: the column head on every page, no row split', async ({ page, browser }, info) => {
  await seedLongWeek();
  await openWeek(page, LONG_WEEK);
  const { bytes, pages } = await print(page, info, 'long');
  expectPrinted(pages, 'long');
  expect(pages.length, 'more than one page').toBeGreaterThan(1);
  const texts = pages.map((p) => flat(p.text));
  // The head repeats wherever the table continues — every page before the lists.
  const tablePages = texts.filter((t) => LONG_WEEK_DRIVERS.some(([name]) => t.includes(flat(name))));
  expect(tablePages.length).toBeGreaterThan(1);
  for (const [i, t] of tablePages.entries()) {
    expect.soft(t, `table page ${i + 1}: head`).toContain(flat('Driver · Truck'));
    expect.soft(t, `table page ${i + 1}: head`).toContain(flat('Mon 14'));
    expect.soft(t, `table page ${i + 1}: head`).toContain(flat('Sun 20'));
  }
  // A row is whole: the page that has the driver has every one of their loads.
  for (const [row, [name]] of LONG_WEEK_DRIVERS.entries()) {
    const at = texts.findIndex((t) => t.includes(flat(name)));
    expect(at, `${name}: printed`).toBeGreaterThanOrEqual(0);
    const missing = longWeekNumbers(row).filter((n) => !texts[at]!.includes(n));
    expect.soft(missing, `${name}: loads not on the driver's page ${at + 1}`).toEqual([]);
  }
  await pdfToImages(browser, bytes, info.outputPath('long-Letter'));
});

/**
 * What print media would put on paper, as text: every visible word in `main`
 * and its contrast against white (over white where the ink is translucent),
 * and every button left showing. A PDF holds white text as readily as black,
 * so the PDF's text alone cannot see white on white.
 */
async function onPaper(page: Page) {
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 979, height: 900 }); // Letter landscape inside its margins
  try {
    return await page.evaluate(() => {
      const lum = ([r, g, b]: number[]) => {
        const c = [r!, g!, b!].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
      };
      const pale: string[] = [];
      const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent!.trim();
        const el = n.parentElement!;
        if (!text || !el.checkVisibility() || el.getClientRects().length === 0) continue;
        const m = getComputedStyle(el).color.match(/[\d.]+/g)!.map(Number);
        const a = m[3] ?? 1;
        const rgb = m.slice(0, 3).map((v) => v * a + 255 * (1 - a));
        const ratio = 1.05 / (lum(rgb) + 0.05);
        if (ratio < 4.5) pale.push(`"${text.slice(0, 40)}" ${ratio.toFixed(2)}:1`);
      }
      const buttons = [...document.querySelectorAll('main button')]
        .filter((b) => b.checkVisibility() && b.getClientRects().length > 0)
        .map((b) => b.textContent!.trim());
      return { pale, buttons };
    });
  } finally {
    await page.emulateMedia({ media: null });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
}

test('every printed word is dark enough to read on paper, and no button prints', async ({ page }) => {
  const check = async (state: string) => {
    const { pale, buttons } = await onPaper(page);
    expect.soft(pale, `${state}: text too pale for paper`).toEqual([]);
    expect.soft(buttons, `${state}: buttons on paper`).toEqual([]);
  };
  for (const [week, state] of [['2026-W40', 'normal'], ['2026-W38', 'empty'], ['2026-W39', 'busy'], ['2026-W37', 'before records']]) {
    await openWeek(page, week!);
    await check(state!);
  }
  await openWeek(page, '2026-W40');
  await page.route('**/api/history?week=2026-W39', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' }),
  );
  await page.locator('[data-history-toolbar]').getByRole('button', { name: 'Previous week' }).click();
  await expect(page.locator('main').getByText('Could not load this week')).toBeVisible({ timeout: 20_000 });
  await check('error');
});

test('every printed load keeps its status shape icon', async ({ page }) => {
  await openWeek(page, '2026-W39');
  await page.emulateMedia({ media: 'print' });
  const marks = await page.locator('main [data-load]').evaluateAll((els) =>
    els.map((el) => {
      const svg = el.querySelector('svg');
      const r = svg?.getBoundingClientRect();
      return { load: el.getAttribute('data-load'), icon: !!r && r.width > 0 && r.height > 0 };
    }),
  );
  expect(marks.length).toBeGreaterThan(10);
  expect(marks.filter((m) => !m.icon)).toEqual([]);
});

test('the Print button calls the browser’s print; Ctrl/Cmd+P is left to the browser', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed++;
    };
  });
  await openWeek(page, '2026-W40');
  await page.locator('[data-history-toolbar]').getByRole('button', { name: 'Print' }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  // The shortcut is the browser's own Print: nothing on the page may swallow it.
  const prevented = await page.evaluate(() =>
    [{ ctrlKey: true }, { metaKey: true }].map(
      (mods) => !document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true, ...mods })),
    ),
  );
  expect(prevented).toEqual([false, false]);
});

test('printing from a phone-sized window prints the same landscape table, not the cards', async ({ page, browser }, info) => {
  await openWeek(page, '2026-W40');
  const desktop = expectPrinted((await print(page, info, 'desktop')).pages, 'desktop');
  for (const size of SIZES.filter((s) => ['320x568', '390x844'].includes(s.name))) {
    const { context, page: phone } = await onPhone(browser, size);
    try {
      await phone.clock.setFixedTime(HISTORY_NOW);
      await openWeek(phone, '2026-W40', '[data-history-phone]');
      const { bytes, pages } = await print(phone, info, `phone-${size.name}`);
      const all = expectPrinted(pages, `phone ${size.name}`);
      expect(all, `${size.name}: the same document as the desktop's`).toBe(desktop);
      if (size.name === '390x844') await pdfToImages(browser, bytes, info.outputPath(`phone-${size.name}`));
    } finally {
      await context.close();
    }
  }
});
