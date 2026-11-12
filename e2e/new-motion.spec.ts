import { expect, test, type Locator, type Page } from '@playwright/test';
import { IDS, connect, resetWorld } from './fixtures';
import { SIZES, onPhone } from './phone-helpers';
import { FREE, seedBoard } from './assignments-seed';
import { seedHistory } from './history-seed';

/**
 * Phase 3bd, the new motion (§12.149), in a real browser with motion on and a real
 * pointer. The suite's default is reduced (playwright.config.ts), so this file turns
 * it back on, as `dialog-motion.spec.ts` does.
 *
 * What every motion here is held to, by `watchFrames`: nothing grows a scroller on
 * any frame, and nothing is left when it ends.
 */
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

/**
 * The numbers of §12.149, written out and not read from `tokens.ts`: a test reading the
 * token passes whatever the token says.
 */
const DIALOG_CURVE = 'cubic-bezier(.22,.61,.36,1)';
const SEGMENT_MS = 260;
const ROLL_MS = 400;
const FLASH_MS = 1600;
const PAGE_MS = 260;
const RISE_PX = 10;
const BAR_MS = 300;
const OPEN_MS = 500;
const OPEN_ROW_MS = 200;
const OPEN_GAP_MAX_MS = 35;
const SELECT_MS = 280;
const MAP_MS = 700;
const ZOOM_MS = 150;
const GLIDE_MS = 380;
/** §12.152, phase 3bj: the small motions. */
const SMALL_MS = 270;
const PAL_MS = 180;
const DROP_PX = 14;
const POP_FROM = 0.5;
const TOUR_PX = 28;

test.beforeEach(async () => {
  await resetWorld();
});

type Frames = {
  __stop: boolean;
  __count: number;
  /** For each scroller: the most it could scroll on any frame, across and down. */
  __peak: Map<Element, [number, number]>;
  __start: Map<Element, [number, number]>;
};

const OVERFLOWS = /auto|scroll|hidden/;

/**
 * Every scroller on the page, read on every frame. A thing moving past its box makes
 * the box able to scroll further for that frame, and the bars appear: §12.148, 3bb's
 * live bug. Hidden boxes count too, since what moves past one still counts against it.
 * The map's own insides do not.
 *
 * Growth is measured against the larger of the two ends, because a list that changes
 * length has really changed its size.
 */
async function watchFrames(page: Page) {
  await page.evaluate((pattern) => {
    const overflows = new RegExp(pattern);
    const w = window as unknown as Frames;
    w.__stop = false;
    w.__count = 0;
    w.__peak = new Map();
    w.__start = new Map();
    const find = () => [
      document.documentElement,
      document.body,
      ...[...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
        // A screen reader's 1px box: what it says changes with the clock.
        if (el.closest('.mapboxgl-map') || el.classList.contains('sr-only')) return false;
        const cs = getComputedStyle(el);
        return overflows.test(cs.overflowX) || overflows.test(cs.overflowY);
      }),
    ];
    let scrollers = find();
    const read = () => {
      if (w.__stop) return;
      w.__count += 1;
      // The list of them changes rarely, and finding them is the one slow part.
      if (w.__count % 30 === 0) scrollers = find();
      for (const el of scrollers) {
        const x = el.scrollWidth - el.clientWidth;
        const y = el.scrollHeight - el.clientHeight;
        if (!w.__start.has(el)) w.__start.set(el, [x, y]);
        const peak = w.__peak.get(el);
        w.__peak.set(el, peak ? [Math.max(peak[0], x), Math.max(peak[1], y)] : [x, y]);
      }
      requestAnimationFrame(read);
    };
    read();
  }, OVERFLOWS.source);

  return async () =>
    page.evaluate(() => {
      const w = window as unknown as Frames;
      w.__stop = true;
      const grew: string[] = [];
      for (const [el, [px, py]] of w.__peak) {
        if (!el.isConnected) continue;
        const [sx, sy] = w.__start.get(el)!;
        const ex = el.scrollWidth - el.clientWidth;
        const ey = el.scrollHeight - el.clientHeight;
        if (px > Math.max(sx, ex) || py > Math.max(sy, ey)) {
          const name = `${el.tagName} ${String(el.className).slice(0, 60)}`;
          grew.push(`${name}: ${sx},${sy} -> peak ${px},${py} -> ${ex},${ey}`);
        }
      }
      return { frames: w.__count, grew };
    });
}

test.describe('the watch itself', () => {
  /** A sweep that cannot fail has tested nothing. */
  test('a control: something planted past the edge of a box is found', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    const stop = await watchFrames(page);
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          const scroller = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!;
          const planted = document.createElement('div');
          planted.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px';
          planted.style.transform = 'translateY(5000px)';
          scroller.querySelector('[style*="relative"]')!.append(planted);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              planted.remove();
              requestAnimationFrame(() => done());
            }),
          );
        }),
    );
    const { grew } = await stop();
    expect(grew.join('\n')).toContain('overflow-y-auto');
  });
});

test.describe('step 1, the map toggle is a long thing', () => {
  const toggle = (page: Page) => page.getByRole('button', { name: /^(Hide|Show) map$/ });
  const transformOf = (el: Element) => getComputedStyle(el).transform;
  const scaleOf = (matrix: string) =>
    matrix === 'none' ? 1 : Number(/matrix\(([^,]+)/.exec(matrix)![1]);

  test('pressed, it shrinks by half a percent and does not lift, and the stored split stays', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto('/');
    await toggle(page).waitFor();
    const stored = () =>
      page.evaluate(() => [
        window.localStorage.getItem('ft.splitPct'),
        window.localStorage.getItem('ft.narrowPane'),
      ]);
    const before = await stored();
    const box = (await toggle(page).boundingBox())!;
    const stop = await watchFrames(page);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(250);
    expect(await toggle(page).evaluate(transformOf)).toBe('none');

    await page.mouse.down();
    await expect.poll(async () => scaleOf(await toggle(page).evaluate(transformOf))).toBeCloseTo(0.995, 3);
    const held = (await toggle(page).boundingBox())!;
    expect(box.width - held.width).toBeLessThan(box.width * 0.006);
    await page.mouse.move(1, 1);
    await page.mouse.up();
    await expect.poll(() => toggle(page).evaluate(transformOf)).toBe('none');

    const { frames, grew } = await stop();
    expect(frames).toBeGreaterThan(5);
    expect(grew).toEqual([]);
    expect(await stored()).toEqual(before);
  });

  test('a click still toggles it, and the stored split still stays', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto('/');
    await toggle(page).waitFor();
    const split = () => page.evaluate(() => window.localStorage.getItem('ft.splitPct'));
    const before = await split();
    const name = await toggle(page).textContent();
    await toggle(page).click();
    await expect(toggle(page)).not.toHaveText(name!);
    expect(await split()).toBe(before);
  });
});

/**
 * Whatever `read` returns, on every frame, until stopped. As a string so it runs in
 * the page with no help from Playwright between frames.
 */
async function record<T>(page: Page, read: () => T) {
  await page.evaluate(`(() => {
    const read = ${read.toString()};
    window.__rec = [];
    window.__recStop = false;
    const tick = () => {
      if (window.__recStop) return;
      window.__rec.push(read());
      requestAnimationFrame(tick);
    };
    tick();
  })()`);
  return () =>
    page.evaluate(() => {
      const w = window as unknown as { __rec: unknown[]; __recStop: boolean };
      w.__recStop = true;
      return w.__rec as T[];
    });
}

/** A second recorder alongside the first, for a test that reads two things. */
async function record2<T>(page: Page, read: () => T) {
  await page.evaluate(`(() => {
    const read = ${read.toString()};
    window.__rec2 = [];
    window.__rec2Stop = false;
    const tick = () => {
      if (window.__rec2Stop) return;
      window.__rec2.push(read());
      requestAnimationFrame(tick);
    };
    tick();
  })()`);
  return () =>
    page.evaluate(() => {
      const w = window as unknown as { __rec2: unknown[]; __rec2Stop: boolean };
      w.__rec2Stop = true;
      return w.__rec2 as T[];
    });
}

/**
 * The page's own frames have settled. The map's first load, drawn in software here,
 * runs frames of 200ms and more for a second or so after a page opens (measured), and a
 * short motion started in them is only a frame or two. A condition, not a wait.
 */
const quiet = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        let last = performance.now();
        let calm = 0;
        const tick = (now: number) => {
          calm = now - last < 25 ? calm + 1 : 0;
          last = now;
          if (calm >= 12) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

/** A curve as the browser prints it, and as the token writes it, compared as numbers. */
const curve = (easing: string) => easing.replace(/\s/g, '').replace(/([(,])0\./g, '$1.');

/** Everything the page is still running, other than a button letting go of a press. */
const stillMoving = (page: Page) =>
  page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (a) => !(a instanceof CSSTransition && ['--press', '--lift', 'transform'].includes(a.transitionProperty)),
        )
        .map((a) => (a instanceof CSSTransition ? a.transitionProperty : a.constructor.name)).length,
  );

test.describe('step 2, a segment highlight slides', () => {
  const OVERLAY = '[data-segment-slide]';
  const overlayFrame = () => {
    const found = [...document.querySelectorAll('[data-segment-slide]')];
    const w = window as unknown as { __from?: Element; __to?: Element };
    return {
      count: found.length,
      x: found[0]?.getBoundingClientRect().x ?? null,
      from: w.__from ? getComputedStyle(w.__from).backgroundColor : null,
      to: w.__to ? getComputedStyle(w.__to).backgroundColor : null,
    };
  };

  const expectSlid = async (page: Page, target: Locator) => {
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(target).not.toHaveAttribute('data-segment-target', '');
    await expect.poll(() => stillMoving(page)).toBe(0);
  };

  const groundOf = (el: Element) => {
    const cs = getComputedStyle(el);
    return [cs.backgroundColor, cs.borderTopColor, cs.boxShadow];
  };

  /** One gesture on one control: a real pointer, with every frame read. */
  async function slideOnce(page: Page, from: Locator, to: Locator) {
    const before = await page.evaluate(
      () => document.querySelectorAll('[data-segment-slide]').length,
    );
    expect(before).toBe(0);
    // The stacking context that lets it sit under the words and over the ground.
    expect(
      await to.evaluate((el) => {
        const cs = getComputedStyle(el.parentElement!);
        return cs.isolation === 'isolate' || cs.zIndex !== 'auto';
      }),
    ).toBe(true);
    await from.evaluate((el) => {
      (window as unknown as { __from: Element }).__from = el;
    });
    await to.evaluate((el) => {
      (window as unknown as { __to: Element }).__to = el;
    });
    const stop = await watchFrames(page);
    const frames = await record(page, overlayFrame);
    const box = (await to.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    const timing = await page
      .locator(OVERLAY)
      .evaluate((el) => {
        const [a] = el.getAnimations();
        const t = a!.effect!.getTiming();
        return { duration: t.duration, easing: t.easing, fill: t.fill };
      })
      .then((t) => ({ ...t, easing: curve(String(t.easing)) }))
      .catch(() => null);
    await expectSlid(page, to);
    const seen = await frames();
    const { frames: count, grew } = await stop();

    expect(grew).toEqual([]);
    expect(count).toBeGreaterThan(5);
    expect(Math.max(...seen.map((f) => f.count))).toBe(1);
    const xs = seen.flatMap((f) => (f.x === null ? [] : [f.x]));
    // Two at least: choosing a basemap reloads the map, heavy in software, in the same moment.
    expect(xs.length).toBeGreaterThan(1);
    // The old ground is gone as the overlay leaves it, and the new one is there as it
    // lands: neither fades on its own beside the overlay. A hover can show on `from`.
    const flying = seen.filter((f) => f.count === 1);
    expect(new Set(flying.map((f) => f.to))).toEqual(new Set(['rgba(0, 0, 0, 0)']));
    const landed = seen.slice(seen.map((f) => f.count).lastIndexOf(1) + 1);
    expect(new Set(landed.map((f) => f.to)).size).toBe(1);
    expect(flying[0]!.from).toBe(flying.at(-1)!.from);
    const direction = Math.sign(xs[xs.length - 1]! - xs[0]!);
    expect(direction).not.toBe(0);
    for (let i = 1; i < xs.length; i += 1) {
      // It only ever goes one way, and it never goes back.
      expect(Math.sign(xs[i]! - xs[i - 1]!) * direction).toBeGreaterThanOrEqual(0);
    }
    expect(timing).toEqual({
      duration: SEGMENT_MS,
      easing: curve(DIALOG_CURVE),
      fill: 'auto',
    });
  }

  test('the density control: slides, lands, and leaves nothing', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const comfortable = page.locator('[data-segment="comfortable"]');
    const compact = page.locator('[data-segment="compact"]');
    const restingLook = await comfortable.evaluate(groundOf);
    await slideOnce(page, comfortable, compact);
    await expect(compact).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(1, 1);
    await expect.poll(() => compact.evaluate(groundOf)).toEqual(restingLook);
    await expect(compact).not.toHaveAttribute('style', /./);
  });

  test('the basemap control: slides, lands, and leaves nothing', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const dark = page.locator('[data-segment="dark"]');
    const satellite = page.locator('[data-segment="satellite"]');
    await slideOnce(page, dark, satellite);
    await expect(satellite).toHaveAttribute('aria-pressed', 'true');
    await expect(satellite).not.toHaveAttribute('style', /./);
  });

  test('the phone tabs: slide, land, and leave nothing', async ({ browser }) => {
    const { context, page } = await onPhone(browser, SIZES[3]!);
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto('/');
      const list = page.locator('[data-phone-tab="list"]');
      const map = page.locator('[data-phone-tab="map"]');
      await map.waitFor();
      await quiet(page);
      await slideOnce(page, list, map);
      await expect(map).toHaveAttribute('aria-selected', 'true');
      await expect(map).not.toHaveAttribute('style', /./);
    } finally {
      await context.close();
    }
  });

  test('a second choice takes it up from where it is drawn, with no pile-up', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const frames = await record(page, overlayFrame);
    const comfortable = (await page.locator('[data-segment="comfortable"]').boundingBox())!;
    const compact = (await page.locator('[data-segment="compact"]').boundingBox())!;
    const distance = Math.abs(compact.x - comfortable.x);
    // In the page, two frames apart, so the second lands well before the first arrives:
    // Playwright's own round trips can outlast most of a slide and hide a jump.
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          document.querySelector<HTMLElement>('[data-segment="compact"]')!.click();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              document.querySelector<HTMLElement>('[data-segment="comfortable"]')!.click();
              done();
            }),
          );
        }),
    );
    await expect(page.locator('[data-segment="comfortable"]')).toHaveAttribute('aria-pressed', 'true');
    await expectSlid(page, page.locator('[data-segment="comfortable"]'));
    const seen = await frames();
    expect(Math.max(...seen.map((f) => f.count))).toBe(1);
    const xs = seen.flatMap((f) => (f.x === null ? [] : [f.x]));
    for (let i = 1; i < xs.length; i += 1) {
      // A frame of this curve covers a quarter of the way at most, at its fastest.
      expect(Math.abs(xs[i]! - xs[i - 1]!)).toBeLessThan(distance * 0.35);
    }
  });

  test('D pressed five times fast: one overlay at a time, and the choice is the last', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const frames = await record(page, overlayFrame);
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('d');
    await expect(page.locator('[data-segment="compact"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    expect(Math.max(...(await frames()).map((f) => f.count))).toBe(1);
  });

  test('a press holds it until it ends', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const compact = (await page.locator('[data-segment="compact"]').boundingBox())!;
    await page.mouse.click(compact.x + 8, compact.y + 8);
    await page.mouse.move(400, 12);
    await page.mouse.down();
    const time = () =>
      page.locator(OVERLAY).evaluate((el) => el.getAnimations()[0]!.currentTime as number);
    const first = await time();
    expect(first).toBeLessThan(SEGMENT_MS);
    await page.waitForTimeout(SEGMENT_MS + 60);
    expect(await time()).toBe(first);
    await page.mouse.up();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  test('a stored choice does not slide on load, nor when the page comes back', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('ft.density', 'compact');
      window.localStorage.setItem('ft.basemap', 'satellite');
      const w = window as unknown as { __slides: number };
      w.__slides = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n instanceof HTMLElement && n.hasAttribute('data-segment-slide')) w.__slides += 1;
          }
        }
      }).observe(document, { subtree: true, childList: true });
    });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await expect(page.locator('[data-segment="compact"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-segment="satellite"]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.locator('[data-history-summary]').waitFor();
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await page.locator('[data-row-id]').first().waitFor();
    await expect(page.locator('[data-segment="compact"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => (window as unknown as { __slides: number }).__slides)).toBe(0);
  });

  test('a filter chip never slides: it is multi-select', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const frames = await record(page, overlayFrame);
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('0');
    await quiet(page);
    expect(Math.max(...(await frames()).map((f) => f.count))).toBe(0);
  });

  test('under reduced motion: no overlay, no animation, and the choice is at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const frames = await record(page, () => ({
      overlays: document.querySelectorAll('[data-segment-slide]').length,
      animations: document.getAnimations().filter((a) => !(a instanceof CSSAnimation)).length,
    }));
    await page.locator('[data-segment="compact"]').click();
    await expect(page.locator('[data-segment="compact"]')).toHaveAttribute('aria-pressed', 'true');
    // Read past the end of where a slide would be. Stopping here read nothing at all.
    await quiet(page);
    const seen = await frames();
    expect(seen.length).toBeGreaterThan(10);
    expect(Math.max(...seen.map((f) => f.overlays))).toBe(0);
    expect(Math.max(...seen.map((f) => f.animations))).toBe(0);
  });
});

/**
 * Serves `/api/fleet` through `change`, and asks for it now: the same request a poll
 * makes, by the same hook, with no 20s to wait. Returns once the answer is in the page.
 */
async function pollWith(page: Page, change: (rows: FleetRowLike[]) => void) {
  await page.unroute('**/api/fleet');
  await page.route('**/api/fleet', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { fleet: FleetRowLike[] };
    change(body.fleet);
    await route.fulfill({ response, json: body });
  });
  const answered = page.waitForResponse('**/api/fleet');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await answered;
}

type FleetRowLike = { id: string; status: string; computed: string; active: boolean };

/** The first `n` rows are late, and the rest as they were. */
const lateFirst = (n: number) => (rows: FleetRowLike[]) => {
  rows.forEach((row, i) => {
    if (i < n) {
      row.status = 'LATE';
      row.computed = 'LATE';
    }
  });
};

