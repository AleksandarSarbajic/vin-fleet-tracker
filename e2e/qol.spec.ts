import { expect, test, type Page } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, connect, makeFeedStale, resetWorld } from './fixtures';
import { isoDayIn, startOfDayIn } from '../src/test/zone-day';
import { nextCalendarDay } from '../src/lib/calendar';
import { PU_SO, puSoBlocks } from '../src/test/ratecon-fixtures';
import { tinyPdf } from '../src/test/tiny-pdf';

/**
 * Phase 3bw (§12.163): QoL batch 1, each feature's `hand` path from the 3bf demo, in the real
 * app: the real build, the real routes, the real database. One describe per feature.
 */

const CHICAGO = 'America/Chicago';
const HOUR = 3_600_000;

const rowOf = (page: Page, id: string = IDS.truckChicago) => page.locator(`[data-row-id="${id}"]`);
const editModal = (page: Page, truck: number = TRUCK_NUMBERS.chicago) =>
  page.getByRole('dialog', { name: new RegExp(`^(Edit|New) load for truck ${truck}$`) });

async function openModal(page: Page, id: string = IDS.truckChicago, truck: number = TRUCK_NUMBERS.chicago) {
  await page.goto('/');
  await rowOf(page, id).click();
  await page.keyboard.press('Enter');
  await expect(editModal(page, truck)).toBeVisible();
  return editModal(page, truck);
}