test.describe('step 3, a count rolls when it changes', () => {
  const chip = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).first();
  const cell = (page: Page, name: string) => chip(page, name).locator('[data-roll]');
  const COPY = '[data-roll-copy]';

  const openLong = async (page: Page) => {
    await resetWorld({ extraTrucks: 20 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
  };

  test('0 to 1: two numbers for its length, then a plain number', async ({ page }) => {
    await openLong(page);
    await expect(cell(page, 'Late')).toHaveText('0');
    await chip(page, 'Late').evaluate((el) => {
      (window as unknown as { __chip: Element }).__chip = el;
    });
    const stop = await watchFrames(page);
    const frames = await record(page, () => ({
      // Per number: a truck going late takes one off another chip in the same poll.
      copies: Math.max(
        0,
        ...[...document.querySelectorAll('[data-roll]')].map(
          (b) => b.querySelectorAll('[data-roll-copy]').length,
        ),
      ),
      // What the Late chip's box is doing on this frame, read where it happens.
      ...(() => {
        const box = (window as unknown as { __chip: Element }).__chip.querySelector('[data-roll]')!;
        const copy = box.querySelector('[data-roll-copy]');
        if (!copy) return { overflow: null, from: null, duration: null, easing: null };
        const number = box.firstElementChild!.getAnimations()[0]?.effect as KeyframeEffect | undefined;
        return {
          overflow: getComputedStyle(box).overflow,
          from: number?.getKeyframes()[0]?.transform ?? null,
          duration: number?.getTiming().duration ?? null,
          easing: number?.getTiming().easing ?? null,
        };
      })(),
    }));
    await pollWith(page, lateFirst(1));
    await expect(cell(page, 'Late')).toHaveText('1', { timeout: 2_000 });
    const seen = await frames();
    const { grew, frames: count } = await stop();
    expect(grew).toEqual([]);
    expect(count).toBeGreaterThan(5);
    expect(seen.filter((f) => f.copies > 0).length).toBeGreaterThan(3);
    expect(Math.max(...seen.map((f) => f.copies))).toBe(1);
    const rolling = seen.filter((f) => f.overflow !== null);
    expect(rolling.length).toBeGreaterThan(3);
    for (const frame of rolling) {
      // It rolls inside its own box. Going up, the new number comes from below.
      expect(frame.overflow).toBe('clip');
      expect(frame.from).toBe('translateY(100%)');
      expect(frame.duration).toBe(ROLL_MS);
      expect(curve(String(frame.easing))).toBe(curve(DIALOG_CURVE));
    }

    // Plain: the number, as text, with nothing on it or around it.
    const rest = await cell(page, 'Late').evaluate((box) => ({
      text: box.textContent,
      children: box.children.length,
      boxStyle: box.getAttribute('style'),
      numberStyle: box.firstElementChild?.getAttribute('style') ?? null,
      animations: box.getAnimations({ subtree: true }).length,
    }));
    expect(rest).toEqual({ text: '1', children: 1, boxStyle: null, numberStyle: null, animations: 0 });

    // Going down, it comes from above.
    const down = await record(page, () => {
      const box = (window as unknown as { __chip: Element }).__chip.querySelector('[data-roll]')!;
      return (box.firstElementChild!.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes()[0]
        ?.transform;
    });
    await pollWith(page, lateFirst(0));
    await expect(cell(page, 'Late')).toHaveText('0');
    const ways = new Set((await down()).filter(Boolean));
    expect(ways).toEqual(new Set(['translateY(-100%)']));
  });

  test('a screen reader only ever gets the final number', async ({ page }) => {
    await openLong(page);
    await chip(page, 'Late').evaluate((el) => {
      (window as unknown as { __chip: Element }).__chip = el;
    });
    const frames = await record(page, () => {
      const el = (window as unknown as { __chip: Element }).__chip;
      const copy = el.querySelector('[data-roll-copy]');
      const clone = el.cloneNode(true) as Element;
      clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      return {
        spoken: clone.textContent,
        copyHidden: copy ? copy.getAttribute('aria-hidden') : 'none',
      };
    });
    await pollWith(page, lateFirst(1));
    await expect(cell(page, 'Late')).toHaveText('1');
    await expect(page.getByRole('button', { name: /^Late\s*1$/ })).toBeVisible();
    const seen = await frames();
    expect([...new Set(seen.map((f) => f.spoken))]).toEqual(['Late0', 'Late1']);
    expect(seen.some((f) => f.copyHidden === 'true')).toBe(true);
    expect(seen.every((f) => f.copyHidden === 'true' || f.copyHidden === 'none')).toBe(true);
  });

  test('9 to 10: the chip beside it steps once, and nothing moves up or down', async ({ page }) => {
    await openLong(page);
    await pollWith(page, lateFirst(9));
    await expect(cell(page, 'Late')).toHaveText('9');
    await expect(page.locator(COPY)).toHaveCount(0);
    await quiet(page);

    await chip(page, 'Late').evaluate((el) => {
      (window as unknown as { __chip: Element }).__chip = el;
    });
    await chip(page, 'At risk').evaluate((el) => {
      (window as unknown as { __next: Element }).__next = el;
    });
    const stop = await watchFrames(page);
    const frames = await record(page, () => {
      const w = window as unknown as { __chip: Element; __next: Element };
      const box = w.__chip.querySelector('[data-roll]')!.getBoundingClientRect();
      const chipBox = w.__chip.getBoundingClientRect();
      return {
        nextX: w.__next.getBoundingClientRect().x,
        top: box.top,
        height: box.height,
        chipTop: chipBox.top,
        chipHeight: chipBox.height,
      };
    });
    await pollWith(page, lateFirst(10));
    await expect(cell(page, 'Late')).toHaveText('10');
    await expect(page.locator(COPY)).toHaveCount(0);
    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    expect(new Set(seen.map((f) => f.nextX)).size).toBe(2);
    expect(new Set(seen.map((f) => f.chipTop)).size).toBe(1);
    expect(new Set(seen.map((f) => f.chipHeight)).size).toBe(1);
    expect(new Set(seen.map((f) => f.top)).size).toBe(1);
    expect(new Set(seen.map((f) => f.height)).size).toBe(1);
  });

  test('rapid polls: one old number at a time, and it ends on the last', async ({ page }) => {
    await openLong(page);
    await chip(page, 'Late').evaluate((el) => {
      (window as unknown as { __chip: Element }).__chip = el;
    });
    const frames = await record(page, () => ({
      most: Math.max(
        0,
        ...[...document.querySelectorAll('[data-roll]')].map(
          (b) => b.querySelectorAll('[data-roll-copy]').length,
        ),
      ),
      old:
        (window as unknown as { __chip: Element }).__chip.querySelector('[data-roll-copy]')?.textContent ??
        null,
    }));
    for (const n of [1, 2, 3, 4, 5]) await pollWith(page, lateFirst(n));
    await expect(cell(page, 'Late')).toHaveText('5');
    await expect(page.locator(COPY)).toHaveCount(0);
    const seen = await frames();
    expect(Math.max(...seen.map((f) => f.most))).toBe(1);
    // A poll really landed mid-roll: from one old number to the next with no frame between.
    const midRoll = seen.filter((f, i) => i > 0 && f.old && seen[i - 1]!.old && f.old !== seen[i - 1]!.old);
    expect(midRoll.length).toBeGreaterThan(0);
    expect(await cell(page, 'Late').evaluate((b) => b.getAttribute('style'))).toBeNull();
  });

  test('nothing changed: nothing rolls, and the first paint never does', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __rolls: number };
      w.__rolls = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n instanceof HTMLElement && n.hasAttribute('data-roll-copy')) w.__rolls += 1;
          }
        }
      }).observe(document, { subtree: true, childList: true });
    });
    await openLong(page);
    await pollWith(page, () => {});
    await quiet(page);
    expect(await page.evaluate(() => (window as unknown as { __rolls: number }).__rolls)).toBe(0);
  });

  test('a press holds it until it ends', async ({ page }) => {
    await openLong(page);
    const box = (await page.locator('[data-row-id]').first().boundingBox())!;
    await page.mouse.move(box.x + 200, box.y + 10);
    await page.mouse.down();
    await pollWith(page, lateFirst(1));
    const copy = page.locator(COPY).first();
    await copy.waitFor({ state: 'attached' });
    const time = () => copy.evaluate((el) => el.getAnimations()[0]!.currentTime as number);
    const first = await time();
    await page.waitForTimeout(ROLL_MS + 60);
    expect(await time()).toBe(first);
    await page.mouse.up();
    await expect(page.locator(COPY)).toHaveCount(0);
  });

  /** Counts every copy ever added, however briefly. */
  const countCopies = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __rolls: number };
      w.__rolls = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n instanceof HTMLElement && n.hasAttribute('data-roll-copy')) w.__rolls += 1;
          }
        }
      }).observe(document, { subtree: true, childList: true });
    });
  const copiesEver = (page: Page) =>
    page.evaluate(() => (window as unknown as { __rolls: number }).__rolls);

  test('a tab in the background does not roll: it would play on the way back', async ({ page }) => {
    await countCopies(page);
    await openLong(page);
    await page.evaluate(() =>
      Object.defineProperty(document, 'hidden', { configurable: true, value: true }),
    );
    await pollWith(page, lateFirst(1));
    await expect(cell(page, 'Late')).toHaveText('1');
    expect(await copiesEver(page)).toBe(0);
  });

  test('on a phone, where the chips are not drawn, nothing rolls behind them', async ({ browser }) => {
    const { context, page } = await onPhone(browser, SIZES[3]!);
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await countCopies(page);
      await resetWorld({ extraTrucks: 5 });
      await page.goto('/');
      await page.locator('[data-count-tile="late"]').waitFor();
      await pollWith(page, lateFirst(1));
      await expect(page.locator('[data-count-tile="late"]')).toHaveAttribute('aria-label', 'Late, 1');
      expect(await copiesEver(page)).toBe(0);
    } finally {
      await context.close();
    }
  });

  test('under reduced motion: the new number at once, and no second one', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await countCopies(page);
    await openLong(page);
    const frames = await record(page, () => document.querySelectorAll('[data-roll-copy]').length);
    await pollWith(page, lateFirst(1));
    await expect(cell(page, 'Late')).toHaveText('1');
    await quiet(page);
    expect(await copiesEver(page)).toBe(0);
    expect(Math.max(...(await frames()))).toBe(0);
    expect(await cell(page, 'Late').evaluate((b) => b.getAnimations({ subtree: true }).length)).toBe(0);
  });

  test('the flash stays the strongest thing: the row keeps its 1.6s, the count only its cell', async ({ page }) => {
    await openLong(page);
    let changed = '';
    const firstRow = (rows: FleetRowLike[]) => {
      changed = rows[0]!.id;
      lateFirst(1)(rows);
    };
    await pollWith(page, firstRow);
    const first = page.locator(`[data-row-id="${changed}"]`);
    const before = (await first.boundingBox())!;
    const flash = first.locator('.animate-flash');
    await flash.waitFor({ state: 'attached' });
    const duration = await flash.evaluate(
      (el) => el.getAnimations()[0]!.effect!.getComputedTiming().duration,
    );
    expect(duration).toBe(FLASH_MS);
    // A quarter at most. Exactly a quarter since Bold, so a longer roll has to answer to this.
    expect(ROLL_MS).toBeLessThanOrEqual(FLASH_MS / 4);
    // The poll that started it moved no row.
    expect((await first.boundingBox())!.y).toBe(before.y);
    // What rolls is 12px high inside a chip; what flashes is the whole row.
    const rolled = await cell(page, 'Late').boundingBox();
    expect(rolled!.height * rolled!.width).toBeLessThan((before.width * before.height) / 20);
  });

  test('the health strip: a real poll rolls the number that changed, and only it', async ({ page }) => {
    test.setTimeout(120_000);
    await resetWorld({ extraTrucks: 5, appointmentUtc: new Date() });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const strip = page.locator('[data-health-text]');
    const text = (await strip.textContent())!;
    const total = Number(/of (\d+) done/.exec(text)?.[1]);
    await page.route('**/api/health', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { onTime: number; remaining: number };
      body.onTime += 1;
      body.remaining -= 1;
      await route.fulfill({ response, json: body });
    });
    const stop = await watchFrames(page);
    const frames = await record(page, () =>
      [...document.querySelectorAll('[data-health-text] [data-roll]')]
        .filter((b) => b.querySelector('[data-roll-copy]'))
        .map((b) => b.getAttribute('data-roll')),
    );
    await expect(strip).toHaveText(new RegExp(`^1 of ${total} done`), { timeout: 70_000 });
    await expect(strip.locator(COPY)).toHaveCount(0);
    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    expect(seen.filter((f) => f.length > 0).length).toBeGreaterThan(3);
    expect(new Set(seen.flat())).toEqual(new Set(['1']));
    expect(await strip.locator('[data-roll]').first().evaluate((b) => b.getAttribute('style'))).toBeNull();
  });
});

/**
 * Every Web Animation the page starts, from before the page's own code runs: what it
 * moves and how. A test that something never played reads this, because a frame-by-frame
 * watch can miss what is over between two frames.
 */
const logAnimations = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __started: { from: string; duration: number; easing: string }[] };
    w.__started = [];
    const real = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      const first = (Array.isArray(frames) ? frames[0] : null) as Keyframe | null;
      const timing = (typeof options === 'object' ? options : { duration: options }) as KeyframeAnimationOptions;
      w.__started.push({
        from: `${String(first?.['transform'] ?? '')}|${String(first?.['opacity'] ?? '')}`,
        duration: Number(timing.duration),
        easing: String(timing.easing ?? ''),
      });
      return real.call(this, frames, options);
    };
  });
const started = (page: Page) =>
  page.evaluate(() => (window as unknown as { __started: { from: string; duration: number; easing: string }[] }).__started);

test.describe('step 4, a page rises', () => {
  const RISE = `translateY(${RISE_PX}px)|0`;
  const rises = async (page: Page) => (await started(page)).filter((s) => s.from === RISE);
  /** The box the template mounts, and the page in it. */
  const riseFrame = () => {
    const box = document.querySelector('[data-page]');
    const inner = box?.firstElementChild;
    const running = inner
      ?.getAnimations()
      .some((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation));
    return {
      running: Boolean(running),
      clip: box ? getComputedStyle(box).overflow : '',
      style: box?.getAttribute('style') ?? null,
      opacity: inner ? Number(getComputedStyle(inner).opacity) : 1,
      y: inner ? new DOMMatrixReadOnly(getComputedStyle(inner).transform).m42 : 0,
    };
  };
  const toBoardAndBack = async (page: Page) => {
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.locator('[data-history-summary]').waitFor();
    await quiet(page);
  };
  const backToBoard = async (page: Page) => {
    await page.keyboard.press('g');
    await page.keyboard.press('b');
  };
  /** The board is drawn and still rising. Checked on each frame, so it does not miss it. */
  const midRise = (page: Page) =>
    page.waitForFunction(
      () =>
        Boolean(
          document.querySelector('[data-row-id]') &&
            document
              .querySelector('[data-page]')
              ?.firstElementChild?.getAnimations()
              .some((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)),
        ),
      undefined,
      { polling: 'raf' },
    );

  test('a change of page: it fades and rises 10px in 260ms, and leaves nothing', async ({ page }) => {
    await logAnimations(page);
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const stop = await watchFrames(page);
    const frames = await record(page, riseFrame);
    await toBoardAndBack(page);
    // Past its end, so the last frame read is the page at rest: `quiet` alone is shorter than a rise.
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);

    const seen = await frames();
    const { grew, frames: count } = await stop();
    expect(grew).toEqual([]);
    expect(count).toBeGreaterThan(5);
    const [only, ...more] = await rises(page);
    expect(more).toEqual([]);
    expect(only!.duration).toBe(PAGE_MS);
    expect(curve(only!.easing)).toBe(curve(DIALOG_CURVE));

    const rising = seen.filter((f) => f.running);
    expect(rising.length).toBeGreaterThan(2);
    // The box clips for as long as it rises, or the page below the screen scrolls.
    expect(new Set(rising.map((f) => f.clip))).toEqual(new Set(['clip']));
    for (const f of rising) {
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeLessThanOrEqual(RISE_PX);
    }
    const last = seen.at(-1)!;
    expect(last).toMatchObject({ running: false, style: null, opacity: 1, y: 0 });
    expect(await page.locator('[data-page]').evaluate((b) => b.firstElementChild!.getAttribute('style'))).toBeNull();
    await expect.poll(() => stillMoving(page)).toBe(0);
  });

  test('the two links that change page rise too: Assignments, and Driver history', async ({ page }) => {
    await logAnimations(page);
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await page.getByRole('link', { name: 'Assignments' }).click();
    await page.waitForURL('**/assignments');
    await expect.poll(async () => (await rises(page)).length).toBe(1);

    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    expect(await rises(page)).toEqual([]);
    await page.getByRole('button', { name: /^Account:/ }).click();
    await page.locator('[data-menu-history]').click();
    await page.waitForURL('**/history**');
    await expect.poll(async () => (await rises(page)).length).toBe(1);
  });

  test('the first page of a load does not rise', async ({ page }) => {
    await logAnimations(page);
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    expect(await rises(page)).toEqual([]);
    await page.reload();
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    expect(await rises(page)).toEqual([]);
  });

  test('?truck=, a search, a poll and a refetch never replay it, and never remount the board or the map', async ({ page }) => {
    await logAnimations(page);
    await resetWorld({ extraTrucks: 5 });
    await page.goto('/');
    const row = page.locator('[data-row-id]').first();
    await row.waitFor();
    await page.locator('.mapboxgl-canvas').first().waitFor();
    await quiet(page);
    await page.evaluate(() => {
      const mark = (el: Element | null) => {
        (el as unknown as { __kept: boolean }).__kept = true;
      };
      mark(document.querySelector('[data-page]'));
      mark(document.querySelector('[data-row-id]')!.closest('.overflow-y-auto'));
      mark(document.querySelector('.mapboxgl-canvas'));
    });
    const kept = () =>
      page.evaluate(() =>
        ['[data-page]', '.overflow-y-auto', '.mapboxgl-canvas'].map(
          (s) => (document.querySelector(s) as unknown as { __kept?: boolean } | null)?.__kept === true,
        ),
      );

    await row.click();
    await page.waitForURL(/[?&]truck=/);
    expect(await kept()).toEqual([true, true, true]);

    await pollWith(page, lateFirst(1));
    await quiet(page);
    expect(await kept()).toEqual([true, true, true]);

    await page.keyboard.press('/');
    await page.keyboard.type('10');
    await page.waitForURL(/[?&]q=10/);
    await quiet(page);
    expect(await kept()).toEqual([true, true, true]);

    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await quiet(page);
    expect(await kept()).toEqual([true, true, true]);
    expect(await rises(page)).toEqual([]);
  });

  test('a popover opened mid-rise lands where it does at rest', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const scope = page.locator('[data-scope] [aria-haspopup="menu"]');
    const menu = page.locator('[data-views-menu]');
    const box = (await scope.boundingBox())!;
    // Its middle. On a rise's first frame the page is 10px low, and 8px in is above the button.
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await quiet(page);
    await page.mouse.down();
    await page.mouse.up();
    await menu.waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const atRest = (await menu.boundingBox())!;
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await toBoardAndBack(page);
    // The pointer is already on the button, so the press lands in the rise.
    await page.evaluate(() => {
      const w = window as unknown as { __riseAtPress: boolean | null };
      w.__riseAtPress = null;
      window.addEventListener(
        'pointerdown',
        () => {
          w.__riseAtPress = Boolean(
            document
              .querySelector('[data-page]')
              ?.firstElementChild?.getAnimations()
              .some((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)),
          );
        },
        { capture: true, once: true },
      );
    });
    await backToBoard(page);
    await midRise(page);
    await page.mouse.down();
    await page.mouse.up();
    await menu.waitFor();
    expect(await page.evaluate(() => (window as unknown as { __riseAtPress: boolean }).__riseAtPress)).toBe(true);
    await expect.poll(() => stillMoving(page)).toBe(0);
    expect(await menu.boundingBox()).toEqual(atRest);
  });

  test('a key opens one mid-rise: V, and it lands where it does at rest', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const menu = page.locator('[data-views-menu]');
    await page.keyboard.press('v');
    await menu.waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const atRest = (await menu.boundingBox())!;
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await toBoardAndBack(page);
    await backToBoard(page);
    await midRise(page);
    await page.keyboard.press('v');
    await menu.waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    expect(await menu.boundingBox()).toEqual(atRest);
  });

  test('a window opened mid-rise fills the screen from its first frame', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('[data-row-id]').first();
    await row.waitFor();
    await row.click();
    await quiet(page);
    await toBoardAndBack(page);
    await backToBoard(page);
    await midRise(page);
    const frames = await record(page, () => {
      const scrim = document.querySelector('[aria-modal="true"]');
      if (!scrim) return null;
      const r = scrim.getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    });
    await page.keyboard.press('Enter');
    await page.locator('[aria-modal="true"]').first().waitFor();
    await quiet(page);
    const viewport = page.viewportSize()!;
    const seen = (await frames()).filter((f) => f !== null);
    expect(seen.length).toBeGreaterThan(3);
    for (const f of seen) {
      expect(f).toEqual({ top: 0, left: 0, width: viewport.width, height: viewport.height });
    }
  });

  test('a press in the rise holds it, and the row under the pointer is the row selected', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('[data-row-id]').first();
    await row.waitFor();
    const box = (await row.boundingBox())!;
    await quiet(page);
    await toBoardAndBack(page);
    await page.mouse.move(box.x + 300, box.y + box.height / 2);
    await backToBoard(page);
    await midRise(page);
    await page.mouse.down();
    const time = () =>
      page.evaluate(
        () =>
          document
            .querySelector('[data-page]')
            ?.firstElementChild?.getAnimations()
            .find((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation))?.currentTime ?? null,
      );
    const first = await time();
    expect(first).not.toBeNull();
    await page.waitForTimeout(PAGE_MS + 60);
    expect(await time()).toBe(first);
    await page.mouse.up();
    await expect(page.locator('[data-row-id]').first()).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => stillMoving(page)).toBe(0);
  });

  test('Reload still asks with typed work, Discard still closes, and only then does a key change page', async ({ page }) => {
    await logAnimations(page);
    await page.goto('/');
    const row = page.locator('[data-row-id]').first();
    await row.waitFor();
    await row.click();
    await page.keyboard.press('Enter');
    const modal = page.getByRole('dialog', { name: /^(Edit|New) load for truck/ });
    await modal.waitFor();
    await modal.getByLabel('Load number').fill('TYPED');

    const asked = page.waitForEvent('dialog');
    void page.reload().catch(() => {});
    const stay = await asked;
    expect(stay.type()).toBe('beforeunload');
    await stay.dismiss();
    await expect(modal.getByLabel('Load number')).toHaveValue('TYPED');

    // Focus on a button, where the keys reach the window's guard: no page change.
    await modal.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await quiet(page);
    expect(await rises(page)).toEqual([]);

    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Discard changes?' }).getByRole('button', { name: 'Discard' }).click();
    await expect(modal).toHaveCount(0);
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.locator('[data-history-summary]').waitFor();
    await expect.poll(async () => (await rises(page)).length).toBe(1);
  });

  test('under reduced motion: no rise, and the page is there at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await logAnimations(page);
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const frames = await record(page, riseFrame);
    await toBoardAndBack(page);
    expect((await frames()).some((f) => f.running)).toBe(false);
    expect(await started(page)).toEqual([]);
  });
});

test.describe('step 4, the bulk bar comes up into its slot', () => {
  const BAR_FROM = 'translateY(100%)|';
  const bar = (page: Page) => page.locator('.bg-surface-bar button', { hasText: /^Clear/ });
  const footer = (page: Page) => page.getByText(/^Showing/);
  const COPY = '[data-bar-copy]';

  async function openBoard(page: Page) {
    await resetWorld({ extraTrucks: 5 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
  }
  const boxes = (page: Page) => page.locator('[data-row-id] input[type="checkbox"]');
  /** A real press on each of two rows' checkboxes. */
  async function checkTwo(page: Page) {
    for (const i of [0, 1]) {
      const b = (await boxes(page).nth(i).boundingBox())!;
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    }
  }
  const barFrame = () => {
    const button = [...document.querySelectorAll('.bg-surface-bar button')].find(
      (b) => b.textContent?.trim().startsWith('Clear') && !b.closest('[data-bar-copy]'),
    );
    const real = button?.closest('.bg-surface-bar');
    const slot = real?.parentElement;
    const copy = document.querySelector('[data-bar-copy]');
    return {
      open: Boolean(real),
      y: real ? new DOMMatrixReadOnly(getComputedStyle(real).transform).m42 : null,
      clip: slot ? getComputedStyle(slot).overflow : null,
      copies: document.querySelectorAll('[data-bar-copy]').length,
      copyY: copy?.firstElementChild
        ? new DOMMatrixReadOnly(getComputedStyle(copy.firstElementChild).transform).m42
        : null,
      footer: [...document.querySelectorAll('span, div')].some((n) =>
        n.textContent?.trim().startsWith('Showing'),
      ),
    };
  };

  test('opening: 300ms on the curve, inside its slot, and nothing left', async ({ page }) => {
    await logAnimations(page);
    await openBoard(page);
    const stop = await watchFrames(page);
    const frames = await record(page, barFrame);
    await checkTwo(page);
    await bar(page).waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    const moved = (await started(page)).filter((s) => s.from === BAR_FROM);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.duration).toBe(BAR_MS);
    expect(curve(moved[0]!.easing)).toBe(curve(DIALOG_CURVE));
    const flying = seen.filter((f) => f.open && f.y !== 0);
    expect(flying.length).toBeGreaterThan(2);
    expect(new Set(flying.map((f) => f.clip))).toEqual(new Set(['clip']));
    for (let i = 1; i < flying.length; i += 1) {
      expect(flying[i]!.y!).toBeLessThanOrEqual(flying[i - 1]!.y!);
    }
    const rest = await bar(page).evaluate((b) => {
      const real = b.closest('.bg-surface-bar')!;
      return {
        transform: getComputedStyle(real).transform,
        animations: real.getAnimations().length,
        slotStyle: real.parentElement!.getAttribute('style'),
        barStyle: real.getAttribute('style'),
      };
    });
    expect(rest).toEqual({ transform: 'none', animations: 0, slotStyle: null, barStyle: null });
  });

  test('its buttons work while it is still moving', async ({ page }) => {
    await openBoard(page);
    // Where the button rests, which is where a person is already aiming.
    await checkTwo(page);
    await bar(page).waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const rest = (await bar(page).boundingBox())!;
    await bar(page).click();
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator(COPY)).toHaveCount(0);
    await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2);

    // The bar is open again by keys, so the pointer has not moved.
    for (const key of ['ArrowDown', 'x', 'ArrowDown', 'x']) await page.keyboard.press(key);
    await page.waitForFunction(
      () => {
        const clear = [...document.querySelectorAll('.bg-surface-bar button')].find((b) =>
          b.textContent?.trim().startsWith('Clear'),
        );
        const real = clear?.closest('.bg-surface-bar');
        if (!real || real.getAnimations().length === 0) return false;
        // The button has reached the pointer, and the bar has further to go.
        const y = new DOMMatrixReadOnly(getComputedStyle(real).transform).m42;
        return y > 0 && y <= 8;
      },
      undefined,
      { polling: 'raf' },
    );
    await page.mouse.down();
    const moving = await bar(page).evaluate((el) => el.closest('.bg-surface-bar')!.getAnimations().length);
    await page.mouse.up();
    expect(moving).toBe(1);
    await expect(boxes(page).first()).not.toBeChecked();
    await expect(footer(page)).toBeVisible();
  });

  test('closing never waits: the footer is back at once, and a copy nothing can use slides away', async ({ page }) => {
    await openBoard(page);
    await checkTwo(page);
    await bar(page).waitFor();
    await quiet(page);
    const stop = await watchFrames(page);
    const frames = await record(page, barFrame);
    const b = (await bar(page).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(footer(page)).toBeVisible();

    // The copy, while it is there: nothing can find it, press it or read it.
    const facts = await page.locator(COPY).evaluate((holder) => {
      const everything = [holder, ...holder.querySelectorAll('*')];
      const r = holder.getBoundingClientRect();
      return {
        inert: holder.hasAttribute('inert'),
        hidden: holder.getAttribute('aria-hidden'),
        pointer: getComputedStyle(holder).pointerEvents,
        overflow: getComputedStyle(holder).overflow,
        position: getComputedStyle(holder).position,
        identity: everything.flatMap((n) =>
          [...n.attributes]
            .map((a) => a.name)
            .filter((a) => /^(id|name|role|tabindex|aria-(?!hidden)|data-(?!bar-copy))/.test(a)),
        ),
        height: r.height,
        hit: document.elementFromPoint(r.x + 40, r.y + 15)?.closest('[data-bar-copy]') !== null,
      };
    });
    expect(facts).toEqual({
      inert: true,
      hidden: 'true',
      pointer: 'none',
      overflow: 'clip',
      position: 'fixed',
      identity: [],
      height: 30,
      hit: false,
    });

    await expect(page.locator(COPY)).toHaveCount(0);
    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    expect(Math.max(...seen.map((f) => f.copies))).toBe(1);
    // In the same frame the bar went, the footer was there.
    const firstClosed = seen.findIndex((f) => !f.open);
    expect(seen[firstClosed]!.footer).toBe(true);
    expect(await page.evaluate(() => document.querySelectorAll('[data-bar-copy]').length)).toBe(0);
  });

  test('closed halfway up, the copy leaves from where the bar was drawn', async ({ page }) => {
    await openBoard(page);
    const frames = await record(page, barFrame);
    await checkTwo(page);
    // In the page, on the frame the bar is partway up, so it is really on its way.
    const closedAt = await page.evaluate(
      () =>
        new Promise<number>((done) => {
          const tick = () => {
            const clear = [...document.querySelectorAll<HTMLElement>('.bg-surface-bar button')].find(
              (b) => b.textContent?.trim().startsWith('Clear'),
            );
            const real = clear?.closest('.bg-surface-bar');
            const y = real ? new DOMMatrixReadOnly(getComputedStyle(real).transform).m42 : null;
            if (!clear || y === null || y > 25) {
              requestAnimationFrame(tick);
              return;
            }
            if (y === 0) throw new Error('The bar had already landed.');
            clear.click();
            done(y);
          };
          tick();
        }),
    );
    expect(closedAt).toBeGreaterThan(0);
    await expect(page.locator(COPY)).toHaveCount(0);
    const seen = await frames();
    const firstCopy = seen.find((f) => f.copyY !== null)!;
    // Up to one frame's travel below where it was: not back at its resting place, and
    // not all the way out of the slot.
    expect(firstCopy.copyY!).toBeGreaterThanOrEqual(closedAt - 0.01);
    expect(firstCopy.copyY!).toBeLessThan(closedAt + 30 * 0.4);
  });

  test('opening again takes the copy away at once', async ({ page }) => {
    await openBoard(page);
    await checkTwo(page);
    await bar(page).waitFor();
    await quiet(page);
    const frames = await record(page, barFrame);
    // Esc clears the checks, and a shift-free X on each row is too slow here: by hand.
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          const clear = [...document.querySelectorAll<HTMLElement>('.bg-surface-bar button')].find((b) =>
            b.textContent?.trim().startsWith('Clear'),
          )!;
          clear.click();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const [one, two] = document.querySelectorAll<HTMLInputElement>('[data-row-id] input[type="checkbox"]');
              one!.click();
              two!.click();
              done();
            }),
          );
        }),
    );
    await bar(page).waitFor();
    await quiet(page);
    const seen = await frames();
    expect(seen.some((f) => f.copies === 1)).toBe(true);
    const reopened = seen.findIndex((f, i) => i > 0 && f.open && !seen[i - 1]!.open);
    expect(reopened).toBeGreaterThan(0);
    expect(seen.slice(reopened).every((f) => f.copies === 0)).toBe(true);
  });

  test('under reduced motion: no slide and no copy', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await logAnimations(page);
    await openBoard(page);
    const frames = await record(page, barFrame);
    await checkTwo(page);
    await bar(page).waitFor();
    const b = (await bar(page).boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(footer(page)).toBeVisible();
    await quiet(page);
    const seen = await frames();
    expect(Math.max(...seen.map((f) => f.copies))).toBe(0);
    expect(seen.every((f) => f.y === null || f.y === 0)).toBe(true);
    expect(await started(page)).toEqual([]);
  });
});