async function db<T>(body: (sql: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const sql = connect();
  try {
    return await body(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Save, and wait for the window to close. The save route allows 15 saves at once and then one
 * every 4s per user (`LIMITS.geocode`); a save it refuses says "Too many requests. Retry in 1s",
 * and is sent again, as a person would. The glow's press table spends that allowance and then
 * waits it back.
 */
async function saveAndClose(page: Page, modal: ReturnType<typeof editModal>) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await modal.getByRole('button', { name: /^Save$/ }).click();
    const outcome = await Promise.race([
      modal.waitFor({ state: 'hidden', timeout: 20_000 }).then(() => 'closed' as const, () => 'open' as const),
      modal.getByText('Too many requests').waitFor({ timeout: 20_000 }).then(() => 'limited' as const, () => 'open' as const),
    ]);
    if (outcome === 'closed') return;
    expect(outcome, 'the save neither closed the window nor was refused by the limit').toBe('limited');
    await page.waitForTimeout(4_500);
  }
  throw new Error('the save route kept refusing');
}

/** A clock as the app's lines write one, in a zone: `15:00`. */
const clockIn = (instant: Date, zone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);

/* ------------------------------------------------------------------ 4 */

/**
 * The dispatcher's zone for feature 4: one on another date from the stop's (Chicago) right now.
 * Kiritimati is 19 or 20 hours ahead of Chicago and Pago Pago 5 or 6 behind, so at any instant
 * one of the two is on another date. Derived when the file loads, never pasted.
 */
const OTHER_DAY_ZONE =
  ['Pacific/Kiritimati', 'Pacific/Pago_Pago'].find((zone) => isoDayIn(new Date(), zone) !== isoDayIn(new Date(), CHICAGO)) ??
  'Pacific/Kiritimati';

test.describe('4: Today and Tomorrow beside the appointment date', () => {
  test.use({ timezoneId: OTHER_DAY_ZONE });

  test('Today writes the date at the stop, from the stop\'s zone, a note says the dates differ, and Tomorrow is saved as the stop\'s wall date', async ({
    page,
  }) => {
    // Three days on at about 15:00 in Chicago, so Tomorrow is always a change and always ahead.
    const seeded = new Date(startOfDayIn(new Date(Date.now() + 72 * HOUR), CHICAGO).getTime() + 15 * HOUR);
    await resetWorld({ appointmentUtc: seeded });
    const modal = await openModal(page);
    const date = modal.locator('[data-fill="appointment.date"]');
    expect(await date.inputValue()).toBe(isoDayIn(seeded, CHICAGO));

    const before = new Date();
    await modal.getByRole('button', { name: 'Today at this stop' }).click();
    const after = new Date();
    const written = await date.inputValue();
    // The stop's date at the click: either side of a midnight that fell during it.
    expect([isoDayIn(before, CHICAGO), isoDayIn(after, CHICAGO)]).toContain(written);
    expect(written).not.toBe(isoDayIn(after, OTHER_DAY_ZONE));
    await expect(modal.locator('[data-stop-day-note]')).toContainText('At this stop it is');
    await expect(modal.locator('[data-stop-day-note]')).toContainText('Your own date is');

    await modal.getByRole('button', { name: 'Tomorrow at this stop' }).click();
    const tomorrow = await date.inputValue();
    expect(tomorrow).toBe(nextCalendarDay(written));

    await saveAndClose(page, modal);
    const [stop] = await db((sql) => sql<{ start: Date; tz: string }[]>`
      select appointment_start_utc as start, appointment_tz as tz from stops where id = ${IDS.stopChicago}`);
    expect(stop!.tz).toBe(CHICAGO);
    // The wall date the button wrote, at the wall clock the stop already had.
    expect(isoDayIn(stop!.start, CHICAGO)).toBe(tomorrow);
    expect(clockIn(stop!.start, CHICAGO)).toBe(clockIn(seeded, CHICAGO));
  });
});

/* ------------------------------------------------------------------ 10 */

const search = (page: Page) => page.getByRole('textbox', { name: 'Search the fleet' });

test.describe('10: search marks what matched, everywhere it matched', () => {
  test('the truck number is marked; a ZIP and a load number the row does not show are shown, marked; the copy controls over that cell still work', async ({
    page,
    context,
  }) => {
    await resetWorld();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    const row = rowOf(page);
    await expect(row).toBeVisible();

    await search(page).fill(String(TRUCK_NUMBERS.chicago));
    await expect(row.locator('.bg-highlight').first()).toHaveText(String(TRUCK_NUMBERS.chicago));
    await expect(row.locator('[data-search-hint]')).toHaveCount(0);

    // The seed's stop: 1 Test Dock, Chicago, IL 60601, load E2E-101, the truck's one open load.
    await search(page).fill('60601');
    await expect(row.locator('[data-search-hint]')).toHaveText('ZIP 60601 · ');
    await expect(row.locator('[data-search-hint] .bg-highlight')).toHaveText('60601');
    await expect(rowOf(page, IDS.truckAtZipStop)).toHaveCount(0);

    // The copy controls sit over the right edge of the cell the hint starts: each is still the
    // thing under its own middle, and each still copies.
    await row.hover();
    for (const [label, expected] of [
      ['Copy address', '1 Test Dock, Chicago, IL, 60601'],
      ['Copy load info', 'Load: E2E-101'],
    ] as const) {
      const button = row.getByRole('button', { name: label });
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      const top = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.getAttribute('aria-label') ?? null,
        [box.x + box.width / 2, box.y + box.height / 2],
      );
      expect(top, `${label} is what lies under its own middle`).toBe(label);
      await button.click();
      await expect(button).toContainText('Copied');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(expected);
    }

    await search(page).fill('e2e-101');
    await expect(row.locator('[data-search-hint]')).toHaveText('Load E2E-101 · ');
  });
});

/* ------------------------------------------------------------------ 11 */

test.describe('11: C copies the address, T opens the timeline', () => {
  test('click a row, press C, press T; neither works while typing or behind a window; the sheet lists both', async ({
    page,
    context,
  }) => {
    await resetWorld();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    const row = rowOf(page);
    await row.click();

    await page.evaluate(() => navigator.clipboard.writeText('before'));
    await page.keyboard.press('c');
    await expect(row.getByRole('button', { name: 'Copy address' })).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1 Test Dock, Chicago, IL, 60601');

    // Typing: the key goes into the field, and nothing is copied.
    await page.evaluate(() => navigator.clipboard.writeText('before'));
    await search(page).focus();
    await page.keyboard.press('c');
    await expect(search(page)).toHaveValue('c');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before');
    await search(page).fill('');
    await row.click();

    await page.keyboard.press('t');
    const timeline = page.getByRole('dialog', { name: `Timeline for truck ${TRUCK_NUMBERS.chicago}` });
    await expect(timeline).toBeVisible();
    // Behind a window: C copies nothing.
    await page.keyboard.press('c');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before');
    await page.keyboard.press('Escape');
    await expect(timeline).toBeHidden();

    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog').filter({ hasText: "Copy the selected truck's address" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Open the selected truck's timeline");
  });
});

/* ------------------------------------------------------------------ 14 */

test.describe('14: Copy the ETA line, from the popup', () => {
  test('select a truck, Copy ETA: one line whose ETA is the popup\'s own; on a stale feed it copies nothing and says why', async ({
    page,
    context,
  }) => {
    await resetWorld();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await rowOf(page).click();
    const popup = page.locator('.mapboxgl-popup');
    await expect(popup).toBeVisible();
    const projected = (await popup.getByText(/ETA \d\d:\d\d /).first().textContent()) ?? '';
    const eta = /ETA \d\d:\d\d [A-Z][A-Za-z0-9+-]+/.exec(projected)?.[0];
    expect(eta, `the popup's Projected line: "${projected}"`).toBeTruthy();

    await page.evaluate(() => navigator.clipboard.writeText('before'));
    await popup.getByRole('button', { name: 'Copy ETA' }).click();
    await expect(popup.locator('[data-copy-eta]')).toHaveText('✓ Copied');
    const line = await page.evaluate(() => navigator.clipboard.readText());
    expect(line).toMatch(new RegExp(`^Truck ${TRUCK_NUMBERS.chicago} · Chicago, IL · ${eta} · (\\d+ mi|arriving)$`));

    await makeFeedStale();
    await page.reload();
    await rowOf(page).click();
    await expect(popup).toBeVisible();
    await page.evaluate(() => navigator.clipboard.writeText('before'));
    await popup.getByRole('button', { name: 'Copy ETA' }).click();
    await expect(popup.locator('[data-eta-copy-note]')).toHaveText('The feed is down, so there is no ETA to quote from this screen.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before');
  });
});

/* ------------------------------------------------------------------ 12 */

/**
 * A drag the way a browser sends one from the desktop: a real `File` in a real `DataTransfer`,
 * on a real `DragEvent`. Synthesized, so it is not an OS drag (3bf's check limits): what it shows
 * is that the window takes the event, by `defaultPrevented`, which is what keeps the browser from
 * opening the file.
 */
async function dragFile(page: Page, selector: string, type: 'dragenter' | 'dragover' | 'drop', bytes: number[]): Promise<boolean> {
  return page.evaluate(
    ({ selector, type, bytes }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], 'invented-ratecon.pdf', { type: 'application/pdf' }));
      const target = document.querySelector(selector);
      if (!target) throw new Error(`nothing at ${selector}`);
      const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { selector, type, bytes },
  );
}

const FORM = '[role="dialog"] [role="tabpanel"]';

test.describe('12: drop anywhere in the edit window', () => {
  test('on a new load a PDF let go on the form fills it, as on the strip; on saved stops it is taken, nothing is read, and the window says why', async ({
    page,
  }) => {
    const pdf = [...tinyPdf(puSoBlocks(PU_SO))];
    await resetWorld();
    await db(async (sql) => {
      await sql`delete from stops where load_id = ${IDS.loadChicago}`;
      await sql`delete from loads where id = ${IDS.loadChicago}`;
    });
    const modal = await openModal(page);
    const strip = modal.locator('[data-ratecon-strip]');
    await expect(strip).toBeVisible();

    expect(await dragFile(page, FORM, 'dragenter', pdf)).toBe(false);
    expect(await dragFile(page, FORM, 'dragover', pdf), 'the window takes a file over the form').toBe(true);
    await expect(modal.locator('.ring-accent')).toHaveCount(1);
    expect(await dragFile(page, FORM, 'drop', pdf), 'the window takes a file let go on the form').toBe(true);
    await expect(modal.locator('.ring-accent')).toHaveCount(0);
    await expect(strip.locator('[data-ratecon-said]')).toHaveText(
      'Filled 2 stops from PU / SO blocks (Name, Address, Date). Nothing is saved until Save.',
      { timeout: 20_000 },
    );
    await expect(modal.getByRole('tab')).toHaveCount(2);
    await expect(modal.locator('[data-drop-refused]')).toHaveCount(0);

    // A load with saved stops: no strip, and a file let go is taken and says why.
    await resetWorld();
    await page.goto('/');
    const saved = await openModal(page);
    // A saved load is read first: the form, not the reading panel, is what a file is let go on.
    await saved.getByRole('tabpanel').waitFor();
    await expect(saved.locator('[data-ratecon-strip]')).toHaveCount(0);
    expect(await dragFile(page, FORM, 'dragover', pdf)).toBe(true);
    await expect(saved.locator('.ring-accent')).toHaveCount(0);
    expect(await dragFile(page, FORM, 'drop', pdf), 'the browser would open the file').toBe(true);
    await expect(saved.locator('[data-drop-refused]')).toHaveText(
      'Nothing was read: this load has saved stops, and a read only fills a new load.',
    );
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(saved).toBeVisible();
  });
});