test.describe('step 5, the board opens once per page load', () => {
  /** Rows draw in, one after the other: opacity only, linear. */
  const OPENING = '|0';
  const openings = async (page: Page) =>
    (await started(page)).filter((s) => s.from === OPENING && s.duration === OPEN_ROW_MS);

  const rowsInView = (page: Page) =>
    page.evaluate(() => {
      const scroller = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!;
      const view = scroller.getBoundingClientRect();
      return [...document.querySelectorAll('[data-row-id]')].filter((r) => {
        const box = r.getBoundingClientRect();
        return box.bottom > view.top && box.top < view.bottom;
      }).length;
    });

  const logDelays = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __delays: number[] };
      w.__delays = [];
      const real = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, frames, options) {
        if (typeof options === 'object' && options.fill === 'backwards') {
          w.__delays.push(Number(options.delay ?? 0));
        }
        return real.call(this, frames, options);
      };
    });
  const delays = (page: Page) =>
    page.evaluate(() => (window as unknown as { __delays: number[] }).__delays);

  test('a long board: every row in view, 500ms in all, opacity only and linear', async ({ page }) => {
    await logAnimations(page);
    await logDelays(page);
    await resetWorld({ extraTrucks: 30 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    const frames = await record(page, () =>
      [...document.querySelectorAll('[data-row-id]')].some(
        (r) => r.parentElement!.getAnimations().length > 0,
      ),
    );
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);
    expect(await frames()).toContain(false);

    const inView = await rowsInView(page);
    const theirs = await openings(page);
    expect(theirs.length).toBe(inView);
    expect(new Set(theirs.map((t) => t.duration))).toEqual(new Set([OPEN_ROW_MS]));
    expect(new Set(theirs.map((t) => t.easing))).toEqual(new Set(['linear']));
    const gaps = await delays(page);
    expect(gaps).toHaveLength(inView);
    expect(gaps[0]).toBe(0);
    // All of it in 500ms: the last row's start, and its own 200ms.
    expect(gaps.at(-1)! + OPEN_ROW_MS).toBeCloseTo(OPEN_MS, 5);
    expect(gaps[1]! - gaps[0]!).toBeLessThanOrEqual(OPEN_GAP_MAX_MS);

    // Nothing left on a row: only what the list itself wrote.
    const rest = await page.evaluate(() =>
      [...document.querySelectorAll('[data-row-id]')].map((r) => ({
        animations: r.parentElement!.getAnimations().length,
        opacity: (r.parentElement as HTMLElement).style.opacity,
      })),
    );
    for (const row of rest) expect(row).toEqual({ animations: 0, opacity: '' });
  });

  test('a short board: the gap has a ceiling, so three rows do not take 500ms', async ({ page }) => {
    await logDelays(page);
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await expect.poll(() => delays(page)).toEqual([0, OPEN_GAP_MAX_MS, OPEN_GAP_MAX_MS * 2]);
  });

  test('a click on the first frame selects: nothing waits for it', async ({ page }) => {
    await resetWorld({ extraTrucks: 30 });
    await page.goto('/');
    // One of the last to draw in, so it is still on its way when the press arrives.
    const row = page.locator('[data-row-id]').nth(17);
    await row.waitFor();
    await quiet(page);
    const box = (await row.boundingBox())!;
    const id = await row.getAttribute('data-row-id');
    await page.mouse.move(box.x + 300, box.y + box.height / 2);

    await page.addInitScript(() => {
      /*
       * A page load keeps the main thread busy, so a real press can arrive after the opening
       * has gone. It is stretched for this one test, so the press is sure to land inside it.
       * Whether a click lands does not depend on how long the fade is.
       */
      const real = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, frames, options) {
        return real.call(
          this,
          frames,
          typeof options === 'object' && options.fill === 'backwards'
            ? { ...options, duration: Number(options.duration) * 40, delay: Number(options.delay) * 40 }
            : options,
        );
      };
      window.addEventListener(
        'pointerdown',
        (event) => {
          const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-row-id]');
          const wrapper = hit?.parentElement;
          (window as unknown as { __press: unknown }).__press = {
            id: hit?.getAttribute('data-row-id') ?? null,
            opacity: wrapper ? Number(getComputedStyle(wrapper).opacity) : null,
            moving: wrapper ? wrapper.getAnimations().length : null,
          };
        },
        { capture: true, once: true },
      );
    });
    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForFunction(
      (rowId) => document.querySelector(`[data-row-id="${rowId}"]`)?.parentElement?.getAnimations().length,
      id,
      { polling: 'raf' },
    );
    await page.mouse.down();
    await page.mouse.up();
    const press = await page.evaluate(
      () => (window as unknown as { __press: { id: string; opacity: number; moving: number } }).__press,
    );
    expect(press.id).toBe(id);
    expect(press.moving).toBe(1);
    expect(press.opacity).toBeLessThan(1);
    await expect(page.locator(`[data-row-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  });

  test('never again: not on a page change, a chip, a refetch or a poll', async ({ page }) => {
    await logAnimations(page);
    await resetWorld({ extraTrucks: 5 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const once = (await openings(page)).length;
    expect(once).toBeGreaterThan(0);

    await pollWith(page, lateFirst(2));
    await quiet(page);
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await page.locator('[data-history-summary]').waitFor();
    await quiet(page);
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    await page.keyboard.press('1');
    await quiet(page);
    await page.keyboard.press('0');
    await quiet(page);
    await pollWith(page, lateFirst(3));
    await quiet(page);
    expect((await openings(page)).length).toBe(once);
  });

  test('rows that only arrive after a fetch take it, once', async ({ page }) => {
    await logAnimations(page);
    await resetWorld({ extraTrucks: 5 });
    await page.goto('/?chips=late');
    // Nothing late, so nothing to draw: the opening is still to come.
    await page.getByText('No trucks in this filter').first().waitFor();
    await quiet(page);
    expect(await openings(page)).toEqual([]);

    await pollWith(page, lateFirst(3));
    await page.locator('[data-row-id]').first().waitFor();
    await expect.poll(async () => (await openings(page)).length).toBe(3);
    await quiet(page);

    await pollWith(page, lateFirst(4));
    await quiet(page);
    expect((await openings(page)).length).toBe(3);
  });

  test('the server and the first client render are the same: no hydration complaint', async ({ page }) => {
    const complaints: string[] = [];
    page.on('pageerror', (e) => complaints.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /hydrat|#418|#423|#425/i.test(m.text())) complaints.push(m.text());
    });
    await resetWorld({ extraTrucks: 5 });
    const html = await (await page.goto('/'))!.text();
    expect(html).not.toMatch(/opacity:\s*0/);
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    expect(complaints).toEqual([]);
  });

  test('nothing grows while it plays', async ({ page }) => {
    await resetWorld({ extraTrucks: 30 });
    await page.goto('/', { waitUntil: 'commit' });
    await page.locator('body').waitFor();
    const stop = await watchFrames(page);
    await page.locator('[data-row-id]').first().waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const { grew } = await stop();
    expect(grew).toEqual([]);
  });

  test('under reduced motion: the rows are simply there', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await logAnimations(page);
    await resetWorld({ extraTrucks: 5 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    expect(await started(page)).toEqual([]);
  });
});

test.describe('step 6, the selection slides', () => {
  const OVERLAY = '[data-selection-slide]';
  const rowAt = (page: Page, i: number) => page.locator('[data-row-id]').nth(i);

  async function openLong(page: Page) {
    await resetWorld({ extraTrucks: 30 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);
  }
  const frame = () => {
    const found = [...document.querySelectorAll('[data-selection-slide]')];
    const target = document.querySelector('[data-selection-target]');
    const selected = document.querySelector('[data-row-id][aria-selected="true"]');
    return {
      at: performance.now(),
      count: found.length,
      y: found[0]?.getBoundingClientRect().y ?? null,
      height: found[0]?.getBoundingClientRect().height ?? null,
      target: target ? getComputedStyle(target).backgroundColor : null,
      selected: selected ? getComputedStyle(selected).backgroundColor : null,
      leftOn: selected?.getAttribute('data-row-id') ?? null,
      selectedY: selected?.getBoundingClientRect().y ?? null,
    };
  };
  const SELECTED_GROUND = 'rgb(27, 34, 43)';
  const midpoint = async (page: Page, i: number) => {
    const b = (await rowAt(page, i).boundingBox())!;
    return [b.x + 300, b.y + b.height / 2] as const;
  };

  test('from one row to another: 280ms, on the curve, under the words, and nothing left', async ({ page }) => {
    await openLong(page);
    const [x1, y1] = await midpoint(page, 2);
    await page.mouse.click(x1, y1);
    await expect(rowAt(page, 2)).toHaveAttribute('aria-selected', 'true');
    await quiet(page);

    const stop = await watchFrames(page);
    const frames = await record(page, frame);
    const [x2, y2] = await midpoint(page, 8);
    await page.mouse.move(x2, y2);
    await page.mouse.down();
    await page.mouse.up();
    const timing = await page
      .locator(OVERLAY)
      .evaluate((el) => {
        const t = el.getAnimations()[0]!.effect!.getTiming();
        return { duration: t.duration, easing: String(t.easing) };
      });
    expect(timing.duration).toBe(SELECT_MS);
    expect(curve(timing.easing)).toBe(curve(DIALOG_CURVE));
    await expect(rowAt(page, 8)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect.poll(() => stillMoving(page)).toBe(0);

    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    const flying = seen.filter((f) => f.count === 1);
    expect(Math.max(...seen.map((f) => f.count))).toBe(1);
    expect(flying.length).toBeGreaterThan(3);
    for (let i = 1; i < flying.length; i += 1) {
      // Down the list, and never back.
      expect(flying[i]!.y!).toBeGreaterThanOrEqual(flying[i - 1]!.y!);
    }
    // It arrives on the row: its last frame is within a few pixels of it, and level with it.
    const landed = (await rowAt(page, 8).boundingBox())!;
    expect(Math.abs(flying.at(-1)!.y! - landed.y)).toBeLessThan(6);
    expect(flying.at(-1)!.height).toBeCloseTo(landed.height, 1);
    // The row it is going to keeps its ground back until it lands, so it is seen once.
    expect(new Set(flying.map((f) => f.target))).toEqual(new Set(['rgba(0, 0, 0, 0)']));
    expect(await rowAt(page, 8).getAttribute('data-selection-target')).toBeNull();
    expect(await rowAt(page, 8).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(SELECTED_GROUND);
    // The row it left has its ground off on the frame the slide begins: not a 120ms fade.
    expect(
      await rowAt(page, 2).evaluate((el) => el.getAnimations().filter((a) => a instanceof CSSTransition).length),
    ).toBe(0);
  });

  test('the one it left is plain on the first frame of the slide, not fading beside it', async ({ page }) => {
    await openLong(page);
    const id = await rowAt(page, 2).getAttribute('data-row-id');
    await rowAt(page, 2).click();
    await quiet(page);
    await page.mouse.move(1, 1);
    await quiet(page);
    await page.evaluate((rowId) => {
      (window as unknown as { __old: Element }).__old = document.querySelector(`[data-row-id="${rowId}"]`)!;
    }, id);
    const frames = await record(page, () => {
      const old = (window as unknown as { __old: Element }).__old;
      return {
        flying: document.querySelectorAll('[data-selection-slide]').length,
        ground: getComputedStyle(old).backgroundColor,
      };
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    const seen = (await frames()).filter((f) => f.flying > 0);
    expect(seen.length).toBeGreaterThan(3);
    expect(new Set(seen.map((f) => f.ground))).toEqual(new Set(['rgba(0, 0, 0, 0)']));
  });

  test('fast arrow keys: one highlight, no jump, and it ends on the last row', async ({ page }) => {
    await openLong(page);
    await rowAt(page, 0).click();
    await quiet(page);
    const frames = await record(page, frame);
    // A key on every frame, in the page, so each lands long before the last has arrived.
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          let left = 6;
          const next = () => {
            if (left === 0) return done();
            left -= 1;
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
            requestAnimationFrame(next);
          };
          next();
        }),
    );
    await expect(rowAt(page, 6)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    const seen = await frames();
    expect(Math.max(...seen.map((f) => f.count))).toBe(1);
    const flying = seen.filter((f) => f.y !== null);
    const ys = flying.map((f) => f.y!);
    expect(ys.length).toBeGreaterThan(3);
    for (let i = 1; i < flying.length; i += 1) {
      // A long frame covers more ground: each key does work beyond the highlight.
      const frames = Math.max(1, (flying[i]!.at - flying[i - 1]!.at) / (1000 / 60));
      expect(Math.abs(ys[i]! - ys[i - 1]!)).toBeLessThan(60 * frames);
    }
    // Taken up from where it is drawn, it falls behind keys this fast. Taken up from the row
    // it was last going to, it would never be more than a row behind the selected one.
    const behind = flying.map((f) => f.selectedY! - f.y!);
    expect(Math.max(...behind)).toBeGreaterThan(44 * 1.5);
  });

  test('the last row on the screen and one more: it slides, the list follows, and nothing grows', async ({ page }) => {
    await openLong(page);
    const inView = await page.evaluate(() => {
      const view = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!.getBoundingClientRect();
      return [...document.querySelectorAll('[data-row-id]')].filter((r) => r.getBoundingClientRect().bottom <= view.bottom).length;
    });
    await rowAt(page, inView - 1).click();
    await quiet(page);
    const id = await rowAt(page, inView).getAttribute('data-row-id');
    const stop = await watchFrames(page);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(`[data-row-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    const { grew } = await stop();
    expect(grew).toEqual([]);
  });

  test('the old row off screen: the highlight just appears', async ({ page }) => {
    await openLong(page);
    await rowAt(page, 0).click();
    await quiet(page);
    // Past the top of the view and still drawn, since the list draws a few beyond it: a row
    // not drawn at all would not tell this apart from having nowhere to come from.
    await page.evaluate(() => {
      document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!.scrollTop = 200;
    });
    await quiet(page);
    await expect(rowAt(page, 0)).toHaveAttribute('aria-selected', 'true');
    const target = page.locator('[data-row-id]').nth(12);
    const frames = await record(page, frame);
    await target.click();
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await quiet(page);
    expect(Math.max(...(await frames()).map((f) => f.count))).toBe(0);
  });

  test('nothing selected before, or nothing after: no slide', async ({ page }) => {
    await openLong(page);
    const frames = await record(page, frame);
    await rowAt(page, 3).click();
    await quiet(page);
    await page.mouse.move(1, 1);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-row-id][aria-selected="true"]')).toHaveCount(0);
    await quiet(page);
    expect(Math.max(...(await frames()).map((f) => f.count))).toBe(0);
  });

  test('pinned rows slide too: into the list, out of it, and between themselves', async ({ page }) => {
    await openLong(page);
    for (const i of [1, 2]) {
      await rowAt(page, i).click();
      await page.keyboard.press('p');
    }
    await expect(page.getByText(/^Pinned$/)).toBeVisible();
    await quiet(page);
    // The two pinned rows draw first, above the list.
    const frames = await record(page, frame);
    const first = page.locator('[data-row-id]').nth(0);
    await first.click();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    const inList = page.locator('[data-row-id]').nth(6);
    await inList.click();
    await expect(inList).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await first.click();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    const seen = await frames();
    // Each of the three moves was seen flying, as one highlight.
    expect(seen.filter((f) => f.count === 1).length).toBeGreaterThan(6);
    expect(Math.max(...seen.map((f) => f.count))).toBe(1);
    await expect(first).not.toHaveAttribute('data-selection-target', '');
    expect(await first.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(SELECTED_GROUND);
  });

  test('a press holds it until it ends', async ({ page }) => {
    await openLong(page);
    await rowAt(page, 0).click();
    await quiet(page);
    await page.keyboard.press('ArrowDown');
    await page.mouse.move(600, 12);
    await page.mouse.down();
    const time = () => page.locator(OVERLAY).evaluate((el) => el.getAnimations()[0]!.currentTime as number);
    const first = await time();
    await page.waitForTimeout(SELECT_MS + 60);
    expect(await time()).toBe(first);
    await page.mouse.up();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  test('under reduced motion: no slide, and the selection is at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await logAnimations(page);
    await resetWorld({ extraTrucks: 5 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await rowAt(page, 0).click();
    await rowAt(page, 3).click();
    await expect(rowAt(page, 3)).toHaveAttribute('aria-selected', 'true');
    await quiet(page);
    expect(await started(page)).toEqual([]);
  });
});

test.describe('step 6, the map travels', () => {
  type MapCall = {
    at: number;
    name: 'easeTo' | 'panBy' | 'stop' | 'moveend';
    center?: [number, number];
    duration?: number;
    easing?: string;
  };
  /** Far apart, so a truck is not already in view and a pan has somewhere to go. */
  const spread = (rows: (FleetRowLike & { lat?: number; lng?: number })[]) => {
    rows.forEach((row, i) => {
      row.lat = 30 + (i % 8) * 2.2;
      row.lng = -115 + i * 3.1;
    });
  };

  /**
   * The real map, found through React, with what is asked of it written down. Only here:
   * a pan's length and curve are arguments, and the pixels of a popup that snaps to whole
   * pixels near the end of a pan say much less about them.
   */
  const spyOnMap = (page: Page) =>
    page.evaluate(() => {
      type Spied = {
        getCenter(): { lat: number; lng: number };
        on(type: string, listener: () => void): void;
      } & Record<string, unknown>;
      const el = document.querySelector('.mapboxgl-map') as unknown as Record<string, unknown>;
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber'))!;
      type Fiber = { memoizedState: Hook | null; return: Fiber | null };
      type Hook = { memoizedState: unknown; next: Hook | null };
      let fiber = el[key] as Fiber | null;
      let map: Spied | null = null;
      while (fiber && !map) {
        let hook = fiber.memoizedState;
        while (hook && !map) {
          const held = hook.memoizedState as { current?: unknown; map?: unknown } | null;
          const value = (held?.current ?? held) as { getMap?: () => Spied; map?: Spied } | null;
          if (typeof value?.getMap === 'function') map = value.getMap();
          else if (value?.map && typeof (value.map as Spied)['easeTo'] === 'function') map = value.map;
          hook = hook.next;
        }
        fiber = fiber.return;
      }
      if (!map) throw new Error('No map found');
      const w = window as unknown as { __calls: MapCall[] };
      w.__calls = [];
      for (const name of ['easeTo', 'panBy', 'stop'] as const) {
        const real = map[name] as (...args: unknown[]) => unknown;
        map[name] = function (this: unknown, ...args: unknown[]) {
          const options = (name === 'panBy' ? args[1] : args[0]) as
            | { center?: [number, number]; duration?: number; easing?: unknown }
            | undefined;
          // A panBy goes through easeTo: only what the app asked for counts.
          const inner = (window as unknown as { __inPan?: boolean }).__inPan === true;
          if (!(inner && name === 'easeTo')) {
            w.__calls.push({
              at: performance.now(),
              name,
              ...(Array.isArray(options?.center) ? { center: options.center } : {}),
              ...(options?.duration === undefined ? {} : { duration: options.duration }),
              easing: typeof options?.easing,
            });
          }
          if (name === 'panBy') (window as unknown as { __inPan?: boolean }).__inPan = true;
          try {
            return real.apply(this, args);
          } finally {
            if (name === 'panBy') (window as unknown as { __inPan?: boolean }).__inPan = false;
          }
        };
      }
      const spied = map;
      map.on('moveend', () => {
        const c = spied.getCenter();
        w.__calls.push({ at: performance.now(), name: 'moveend', center: [c.lng, c.lat] });
      });
    });
  const calls = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as { __calls: MapCall[] };
      const seen = w.__calls;
      w.__calls = [];
      return seen;
    });
  const clearCalls = calls;

  /** Further apart than a popup is wide, so a popup in flight is often off the map. */
  const farApart = (rows: (FleetRowLike & { lat?: number; lng?: number })[]) => {
    rows.forEach((row, i) => {
      row.lat = 25 + (i % 2) * 22;
      row.lng = -150 + i * 17;
    });
  };

  async function openSpread(page: Page, place: typeof spread = spread) {
    await resetWorld({ extraTrucks: 12 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await page.locator('canvas.mapboxgl-canvas').waitFor();
    await pollWith(page, place);
    await quiet(page);
    await spyOnMap(page);
  }
  const selectAndLand = async (page: Page, i: number) => {
    await page.locator('[data-row-id]').nth(i).click();
    await expect.poll(async () => (await page.evaluate(() =>
      (window as unknown as { __calls: MapCall[] }).__calls.some((c) => c.name === 'moveend'))), { timeout: 5_000 }).toBe(true);
    await page.waitForTimeout(ZOOM_MS + 150);
    await quiet(page);
  };
  /** What the selection asked for, and where the map was when that pan ended. */
  const travelIn = (seen: MapCall[]) => {
    const ease = seen.find((c) => c.name === 'easeTo')!;
    const end = seen.find((c) => c.name === 'moveend' && c.at > ease.at)!;
    // `stop` is Mapbox's own, at the end of every ease.
    return {
      ease,
      end,
      between: seen.filter((c) => c.at > ease.at && c.at < end.at && c.name !== 'stop'),
    };
  };

  test('a selection takes 700ms on the default curve, and ends on the truck', async ({ page }) => {
    await openSpread(page);
    await selectAndLand(page, 3);
    await clearCalls(page);
    await page.locator('[data-row-id]').nth(9).click();
    await expect.poll(async () => page.evaluate(() =>
      (window as unknown as { __calls: MapCall[] }).__calls.some((c) => c.name === 'moveend'))).toBe(true);
    const { ease, end, between } = travelIn(await calls(page));
    expect(ease.duration).toBe(MAP_MS);
    expect(ease.easing).toBe('undefined');
    expect(between).toEqual([]);
    expect(end.at - ease.at).toBeGreaterThan(MAP_MS - 60);
    expect(end.at - ease.at).toBeLessThan(MAP_MS + 150);
    expect(end.center![0]).toBeCloseTo(ease.center![0], 3);
    expect(end.center![1]).toBeCloseTo(ease.center![1], 3);
  });

  /**
   * Found by this phase. The popup's ResizeObserver asks for the nudge too, and a new truck
   * usually has a popup of another height. So 28ms into the pan a panBy cancelled it, and
   * the map stopped 15 degrees short of the truck.
   */
  test('a popup that changes height on the way does not stop the pan', async ({ page }) => {
    await openSpread(page);
    // Truck 103 has a tall popup and 205 a short one: the case that was seen to fail.
    await selectAndLand(page, 0);
    const tall = (await page.locator('.ft-popup').boundingBox())!.height;
    await clearCalls(page);
    await page.locator('[data-row-id]').nth(6).click();
    await expect.poll(async () => (await page.locator('.ft-popup').boundingBox())!.height).not.toBe(tall);
    await expect.poll(async () => page.evaluate(() =>
      (window as unknown as { __calls: MapCall[] }).__calls.some((c) => c.name === 'moveend'))).toBe(true);
    const { ease, end, between } = travelIn(await calls(page));
    expect(between).toEqual([]);
    expect(end.center![0]).toBeCloseTo(ease.center![0], 3);
    expect(end.center![1]).toBeCloseTo(ease.center![1], 3);
  });

  test('the other pans keep their 150ms: a zoom, and the nudge that clears a popup', async ({ page }) => {
    await openSpread(page);
    await selectAndLand(page, 0);
    // Truck 103's popup is taller than the room above it, so it is nudged as it lands.
    const nudges = (await calls(page)).filter((c) => c.name === 'panBy');
    expect(nudges.length).toBeGreaterThan(0);
    expect(new Set(nudges.map((c) => c.duration))).toEqual(new Set([ZOOM_MS]));

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(async () => page.evaluate(() =>
      (window as unknown as { __calls: MapCall[] }).__calls.some((c) => c.name === 'easeTo'))).toBe(true);
    const zoom = (await calls(page)).find((c) => c.name === 'easeTo')!;
    expect(zoom.duration).toBe(ZOOM_MS);
  });

  test('fast arrow keys: no pile-up, and the map ends on the last row', async ({ page }) => {
    await openSpread(page, farApart);
    await selectAndLand(page, 4);
    await clearCalls(page);
    // Faster than a pan, so each key arrives in the middle of the last one's travel.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(30);
    }
    await expect(page.locator('[data-row-id]').nth(10)).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(MAP_MS + 300);
    const seen = await calls(page);
    const eases = seen.filter((c) => c.name === 'easeTo');
    expect(eases.length).toBe(6);
    const last = eases.at(-1)!;
    // Nothing else moved the map on the way, and nothing cut the last one short.
    const firstEase = eases[0]!;
    const end = seen.find((c) => c.name === 'moveend' && c.at > last.at + MAP_MS - 60)!;
    expect(seen.filter((c) => c.name === 'panBy' && c.at > firstEase.at && c.at < end.at)).toEqual([]);
    expect(end.center![0]).toBeCloseTo(last.center![0], 3);
    expect(end.center![1]).toBeCloseTo(last.center![1], 3);
  });

  /** A nudge is under way, and a new truck is chosen: the old nudge does not go on. */
  test('a new selection while the last popup is being nudged: the nudge stops there', async ({ page }) => {
    await openSpread(page, farApart);
    await selectAndLand(page, 3);
    await clearCalls(page);
    // Truck 103's tall popup is nudged as it lands.
    await page.locator('[data-row-id]').nth(0).click();
    await page.waitForFunction(
      () => (window as unknown as { __calls: MapCall[] }).__calls.some((c) => c.name === 'panBy'),
      undefined,
      { polling: 'raf' },
    );
    await page.locator('[data-row-id]').nth(9).evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(MAP_MS + 400);
    const seen = await calls(page);
    const last = seen.filter((c) => c.name === 'easeTo').at(-1)!;
    const end = seen.find((c) => c.name === 'moveend' && c.at > last.at + MAP_MS - 60)!;
    expect(seen.filter((c) => c.name === 'panBy' && c.at > last.at && c.at < end.at)).toEqual([]);
    expect(end.center![0]).toBeCloseTo(last.center![0], 3);
    expect(end.center![1]).toBeCloseTo(last.center![1], 3);
  });

  test('a press on the map stops it there, and a drag is left alone', async ({ page }) => {
    await openSpread(page, farApart);
    await selectAndLand(page, 3);
    // Zoomed in, where the map is flat: at the fleet's zoom Mapbox draws a globe, and a far
    // truck's popup never leaves it.
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('button', { name: 'Zoom in' }).click();
      await page.waitForTimeout(ZOOM_MS + 80);
    }
    await quiet(page);
    const map = (await page.locator('.mapboxgl-map').boundingBox())!;
    const spot = { x: map.x + 40, y: map.y + map.height - 80 };
    await page.mouse.move(spot.x, spot.y);
    await clearCalls(page);

    await page.locator('[data-row-id]').nth(9).evaluate((el) => (el as HTMLElement).click());
    // Early in a long pan, with the new truck's popup still off the map: the case in which
    // the landing, if it were still armed, would nudge the map under the press.
    await page.waitForFunction(
      () => {
        const popup = document.querySelector('.ft-popup')?.getBoundingClientRect();
        const box = document.querySelector('.mapboxgl-map')?.getBoundingClientRect();
        return Boolean(popup && box && popup.right > box.right + 40);
      },
      undefined,
      { polling: 'raf' },
    );
    await page.mouse.down();
    const stopped = await calls(page);
    expect(stopped.map((c) => c.name)).toContain('stop');
    const held = await page.locator('.ft-popup .mapboxgl-popup-tip').boundingBox();
    await page.waitForTimeout(MAP_MS);
    expect(await page.locator('.ft-popup .mapboxgl-popup-tip').boundingBox()).toEqual(held);

    // The same press as a drag: the popup follows the pointer, and nothing fights it.
    await page.mouse.move(spot.x + 30, spot.y - 20, { steps: 4 });
    await page.mouse.move(spot.x + 60, spot.y - 40, { steps: 4 });
    await page.waitForTimeout(300);
    expect((await calls(page)).filter((c) => c.name === 'panBy')).toEqual([]);
    await page.mouse.up();
  });

  test('under reduced motion it jumps', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSpread(page);
    await selectAndLand(page, 3);
    await clearCalls(page);
    await page.locator('[data-row-id]').nth(9).click();
    await expect.poll(async () => page.evaluate(() =>
      (window as unknown as { __calls: MapCall[] }).__calls.some((c) => c.name === 'easeTo'))).toBe(true);
    expect((await calls(page)).find((c) => c.name === 'easeTo')!.duration).toBe(0);
  });
});

test.describe('step 6, the popup after a long pan', () => {
  const CENTRE = { lat: 39.5, lng: -95.5 };
  const PLACES = {
    'top-right': { dLat: 10, dLng: 9.5 },
    top: { dLat: 6, dLng: 0 },
    right: { dLat: 0, dLng: 12 },
    bottom: { dLat: -6, dLng: 0 },
    left: { dLat: 0, dLng: -12 },
    'bottom-right': { dLat: -10, dLng: 9.5 },
  } as const;

  for (const [place, { dLat, dLng }] of Object.entries(PLACES)) {
    test(`a truck far off to the ${place}: clear of every edge and control once it lands`, async ({ page }) => {
      await resetWorld();
      const sql = connect();
      try {
        const at = (truckId: string, lat: number, lng: number) => sql`
          insert into positions (truck_id, lat, lng, heading, speed_mph, recorded_at, formatted_location)
          values (${truckId}, ${lat}, ${lng}, null, 0, ${new Date()}, ${'Somewhere, KS'})`;
        await at(IDS.truckChicago, CENTRE.lat + dLat, CENTRE.lng + dLng);
        await at(IDS.truckDallas, CENTRE.lat, CENTRE.lng);
        await at(IDS.truckAtZipStop, CENTRE.lat, CENTRE.lng);
      } finally {
        await sql.end({ timeout: 5 });
      }
      await page.goto('/');
      await page.locator(`[data-row-id="${IDS.truckDallas}"]`).click();
      await expect(page.locator('.ft-popup')).toBeVisible();
      await page.waitForTimeout(MAP_MS + 300);
      await page.locator(`[data-row-id="${IDS.truckChicago}"]`).click();

      const clear = async () => {
        const popup = (await page.locator('.ft-popup').boundingBox())!;
        const map = (await page.locator('.mapboxgl-map').boundingBox())!;
        const controls = await Promise.all(
          [
            page.getByRole('group', { name: 'Basemap' }),
            page.getByRole('button', { name: 'Zoom in' }).locator('xpath=..'),
            page.getByText('Marker key', { exact: true }).locator('xpath=..'),
          ].map((c) => c.boundingBox()),
        );
        const under = controls.filter(
          (b) =>
            b &&
            popup.x < b.x + b.width &&
            b.x < popup.x + popup.width &&
            popup.y < b.y + b.height &&
            b.y < popup.y + popup.height,
        ).length;
        return {
          inside:
            popup.x >= map.x - 1 &&
            popup.y >= map.y - 1 &&
            popup.x + popup.width <= map.x + map.width + 1 &&
            popup.y + popup.height <= map.y + map.height + 1,
          under,
        };
      };
      await expect.poll(clear, { timeout: 10_000 }).toEqual({ inside: true, under: 0 });
    });
  }
});

/** A third late, a third at risk and a third on time, in the API's order. */
const mixed = (rows: FleetRowLike[]) => {
  const third = Math.ceil(rows.length / 3);
  rows.forEach((row, i) => {
    const status = i < third ? 'LATE' : i < third * 2 ? 'AT_RISK' : 'ON_TIME';
    row.status = status;
    row.computed = status;
  });
};

/** A list in urgency order, late first, and every one of its rows at rest. */
async function openMixed(page: Page, trucks = 33, viewport = { width: 1440, height: 900 }) {
  await resetWorld({ extraTrucks: trucks - 3 });
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.locator('[data-row-id]').first().waitFor();
  await pollWith(page, mixed);
  // `pollWith` returns when the answer reaches Playwright, which can be ahead of the page. A chip
  // pressed before the page has it sorts the old statuses, and the list is not in this order.
  await expect(page.getByRole('button', { name: /^Late\b/ }).first().locator('[data-roll]')).toHaveText(
    String(Math.ceil(trucks / 3)),
  );
  await page.keyboard.press('1');
  await page.keyboard.press('0');
  await expect.poll(() => stillMoving(page)).toBe(0);
  await quiet(page);
}

type Tops = Record<string, number>;
const topsFrame = () => {
  const tops: Record<string, number> = {};
  for (const row of document.querySelectorAll('[data-row-id]')) {
    // A pinned row has no wrapper of its own.
    const wrapper = row.parentElement as HTMLElement;
    tops[row.getAttribute('data-row-id')!] = (wrapper.style.transform ? wrapper : row).getBoundingClientRect().top;
  }
  return tops;
};
/**
 * Each row's place in the list on this frame, how long its flight is, and when. A row can
 * only be judged against its own flight: the same step is a jump on a short trip and
 * nothing on a long one.
 */
type Flying = { at: number; rows: Record<string, { y: number; trip: number }> };
const flyingFrame = (): Flying => {
  const scroller = document.querySelector('[data-row-id]')?.closest('.overflow-y-auto');
  const rows: Flying['rows'] = {};
  if (scroller) {
    const offset = scroller.getBoundingClientRect().top - scroller.scrollTop;
    for (const row of document.querySelectorAll('[data-row-id]')) {
      const wrapper = row.parentElement as HTMLElement;
      const frames = wrapper
        .getAnimations()
        .map((a) => (a.effect as KeyframeEffect).getKeyframes())
        .find((k) => k[0]?.transform);
      const yOf = (t: unknown) => new DOMMatrixReadOnly(String(t)).m42;
      rows[row.getAttribute('data-row-id')!] = {
        y: (wrapper.style.transform ? wrapper : row).getBoundingClientRect().top - offset,
        trip: frames ? Math.abs(yOf(frames[0]!.transform) - yOf(frames[1]!.transform)) : 0,
      };
    }
  }
  return { at: performance.now(), rows };
};
/**
 * The steps no glide can make. This curve covers about a quarter of a trip in its fastest
 * frame. A row taken up from anywhere but where it is drawn jumps by what it had left.
 */
const jumps = (seen: Flying[]) => {
  const found: string[] = [];
  for (let i = 1; i < seen.length; i += 1) {
    const frames = (seen[i]!.at - seen[i - 1]!.at) / (1000 / 60);
    for (const [id, now] of Object.entries(seen[i]!.rows)) {
      const was = seen[i - 1]!.rows[id];
      if (!was) continue;
      const allowed = 0.3 * Math.max(now.trip, was.trip) * Math.max(1, frames) + 6;
      const step = Math.abs(now.y - was.y);
      if (step > allowed) found.push(`${step.toFixed(0)}px with ${allowed.toFixed(0)}px allowed`);
    }
  }
  return found;
};
const rowsThatMoved = (seen: Tops[]) => {
  const places = new Map<string, Set<number>>();
  for (const frame of seen) {
    for (const [id, top] of Object.entries(frame)) {
      places.set(id, (places.get(id) ?? new Set()).add(top));
    }
  }
  return [...places].filter(([, tops]) => tops.size > 1).map(([id]) => id);
};
const glidesStarted = async (page: Page) =>
  (await started(page)).filter((s) => s.from.startsWith('translateY') && s.duration === GLIDE_MS);
const atRest = (page: Page) =>
  page.evaluate(() => {
    const body = document.querySelector('[data-row-id]')?.parentElement?.parentElement as HTMLElement | undefined;
    return {
      animations: document
        .getAnimations()
        .filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length,
      copies: document.querySelectorAll('[data-glide-copy]').length,
      solid: [...document.querySelectorAll('[data-row-id]')].filter((r) =>
        r.parentElement?.classList.contains('bg-surface-base'),
      ).length,
      zIndex: [...document.querySelectorAll('[data-row-id]')].filter(
        (r) => (r.parentElement as HTMLElement | null)?.style.zIndex,
      ).length,
      bodyOverflow: body?.style.overflow ?? '',
      bodyIsolation: body?.style.isolation ?? '',
      bodyMinHeight: body?.style.minHeight ?? '',
    };
  });
const RESTING = {
  animations: 0,
  copies: 0,
  solid: 0,
  zIndex: 0,
  bodyOverflow: '',
  bodyIsolation: '',
  bodyMinHeight: '',
};
/** Two frames apart, in the page, so a Playwright round trip does not outlast the glide. */
const keysTwoFramesApart = (page: Page, keys: string[]) =>
  page.evaluate(
    (list) =>
      new Promise<void>((done) => {
        const left = [...list];
        const next = () => {
          const key = left.shift();
          if (key === undefined) {
            done();
            return;
          }
          window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
          requestAnimationFrame(() => requestAnimationFrame(next));
        };
        next();
      }),
    keys,
  );