/* ------------------------------------------------------------------ 6 */

type Glow = { duration: number; easing: string; frames: string; startTime: number | null; scrollTop: number };
type GlowLog = { __glows: Glow[]; __glowAnimations: Animation[]; __scrolls: number[] };

/** Every glow the page starts, with the list's scroll at that moment, from before the app's code runs. */
const logGlows = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as GlowLog;
    w.__glows = [];
    w.__glowAnimations = [];
    w.__scrolls = [];
    const real = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      const animation = real.call(this, frames, options);
      if (this.hasAttribute('data-saved-glow')) {
        const timing = (typeof options === 'object' ? options : { duration: options }) as KeyframeAnimationOptions;
        const scroller = document.querySelector('[data-board-rows]')?.parentElement;
        w.__glowAnimations.push(animation);
        w.__glows.push({
          duration: Number(timing.duration),
          easing: String(timing.easing ?? ''),
          frames: JSON.stringify(frames),
          startTime: animation.startTime === null ? null : Number(animation.startTime),
          scrollTop: scroller?.scrollTop ?? -1,
        });
      }
      return animation;
    };
  });

const glowsIn = (page: Page) => page.evaluate(() => (window as unknown as GlowLog).__glows);
const scroller = (page: Page) => page.locator('[data-board-rows]').locator('..');

/**
 * Selects truck 101 by its row, as a person does: scrolled to where the virtualized list draws it,
 * then clicked until the row says it is selected (a click before the page has hydrated selects
 * nothing).
 */
async function selectRow(page: Page) {
  const row = rowOf(page);
  for (let i = 0; i < 60 && (await row.count()) === 0; i += 1) {
    await scroller(page).evaluate((el) => el.scrollBy(0, 300));
  }
  await expect(async () => {
    await row.click({ timeout: 2_000 });
    await expect(row).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return row;
}

async function saveNote(page: Page, modal: ReturnType<typeof editModal>, text: string) {
  await modal.locator('textarea').fill(text);
  await saveAndClose(page, modal);
}

test.describe('6: the row you just saved glows once', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('Save glows the saved row once at the demo\'s values, in view at once when it was off screen, nothing left; a poll glows nothing', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await logGlows(page);
    await resetWorld({ extraTrucks: 40 });
    await page.goto('/');
    await selectRow(page);
    await page.keyboard.press('Enter');
    const modal = editModal(page);
    await expect(modal).toBeVisible();

    // In view already: nothing scrolls.
    const before = await scroller(page).evaluate((el) => el.scrollTop);
    await saveNote(page, modal, 'Gate 4');
    await expect.poll(async () => (await glowsIn(page)).length).toBe(1);
    const [glow] = await glowsIn(page);
    expect(glow).toMatchObject({ duration: 1000, easing: 'linear', scrollTop: before });
    expect(JSON.parse(glow!.frames)).toEqual([{ opacity: 0 }, { opacity: 0.3, offset: 0.25 }, { opacity: 0 }]);
    await expect(rowOf(page).locator('[data-saved-glow]')).toHaveCount(1);
    // Over in its 1000ms, and nothing left: no node, no running animation on the row.
    await expect(rowOf(page).locator('[data-saved-glow]')).toHaveCount(0, { timeout: 3_000 });
    expect(await rowOf(page).evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length)).toBe(0);

    // Off screen: the list scrolled away from it, to the farther end, while the window was open.
    // Brought back at once.
    await page.keyboard.press('Enter');
    await expect(modal).toBeVisible();
    const bottom = await scroller(page).evaluate((el) => {
      const row = el.querySelector<HTMLElement>('[data-row-id="11111111-1111-4111-8111-111111111101"]')!;
      const offset = row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      el.scrollTop = offset > el.scrollHeight / 2 ? 0 : el.scrollHeight;
      return el.scrollTop;
    });
    await expect(rowOf(page)).not.toBeInViewport();
    // Every frame's scroll from the press of Save to the glow: one jump, no steps between.
    await page.evaluate(() => {
      const w = window as unknown as GlowLog;
      const el = document.querySelector('[data-board-rows]')!.parentElement!;
      const sample = () => {
        w.__scrolls.push(el.scrollTop);
        if (w.__scrolls.length < 90) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await saveNote(page, modal, 'Gate 5');
    await expect.poll(async () => (await glowsIn(page)).length).toBe(2);
    const second = (await glowsIn(page))[1]!;
    expect(second.scrollTop).not.toBe(bottom);
    await expect(rowOf(page)).toBeInViewport();
    await page.waitForFunction(() => (window as unknown as GlowLog).__scrolls.length >= 90);
    const seen = [...new Set(await page.evaluate(() => (window as unknown as GlowLog).__scrolls))];
    expect(seen, `scroll positions seen, frame by frame: ${seen.join(', ')}`).toEqual([bottom, second.scrollTop]);

    // A poll after it: nothing more glows.
    await page.waitForResponse((r) => r.url().includes('/api/fleet') && r.request().method() === 'GET', { timeout: 30_000 });
    await page.waitForTimeout(500);
    expect(await glowsIn(page)).toHaveLength(2);
  });

  /**
   * The press table, as 3bj's: a real mouse on the glowing row 20, 60, 120 and 300ms into the
   * glow by its own clock (±18ms), held 40ms, 8 landed presses a cell, and 950ms, just before its
   * end. A press that came early or late is tried again with a new save; a miss never is.
   * Landed: it came down and went up on the saved row, the row heard the click, and its box did
   * not change. The glow is opacity only on a layer that takes no pointer. The page's long tasks
   * around each glow's start are recorded and said at the end.
   */
  test('a real mouse on the glowing row, 20 to 300ms into its glow: every press lands', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await logGlows(page);
    await resetWorld();
    await page.addInitScript(() => {
      type Press = { at: number | null; down: boolean; up: boolean | null; clicked: boolean };
      const w = window as unknown as GlowLog & { __press: Press | null; __long: { start: number; duration: number }[] };
      w.__press = null;
      // What keeps the page from taking a press early in the glow: its long tasks.
      w.__long = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__long.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: 'longtask', buffered: true });
      const onRow = (event: Event) => Boolean((event.target as Element | null)?.closest?.('[data-row-id="11111111-1111-4111-8111-111111111101"]'));
      window.addEventListener(
        'pointerdown',
        (event) => {
          const glow = w.__glowAnimations.at(-1);
          const start = glow?.startTime;
          w.__press = {
            at: glow && start !== null && start !== undefined ? Number(document.timeline.currentTime) - Number(start) : null,
            down: onRow(event),
            up: null,
            clicked: false,
          };
        },
        true,
      );
      window.addEventListener('pointerup', (event) => {
        if (w.__press) w.__press.up = onRow(event);
      }, true);
      window.addEventListener('click', (event) => {
        if (w.__press && onRow(event)) w.__press.clicked = true;
      }, true);
    });
    await page.goto('/');
    const row = await selectRow(page);
    const cdp = await page.context().newCDPSession(page);
    const box = (await row.boundingBox())!;
    const at = { x: box.x + box.width * 0.4, y: box.y + box.height / 2 };

    const TIMES = [20, 60, 120, 300, 950];
    const table: Record<number, { landed: number; missed: number; tries: number }> = {};
    const check = row.locator('input[type="checkbox"]');
    let lead = 10;
    let n = 0;
    let lastSave = 0;
    const ats: string[] = [];
    for (const target of TIMES) {
      table[target] = { landed: 0, missed: 0, tries: 0 };
      while (table[target]!.landed < 8) {
        expect(table[target]!.tries, `${target}ms: too many presses came early or late (${ats.join(', ')})`).toBeLessThan(40);
        table[target]!.tries += 1;
        n += 1;
        await page.keyboard.press('Enter');
        const modal = editModal(page);
        await expect(modal).toBeVisible();
        await modal.locator('textarea').fill(`Round ${n}`);
        const glows = (await glowsIn(page)).length;
        const checkedBefore = await check.isChecked();
        // Armed before Save: the page says when the glow's own clock reaches the target, less the
        // press's own way in, and the press goes the moment it does.
        const pressNow = page.waitForEvent('console', { predicate: (m) => m.text() === 'press now', timeout: 30_000 });
        await page.evaluate(
          ({ glows, until }) => {
            const tick = () => {
              const glow = (window as unknown as GlowLog).__glowAnimations[glows];
              if (glow && glow.startTime !== null && Number(document.timeline.currentTime) - Number(glow.startTime) >= until) {
                console.info('press now');
                return;
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          },
          { glows, until: target - lead },
        );
        // The save route allows a person's pace, not a loop's (15 at once, then one every 4s): a
        // save at most every 1.2s, and one refused for that is sent again after 4.5s.
        for (let attempt = 0; ; attempt += 1) {
          await page.waitForTimeout(Math.max(0, lastSave + 1_200 - Date.now()));
          lastSave = Date.now();
          await modal.getByRole('button', { name: /^Save$/ }).click();
          // The click took the mouse to Save: back over the row before the glow comes.
          await page.mouse.move(at.x, at.y);
          // The press goes the moment the page says: nothing of the test's may wait in between.
          const outcome = await Promise.race([
            pressNow.then(() => 'press' as const, () => 'no glow' as const),
            modal
              .getByText('Too many requests')
              .waitFor({ timeout: 20_000 })
              .then(() => 'limited' as const, () => 'no glow' as const),
          ]);
          expect(outcome, 'the save closed the window and its glow came').not.toBe('no glow');
          if (outcome === 'press') break;
          expect(attempt, 'the save route kept refusing').toBeLessThan(5);
          await page.waitForTimeout(4_500);
        }
        // The browser's own press, what `page.mouse.down` sends, straight from a CDP session: the
        // trace's snapshot around a Playwright action held that one back 350 to 500ms (as 3bm found).
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 });
        await page.waitForTimeout(40);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 });
        await expect(modal).toBeHidden();
        const press = await page.evaluate(() => (window as unknown as { __press: { at: number | null; down: boolean; up: boolean | null; clicked: boolean } | null }).__press);
        expect(press, 'the press reached the page').not.toBeNull();
        // Each round meets one glow: let this one land first.
        await expect(row.locator('[data-saved-glow]')).toHaveCount(0, { timeout: 3_000 });
        ats.push(`${target}:${press!.at === null ? 'none' : Math.round(press!.at)}/lead ${Math.round(lead)}`);
        const error = (press!.at ?? 0) - target;
        lead = Math.max(0, Math.min(150, lead + error));
        if (press!.at === null || Math.abs(error) > 18) continue;
        const checkedAfter = await check.isChecked();
        if (press!.down && press!.up && press!.clicked && checkedAfter === checkedBefore) table[target]!.landed += 1;
        else table[target]!.missed += 1;
      }
    }
    console.info(`e2e: the glow's press table (landed, missed, tries): ${TIMES.map((t) => `${t}ms ${table[t]!.landed}/${table[t]!.missed}/${table[t]!.tries}`).join('; ')}`);
    // Each glow's busy start: the long tasks that began within 600ms of it, in ms from its start.
    const busy = await page.evaluate(() => {
      const w = window as unknown as GlowLog & { __long: { start: number; duration: number }[] };
      return w.__glowAnimations.map((glow) => {
        const start = Number(glow.startTime);
        return w.__long
          .filter((t) => t.start + t.duration > start - 50 && t.start < start + 600)
          .map((t) => `${Math.round(t.start - start)}+${Math.round(t.duration)}`)
          .join(' ');
      });
    });
    console.info(`e2e: long tasks around each glow's start (ms from it + length): ${busy.slice(0, 8).join(' | ')}`);
    for (const t of TIMES) expect(table[t]!.missed, `${t}ms into the glow`).toBe(0);
    // Left as found: the save route's allowance refills in 60s (15 at 0.25 a second), so the next
    // test to save, here or in the next file, is not refused for this one's pace.
    await page.waitForTimeout(61_000);
  });
});

test.describe('6, under reduced motion: the static tag the flash has', () => {
  test('Save: nothing plays, and the row says "saved" after its chip', async ({ page }) => {
    await logGlows(page);
    await resetWorld();
    const modal = await openModal(page);
    await saveNote(page, modal, 'Gate 6');
    await expect(rowOf(page).locator('[data-saved-tag]')).toHaveText('◆ saved');
    await expect(rowOf(page).locator('[data-saved-glow]')).toHaveCount(0);
    expect(await glowsIn(page)).toHaveLength(0);
  });
});