test.describe('step 7, rows glide', () => {
  test('a chip: rows go 380ms on the curve, leavers fade, nothing grows, and nothing is left', async ({ page }) => {
    await logAnimations(page);
    await openMixed(page);
    const stop = await watchFrames(page);
    const frames = await record(page, topsFrame);
    await page.keyboard.press('2');
    // The copies while they are there: nothing can find or press one.
    await page.locator('[data-glide-copy]').first().waitFor({ state: 'attached' });
    const copy = await page.locator('[data-glide-copy]').first().evaluate((el) => {
      const everything = [el, ...el.querySelectorAll('*')];
      return {
        inert: el.hasAttribute('inert'),
        hidden: el.getAttribute('aria-hidden'),
        pointer: getComputedStyle(el).pointerEvents,
        identity: everything.flatMap((n) =>
          [...n.attributes]
            .map((a) => a.name)
            .filter((a) => /^(id|name|role|tabindex|aria-(?!hidden)|data-(?!glide-copy))/.test(a)),
        ),
      };
    });
    expect(copy).toEqual({ inert: true, hidden: 'true', pointer: 'none', identity: [] });
    await expect.poll(() => stillMoving(page)).toBe(0);

    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    expect(await atRest(page)).toEqual(RESTING);

    const glides = await glidesStarted(page);
    expect(glides.length).toBeGreaterThan(5);
    expect(new Set(glides.map((g) => curve(g.easing)))).toEqual(new Set([curve(DIALOG_CURVE)]));
    const fades = (await started(page)).filter((s) => s.from === '|1' && s.duration === GLIDE_MS);
    expect(fades.length).toBeGreaterThan(5);
    expect(new Set(fades.map((f) => f.easing))).toEqual(new Set(['linear']));

    // The rows that stayed went up, and took more than a frame or two to get there.
    const moved = rowsThatMoved(seen);
    expect(moved.length).toBeGreaterThan(5);
    const one = moved[0]!;
    const path = seen.flatMap((f) => (f[one] === undefined ? [] : [f[one]!]));
    expect(path.length).toBeGreaterThan(4);
    for (let i = 1; i < path.length; i += 1) expect(path[i]!).toBeLessThanOrEqual(path[i - 1]!);
  });

  test('a list that gets shorter holds its height until the rows land: they are seen going', async ({ page }) => {
    await openMixed(page);
    await page.evaluate(() => {
      const w = window as unknown as { __scroller: Element };
      w.__scroller = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!;
    });
    const before = await page.evaluate(() =>
      (window as unknown as { __scroller: Element }).__scroller.getBoundingClientRect().bottom,
    );
    const frames = await record(page, () => {
      const scroller = (window as unknown as { __scroller: Element }).__scroller;
      const newEnd = document.querySelectorAll('[data-row-id]').length * 44;
      const top = document.querySelector('[data-row-id]')?.parentElement?.parentElement?.getBoundingClientRect().top ?? 0;
      return {
        bottom: scroller.getBoundingClientRect().bottom,
        copies: document.querySelectorAll('[data-glide-copy]').length,
        // A copy further down than where the list will end, and inside the box that clips it:
        // it is only there, and only seen, because of the hold and the reach.
        below: [...document.querySelectorAll('[data-glide-copy]')].filter((c) => {
          const r = c.getBoundingClientRect();
          const clip = c.parentElement!.getBoundingClientRect();
          return (
            r.top > top + newEnd &&
            r.bottom <= clip.bottom + 1 &&
            r.bottom < scroller.getBoundingClientRect().bottom
          );
        }).length,
      };
    });
    await page.keyboard.press('1');
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);
    const seen = await frames();
    const going = seen.filter((f) => f.copies > 0);
    expect(going.length).toBeGreaterThan(3);
    expect(new Set(going.map((f) => f.bottom))).toEqual(new Set([before]));
    expect(Math.max(...going.map((f) => f.below))).toBeGreaterThan(0);
    // It lets go when they land, and the scroller is left with nothing on it.
    expect(seen.at(-1)!.bottom).toBeLessThan(before);
    expect(
      await page.evaluate(() => (window as unknown as { __scroller: Element }).__scroller.getAttribute('style')),
    ).toBeNull();
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('a row from far away starts just past the edge of the view, at a sane speed', async ({ page }) => {
    await logAnimations(page);
    await openMixed(page, 60);
    await page.evaluate(() => {
      (window as unknown as { __started: unknown[] }).__started = [];
    });
    const view = await page.evaluate(() => {
      const body = document.querySelector('[data-row-id]')!.parentElement!.parentElement!.getBoundingClientRect();
      const box = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!.getBoundingClientRect();
      return { top: box.top - body.top, bottom: box.bottom - body.top };
    });
    // Drawn rows are the top of the list. The On time rows are far below them, undrawn.
    await page.keyboard.press('3');
    await expect.poll(() => stillMoving(page)).toBe(0);
    const froms = (await glidesStarted(page)).map((g) => Number(/translateY\((-?[\d.]+)px\)/.exec(g.from)![1]));
    expect(froms.length).toBeGreaterThan(5);
    expect(Math.max(...froms)).toBeLessThanOrEqual(view.bottom + 1);
    expect(Math.min(...froms)).toBeGreaterThanOrEqual(view.top - 44 - 1);
  });

  test('rows in flight stay under the column headers', async ({ page }) => {
    await openMixed(page, 60);
    // Late and On time on, so the list stays long and stays scrolled when At risk goes on.
    await page.keyboard.press('1');
    await page.keyboard.press('3');
    await expect.poll(() => stillMoving(page)).toBe(0);
    // Scrolled so the first On time row, the 21st, is under the headers (28px): it is about
    // to go a long way, and starts where the headers stand.
    await page.evaluate(() => {
      document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!.scrollTop = 20 * 44 + 28 - 10;
    });
    await quiet(page);
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!;
      const header = scroller.querySelector(':scope > [role="row"]')!;
      const box = header.getBoundingClientRect();
      (window as unknown as { __spot: number[]; __header: Element }).__spot = [box.x + 300, box.y + box.height / 2];
      (window as unknown as { __spot: number[]; __header: Element }).__header = header;
    });
    const frames = await record(page, () => {
      const w = window as unknown as { __spot: number[]; __header: Element };
      const top = document.elementFromPoint(w.__spot[0]!, w.__spot[1]!);
      return {
        moving: document.querySelectorAll('[data-row-id]').length > 0 &&
          document.getAnimations().some((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)),
        header: top ? w.__header.contains(top) : false,
      };
    });
    await page.keyboard.press('2');
    await expect.poll(() => stillMoving(page)).toBe(0);
    const seen = (await frames()).filter((f) => f.moving);
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.every((f) => f.header)).toBe(true);
  });

  test('rows in flight stay out of the pinned block', async ({ page }) => {
    await openMixed(page);
    await page.locator('[data-row-id]').nth(0).click();
    await page.keyboard.press('p');
    await expect(page.getByText(/^Pinned$/)).toBeVisible();
    await page.mouse.move(1, 1);
    await page.keyboard.press('Escape');
    // At risk on hides the pinned truck, so the block goes and the list starts higher.
    await page.keyboard.press('2');
    await expect(page.getByText(/^Pinned$/)).toHaveCount(0);
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);
    // Off again: the block comes back, so the list starts lower, and its rows begin above
    // their new tops, where the block now stands.
    const frames = await record(page, () => {
      const pinned = document.querySelector('[data-row-id]');
      const strip = [...document.querySelectorAll('span')].find((s) => s.textContent === 'Pinned');
      if (!pinned || !strip) return null;
      const r = pinned.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + 300, r.y + r.height / 2);
      return {
        moving: document.getAnimations().some((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)),
        own: top ? pinned.contains(top) : false,
      };
    });
    await page.keyboard.press('2');
    await expect(page.getByText(/^Pinned$/)).toBeVisible();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const seen = (await frames()).flatMap((f) => (f && f.moving ? [f] : []));
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.every((f) => f.own)).toBe(true);
  });

  test('a row whose place changes in flight goes there at once', async ({ page }) => {
    await openMixed(page);
    const frames = await record(page, () =>
      [...document.querySelectorAll('[data-row-id]')].flatMap((r) => {
        const wrapper = r.parentElement as HTMLElement;
        const going = wrapper
          .getAnimations()
          .map((a) => (a.effect as KeyframeEffect).getKeyframes())
          .find((k) => k[0]?.transform);
        // A flight still headed somewhere the list no longer puts this row.
        return going && going[1]!.transform !== wrapper.style.transform ? [r.getAttribute('data-row-id')] : [];
      }),
    );
    // A density change mid-glide: every row has a new place.
    await keysTwoFramesApart(page, ['2', 'd']);
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);
    // One frame at most, between the commit and the effect that runs in it: in practice none.
    expect((await frames()).flat()).toEqual([]);
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('rows in flight have a solid ground, and the furthest travelled is on top', async ({ page }) => {
    await openMixed(page);
    const frames = await record(page, () => {
      const flying = [...document.querySelectorAll('[data-row-id]')]
        .map((r) => r.parentElement as HTMLElement)
        .filter((w) => w.getAnimations().some((a) => (a.effect as KeyframeEffect).getKeyframes()[0]?.transform));
      return flying.map((w) => ({
        ground: getComputedStyle(w).backgroundColor,
        z: Number(w.style.zIndex),
      }));
    });
    await page.keyboard.press('2');
    await expect.poll(() => stillMoving(page)).toBe(0);
    const seen = (await frames()).flat();
    expect(seen.length).toBeGreaterThan(5);
    expect(new Set(seen.map((f) => f.ground))).toEqual(new Set(['rgb(21, 24, 27)']));
    for (const f of seen) expect(f.z).toBeGreaterThan(0);
  });

  test('a chip off again: rows go down, and those coming back arrive', async ({ page }) => {
    await openMixed(page);
    await page.keyboard.press('2');
    await expect.poll(() => stillMoving(page)).toBe(0);
    const frames = await record(page, topsFrame);
    await page.keyboard.press('2');
    await page.waitForTimeout(GLIDE_MS / 2);
    await expect.poll(() => stillMoving(page)).toBe(0);
    const seen = await frames();
    const moved = rowsThatMoved(seen);
    expect(moved.length).toBeGreaterThan(3);
    const path = seen.flatMap((f) => (f[moved[0]!] === undefined ? [] : [f[moved[0]!]!]));
    expect(path.at(-1)!).toBeGreaterThan(path[0]!);
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('the reorder bar: its click glides, and only its click', async ({ page }) => {
    await logAnimations(page);
    await openMixed(page);
    const last = await page.locator('[data-row-id]').nth(14).getAttribute('data-row-id');
    const before = (await glidesStarted(page)).length;
    const frames = await record(page, topsFrame);
    await pollWith(page, (rows) => {
      mixed(rows);
      const row = rows.find((r) => r.id === last)!;
      row.status = 'LATE';
      row.computed = 'LATE';
    });
    const bar = page.getByRole('button', { name: /rows? would reorder/i });
    await bar.waitFor();
    await quiet(page);
    // The bar appearing moved nothing.
    expect(rowsThatMoved(await frames())).toEqual([]);
    expect((await glidesStarted(page)).length).toBe(before);

    const stop = await watchFrames(page);
    await bar.click();
    await expect(bar).toHaveCount(0);
    await expect.poll(() => stillMoving(page)).toBe(0);
    const { grew } = await stop();
    expect(grew).toEqual([]);
    expect((await glidesStarted(page)).length).toBeGreaterThan(before);
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('a list: choosing one glides', async ({ page }) => {
    await logAnimations(page);
    await openMixed(page, 12);
    // These two draw last after the reload, so the list brings them up: they have to move.
    const members = [IDS.truckChicago, IDS.truckDallas];
    const sql = connect();
    try {
      const [list] = await sql<{ id: string }[]>`
        insert into truck_lists (name) values (${'Motion list'}) returning id`;
      for (const truck of members) {
        await sql`insert into truck_list_members (list_id, truck_id) values (${list!.id}, ${truck})`;
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
    await page.reload();
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    await page.locator('[data-scope] [aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: /Motion list/ }).click();
    await expect.poll(async () => (await glidesStarted(page)).length).toBeGreaterThan(0);
    await expect.poll(() => stillMoving(page)).toBe(0);
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('a search does not glide: it would start on every key', async ({ page }) => {
    await logAnimations(page);
    await openMixed(page);
    const before = (await glidesStarted(page)).length;
    await page.keyboard.press('/');
    await page.keyboard.type('20');
    await page.waitForURL(/[?&]q=20/);
    await quiet(page);
    await page.keyboard.press('Escape');
    await page.waitForURL((url) => !url.search.includes('q='));
    await quiet(page);
    expect((await glidesStarted(page)).length).toBe(before);
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('a density change, a resize and a scroll never start one', async ({ page }) => {
    await logAnimations(page);
    await openMixed(page);
    const before = (await glidesStarted(page)).length;
    await page.keyboard.press('d');
    await quiet(page);
    await page.setViewportSize({ width: 1300, height: 800 });
    await quiet(page);
    await page.evaluate(() => {
      document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!.scrollTop = 400;
    });
    await quiet(page);
    expect((await glidesStarted(page)).length).toBe(before);
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('a poll moves no row, on any frame', async ({ page }) => {
    await logAnimations(page);
    await openMixed(page);
    const before = (await glidesStarted(page)).length;
    const frames = await record(page, topsFrame);
    // New values, a new urgency for one, and the same trucks in the list.
    await pollWith(page, (rows) => {
      mixed(rows);
      rows[20]!.status = 'LATE';
      rows[20]!.computed = 'LATE';
    });
    await quiet(page);
    await pollWith(page, mixed);
    await quiet(page);
    expect(rowsThatMoved(await frames())).toEqual([]);
    expect((await glidesStarted(page)).length).toBe(before);
  });

  test('a poll that changes who is in the list snaps: no glide, no in-between', async ({ page }) => {
    await logAnimations(page);
    await openMixed(page);
    await page.keyboard.press('1');
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);
    const before = (await glidesStarted(page)).length;
    const first = await page.locator('[data-row-id]').first().getAttribute('data-row-id');
    const second = await page.locator('[data-row-id]').nth(1).getAttribute('data-row-id');
    const startTop = (await page.locator(`[data-row-id="${second}"]`).boundingBox())!.y;
    const frames = await record(page, topsFrame);
    // The first late truck stops being late, so it leaves the chip.
    await pollWith(page, (rows) => {
      mixed(rows);
      const row = rows.find((r) => r.id === first)!;
      row.status = 'ON_TIME';
      row.computed = 'ON_TIME';
    });
    await expect(page.locator(`[data-row-id="${first}"]`)).toHaveCount(0);
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);
    const seen = await frames();
    const path = [...new Set(seen.flatMap((f) => (f[second!] === undefined ? [] : [f[second!]!])))];
    expect(path).toEqual([startTop, startTop - 44]);
    expect((await glidesStarted(page)).length).toBe(before);
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('five chips in a row: every row goes from where it is drawn, and none jumps', async ({ page }) => {
    await openMixed(page);
    const stop = await watchFrames(page);
    const frames = await record(page, flyingFrame);
    await keysTwoFramesApart(page, ['2', '3', '2', '1', '2']);
    await expect.poll(() => stillMoving(page)).toBe(0);
    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    expect(seen.length).toBeGreaterThan(10);
    expect(jumps(seen)).toEqual([]);
    await expect.poll(() => stillMoving(page)).toBe(0);
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('a scroll during a glide stays right', async ({ page }) => {
    await openMixed(page);
    const stop = await watchFrames(page);
    const frames = await record(page, flyingFrame);
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }));
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!.scrollTop += 80;
              done();
            }),
          );
        }),
    );
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);
    const seen = await frames();
    const { grew } = await stop();
    expect(grew).toEqual([]);
    expect(jumps(seen)).toEqual([]);
    // Each row where the list says it belongs.
    const off = await page.evaluate(() => {
      const scroller = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!;
      const body = document.querySelector('[data-row-id]')!.parentElement!.parentElement!;
      const top = body.getBoundingClientRect().top;
      return [...scroller.querySelectorAll('[data-row-id]')].filter((r) => {
        const wrapper = r.parentElement as HTMLElement;
        const y = new DOMMatrixReadOnly(wrapper.style.transform).m42;
        return Math.abs(wrapper.getBoundingClientRect().top - top - y) > 0.5;
      }).length;
    });
    expect(off).toBe(0);
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('scrolled to the end, a chip that shortens the list: rows are seen going, and nothing grows', async ({ page }) => {
    await openMixed(page);
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!;
      scroller.scrollTop = scroller.scrollHeight;
    });
    await quiet(page);
    const stop = await watchFrames(page);
    await page.keyboard.press('1');
    const going = await page.locator('[data-glide-copy]').first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      const view = el.parentElement!.parentElement!.getBoundingClientRect();
      return r.bottom > view.top && r.top < view.bottom;
    });
    expect(going).toBe(true);
    await expect.poll(() => stillMoving(page)).toBe(0);
    const { grew } = await stop();
    expect(grew).toEqual([]);
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('the reorder bar works mid-glide', async ({ page }) => {
    await openMixed(page);
    // A late row that the next poll says is the most urgent of them: the bar's offer.
    const row = await page.locator('[data-row-id]').nth(8).getAttribute('data-row-id');
    // A poll held back, to land in the middle of a chip's glide and offer the bar there.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached: () => void = () => {};
    const atTheDoor = new Promise<void>((resolve) => {
      reached = resolve;
    });
    await page.unroute('**/api/fleet');
    await page.route('**/api/fleet', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { fleet: FleetRowLike[] };
      mixed(body.fleet);
      for (const r of body.fleet as (FleetRowLike & { apptAt?: string })[]) {
        if (r.id === row) r.apptAt = '2020-01-01T00:00:00.000Z';
      }
      reached();
      await held;
      await route.fulfill({ response, json: body });
    });
    const answered = page.waitForResponse('**/api/fleet');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await atTheDoor;
    const frames = await record(page, flyingFrame);
    await page.keyboard.press('1');
    release();
    await answered;
    const bar = page.getByRole('button', { name: /rows? would reorder/i });
    await bar.waitFor();
    const moving = await page.evaluate(() =>
      document.getAnimations().filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length,
    );
    await bar.click();
    await expect(bar).toHaveCount(0);
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);
    expect(jumps(await frames())).toEqual([]);
    expect(moving).toBeGreaterThan(0);
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('pinned rows stay put, and the rows below do not jump when the block changes height', async ({ page }) => {
    await logAnimations(page);
    await openMixed(page);
    await page.locator('[data-row-id]').nth(0).click();
    await page.keyboard.press('p');
    await expect(page.getByText(/^Pinned$/)).toBeVisible();
    await quiet(page);
    const pinned = await page.locator('[aria-selected="true"][data-row-id]').getAttribute('data-row-id');
    const before = (await page.locator(`[data-row-id="${pinned}"]`).boundingBox())!.y;
    await page.mouse.move(1, 1);
    const frames = await record(page, topsFrame);
    const flying = await record2(page, flyingFrame);
    // Off the late chip's rows: the pinned truck is late, so this hides it and the block.
    await page.keyboard.press('2');
    await expect(page.getByText(/^Pinned$/)).toHaveCount(0);
    await expect.poll(() => stillMoving(page)).toBe(0);
    await quiet(page);
    const seen = await frames();
    // Its row was never animated: there one frame, gone the next.
    const path = [...new Set(seen.flatMap((f) => (f[pinned!] === undefined ? [] : [f[pinned!]!])))];
    expect(path).toEqual([before]);
    expect(jumps(await flying())).toEqual([]);
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('selecting during a glide: the highlight just appears', async ({ page }) => {
    await openMixed(page);
    await page.locator('[data-row-id]').nth(1).click();
    await quiet(page);
    await page.mouse.move(1, 1);
    await quiet(page);
    await page.keyboard.press('1');
    await page.keyboard.press('ArrowDown');
    const slid = await page.evaluate(() => document.querySelectorAll('[data-selection-slide]').length);
    expect(slid).toBe(0);
    await expect.poll(() => stillMoving(page)).toBe(0);
  });

  test('under reduced motion: rows are simply in their new places, with no copies', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await logAnimations(page);
    await openMixed(page);
    const frames = await record(page, () => document.querySelectorAll('[data-glide-copy]').length);
    await page.keyboard.press('2');
    await quiet(page);
    await page.keyboard.press('2');
    await quiet(page);
    expect(Math.max(...(await frames()))).toBe(0);
    expect(await started(page)).toEqual([]);
    expect(await atRest(page)).toEqual(RESTING);
  });
});

/**
 * The hardest one. In the demo only 12 of 16 presses during a glide selected the pressed
 * row: 2 hit a gap, and on 2 the row changed during the press.
 *
 * A real mouse. What the press came down on is read in the page, in the capture phase,
 * at the instant it arrives, along with how far into the glide that really was.
 */
test.describe('the press during a glide', () => {
  type Press = {
    at: number | null;
    hit: string | null;
    gap: boolean;
    /** Every row as near as the nearest: rows arriving can stand exactly level. */
    nearest: string[];
    moving: 'up' | 'down' | 'still' | 'none';
    place: 'first' | 'last' | 'middle' | 'none';
    target: string;
    /** How far the row under the pointer moved between the press and the release. */
    drift: number | null;
  };
  type Tally = Press & { time: number; hold: number; selected: string | null; ok: boolean };

  const listenForPresses = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __press: Press | null; __held: { el: Element; top: number } | null };
      w.__press = null;
      w.__held = null;
      /** The rows in view, and those as near as the nearest. A row has to be drawn to count. */
      const rowsInView = () => {
        const scroller = document.querySelector('[data-row-id]')?.closest('.overflow-y-auto');
        const view = scroller?.getBoundingClientRect();
        return [...document.querySelectorAll('[data-row-id]')]
          .map((r) => ({ id: r.getAttribute('data-row-id')!, box: r.getBoundingClientRect() }))
          .filter(({ box }) => view && box.bottom > view.top + 28 && box.top < view.bottom)
          .sort((a, b) => a.box.top - b.box.top);
      };
      const nearestTo = (y: number) => {
        const inView = rowsInView();
        const distance = (box: DOMRect) => Math.max(box.top - y, y - box.bottom, 0);
        const heightOf = (other: string) =>
          Number((document.querySelector(`[data-row-id="${other}"]`)!.parentElement as HTMLElement).style.zIndex);
        const closest = Math.min(...inView.map(({ box }) => distance(box)));
        const level = inView.filter(({ box }) => Math.abs(distance(box) - closest) < 0.01);
        // Rows arriving from past the edge can be on top of each other: the one on top.
        const highest = Math.max(...level.map(({ id: other }) => heightOf(other)));
        return level.filter(({ id: other }) => heightOf(other) === highest).map(({ id: other }) => other);
      };
      window.addEventListener(
        'pointerup',
        (event) => {
          if (!w.__press || !w.__held) return;
          w.__press.drift = Math.abs(w.__held.el.getBoundingClientRect().top - w.__held.top);
          // Read here, with everything held: at the press itself the hold has not landed yet,
          // and a frame's difference can flip which of two rows is nearer.
          if (w.__press.gap) w.__press.nearest = nearestTo(event.clientY);
        },
        true,
      );
      window.addEventListener(
        'pointerdown',
        (event) => {
          // The browser's own answer. `elementFromPoint` here can read a frame further on.
          const under = event.target as Element | null;
          const row = under?.closest?.('[data-row-id]') ?? null;
          const anyRow = document.querySelector('[data-row-id]');
          w.__held = row
            ? { el: row, top: row.getBoundingClientRect().top }
            : anyRow
              ? { el: anyRow, top: anyRow.getBoundingClientRect().top }
              : null;
          const inView = rowsInView();
          const id = row?.getAttribute('data-row-id') ?? null;
          const glide = (row?.parentElement ?? null)
            ?.getAnimations()
            .map((a) => (a.effect as KeyframeEffect).getKeyframes())
            .find((k) => k[0]?.transform);
          const y = (t: unknown) => new DOMMatrixReadOnly(String(t)).m42;
          const way = glide ? y(glide[0]!.transform) - y(glide[1]!.transform) : 0;
          const any = document
            .getAnimations()
            .find(
              (a) =>
                !(a instanceof CSSTransition) &&
                !(a instanceof CSSAnimation) &&
                Boolean((a.effect as KeyframeEffect).getKeyframes()[0]?.transform) &&
                (a.effect as KeyframeEffect).getTiming().duration === 380,
            );
          w.__press = {
            at: any ? Number(any.currentTime) : null,
            hit: id,
            gap: id === null,
            nearest: [],
            moving: !row ? 'none' : way > 0.5 ? 'up' : way < -0.5 ? 'down' : 'still',
            place: !id
              ? 'none'
              : inView[0]?.id === id
                ? 'first'
                : inView.at(-1)?.id === id
                  ? 'last'
                  : 'middle',
            target: `${(event.target as Element)?.tagName}.${String((event.target as Element)?.className).slice(0, 44)}`,
            drift: null,
          };
        },
        true,
      );
    });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const selected = (page: Page) =>
    page.evaluate(() => document.querySelector('[data-row-id][aria-selected="true"]')?.getAttribute('data-row-id') ?? null);
  const startGlide = (page: Page, key: string) =>
    page.evaluate((k) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    }, key);
  test('a real mouse, at 20, 60, 120 and 300ms into a glide, held 16 to 150ms: the row drawn under it is the row selected', async ({ page }, info) => {
    test.setTimeout(30 * 60_000);
    await listenForPresses(page);
    await openMixed(page);
    const view = await page.evaluate(() => {
      const r = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left };
    });
    const x = view.left + 300;
    /**
     * Each chip with where to stand for it, so the presses reach rows of every kind. The
     * Late rows are first in the list, so they stay put when Late goes on and off; the At
     * risk rows go up past the top rows, and back down. The first row drawn is near the
     * top of the list, and the last near its bottom.
     */
    const top = view.top + 28;
    const last = view.bottom - 4;
    /*
     * The toolbar above the list is 32px on a list that fits and 27px on one that does not
     * (HANDOFF, found wrong), so the first row only stays exactly put while the list is too
     * long for the screen before and after, and only counts while something else is moving:
     * Late and On time on, with At risk going on and off between them.
     */
    const PLAN = [
      { key: '2', y: top + 130 }, // At risk on: its rows come up through here
      { key: '2', y: top + 130 }, // off: and go back down
      { key: '2', y: top + 20 }, // on: the first of them, on its way to the top
      { key: '2', y: last }, // off: rows arrive at the end of the view
      { key: '2', y: last }, // on: its rows leave the end of the view, going up
      { key: '2', y: top + 20 }, // off: the first of them leaves the top, going down
      { key: '1', y: top + 200 }, // Late on
      { key: '3', y: top + 20 }, // On time on
      { key: '2', y: top + 20 }, // At risk on: On time moves down, the first row stays put
      { key: '2', y: top + 20 }, // off: On time moves up, the first row stays put
      { key: '2', y: top + 200 }, // on: the rows in the middle stay put too
      { key: '2', y: last }, // off: On time moves up from the end of the view
      { key: '3', y: top + 20 }, // On time off
      { key: '1', y: last }, // Late off: back to the whole list
    ];

    const TIMES = [20, 60, 120, 300];
    const HOLDS = [16, 40, 80, 150];
    const ROUNDS_PER_COMBO = 16;
    const lateBy = new Map<number, number>(TIMES.map((t) => [t, 0]));
    const tally: Tally[] = [];
    let step = 0;
    /*
     * The worker keeps the feed fresh by polling every 30 s; in e2e nothing does, and the
     * board calls the feed stale 5 min after the seed (§12.3). This test runs about that
     * long, so it does the worker's part itself: once the banner shows, the list sits lower
     * than `view` says, and the last presses land on the column header (deploy run
     * 2026-11-10T16-33-39-919Z, all three misses at 300ms, held 150ms).
     */
    const keepFeedFresh = async () => {
      const sql = connect();
      try {
        await sql`update feed_health set newest_position_at = now(), last_success_at = now() where id = 1`;
      } finally {
        await sql.end({ timeout: 5 });
      }
    };
    const feedBanner = page.getByText('Position feed unreachable');

    for (const time of TIMES) {
      for (const hold of HOLDS) {
        await keepFeedFresh();
        let done = 0;
        let tries = 0;
        while (done < ROUNDS_PER_COMBO && tries < ROUNDS_PER_COMBO * 4) {
          tries += 1;
          const { key, y } = PLAN[step % PLAN.length]!;
          step += 1;
          // Selecting a row near the end scrolls it into view. Each press starts from the top.
          await page.evaluate(() => {
            document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!.scrollTop = 0;
          });
          await page.mouse.move(x, y);

          // The chip in the page, then the real press after the delay that has been landing on time.
          const fired = startGlide(page, key);
          await sleep(Math.max(0, time - lateBy.get(time)!));
          await page.mouse.down();
          await fired;
          const pressedAt = await page.evaluate(() => (window as unknown as { __press: Press }).__press);
          await sleep(hold);
          await page.mouse.up();
          const press = await page.evaluate(() => (window as unknown as { __press: Press }).__press);
          expect(press.hit).toBe(pressedAt.hit);

          // Keeps the timing honest: what landed teaches the next one.
          if (press.at !== null) lateBy.set(time, lateBy.get(time)! + (press.at - time) * 0.4);
          const onTime = press.at !== null && Math.abs(press.at - time) <= 18;

          const expected = press.gap ? press.nearest : [press.hit!];
          await expect
            .poll(async () => expected.includes((await selected(page)) ?? ''), { timeout: 1_000 })
            .toBe(true)
            .catch(() => {});
          const now = await selected(page);
          await expect.poll(() => stillMoving(page), { timeout: 3_000 }).toBe(0);
          if (onTime) {
            done += 1;
            tally.push({ ...press, time, hold, selected: now, ok: expected.includes(now ?? '') });
          }
        }
        expect(done, `${time}ms, held ${hold}ms: presses that landed on time`).toBe(ROUNDS_PER_COMBO);
        // The control: a press aimed at a board the stale banner pushed down tests nothing.
        await expect(feedBanner, `${time}ms, held ${hold}ms: the feed went stale mid-test`).toHaveCount(0);
      }
    }

    const rows = tally.reduce<
      Record<string, { presses: number; misses: number; gaps: number; moved: number; mostMoved: number }>
    >((table, t) => {
      const key = `${t.time}ms, held ${t.hold}ms`;
      const row = (table[key] ??= { presses: 0, misses: 0, gaps: 0, moved: 0, mostMoved: 0 });
      row.presses += 1;
      if (!t.ok) row.misses += 1;
      if (t.gap) row.gaps += 1;
      const drift = t.drift ?? 0;
      if (drift > 0.5) row.moved += 1;
      row.mostMoved = Math.max(row.mostMoved, Math.round(drift * 10) / 10);
      return table;
    }, {});
    const kinds = tally.reduce<Record<string, number>>((all, t) => {
      const kind = t.gap ? 'a gap' : t.moving;
      all[kind] = (all[kind] ?? 0) + 1;
      if (!t.gap) all[`place ${t.place}`] = (all[`place ${t.place}`] ?? 0) + 1;
      all[`${kind}, ${t.place}`] = (all[`${kind}, ${t.place}`] ?? 0) + 1;
      return all;
    }, {});
    const report = JSON.stringify({ rows, kinds, misses: tally.filter((t) => !t.ok) }, null, 1);
    await info.attach('press-table', { body: report, contentType: 'application/json' });
    process.stdout.write(`PRESS TABLE\n${report}\nEND PRESS TABLE\n`);

    expect(tally.filter((t) => !t.ok)).toEqual([]);
    // The press held it: nothing under the pointer moved from the press to the release.
    expect(tally.filter((t) => (t.drift ?? 0) > 0.5)).toEqual([]);
    // It tested what it claims: rows of every kind, in both places, and gaps too.
    for (const kind of ['up', 'down', 'still', 'a gap', 'place first', 'place last']) {
      expect(kinds[kind] ?? 0, kind).toBeGreaterThan(5);
    }
    for (const moving of ['up', 'down', 'still']) {
      for (const place of ['first', 'last']) {
        expect(kinds[`${moving}, ${place}`] ?? 0, `${moving}, ${place}`).toBeGreaterThan(0);
      }
    }
  });

  test('a press in a gap selects the nearest row drawn, never nothing', async ({ page }) => {
    test.setTimeout(120_000);
    await listenForPresses(page);
    await openMixed(page);
    const view = await page.evaluate(() => {
      const r = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!.getBoundingClientRect();
      return { left: r.left, top: r.top, bottom: r.bottom };
    });
    const x = view.left + 300;
    // At risk on: the Late rows go, and the At risk rows have not got here yet. Off: they
    // have only just left, and the rows coming back start further down.
    const spots = [view.top + 208, view.bottom - 120];
    let gaps = 0;
    for (let i = 0; i < 16; i += 1) {
      await page.mouse.move(x, spots[i % spots.length]!);
      const fired = startGlide(page, '2');
      await sleep(4 + (i % 4) * 6);
      await page.mouse.down();
      await fired;
      await sleep(40);
      await page.mouse.up();
      const press = await page.evaluate(() => (window as unknown as { __press: Press }).__press);
      const expected = press.gap ? press.nearest : [press.hit!];
      if (press.gap) gaps += 1;
      await expect
        .poll(async () => expected.includes((await selected(page)) ?? ''), { timeout: 1_000 })
        .toBe(true);
      await expect.poll(() => stillMoving(page), { timeout: 3_000 }).toBe(0);
    }
    expect(gaps).toBeGreaterThan(0);
  });

  test('press and move off: nothing is selected, and the rows go on', async ({ page }) => {
    await openMixed(page);
    const box = (await page.locator('[data-row-id]').nth(2).boundingBox())!;
    await page.mouse.move(box.x + 300, box.y + 10);
    await page.keyboard.press('1');
    await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 3 });
    await page.mouse.up();
    await expect.poll(() => stillMoving(page)).toBe(0);
    expect(await selected(page)).toBeNull();
    expect(await atRest(page)).toEqual(RESTING);
  });

  test('a press in a gap that moves off selects nothing, and a hand’s shake still selects', async ({ page }) => {
    test.setTimeout(120_000);
    await listenForPresses(page);
    await openMixed(page);
    const view = await page.evaluate(() => {
      const r = document.querySelector('[data-row-id]')!.closest('.overflow-y-auto')!.getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    const x = view.left + 300;
    // At risk on: the Late rows have gone and the At risk rows are not here yet.
    const y = view.top + 208;

    /** Only a press that really landed in a gap says anything: others are tried again. */
    const gapPress = async (dy: number) => {
      for (let i = 0; i < 16; i += 1) {
        await page.mouse.move(x, y);
        await page.keyboard.press('Escape');
        const fired = startGlide(page, '2');
        await sleep(6);
        await page.mouse.down();
        await fired;
        await page.mouse.move(x, y + dy);
        await page.mouse.up();
        const press = await page.evaluate(() => (window as unknown as { __press: Press }).__press);
        await expect.poll(() => stillMoving(page), { timeout: 3_000 }).toBe(0);
        const now = await selected(page);
        await startGlide(page, '2');
        await expect.poll(() => stillMoving(page), { timeout: 3_000 }).toBe(0);
        if (press.gap) return now;
      }
      throw new Error('No press landed in a gap');
    };
    expect(await gapPress(2)).not.toBeNull();
    expect(await gapPress(40)).toBeNull();
  });

  /**
   * The browser sends a click to what the press and the release have in common. A press holds
   * everything, but the animation clock can tick over between the hit test and the hold, and
   * at the start of a glide a frame can be a whole row. Forced here by taking the pressed
   * row out from under the pointer in the middle of the press.
   */
  test('the release finds something else: the pressed row is still the row selected', async ({ page }) => {
    await openMixed(page);
    const row = page.locator('[data-row-id]').nth(2);
    const id = await row.getAttribute('data-row-id');
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + 300, box.y + box.height / 2);
    await page.keyboard.press('1');
    await page.mouse.down();
    await page.evaluate((rowId) => {
      const pressed = document.querySelector(`[data-row-id="${rowId}"]`) as HTMLElement;
      pressed.style.pointerEvents = 'none';
      (pressed.parentElement as HTMLElement).style.pointerEvents = 'none';
    }, id);
    await page.mouse.up();
    await expect(page.locator(`[data-row-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  });

  test('a double press opens the row under the pointer', async ({ page }) => {
    await openMixed(page);
    const box = (await page.locator('[data-row-id]').nth(3).boundingBox())!;
    await page.mouse.move(box.x + 300, box.y + 20);
    await page.keyboard.press('1');
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    const modal = page.getByRole('dialog', { name: /^(Edit|New) load for truck/ });
    await modal.waitFor();
    const title = await modal.getAttribute('aria-label');
    const chosen = await selected(page);
    const number = await page.locator(`[data-row-id="${chosen}"]`).evaluate((r) => r.textContent ?? '');
    expect(number).toContain(/truck (\S+)$/.exec(title!)![1]!);
  });

  test('Space and Enter mid-glide work on the row that has focus', async ({ page }) => {
    await openMixed(page);
    const row = page.locator('[data-row-id]').nth(1);
    const id = await row.getAttribute('data-row-id');
    await row.focus();
    await page.keyboard.press('1');
    await page.keyboard.press(' ');
    await expect(page.locator(`[data-row-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => stillMoving(page)).toBe(0);
    await page.keyboard.press('2');
    await page.locator(`[data-row-id="${id}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /^(Edit|New) load for truck/ })).toBeVisible();
  });

  test('X mid-glide checks the selected row', async ({ page }) => {
    await openMixed(page);
    const row = page.locator('[data-row-id]').nth(1);
    await row.click();
    const id = await row.getAttribute('data-row-id');
    await page.keyboard.press('1');
    await page.keyboard.press('x');
    await expect(page.locator(`[data-row-id="${id}"] input[type="checkbox"]`)).toBeChecked();
    await expect.poll(() => stillMoving(page)).toBe(0);
  });

  test('a row’s own buttons work mid-glide: its checkbox checks and does not select', async ({ page }) => {
    await openMixed(page);
    const box = (await page.locator('[data-row-id]').nth(1).locator('input[type="checkbox"]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const id = await page.locator('[data-row-id]').nth(1).getAttribute('data-row-id');
    // Late rows stay put, so the checkbox is where the pointer is, in the middle of a glide.
    await page.keyboard.press('1');
    const moving = await page.evaluate(() =>
      document.getAnimations().filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length,
    );
    await page.mouse.down();
    await page.mouse.up();
    expect(moving).toBeGreaterThan(0);
    await expect(page.locator(`[data-row-id="${id}"] input[type="checkbox"]`)).toBeChecked();
    expect(await selected(page)).toBeNull();
  });

  test('a row’s pin works mid-glide', async ({ page }) => {
    await openMixed(page);
    const row = page.locator('[data-row-id]').nth(1);
    const id = await row.getAttribute('data-row-id');
    const number = (await row.locator('button[aria-label^="Pin truck"]').getAttribute('aria-label'))!;
    await row.hover();
    const pin = (await row.locator('button[aria-label^="Pin truck"]').boundingBox())!;
    await page.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2);
    await page.keyboard.press('1');
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByRole('button', { name: number.replace('Pin', 'Unpin') })).toBeVisible();
    expect(await selected(page)).toBeNull();
    expect(id).not.toBeNull();
  });
});

/**
 * A chip mid-glide cancels every flight and starts new ones (`land`, `row-glide.ts`). A
 * cancelled animation stays in `moving` (`lib/motion.ts`) until its cancel event, which waits
 * for the next frame, and its time reads null until then. A press queued behind the commit
 * lands in that gap. The real app and a real mouse.
 */
test.describe('a press behind a cancel', () => {
  type Entry = { animation: Animation; cancelEvent: boolean };
  type Seen = { __all: Entry[]; __gap: Entry[]; __later: Entry[]; __armed: boolean };

  const watchCancels = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as Seen;
      w.__all = [];
      w.__gap = [];
      w.__later = [];
      w.__armed = false;
      /*
       * Anchored on the cancel, not on a guess at when React commits, since a chip also goes
       * through the URL. Right after the commit this cancel is part of, the main thread stays
       * busy, with the press waiting behind it.
       */
      const cancel = Animation.prototype.cancel;
      Animation.prototype.cancel = function (this: Animation) {
        cancel.call(this);
        if (!w.__armed) return;
        w.__armed = false;
        queueMicrotask(() => {
          console.info('press now');
          const until = performance.now() + 120;
          while (performance.now() < until);
        });
      };
      const real = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, frames, options) {
        const animation = real.call(this, frames, options);
        const entry: Entry = { animation, cancelEvent: false };
        animation.addEventListener('cancel', () => {
          entry.cancelEvent = true;
        });
        w.__all.push(entry);
        return animation;
      };
      // Ahead of `lib/motion.ts`'s listener, as this runs before the page's own code: what the press finds.
      window.addEventListener(
        'pointerdown',
        () => {
          w.__gap = w.__all.filter((e) => e.animation.playState === 'idle' && !e.cancelEvent);
          const first = w.__all.indexOf(w.__gap[0]!);
          w.__later = w.__all.filter((e, i) => i > first && e.animation.playState === 'running');
        },
        true,
      );
    });

  const stateOf = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as Seen;
      return {
        inGap: w.__gap.length,
        broughtBack: w.__gap.filter((e) => e.animation.playState !== 'idle').length,
        later: w.__later.length,
        laterPaused: w.__later.filter((e) => e.animation.playState === 'paused').length,
        laterTimes: w.__later.map((e) => e.animation.currentTime),
      };
    });

  /** Where every row stands against where the list says it belongs, and how it shows. */
  const standing = (page: Page) =>
    page.evaluate(() => ({
      running: document
        .getAnimations()
        .filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length,
      displaced: [...document.querySelectorAll('[data-row-id]')].filter((r) => {
        const wrapper = r.parentElement as HTMLElement;
        const cs = getComputedStyle(wrapper);
        const drawn = new DOMMatrixReadOnly(cs.transform).m42;
        return Math.abs(drawn - new DOMMatrixReadOnly(wrapper.style.transform).m42) > 0.5 || cs.opacity !== '1';
      }).length,
    }));

  /**
   * Only a press that landed in the gap says anything, so the others are tried again. About
   * 3 in 4 land, however long the main thread stays busy past 90ms (measured, phase 3bg).
   */
  const pressInTheGap = async (page: Page) => {
    for (let tries = 0; tries < 16; tries += 1) {
      const pressNow = page.waitForEvent('console', { predicate: (m) => m.text() === 'press now' });
      await page.evaluate(
        () =>
          new Promise<void>((done) => {
            const chip = () =>
              window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }));
            chip();
            // Frames into the glide, the same chip again, which cancels every flight.
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  (window as unknown as Seen).__armed = true;
                  chip();
                  done();
                }),
              ),
            );
          }),
      );
      await pressNow;
      await page.mouse.down();
      const atPress = await stateOf(page);
      // Very late, a press finds the gap a flight leaves as it lands, with nothing after it.
      if (atPress.inGap > 0 && atPress.later > 0) return atPress;
      await page.mouse.up();
      await expect.poll(() => stillMoving(page)).toBe(0);
    }
    throw new Error('No press landed in the gap in 16 tries');
  };

  test('a chip mid-glide with a press queued behind it: nothing thrown, nothing brought back, the rest held', async ({ page }) => {
    test.setTimeout(120_000);
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(error.message));
    await watchCancels(page);
    await openMixed(page);
    const box = (await page.locator('[data-row-id]').nth(3).boundingBox())!;
    await page.mouse.move(box.x + 300, box.y + box.height / 2);

    const atPress = await pressInTheGap(page);

    await page.waitForTimeout(GLIDE_MS + 60);
    const heldLater = await stateOf(page);
    await page.mouse.up();
    const released = await stateOf(page);
    // A condition, and one the fault cannot hang: over means neither moving nor paused.
    await page.waitForFunction(() =>
      (window as unknown as Seen).__later.every((e) => !['running', 'paused'].includes(e.animation.playState)),
    );
    await quiet(page);

    expect({
      thrown,
      broughtBack: heldLater.broughtBack,
      notHeld: atPress.later - atPress.laterPaused,
      timesMovedUnderThePress: heldLater.laterTimes.filter((t, i) => t !== atPress.laterTimes[i]).length,
      stillPausedAfterTheRelease: released.laterPaused,
      atRest: await standing(page),
    }).toEqual({
      thrown: [],
      broughtBack: 0,
      notHeld: 0,
      timesMovedUnderThePress: 0,
      stillPausedAfterTheRelease: 0,
      atRest: { running: 0, displaced: 0 },
    });
  });
});

/* ------------------------------------------------------------------------------------------
 * Phase 3bj (§12.152), the small motions, in a real browser: the lengths the browser runs,
 * the real CSS that holds a chip's look back, every scroller on every frame, a real press on
 * each new control 20 to 300ms into its motion, and a resize that swaps the note's form. What
 * starts each one, and what does not, is held by the unit tests (`board-motion.test.tsx`,
 * `strip-motion.test.tsx`, `overlay-motion.test.tsx`).
 * ------------------------------------------------------------------------------------------ */

type Small = { what: string; frames: string; duration: number; easing: string };
type SmallLog = { __small: (Small & { animation: Animation; el: Element })[]; __copies: number };

/** Every Web Animation the page starts, named by what it is on, from before its code runs. */
const logSmall = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as SmallLog;
    w.__small = [];
    w.__copies = 0;
    const name = (el: Element): string => {
      const text = el.textContent ?? '';
      if (el.hasAttribute('data-ground-pop')) return 'chip';
      if (el instanceof HTMLInputElement && el.type === 'checkbox') return 'check';
      if (el.hasAttribute('data-empty')) return 'empty';
      if (el.getAttribute('role') === 'alert' && text.includes('Position feed')) return 'feedBanner';
      if (el.getAttribute('role') === 'status' && text.includes('reach the console server')) return 'fetchBanner';
      if (el.tagName === 'BUTTON' && text.includes('reorder — click to sort')) return 'reorder';
      if (el.getAttribute('data-note') === 'drivers') return 'note';
      if (el.tagName.toLowerCase() === 'svg' && el.closest('button[aria-label^="Copy"]')) return 'copied';
      if (el.tagName === 'SPAN' && el.parentElement?.tagName === 'LABEL' && el.classList.contains('text-status-late-fg')) return 'invalid';
      if (text.startsWith('Unsaved changes')) return 'unsaved';
      if (text.startsWith('Saved · one thing to know')) return 'saved';
      if (el.hasAttribute('data-ratecon-detail')) return 'ratecon';
      if (el.getAttribute('role') === 'listbox') return 'palResults';
      if (el.hasAttribute('data-tour-step')) return 'tour';
      return 'other';
    };
    const real = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      const animation = real.call(this, frames, options);
      const timing = (typeof options === 'object' ? options : { duration: options }) as KeyframeAnimationOptions;
      w.__small.push({
        what: name(this),
        frames: JSON.stringify(frames),
        duration: Number(timing.duration),
        easing: String(timing.easing ?? ''),
        animation,
        el: this,
      });
      return animation;
    };
  });
const smallStarted = async (page: Page) =>
  page.evaluate(() =>
    (window as unknown as SmallLog).__small
      .filter((s) => s.what !== 'other')
      .map(({ what, frames, duration, easing }) => ({ what, frames, duration, easing })),
  );
/** Nothing running, and nothing the small motions add left behind. */
const smallAtRest = (page: Page) =>
  page.evaluate(() => ({
    running: document.getAnimations().filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length,
    added: document.querySelectorAll('[data-ground-pop], [data-ground-host]').length,
    boxStyled: [...document.querySelectorAll('[data-row-id] input[type="checkbox"]')].filter((b) => b.getAttribute('style')).length,
    clipped: [...document.querySelectorAll('[data-tour-step]')].filter((s) => s.parentElement?.getAttribute('style')).length,
  }));
const SMALL_AT_REST = { running: 0, added: 0, boxStyled: 0, clipped: 0 };

const DROP_FRAMES = JSON.stringify([
  { opacity: 0, translate: `0 -${DROP_PX}px` },
  { opacity: 1, translate: '0 0' },
]);
const FADE_FRAMES = JSON.stringify([{ opacity: 0 }, { opacity: 1 }]);
const POP_FRAMES = JSON.stringify([
  { opacity: 0, scale: String(POP_FROM) },
  { opacity: 1, scale: '1' },
]);
const drop = { frames: DROP_FRAMES, duration: SMALL_MS, easing: DIALOG_CURVE };
const fade = { frames: FADE_FRAMES, duration: SMALL_MS, easing: 'linear' };
const pop = { frames: POP_FRAMES, duration: SMALL_MS, easing: DIALOG_CURVE };

/**
 * One step watched on its own: every scroller on every frame from its cause until all is
 * still, against that step's own two ends. Watched across several steps, a state in the
 * middle (the health strip giving way to the reorder bar) would read as growth.
 */
const watchStep = async (page: Page, act: () => Promise<unknown>) => {
  const stop = await watchFrames(page);
  await act();
  await expect.poll(() => stillMoving(page)).toBe(0);
  const { grew } = await stop();
  return grew;
};

/** Web Animations still running: the glides and these motions, not a flash or a toast's CSS. */
const webMoving = (page: Page) =>
  page.evaluate(
    () => document.getAnimations().filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length,
  );

/** The worker's part: the seed stamps the feed once, and the board calls it stale 5 min on. */
const keepTheFeedFresh = async () => {
  const sql = connect();
  try {
    await sql`update feed_health set newest_position_at = now(), last_success_at = now() where id = 1`;
  } finally {
    await sql.end({ timeout: 5 });
  }
};

test.describe('phase 3bj, the small motions (§12.152)', () => {
  test('the board: each at its length, a chip’s look at once with nothing played, nothing grown, nothing left, and no replay on a resize', async ({
    page,
    context,
  }) => {
    test.setTimeout(3 * 60_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await logSmall(page);
    await openMixed(page);
    // `openMixed` presses chips itself: count only what this test starts.
    const before = (await smallStarted(page)).length;
    const grew: string[] = [];
    const step = async (name: string, act: () => Promise<unknown>) => {
      grew.push(...(await watchStep(page, act)).map((g) => `${name}: ${g}`));
    };

    /*
     * chip, taken back (`chipGround: 0`, phase 3bj's finish): on every frame for 400ms after
     * Late's key, longer than the motion was, nothing plays on the chip or inside it, no
     * overlay or hold-back is added, and the chip stands where it stood.
     */
    type ChipFrames = { frames: number; pressed: boolean; moved: number; played: number; overlays: number; held: boolean };
    let during = null as ChipFrames | null;
    await step('chip', async () => {
      during = await page.evaluate(
        () =>
          new Promise<ChipFrames>((done) => {
            const log = (window as unknown as SmallLog).__small;
            const since = log.length;
            const chip = [...document.querySelectorAll('button[aria-pressed]')].find((b) => (b.textContent ?? '').startsWith('Late'))!;
            const at = chip.getBoundingClientRect();
            const seen: ChipFrames = { frames: 0, pressed: false, moved: 0, played: 0, overlays: 0, held: false };
            const end = performance.now() + 400;
            const look = () => {
              const now = chip.getBoundingClientRect();
              seen.frames += 1;
              seen.moved = Math.max(seen.moved, ...[now.x - at.x, now.y - at.y, now.width - at.width, now.height - at.height].map(Math.abs));
              seen.overlays = Math.max(seen.overlays, chip.querySelectorAll('[data-ground-pop]').length);
              seen.held ||= chip.hasAttribute('data-ground-host');
              if (performance.now() < end) {
                requestAnimationFrame(look);
                return;
              }
              seen.pressed = chip.getAttribute('aria-pressed') === 'true';
              seen.played = log.slice(since).filter((s) => s.el === chip || chip.contains(s.el)).length;
              done(seen);
            };
            window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }));
            requestAnimationFrame(look);
          }),
      );
    });
    expect(during?.frames, 'frames watched across Late’s arrival').toBeGreaterThan(10);
    expect(during).toEqual({ frames: during?.frames, pressed: true, moved: 0, played: 0, overlays: 0, held: false });
    const late = page.getByRole('button', { name: /^Late\b/ }).first();
    expect(
      await late.evaluate((b) => ({
        edge: getComputedStyle(b).borderTopColor === 'rgba(0, 0, 0, 0)',
        overlays: b.querySelectorAll('[data-ground-pop]').length,
        held: b.hasAttribute('data-ground-host'),
      })),
    ).toEqual({ edge: false, overlays: 0, held: false });
    await step('chip back', () => page.keyboard.press('0'));

    // check: a real click on a box, and again.
    const box = page.locator('[data-row-id]').nth(2).locator('input[type="checkbox"]');
    await step('check on', () => box.click());
    await step('check off', () => box.click());
    // The click left focus on the box, where a chip's key is typing, not a chip.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // empty: Arrived has none in this list.
    await step('empty', async () => {
      await page.keyboard.press('4');
      await expect(page.locator('[data-empty]')).toBeVisible();
    });
    await step('empty back', () => page.keyboard.press('0'));

    // note: Drivers only, then a resize across 1440 that swaps it to its short form and back.
    const note = page.locator('[data-note="drivers"]');
    await step('note', async () => {
      await page.keyboard.press('8');
      await expect(note).toBeVisible();
    });
    await page.setViewportSize({ width: 1300, height: 900 });
    await expect(note.locator('[data-note-text]')).toBeHidden();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(note.locator('[data-note-text]')).toBeVisible();
    await quiet(page);
    await step('note back', () => page.keyboard.press('8'));

    // copied: a real click on a row's copy button. Only a truck with a load has an address.
    const row = page.locator('[data-row-id]').filter({ has: page.locator('button[aria-label="Copy address"]') }).first();
    await row.hover({ timeout: 10_000 });
    await step('copied', async () => {
      await row.getByRole('button', { name: 'Copy address' }).click({ timeout: 10_000 });
      await expect(row.getByRole('button', { name: 'Copy address' })).toContainText('Copied');
    });

    // reorder: a poll changes the order on its own.
    await step('reorder', async () => {
      await pollWith(page, (rows) => {
        rows.reverse();
        mixed(rows);
      });
      await expect(page.getByRole('button', { name: /reorder — click to sort/ })).toBeVisible();
    });

    // feedBanner: the feed goes quiet, and a poll says so.
    const sql = connect();
    try {
      await sql`update feed_health set newest_position_at = now() - interval '3 hours' where id = 1`;
    } finally {
      await sql.end({ timeout: 5 });
    }
    await step('feedBanner', async () => {
      await pollWith(page, () => {});
      await expect(page.getByText('Position feed unreachable')).toBeVisible();
    });

    // fetchBanner: the next poll fails.
    await page.unroute('**/api/fleet');
    await page.route('**/api/fleet', (route) => route.fulfill({ status: 503, json: { error: 'down' } }));
    await step('fetchBanner', async () => {
      const failed = page.waitForResponse('**/api/fleet');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await failed;
      await expect(page.getByText('reach the console server')).toBeVisible();
    });

    expect(grew).toEqual([]);
    expect(await smallAtRest(page)).toEqual(SMALL_AT_REST);

    const seen = (await smallStarted(page)).slice(before);
    const of = (what: string) => seen.filter((s) => s.what === what).map(({ frames: f, duration, easing }) => ({ frames: f, duration, easing }));
    // Six changes (Late, All, Arrived, All, Drivers only on and off), and no chip's look plays: taken back.
    expect(of('chip')).toEqual([]);
    expect(of('check')).toEqual([pop, pop]);
    expect(of('empty')).toEqual([drop]);
    expect(of('note')).toEqual([drop]);
    expect(of('copied')).toEqual([pop]);
    expect(of('reorder')).toEqual([fade]);
    expect(of('feedBanner')).toEqual([fade]);
    expect(of('fetchBanner')).toEqual([fade]);
  });

  test('the edit window: the rate confirmation, a field’s message and “Unsaved changes”, each once, nothing grown, nothing left', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await logSmall(page);
    await resetWorld({ extraTrucks: 1 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?truck=200');
    await page.locator('[data-row-id][aria-selected="true"]').waitFor();
    await quiet(page);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /truck 200/ });
    await dialog.locator('[data-ratecon-strip]').waitFor();
    await expect.poll(() => stillMoving(page)).toBe(0);
    const grew: string[] = [];

    /*
     * Typed first, then the paste. Typing into the load folds an open strip in a passive
     * effect, a commit after the strips appear, so for a frame both are drawn and the
     * window's scroller is 74px taller than at either end. That is layout, not motion: with
     * reduced motion it is there just the same (phase 3bj, HANDOFF). Typed first, no step
     * here holds that frame, and each step is judged on its own frames alone.
     */
    // As a person types: a message, then the same message as they type on.
    await dialog.getByLabel('ZIP', { exact: true }).focus();
    grew.push(
      ...(await watchStep(page, async () => {
        await page.keyboard.type('x');
        await expect(dialog.getByText('ZIP must be digits only', { exact: false })).toBeVisible();
        await expect(dialog.getByText(/^Unsaved changes/)).toBeVisible();
      })),
    );
    // The label wraps the message too, so the field is no longer named just "ZIP": type where focus is.
    grew.push(...(await watchStep(page, () => page.keyboard.type('y'))));

    await page.evaluate(() => navigator.clipboard.writeText('Dear carrier,\nPlease find the load attached.'));
    await dialog.getByLabel("Or paste the rate confirmation's text").focus();
    grew.push(
      ...(await watchStep(page, async () => {
        await page.keyboard.press('ControlOrMeta+v');
        await expect(dialog.getByText('Layout not recognised, nothing filled.')).toBeVisible();
      })),
    );

    expect(grew).toEqual([]);
    expect(await smallAtRest(page)).toEqual(SMALL_AT_REST);
    const seen = (await smallStarted(page)).filter((s) => ['ratecon', 'invalid', 'unsaved'].includes(s.what));
    expect(seen).toEqual([
      // The message and the strip arrive in the same commit; the field's effect runs first.
      { what: 'invalid', ...drop },
      { what: 'unsaved', ...drop },
      { what: 'ratecon', ...drop },
    ]);
  });

  test('the palette and the tour: results fade on each key, steps slide on Next and Back, nothing grown, nothing left', async ({
    page,
  }) => {
    await logSmall(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);

    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await expect.poll(() => stillMoving(page)).toBe(0);
    let stop = await watchFrames(page);
    await page.keyboard.type('da', { delay: 40 });
    await expect(palette.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => stillMoving(page)).toBe(0);
    let watched = await stop();
    expect(watched.grew).toEqual([]);
    await page.keyboard.press('Escape');

    await page.keyboard.press('?');
    await page.getByRole('button', { name: 'Take the tour again' }).click();
    const tour = page.getByRole('dialog', { name: 'What this console does' });
    await expect(tour).toBeVisible();
    await expect.poll(() => stillMoving(page)).toBe(0);
    stop = await watchFrames(page);
    await tour.getByRole('button', { name: 'Next' }).click();
    await tour.getByRole('button', { name: 'Next' }).click();
    await tour.getByRole('button', { name: 'Back' }).click();
    await expect(tour).toContainText('2 of');
    await expect.poll(() => stillMoving(page)).toBe(0);
    watched = await stop();
    expect(watched.grew).toEqual([]);
    expect(await smallAtRest(page)).toEqual(SMALL_AT_REST);

    const seen = await smallStarted(page);
    expect(seen.filter((s) => s.what === 'palResults')).toEqual([
      { what: 'palResults', frames: FADE_FRAMES, duration: PAL_MS, easing: 'linear' },
      { what: 'palResults', frames: FADE_FRAMES, duration: PAL_MS, easing: 'linear' },
    ]);
    const slide = (dx: number) => ({
      what: 'tour',
      frames: JSON.stringify([
        { opacity: 0, translate: `${dx}px 0` },
        { opacity: 1, translate: '0 0' },
      ]),
      duration: SMALL_MS,
      easing: DIALOG_CURVE,
    });
    expect(seen.filter((s) => s.what === 'tour')).toEqual([slide(TOUR_PX), slide(TOUR_PX), slide(-TOUR_PX)]);
  });

  /**
   * The press table for the new controls, as `the press during a glide` has one for rows. A
   * real mouse, 20, 60, 120 and 300ms into each control's own motion (all three last 270ms,
   * so 300 is just after the end), held 40ms. Landed means the press came at that time, ±18
   * ms, by the motion's own clock; only those are judged, and a miss is never tried again.
   * The chip's column went with its motion (phase 3bj's finish): with nothing playing there
   * is no time into it to press at, and a press on a still chip is the board's own tests'.
   */
  test('a real mouse on the checkbox, the copy button and the reorder bar, 20 to 300ms into their motion: every press lands', async ({
    page,
    context,
  }, info) => {
    test.setTimeout(12 * 60_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await logSmall(page);
    await page.addInitScript(() => {
      type Press = { at: number | null; down: boolean; up: boolean | null };
      const w = window as unknown as SmallLog & { __press: Press | null; __aim: string | null; __since: number };
      w.__press = null;
      w.__since = 0;
      /** The control each motion stands on: a press counts only if it came down, and went up, on it. */
      const CONTROL: Record<string, string> = {
        // The box, or its place in its cell, which takes a press for it while it pops.
        check: 'div:has(> input[type="checkbox"])',
        copied: 'button[aria-label="Copy address"]',
        reorder: 'button',
      };
      const onControl = (event: Event) =>
        Boolean(w.__aim && (event.target as Element | null)?.closest?.(CONTROL[w.__aim] ?? '*'));
      // Counted here and copied nowhere: a press that reached the button runs its handler.
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async () => {
          w.__copies += 1;
        },
      });
      window.addEventListener(
        'pointerdown',
        (event) => {
          // Only this round's motion: a press that came before it started has no time in it.
          const last = w.__small.slice(w.__since).filter((s) => s.what === w.__aim).at(-1);
          const clock = Number(document.timeline.currentTime);
          const start = last?.animation.startTime;
          w.__press = {
            at: last && start !== null && start !== undefined ? clock - Number(start) : null,
            down: onControl(event),
            up: null,
          };
        },
        true,
      );
      window.addEventListener(
        'pointerup',
        (event) => {
          if (w.__press) w.__press.up = onControl(event);
        },
        true,
      );
    });
    await openMixed(page);
    const feedBanner = page.getByText('Position feed unreachable');

    type Control = {
      name: 'check' | 'copied' | 'reorder';
      /** Where to stand for round `i`, and what to read before and after. */
      aim: (i: number) => Promise<{ x: number; y: number; read: () => Promise<string> }>;
      /** Starts the control's own motion, in the page, not awaited. */
      start: (i: number) => Promise<unknown>;
      /** What a press that landed leaves: compared with what `read` said before the start. */
      landed: (before: string, after: string) => boolean;
    };
    // Every wait has its own limit: a missing control fails here, not at the test's 12 minutes.
    const centre = async (locator: Locator) => {
      const box = (await locator.boundingBox({ timeout: 5_000 }))!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const rowAt = (i: number) => page.locator('[data-row-id]').nth(1 + (i % 10));
    /** Only a truck with a load has an address to copy. */
    const copyRows = page.locator('[data-row-id]').filter({ has: page.locator('button[aria-label="Copy address"]') });
    const copyRowAt = async (i: number) => copyRows.nth(i % (await copyRows.count()));
    /** Two orders, one after the other, so every poll changes the order the board shows. */
    let flip = false;
    const reorderBar = page.getByRole('button', { name: /reorder — click to sort/ });
    let barAt: { x: number; y: number } | null = null;
    /** At risk and On time trade places: the order changes, and no truck turns late, so no toast. */
    const answerFrom = async (swap: boolean) => {
      const body = (await (await page.request.get('/api/fleet')).json()) as { fleet: FleetRowLike[] };
      mixed(body.fleet);
      if (swap) {
        for (const row of body.fleet) {
          const to = row.status === 'AT_RISK' ? 'ON_TIME' : row.status === 'ON_TIME' ? 'AT_RISK' : row.status;
          row.status = to;
          row.computed = to;
        }
      }
      await page.unroute('**/api/fleet');
      await page.route('**/api/fleet', (route) => route.fulfill({ json: body }));
    };

    const CONTROLS: Control[] = [
      {
        name: 'check',
        aim: async (i) => {
          const box = rowAt(i).locator('input[type="checkbox"]');
          return {
            ...(await centre(box)),
            read: async () =>
              `${await box.isChecked({ timeout: 2_000 })}|${await rowAt(i).getAttribute('aria-selected', { timeout: 2_000 })}`,
          };
        },
        start: (i) =>
          page.evaluate(
            (n) => (document.querySelectorAll('[data-row-id]')[1 + (n % 10)]!.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
            i,
          ),
        // Checked by the start, unchecked by the press, and the row not selected by it.
        landed: (before, after) => before === after,
      },
      {
        name: 'copied',
        aim: async (i) => {
          const row = await copyRowAt(i);
          await row.hover({ timeout: 5_000 });
          const button = row.getByRole('button', { name: 'Copy address' });
          // The last round's "Copied" has to go first, or this click shows nothing new.
          await expect(button).not.toContainText('Copied', { timeout: 3_000 });
          return {
            ...(await centre(button)),
            read: async () =>
              `${await page.evaluate(() => (window as unknown as SmallLog).__copies)}|${await row.getAttribute('aria-selected', { timeout: 2_000 })}`,
          };
        },
        start: (i) =>
          page.evaluate((n) => {
            const rows = [...document.querySelectorAll('[data-row-id]')].filter((r) => r.querySelector('button[aria-label="Copy address"]'));
            (rows[n % rows.length]!.querySelector('button[aria-label="Copy address"]') as HTMLButtonElement).click();
          }, i),
        // Two copies, the start's and the press's, and the row not selected by either.
        landed: (before, after) => {
          const [was, wasSelected] = before.split('|');
          const [now, isSelected] = after.split('|');
          return Number(now) === Number(was) + 2 && isSelected === wasSelected;
        },
      },
      {
        name: 'reorder',
        aim: async () => {
          // Where the bar stands: shown once by a poll and measured.
          if (barAt === null) {
            flip = !flip;
            await answerFrom(flip);
            await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            await reorderBar.waitFor({ timeout: 10_000 });
            barAt = await centre(reorderBar);
          }
          // A bar left from the round before (a press that came early) is clicked away first.
          if (await reorderBar.isVisible()) {
            await reorderBar.click({ timeout: 5_000 });
            await expect(reorderBar).toHaveCount(0, { timeout: 5_000 });
            await expect.poll(() => webMoving(page), { timeout: 3_000 }).toBe(0);
          }
          // The next poll is answered from memory, so the bar comes as soon as the page asks.
          flip = !flip;
          await answerFrom(flip);
          return { ...barAt, read: async () => String(await reorderBar.count()) };
        },
        start: () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))),
        // There before the press and gone after it: the press sorted the list.
        landed: (_before, after) => after === '0',
      },
    ];

    const TIMES = [20, 60, 120, 300];
    const HOLD = 40;
    const ROUNDS = 8;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const tally: { control: string; time: number; ok: boolean; offControl: boolean; moved: number }[] = [];

    for (const control of CONTROLS) {
      for (const time of TIMES) {
        await keepTheFeedFresh();
        let lateBy = 0;
        let done = 0;
        let tries = 0;
        while (done < ROUNDS && tries < ROUNDS * 6) {
          tries += 1;
          const { x, y, read } = await control.aim(tries);
          await page.mouse.move(x, y);
          await quiet(page);
          const before = await read();
          await page.evaluate((m) => {
            const w = window as unknown as SmallLog & { __aim: string; __since: number; __press: unknown };
            w.__aim = m;
            w.__since = w.__small.length;
            w.__press = null;
          }, control.name);

          const fired = control.start(tries);
          await sleep(Math.max(0, time - lateBy));
          await page.mouse.down();
          await fired;
          const pressed = await page.evaluate(() => (window as unknown as { __press: { at: number | null } }).__press);
          const box = await page.evaluate(
            ({ px, py }) => {
              const el = document.elementFromPoint(px, py);
              const r = el?.getBoundingClientRect();
              return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
            },
            { px: x, py: y },
          );
          await sleep(HOLD);
          const boxAfter = await page.evaluate(
            ({ px, py }) => {
              const el = document.elementFromPoint(px, py);
              const r = el?.getBoundingClientRect();
              return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
            },
            { px: x, py: y },
          );
          await page.mouse.up();
          const ends = await page.evaluate(() => (window as unknown as { __press: { down: boolean; up: boolean | null } }).__press);
          // A press on the reorder bar sorts and glides.
          await expect.poll(() => webMoving(page), { timeout: 3_000 }).toBe(0);
          await expect.poll(async () => control.landed(before, await read()), { timeout: 1_000 }).toBe(true).catch(() => {});
          const after = await read();

          // Early, before the motion began: wait longer next time. Otherwise learn from the gap.
          if (pressed.at === null) lateBy -= 20;
          else lateBy += (pressed.at - time) * 0.4;
          const onTime = pressed.at !== null && Math.abs(pressed.at - time) <= 18;
          if (onTime) {
            done += 1;
            tally.push({
              control: control.name,
              time,
              ok: control.landed(before, after),
              offControl: !ends.down || ends.up !== true,
              moved: box && boxAfter ? Math.max(Math.abs(box.x - boxAfter.x), Math.abs(box.y - boxAfter.y)) : -1,
            });
          }
          // Put it back for the next round when the press did not.
          if (control.name === 'check' && (await rowAt(tries).locator('input[type="checkbox"]').isChecked({ timeout: 2_000 }))) {
            await rowAt(tries).locator('input[type="checkbox"]').uncheck({ timeout: 5_000 });
          }
          await expect.poll(() => webMoving(page), { timeout: 3_000 }).toBe(0);
        }
        const these = tally.filter((t) => t.control === control.name && t.time === time);
        process.stdout.write(
          `SMALL PRESS ${control.name} at ${time}ms: ${done} landed in ${tries} tries, ${these.filter((t) => !t.ok).length} missed\n`,
        );
        expect(done, `${control.name} at ${time}ms: presses that landed on time`).toBe(ROUNDS);
        await expect(feedBanner, `${control.name} at ${time}ms: the feed went stale mid-test`).toHaveCount(0);
      }
    }

    const rows = tally.reduce<Record<string, { presses: number; misses: number; offTarget: number; mostMoved: number }>>((table, t) => {
      const key = `${t.control} at ${t.time}ms`;
      const row = (table[key] ??= { presses: 0, misses: 0, offTarget: 0, mostMoved: 0 });
      row.presses += 1;
      if (!t.ok) row.misses += 1;
      if (t.offControl) row.offTarget += 1;
      row.mostMoved = Math.max(row.mostMoved, Math.round(t.moved * 10) / 10);
      return table;
    }, {});
    const report = JSON.stringify({ rows, misses: tally.filter((t) => !t.ok) }, null, 1);
    await info.attach('small-press-table', { body: report, contentType: 'application/json' });
    process.stdout.write(`SMALL PRESS TABLE\n${report}\nEND SMALL PRESS TABLE\n`);

    expect(tally).toHaveLength(CONTROLS.length * TIMES.length * ROUNDS);
    expect(tally.filter((t) => !t.ok)).toEqual([]);
    // Each press came down on its control and went up on it: no motion took it away.
    expect(tally.filter((t) => t.offControl)).toEqual([]);
    /*
     * What stood under the pointer moved by no more than §12.148's own press: a hovered
     * button drops its 1px lift as it is pressed, and none of these motions moves its
     * control at all (an overlay, a copy, the glyph inside, opacity).
     */
    expect(tally.filter((t) => t.moved > 1.01)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------
 * Phase 3bk (§12.153): the small motions of History, Assignments and the login page, at
 * Bold. The numbers are written out, as above. What happy-dom cannot show is here: the
 * lengths a real browser was given, the login form's CSS with no script at all, a key and a
 * password manager's fill while it comes up, nothing grown, nothing left, and real presses.
 * The causes and non-causes are the unit tests' (`history-motion.test.tsx`,
 * `assign-motion.test.tsx`, `login-motion.test.tsx`).
 * ------------------------------------------------------------------------------------------ */

const DRAW_MS = 450;
const DRAW_ROW_MS = 180;
const DRAW_GAP_MS = 30;
const LOGIN_MS = 330;
const LOGIN_RISE_PX = 16;
const LOGIN_FROM = 0.92;

type Paged = { what: string; frames: string; duration: number; delay: number; easing: string; fill: string };
type PagedLog = { __paged: (Paged & { animation: Animation })[] };

/** Every Web Animation the page starts, named by what it is on, from before its code runs. */
const logPages = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as PagedLog;
    w.__paged = [];
    const name = (el: Element): string => {
      if (el.hasAttribute('data-driver-row')) return 'histRows';
      if (el.parentElement?.getAttribute('role') === 'cell' && el.firstElementChild?.hasAttribute('data-load')) return 'histFold';
      if (el.hasAttribute('data-asg-row')) return 'asgRows';
      if (el.getAttribute('role') === 'combobox' && el.closest('[data-asg-row]')) return 'asgDriver';
      if (el.hasAttribute('data-was')) return 'asgDriverWas';
      if (el.tagName === 'LI' && el.querySelector('input[aria-label="New driver name"]')) return 'asgAdd';
      if (el.closest('footer') && (el.textContent ?? '').startsWith('Saved —')) return 'asgSaved';
      if (el.getAttribute('role') === 'alert' && el.closest('form')) return 'loginError';
      return 'other';
    };
    const real = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      const animation = real.call(this, frames, options);
      const timing = (typeof options === 'object' ? options : { duration: options }) as KeyframeAnimationOptions;
      w.__paged.push({
        what: name(this),
        frames: JSON.stringify(frames),
        duration: Number(timing.duration),
        delay: Number(timing.delay ?? 0),
        easing: String(timing.easing ?? ''),
        fill: String(timing.fill ?? ''),
        animation,
      });
      return animation;
    };
  });
const paged = async (page: Page, what?: string) =>
  (
    await page.evaluate(() =>
      (window as unknown as PagedLog).__paged.map(({ what, frames, duration, delay, easing, fill }) => ({
        what,
        frames,
        duration,
        delay,
        easing,
        fill,
      })),
    )
  ).filter((p) => p.what !== 'other' && (what === undefined || p.what === what));

const DRAW_FRAMES = JSON.stringify([{ opacity: 0 }, { opacity: 1 }]);
/**
 * A page's rows in view drew as §12.153 says, held to its numbers as written: one 180ms fade a
 * row, linear, held at nothing until its turn, the first at once, an even gap of 30ms at most,
 * and the last starting by 270ms, so all of it is over by 450.
 */
const expectDrawn = (entries: Paged[], n: number) => {
  expect(entries).toHaveLength(n);
  for (const e of entries) {
    expect(e).toMatchObject({ duration: DRAW_ROW_MS, easing: 'linear', fill: 'backwards', frames: DRAW_FRAMES });
  }
  const delays = entries.map((e) => e.delay);
  expect(delays[0]).toBe(0);
  const gaps = delays.slice(1).map((d, i) => d - delays[i]!);
  for (const g of gaps) {
    expect(g).toBeCloseTo(gaps[0]!, 6);
    expect(g).toBeLessThanOrEqual(DRAW_GAP_MS);
  }
  expect(delays.at(-1)!).toBeLessThanOrEqual(DRAW_MS - DRAW_ROW_MS + 1e-9);
};
/** How many of `rows` stand in `scroller`'s view now. */
const inViewOf = (page: Page, rows: string, scroller: string) =>
  page.evaluate(
    ({ rows, scroller }) => {
      const view = document.querySelector(scroller)!.getBoundingClientRect();
      return [...document.querySelectorAll(rows)].filter((r) => {
        const box = r.getBoundingClientRect();
        return box.bottom > view.top && box.top < view.bottom;
      }).length;
    },
    { rows, scroller },
  );
/** Nothing these motions touch is left with a style, and nothing is running. */
const pagesAtRest = (page: Page) =>
  page.evaluate(() => ({
    running: document.getAnimations().filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length,
    styled: [
      ...document.querySelectorAll(
        'form, [data-driver-row], [role="cell"] > div, [data-asg-row], [data-asg-row] [role="combobox"], [data-was], li, footer span, [role="alert"]',
      ),
    ].filter((el) => el.getAttribute('style')).length,
  }));
const rowDrop = { frames: DROP_FRAMES, duration: SMALL_MS, easing: DIALOG_CURVE };
const dropsOf = (entries: Paged[]) => entries.map(({ frames, duration, easing }) => ({ frames, duration, easing: curve(easing) }));
const asDrops = (n: number) => Array.from({ length: n }, () => ({ ...rowDrop, easing: curve(DIALOG_CURVE) }));

/**
 * A change of page to a week of History, made by Next's own router, as a `Link` makes it. Not
 * the browser's Back: from the board, Back to History changes the address and leaves the board
 * drawn (phase 3bk, "Found wrong"), and the account menu opens the server's real week, which
 * this seed leaves empty.
 */
const toHistoryWeek = (page: Page, week: string) =>
  page.evaluate((w) => {
    (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(`/history?week=${w}`);
  }, week);

/** A signed-out context: the login page with no session, so no load of it asks the hosted auth. */
const signedOut = { storageState: { cookies: [], origins: [] }, reducedMotion: 'no-preference' as const };

/** The form's own animation, seen from its first frame, and every frame of the page until it is still. */
const watchLogin = () => {
  type Frame = { t: number; scrollY: number; opacity: number };
  const w = window as unknown as {
    __arrive: { name: string; duration: number; easing: string; fill: string; frames: Keyframe[] }[] | null;
    __formAnim: Animation | null;
    __frames: Frame[];
    __restY: number | null;
  };
  w.__arrive = null;
  w.__formAnim = null;
  w.__frames = [];
  const tick = () => {
    const form = document.querySelector('form');
    if (form && w.__arrive === null) {
      const all = form.getAnimations();
      w.__formAnim = all[0] ?? null;
      w.__arrive = all.map((a) => ({
        name: (a as CSSAnimation).animationName,
        duration: Number(a.effect!.getComputedTiming().duration),
        // A CSS animation's curve is its keyframes', not its timing's.
        easing: String((a.effect as KeyframeEffect).getKeyframes()[0]?.easing),
        fill: String(a.effect!.getTiming().fill),
        frames: (a.effect as KeyframeEffect).getKeyframes(),
      }));
    }
    if (form) {
      const root = document.scrollingElement!;
      w.__frames.push({
        t: w.__formAnim?.currentTime === null || w.__formAnim === null ? -1 : Number(w.__formAnim.currentTime),
        scrollY: root.scrollHeight - root.clientHeight,
        opacity: Number(getComputedStyle(form).opacity),
      });
    }
    if (w.__frames.length < 90) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};


/**
 * The press table's watch, on every page it presses on: when each press came, by the clock of
 * the motion it aims at, and whether it came down and went up on its control. The login form's
 * animation is CSS and started before any script, so it is kept from its first frame here: a
 * finished one leaves `getAnimations()`. What to aim at survives a reload in `sessionStorage`.
 */
const pressWatch = () => {
  type Press = { at: number | null; down: boolean; same: boolean | null };
  const w = window as unknown as PagedLog & {
    __press: Press | null;
    __since: number;
    __clicks: number;
    __formAnim: Animation | null;
    __downOn: Element | null;
  };
  w.__press = null;
  w.__since = 0;
  w.__clicks = 0;
  w.__formAnim = null;
  w.__downOn = null;
  const aim = () => sessionStorage.getItem('pressAim');
  const zone = () => sessionStorage.getItem('pressZone') ?? '*';
  const keep = () => {
    const form = document.querySelector('form');
    if (form && !w.__formAnim) w.__formAnim = form.getAnimations()[0] ?? null;
    if (!w.__formAnim && performance.now() < 5_000) requestAnimationFrame(keep);
  };
  requestAnimationFrame(keep);
  const timed = (): Animation | null => {
    if (aim() === 'login') return w.__formAnim;
    const log = (w.__paged ?? []).slice(w.__since).filter((s) => s.what === aim());
    // A draw is timed from its first row, a drop from the one just started.
    return (aim() === 'asgRows' || aim() === 'histRows' ? log[0] : log.at(-1))?.animation ?? null;
  };
  const zoneOf = (target: EventTarget | null) => (target as Element | null)?.closest?.(zone()) ?? null;
  window.addEventListener(
    'pointerdown',
    (event) => {
      const motion = timed();
      const start = motion?.startTime;
      w.__downOn = zoneOf(event.target);
      w.__press = {
        at: motion && start !== null && start !== undefined ? Number(document.timeline.currentTime) - Number(start) : null,
        down: w.__downOn !== null,
        same: null,
      };
    },
    true,
  );
  window.addEventListener(
    'pointerup',
    (event) => {
      if (w.__press) w.__press.same = w.__downOn !== null && zoneOf(event.target) === w.__downOn;
    },
    true,
  );
  window.addEventListener(
    'click',
    (event) => {
      if ((event.target as Element | null)?.closest?.('button[type="submit"]')) w.__clicks += 1;
    },
    true,
  );
};
/** Arms one round: what it aims at, the control it must land on, and the log from here on. */
const arm = (page: Page, aim: string, zone: string) =>
  page.evaluate(
    ({ aim, zone }) => {
      sessionStorage.setItem('pressAim', aim);
      sessionStorage.setItem('pressZone', zone);
      const w = window as unknown as PagedLog & { __since: number; __press: unknown };
      w.__since = (w.__paged ?? []).length;
      w.__press = null;
    },
    { aim, zone },
  );
/** Resolves once a motion of `aim` started since the round was armed, and has its time. */
const begun = (page: Page, aim: string) =>
  page.waitForFunction(
    (what) => {
      const w = window as unknown as PagedLog & { __since: number };
      const first = (w.__paged ?? []).slice(w.__since).find((s) => s.what === what);
      return Boolean(first && first.animation.startTime !== null);
    },
    aim,
    { polling: 'raf', timeout: 10_000 },
  );
const centreOf = async (locator: Locator) => {
  const box = (await locator.boundingBox({ timeout: 5_000 }))!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test.describe('phase 3bk, the pages’ small motions (§12.153)', () => {
  test('the login page: up 16px from 92% in 330ms on a load, never hidden without a script, a key and a fill mid-way kept, nothing grown, nothing left', async ({
    browser,
  }) => {
    test.setTimeout(3 * 60_000);
    // At 480 high the form and its padding are taller than the screen: the page scrolls at rest,
    // which is where a form coming up from below could make it scroll further.
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 480 }]) {
      const context = await browser.newContext({ ...signedOut, viewport });
      const page = await context.newPage();
      await page.addInitScript(watchLogin);
      await page.goto('/login');
      await page.waitForFunction(() => (window as unknown as { __frames: unknown[] }).__frames.length >= 90, undefined, { timeout: 10_000 });
      const { arrive, frames, rest } = await page.evaluate(() => {
        const w = window as unknown as { __arrive: unknown; __frames: { t: number; scrollY: number; opacity: number }[] };
        const root = document.scrollingElement!;
        return { arrive: w.__arrive, frames: w.__frames, rest: root.scrollHeight - root.clientHeight };
      });
      const [only, ...more] = arrive as { name: string; duration: number; easing: string; fill: string; frames: Record<string, string>[] }[];
      expect(more).toEqual([]);
      expect(only).toMatchObject({ name: 'login-in', duration: LOGIN_MS, fill: 'backwards' });
      expect(curve(only!.easing)).toBe(curve(DIALOG_CURVE));
      expect(only!.frames[0]).toMatchObject({ opacity: '0', scale: String(LOGIN_FROM) });
      expect(only!.frames[0]!.translate).toMatch(new RegExp(`^0(px)? ${LOGIN_RISE_PX}px$`));
      expect(only!.frames.at(-1)).toMatchObject({ opacity: '1', scale: '1' });
      // It was seen moving, and on no frame could the page scroll further than it does at rest.
      expect(frames.filter((f) => f.t > 0 && f.t < LOGIN_MS).length).toBeGreaterThan(5);
      expect(frames.filter((f) => f.scrollY > rest)).toEqual([]);
      // Nothing left: no style, no animation, and the form at its own look.
      const form = page.locator('form');
      expect(await form.getAttribute('style')).toBeNull();
      expect(
        await form.evaluate((f) => ({ running: f.getAnimations().length, ...((s) => ({ opacity: s.opacity, translate: s.translate, scale: s.scale }))(getComputedStyle(f)) })),
      ).toEqual({ running: 0, opacity: '1', translate: 'none', scale: 'none' });
      await context.close();
    }

    // With no script at all: the CSS still runs and ends by itself, and the form takes typing at once.
    {
      const context = await browser.newContext({ ...signedOut, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto('/login');
      const email = page.getByRole('textbox', { name: 'Work email' });
      await email.fill('rae@example.test', { timeout: 5_000 });
      await expect(email).toHaveValue('rae@example.test');
      await expect(page.locator('form')).toHaveCSS('opacity', '1', { timeout: 5_000 });
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
      await context.close();
    }

    // Under reduced motion: nothing runs, and the form is there on its first frame.
    {
      const context = await browser.newContext({ ...signedOut, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.addInitScript(watchLogin);
      await page.goto('/login');
      await page.waitForFunction(() => (window as unknown as { __frames: unknown[] }).__frames.length >= 10, undefined, { timeout: 10_000 });
      const seen = await page.evaluate(() => {
        const w = window as unknown as { __arrive: unknown[]; __frames: { opacity: number }[] };
        return { arrive: w.__arrive, first: w.__frames[0]!.opacity };
      });
      expect(seen).toEqual({ arrive: [], first: 1 });
      await context.close();
    }

    /*
     * A key pressed 20ms into it lands in the field, and a password manager's fill at the same
     * moment (its value set, and its input event) is kept, through hydration and the end.
     * The key is a real one; a load that took it too early or too late is tried again.
     */
    {
      const context = await browser.newContext({ ...signedOut, viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();
      await page.addInitScript(() => {
        const w = window as unknown as { __keyAt: number | null; __fillAt: number | null };
        w.__keyAt = null;
        w.__fillAt = null;
        let anim: Animation | null = null;
        const timeOf = () => (anim && anim.startTime !== null ? Number(document.timeline.currentTime) - Number(anim.startTime) : null);
        window.addEventListener('keydown', () => (w.__keyAt = timeOf()), true);
        const tick = () => {
          const form = document.querySelector('form');
          const email = form?.querySelector<HTMLInputElement>('input[name="email"]');
          if (form && !anim) anim = form.getAnimations()[0] ?? null;
          if (email && document.activeElement !== email && w.__keyAt === null) email.focus();
          const at = timeOf();
          if (form && at !== null && at >= 20 && w.__fillAt === null) {
            const password = form.querySelector<HTMLInputElement>('input[name="password"]')!;
            password.value = 'filled-by-a-manager';
            password.dispatchEvent(new Event('input', { bubbles: true }));
            password.dispatchEvent(new Event('change', { bubbles: true }));
            w.__fillAt = at;
          }
          if (w.__fillAt === null || w.__keyAt === null) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      let lateBy = 0;
      let at: { key: number | null; fill: number | null } = { key: null, fill: null };
      for (let tries = 0; tries < 30; tries++) {
        await page.goto('/login', { waitUntil: 'commit' });
        await page.waitForFunction(() => document.querySelector('form') !== null, undefined, { polling: 'raf', timeout: 10_000 });
        await page.waitForTimeout(Math.max(0, 20 - lateBy));
        await page.keyboard.type('k');
        // The fill comes on the first frame at 20ms or more: wait for it, not for a guess.
        await page.waitForFunction(() => (window as unknown as { __fillAt: number | null }).__fillAt !== null, undefined, {
          polling: 'raf',
          timeout: 5_000,
        });
        at = await page.evaluate(() => {
          const w = window as unknown as { __keyAt: number | null; __fillAt: number | null };
          return { key: w.__keyAt, fill: w.__fillAt };
        });
        if (at.key !== null && Math.abs(at.key - 20) <= 18) break;
        lateBy += at.key === null ? -10 : (at.key - 20) * 0.5;
      }
      process.stdout.write(`LOGIN KEY at ${at.key}ms, FILL at ${at.fill}ms into the form's motion\n`);
      expect(at.key, 'the key came 20ms into the motion, ±18').not.toBeNull();
      expect(Math.abs(at.key! - 20)).toBeLessThanOrEqual(18);
      expect(at.fill!).toBeGreaterThanOrEqual(20);
      expect(at.fill!).toBeLessThan(LOGIN_MS);
      // Hydrated, and past the end: both are still there.
      await page.waitForFunction(() => Object.keys(document.querySelector('form')!).some((k) => k.startsWith('__react')), undefined, { timeout: 10_000 });
      await page.waitForTimeout(LOGIN_MS);
      await expect(page.locator('input[name="email"]')).toHaveValue('k');
      await expect(page.locator('input[name="password"]')).toHaveValue('filled-by-a-manager');
      await context.close();
    }
  });

  test('Assignments: rows draw on a change of page and not on a load, a pick drops its name and a save’s rebase nothing, the add form and “Saved” drop, nothing grown, nothing left', async ({
    page,
  }) => {
    test.setTimeout(2 * 60_000);
    await seedBoard();
    await logPages(page);
    await page.goto('/');
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    const grew: string[] = [];
    const step = async (name: string, act: () => Promise<unknown>) => {
      grew.push(...(await watchStep(page, act)).map((g) => `${name}: ${g}`));
    };
    const field = (truck: number) => page.getByRole('combobox', { name: `Driver for truck ${truck}` });

    // asgRows: by the header's link, a change of page.
    await step('asgRows', async () => {
      await page.getByRole('link', { name: 'Assignments' }).click();
      await field(401).waitFor();
    });
    const n = await inViewOf(page, '[data-asg-row]', 'main > div.overflow-auto');
    expect(n).toBeGreaterThan(3);
    expectDrawn(await paged(page, 'asgRows'), n);

    // The page a load lands on: nothing.
    await page.reload();
    await field(401).waitFor();
    await quiet(page);
    expect(await paged(page)).toEqual([]);

    // asgDriver: a person's pick. The name and the "was" line that comes with it drop.
    await step('asgDriver', async () => {
      await field(401).click();
      await page.getByRole('option', { name: new RegExp(`^${FREE}`) }).click();
      await expect(field(401)).toHaveValue(FREE);
    });
    expect((await paged(page)).map((p) => p.what)).toEqual(['asgDriver', 'asgDriverWas']);
    expect(dropsOf(await paged(page))).toEqual(asDrops(2));

    // asgSaved: Save, the save's refresh, and its rebase. "Saved" drops once; the pick does not again.
    await step('asgSaved', async () => {
      await page.getByRole('button', { name: 'Save assignments' }).click();
      await expect(page.locator('footer')).toContainText('Saved — 1 assigned', { timeout: 10_000 });
    });
    expect((await paged(page)).map((p) => p.what)).toEqual(['asgDriver', 'asgDriverWas', 'asgSaved']);
    expect(dropsOf(await paged(page, 'asgSaved'))).toEqual(asDrops(1));

    // asgAdd: "+ Add" in an empty truck's picker. How much of the form shows is reported, not fixed.
    await page.setViewportSize({ width: 1440, height: 790 });
    await quiet(page);
    await step('asgAdd', async () => {
      await field(410).click();
      await field(410).fill('Zed Nobody');
      await page.getByRole('button', { name: /^\+ Add “Zed Nobody”/ }).click();
      await page.getByRole('textbox', { name: 'New driver name' }).waitFor();
    });
    expect((await paged(page, 'asgAdd')).length).toBe(1);
    expect(dropsOf(await paged(page, 'asgAdd'))).toEqual(asDrops(1));
    const shown = await page.locator('li:has(input[aria-label="New driver name"])').evaluate((li) => {
      const box = li.getBoundingClientRect();
      let top = 0;
      let bottom = window.innerHeight;
      for (let el = li.parentElement; el; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (/auto|scroll|hidden/.test(cs.overflowY)) {
          const r = el.getBoundingClientRect();
          top = Math.max(top, r.top);
          bottom = Math.min(bottom, r.bottom);
        }
      }
      return Math.round((100 * Math.max(0, Math.min(bottom, box.bottom) - Math.max(top, box.top))) / box.height);
    });
    process.stdout.write(`ASG ADD in view at 1440x790, truck 410: ${shown}% of the form\n`);
    await page.getByRole('button', { name: 'Cancel' }).click();

    expect(grew).toEqual([]);
    await expect.poll(() => pagesAtRest(page)).toEqual({ running: 0, styled: 0 });
  });

  test('History: rows draw on a change of page and not on a load, a filter or a week; a folded day’s loads drop; nothing grown, nothing left', async ({
    page,
  }) => {
    test.setTimeout(2 * 60_000);
    await seedHistory();
    await logPages(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const rows = page.locator('main [data-driver-row]');
    const grew: string[] = [];
    const step = async (name: string, act: () => Promise<unknown>) => {
      grew.push(...(await watchStep(page, act)).map((g) => `${name}: ${g}`));
    };

    // The page a load lands on: nothing.
    await page.goto('/history?week=2026-W39');
    await rows.first().waitFor();
    await quiet(page);
    expect(await paged(page)).toEqual([]);

    // To the board, and to the week again by a change of page. The rows in view draw in.
    await page.locator('[data-board-link]').click();
    await page.locator('[data-row-id]').first().waitFor();
    await quiet(page);
    await step('histRows', async () => {
      await toHistoryWeek(page, '2026-W39');
      await rows.first().waitFor();
    });
    await expect(page).toHaveURL(/week=2026-W39/);
    const n = await inViewOf(page, 'main [data-driver-row]', 'main');
    expect(n).toBeGreaterThan(3);
    expectDrawn(await paged(page, 'histRows'), n);

    // A filter, and a week there and back: nothing more.
    const filter = page.getByRole('textbox', { name: 'Filter drivers' });
    await filter.fill('Andre');
    await expect(rows).toHaveCount(1);
    await filter.fill('');
    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(page).toHaveURL(/week=2026-W38/);
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page).toHaveURL(/week=2026-W39/);
    await rows.first().waitFor();
    await quiet(page);
    expect((await paged(page)).map((p) => p.what)).toEqual(Array.from({ length: n }, () => 'histRows'));

    // histFold: Andre's Tuesday, "+2 more". The two loads that were folded drop; the row grows at once.
    await step('histFold', async () => {
      await page.locator('main [data-driver-row="Andre Baptiste"]').getByRole('button', { name: '+2 more' }).click();
    });
    expect(dropsOf(await paged(page, 'histFold'))).toEqual(asDrops(2));

    expect(grew).toEqual([]);
    await expect.poll(() => pagesAtRest(page)).toEqual({ running: 0, styled: 0 });
  });

  test('a real mouse on the login form, a picked name, the add form, and a drawn and an unfolded row, 20 to 300ms into their motion: every press lands', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(20 * 60_000);
    type Control = {
      name: string;
      on: Page;
      /** What the round is timed by, and the element a press must come down and go up on. */
      aim: string;
      zone: string;
      rounds: number;
      /** Readies the round and says where the pointer stands. */
      ready: (i: number) => Promise<{ x: number; y: number }>;
      /** Starts the control's motion. `waits` starts resolve once it has begun; the rest are fired. */
      start: (i: number) => Promise<unknown>;
      waits: boolean;
      read: () => Promise<string>;
      landed: (before: string, after: string) => boolean;
      /** Whether a press holds it: the login form's CSS runs before the page's script, so not until hydration. */
      held: boolean;
    };
    const TIMES = [20, 60, 120, 300];
    const HOLD = 40;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const tally: { control: string; time: number; ok: boolean; offControl: boolean; moved: number; held: boolean }[] = [];
    const active = (on: Page) =>
      on.evaluate(() => {
        const a = document.activeElement;
        return a?.getAttribute('data-load') ?? a?.getAttribute('name') ?? a?.getAttribute('aria-label') ?? a?.tagName ?? '';
      });

    const run = async (control: Control) => {
      const on = control.on;
      for (const time of TIMES) {
        await keepTheFeedFresh();
        let lateBy = 0;
        let done = 0;
        let tries = 0;
        while (done < control.rounds && tries < control.rounds * 6) {
          tries += 1;
          const { x, y } = await control.ready(tries);
          await on.mouse.move(x, y);
          const before = await control.read();
          await arm(on, control.aim, control.zone);
          const fired = control.start(tries);
          if (control.waits) await fired;
          await sleep(Math.max(0, time - lateBy));
          await on.mouse.down();
          const pressed = await on.evaluate(() => (window as unknown as { __press: { at: number | null } | null }).__press);
          const under = (px: number, py: number) =>
            on.evaluate(
              ({ px, py }) => {
                const r = document.elementFromPoint(px, py)?.getBoundingClientRect();
                return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
              },
              { px, py },
            );
          const box = await under(x, y);
          await sleep(HOLD);
          const boxAfter = await under(x, y);
          await on.mouse.up();
          const ends = await on.evaluate(() => (window as unknown as { __press: { down: boolean; same: boolean | null } | null }).__press);
          await fired;
          await expect.poll(() => control.read().then((after) => control.landed(before, after)), { timeout: 2_000 }).toBe(true).catch(() => {});
          const after = await control.read();
          const at = pressed?.at ?? null;
          if (at === null) lateBy -= 20;
          else lateBy += (at - time) * 0.4;
          if (at !== null && Math.abs(at - time) <= 18) {
            done += 1;
            tally.push({
              control: control.name,
              time,
              ok: control.landed(before, after),
              offControl: !ends?.down || ends.same !== true,
              moved: box && boxAfter ? Math.max(Math.abs(box.x - boxAfter.x), Math.abs(box.y - boxAfter.y)) : -1,
              held: control.held,
            });
          }
        }
        const these = tally.filter((t) => t.control === control.name && t.time === time);
        process.stdout.write(
          `PAGES PRESS ${control.name} at ${time}ms: ${done} landed on time in ${tries} tries, ${these.filter((t) => !t.ok).length} missed\n`,
        );
        expect(done, `${control.name} at ${time}ms: presses on time`).toBe(control.rounds);
      }
    };

    /* The login form, signed out, so no load of it asks the hosted auth. */
    const login = await (await browser.newContext({ ...signedOut, viewport: { width: 1920, height: 1080 } })).newPage();
    await login.addInitScript(pressWatch);
    await login.goto('/login');
    await login.waitForTimeout(LOGIN_MS * 2);
    const email = await centreOf(login.locator('input[name="email"]'));
    const password = await centreOf(login.locator('input[name="password"]'));
    const signInAt = await centreOf(login.getByRole('button', { name: 'Sign in' }));
    const reload = () => login.goto('/login', { waitUntil: 'commit' });
    const loginControl = (name: string, zone: string, at: { x: number; y: number }, read: () => Promise<string>, landed: Control['landed']): Control => ({
      name,
      on: login,
      aim: 'login',
      zone,
      rounds: 8,
      ready: async () => at,
      start: reload,
      waits: true,
      read,
      landed,
      held: false,
    });
    for (const control of [
      loginControl('login email', 'label:has(input[name="email"])', email, () => active(login), (_b, a) => a === 'email'),
      loginControl('login password', 'label:has(input[name="password"])', password, () => active(login), (_b, a) => a === 'password'),
      // Sign in with empty fields: the browser's own check stops it there, so nothing is sent.
      loginControl('login Sign in', 'button[type="submit"]', signInAt, () => login.evaluate(() => String((window as unknown as { __clicks: number }).__clicks)), (_b, a) => a === '1'),
    ]) {
      await run(control);
    }
    await login.context().close();

    /* Assignments. */
    await seedBoard();
    await logPages(page);
    await page.addInitScript(pressWatch);
    let addRequests = 0;
    // Only the add form's create; the merge prompt reads the same address on every mount.
    await page.route('**/api/drivers', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      addRequests += 1;
      return route.fulfill({ status: 400, json: { error: 'Not saved in this test.' } });
    });
    const field = (truck: number) => page.getByRole('combobox', { name: `Driver for truck ${truck}` });
    await page.goto('/assignments');
    await field(401).waitFor();
    // Once first, so the "was" line is there in every round and the row keeps its height.
    await field(401).click();
    await page.getByRole('option', { name: /^Cleo Varga/ }).click();
    await quiet(page);
    const fieldAt = await centreOf(field(401));
    const expanded = () => field(401).getAttribute('aria-expanded', { timeout: 2_000 }).then(String);
    await run({
      name: 'picked name',
      on: page,
      aim: 'asgDriver',
      zone: '[aria-label="Driver for truck 401"]',
      rounds: 8,
      ready: async () => {
        if ((await expanded()) !== 'true') await field(401).click();
        await page.locator('[role="listbox"]').waitFor({ timeout: 5_000 });
        await quiet(page);
        return fieldAt;
      },
      // The other of two names, so each pick changes the row and the "was" line stays.
      start: () =>
        page.evaluate((free) => {
          const list = document.querySelector('[aria-label="Driver for truck 401"]')!.parentElement!.querySelector('[role="listbox"]')!;
          const options = [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')];
          const next = options.find((o) => o.getAttribute('aria-selected') !== 'true' && [free, 'Cleo Varga'].some((n) => (o.textContent ?? '').startsWith(n)))!;
          next.click();
        }, FREE),
      waits: false,
      read: expanded,
      landed: (_b, a) => a === 'true',
      held: true,
    });
    await page.keyboard.press('Escape');

    // The add form: its places measured once, at rest.
    const addField = field(410);
    const formRow = page.locator('li:has(input[aria-label="New driver name"])');
    const offerAdd = async () => {
      if (await formRow.count()) {
        await formRow.getByRole('button', { name: 'Cancel' }).click({ timeout: 5_000 });
        await expect(formRow).toHaveCount(0, { timeout: 5_000 });
      }
      if ((await addField.getAttribute('aria-expanded', { timeout: 2_000 })) !== 'true') await addField.click();
      if ((await addField.inputValue()) !== 'Zed Nobody') await addField.fill('Zed Nobody');
      await page.getByRole('button', { name: /^\+ Add “Zed Nobody”/ }).waitFor({ timeout: 5_000 });
      await quiet(page);
    };
    await offerAdd();
    await page.getByRole('button', { name: /^\+ Add “Zed Nobody”/ }).click();
    await formRow.waitFor();
    await quiet(page);
    const phoneAt = await centreOf(page.getByRole('textbox', { name: 'New driver phone' }));
    const cancelAt = await centreOf(formRow.getByRole('button', { name: 'Cancel' }));
    const addAt = await centreOf(formRow.getByRole('button', { name: 'Add and assign' }));
    const plusAdd = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').startsWith('+ Add “Zed Nobody”'))!.click(),
      );
    const addControl = (name: string, zone: string, at: { x: number; y: number }, read: () => Promise<string>, landed: Control['landed']): Control => ({
      name,
      on: page,
      aim: 'asgAdd',
      zone,
      rounds: 8,
      ready: async () => {
        await offerAdd();
        return at;
      },
      start: plusAdd,
      waits: false,
      read,
      landed,
      held: true,
    });
    for (const control of [
      addControl('add form phone', 'input[aria-label="New driver phone"]', phoneAt, () => active(page), (_b, a) => a === 'New driver phone'),
      addControl('add form Cancel', 'li:has(input[aria-label="New driver name"]) div.flex > button:last-child', cancelAt, async () => String(await formRow.count()), (_b, a) => a === '0'),
      addControl('add form Add and assign', 'li:has(input[aria-label="New driver name"]) div.flex > button:first-child', addAt, async () => String(addRequests), (b, a) => Number(a) === Number(b) + 1),
    ]) {
      await run(control);
    }
    await offerAdd();
    await page.keyboard.press('Escape');

    // A drawn row: the board, then Assignments by its link, a change of page.
    await page.reload();
    await field(401).waitFor();
    await quiet(page);
    const rowFieldAt = await centreOf(field(401));
    await run({
      name: 'drawn Assignments row',
      on: page,
      aim: 'asgRows',
      zone: '[aria-label="Driver for truck 401"]',
      rounds: 4,
      ready: async () => {
        if (page.url().includes('/assignments')) {
          await page.getByRole('link', { name: 'Back to console' }).click();
          await page.locator('[data-row-id]').first().waitFor();
        }
        await quiet(page);
        return rowFieldAt;
      },
      start: async () => {
        await page.evaluate(() => document.querySelector<HTMLAnchorElement>('a[href="/assignments"]')!.click());
        await begun(page, 'asgRows');
      },
      waits: true,
      read: async () => (page.url().endsWith('/assignments') ? await expanded() : 'away'),
      landed: (_b, a) => a === 'true',
      held: true,
    });

    /* History. */
    await seedHistory();
    const rows = page.locator('main [data-driver-row]');
    await page.goto('/history?week=2026-W39');
    await rows.first().waitFor();
    await quiet(page);
    const firstLoad = page.locator('main [data-driver-row]').first().locator('[data-load]:not([data-load="no number"])').first();
    const firstNumber = (await firstLoad.getAttribute('data-load'))!;
    const firstAt = await centreOf(firstLoad);
    await run({
      name: 'drawn History row',
      on: page,
      aim: 'histRows',
      zone: `[data-load="${firstNumber}"]`,
      rounds: 4,
      ready: async () => {
        if (page.url().includes('/history')) {
          await page.locator('[data-board-link]').click();
          await page.locator('[data-row-id]').first().waitFor();
        }
        await quiet(page);
        return firstAt;
      },
      start: async () => {
        await toHistoryWeek(page, '2026-W39');
        await begun(page, 'histRows');
      },
      waits: true,
      read: () => active(page),
      landed: (_b, a) => a === firstNumber,
      held: true,
    });

    const andre = page.locator('main [data-driver-row="Andre Baptiste"]');
    const openWeek = async () => {
      await page.goto('/history?week=2026-W39');
      await andre.getByRole('button', { name: '+2 more' }).waitFor();
      await quiet(page);
    };
    await openWeek();
    const day = await andre
      .locator('[role="cell"]')
      .evaluateAll((cells) => cells.findIndex((c) => [...c.querySelectorAll('button')].some((b) => b.textContent === '+2 more')));
    expect(day).toBeGreaterThanOrEqual(0);
    const cell = andre.locator('[role="cell"]').nth(day);
    await cell.getByRole('button', { name: '+2 more' }).click();
    await quiet(page);
    const third = cell.locator('[data-load]').nth(2);
    const thirdNumber = (await third.getAttribute('data-load'))!;
    const thirdAt = await centreOf(third);
    await run({
      name: 'unfolded load',
      on: page,
      aim: 'histFold',
      zone: `[data-load="${thirdNumber}"]`,
      rounds: 8,
      ready: async () => {
        await openWeek();
        return thirdAt;
      },
      start: () =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLButtonElement>('main [data-driver-row="Andre Baptiste"] button')].find((b) => b.textContent === '+2 more')!.click(),
        ),
      waits: false,
      read: () => active(page),
      landed: (_b, a) => a === thirdNumber,
      held: true,
    });

    const table = tally.reduce<Record<string, { presses: number; misses: number; offTarget: number; mostMoved: number }>>((all, t) => {
      const key = `${t.control} at ${t.time}ms`;
      const row = (all[key] ??= { presses: 0, misses: 0, offTarget: 0, mostMoved: 0 });
      row.presses += 1;
      if (!t.ok) row.misses += 1;
      if (t.offControl) row.offTarget += 1;
      row.mostMoved = Math.max(row.mostMoved, Math.round(t.moved * 10) / 10);
      return all;
    }, {});
    const report = JSON.stringify({ rows: table, misses: tally.filter((t) => !t.ok) }, null, 1);
    await info.attach('pages-press-table', { body: report, contentType: 'application/json' });
    process.stdout.write(`PAGES PRESS TABLE\n${report}\nEND PAGES PRESS TABLE\n`);

    expect(tally).toHaveLength(TIMES.length * (8 * 3 + 8 + 8 * 3 + 4 + 4 + 8));
    expect(tally.filter((t) => !t.ok)).toEqual([]);
    expect(tally.filter((t) => t.offControl)).toEqual([]);
    // What a press holds does not move under it; a hovered button's 1px lift may drop as it is pressed.
    expect(tally.filter((t) => t.held && t.moved > 1.01)).toEqual([]);
  });
});
