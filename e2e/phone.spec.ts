import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { IDS, connect, resetWorld } from './fixtures';

/**
 * §12.96 — the phone view's checks, written BEFORE the phone view exists.
 *
 * Each check runs at every size below. A check the current app cannot pass
 * is listed in `NOT_YET` and marked as an expected failure (`test.fail`):
 * the suite stays green, and the moment a stage makes one pass, Playwright
 * reports it as unexpectedly passing until its line is deleted here. So the
 * list shrinks stage by stage and cannot quietly fall out of date.
 *
 * `PHONE_REPORT=1` runs every check unmarked, to see why each one fails.
 *
 * The checks name the phone view's contract — the `data-*` hooks the stages
 * build to: `data-phone-topbar`, `data-phone-feed`, `data-phone-account`,
 * `data-phone-search`, `data-count-tile`, `data-phone-more`,
 * `data-phone-tab`, `data-phone-card` / `data-card-field`,
 * `data-truck-sheet` / `data-sheet-field`, `data-updating`,
 * `data-marker-key-toggle`.
 */

const SIZES = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x640', width: 360, height: 640 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '667x375', width: 667, height: 375 },
] as const;

/** Ana (truck 101) has a dialable number; Marko (102) has none. */
const ANA_PHONE = '3125550101';

/** The checks the current app cannot pass, and the stage that makes them pass. */
const NOT_YET: Record<string, string> = {
  'every control used is at least 44px': 'stages 1–3',
  'feed down is visible, its sentence whole': 'stage 1 (top bar) and 4 (banner)',
  'every row field is readable without sideways scrolling': 'stage 2',
  'the map mounts once across List/Map switches': 'stage 2',
  'the truck sheet fits and calls only a dialable number': 'stage 3',
  'the marker key is folded behind a button': 'stage 3',
  'the timeline fits the screen width': 'stage 3',
  'the scope menu fits the screen': 'stage 4',
  'no text under 12px': 'stage 4',
};

async function seed(options: { feedDown?: boolean } = {}): Promise<void> {
  // 101 and 102 late (appointment 2 h gone, drivers), 103 unassigned, 12 more.
  await resetWorld({
    extraTrucks: 12,
    appointmentUtc: new Date(Date.now() - 2 * 3_600_000),
  });
  const sql = connect();
  try {
    await sql`update drivers set phone = ${ANA_PHONE} where id = ${IDS.driverAna}`;
    if (options.feedDown) {
      const at = new Date(Date.now() - 25 * 60_000);
      await sql`update feed_health set newest_position_at = ${at}, last_success_at = ${at}`;
    }
  } finally {
    await sql.end();
  }
}

async function onPhone(
  browser: Browser,
  size: (typeof SIZES)[number],
  options: { signedIn?: boolean; tourSeen?: boolean } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: true,
    hasTouch: true,
    ...(options.signedIn === false ? {} : { storageState: 'e2e/.auth/dispatcher.json' }),
  });
  // The shared signed-in state already says the tour was seen; a first
  // visit has to take that away before the page reads it.
  await context.addInitScript((seen) => {
    try {
      if (seen) localStorage.setItem('ft.tour.seen', '1');
      else localStorage.removeItem('ft.tour.seen');
    } catch {
      // No storage: the tour check will say so.
    }
  }, options.tourSeen !== false);
  return { context, page: await context.newPage() };
}

async function board(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  // Both are in the page from stage 1 on; the one CSS shows is the one to wait for.
  await page
    .locator('[data-console-header]:visible, [data-phone-topbar]:visible')
    .first()
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
}

/**
 * Interactive controls a person can see. Mapbox's OWN logo and attribution
 * control are skipped; the product's credits are our footer, not theirs.
 *
 * Measured against the PHONE's width, never `window.innerWidth`: with mobile
 * emulation Chrome widens the layout to fit content that overflows, and then
 * the page's own width reports that everything fits.
 */
async function controls(page: Page, vw: number) {
  return page.evaluate((vw) => {
    return [
      ...document.querySelectorAll('button, a[href], input, select, [role="menuitem"]'),
    ]
      .filter((el) => {
        if (el.closest('.mapboxgl-ctrl-attrib, .mapboxgl-ctrl-logo')) return false;
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return (
          box.width > 0 &&
          box.height > 0 &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        );
      })
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          name: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName)
            .trim()
            .slice(0, 30),
          w: Math.round(box.width),
          h: Math.round(box.height),
          cut: box.left < -0.5 || box.right > vw + 0.5,
          credit: el.closest('[data-testid="map-credits"]') !== null,
        };
      });
  }, vw);
}

const within = async (page: Page, selector: string, vw: number, vh: number) =>
  page
    .locator(selector)
    .first()
    .evaluate(
      (el, [vw, vh]) => {
        const b = el.getBoundingClientRect();
        return (
          b.width > 0 &&
          b.left >= -0.5 &&
          b.right <= vw! + 0.5 &&
          b.top >= -0.5 &&
          b.bottom <= vh! + 0.5
        );
      },
      [vw, vh],
    );

async function check(
  title: string,
  body: (page: Page, size: (typeof SIZES)[number], browser: Browser) => Promise<void>,
  options: {
    signedIn?: boolean;
    tourSeen?: boolean;
    feedDown?: boolean;
    sizes?: readonly (typeof SIZES)[number][];
  } = {},
) {
  test(title, async ({ browser }) => {
    test.fail(!process.env['PHONE_REPORT'] && title in NOT_YET, NOT_YET[title]);
    test.setTimeout(240_000);
    await seed({ feedDown: options.feedDown ?? false });
    for (const size of options.sizes ?? SIZES) {
      const { context, page } = await onPhone(browser, size, options);
      try {
        await test.step(size.name, () => body(page, size, browser));
      } finally {
        await context.close();
      }
    }
  });
}

/* --------------------------------- checks --------------------------------- */

check('no control is cut off by the screen edge', async (page, size) => {
  await board(page);
  const cut = (await controls(page, size.width)).filter((c) => c.cut).map((c) => c.name);
  expect.soft(cut, `${size.name}: controls past the screen edge`).toEqual([]);
});

/**
 * The map footer's credit links (`map-credits`) are the one exemption: text
 * links the Mapbox terms require, not controls anyone uses to check the board.
 * Their TEXT is held to 12px like everything else we draw (below).
 */
check('every control used is at least 44px', async (page, size) => {
  await board(page);
  const small = (await controls(page, size.width))
    .filter((c) => !c.credit && (c.h < 44 || c.w < 44))
    .map((c) => `${c.name} ${c.w}x${c.h}`);
  expect.soft(small, `${size.name}: controls under 44px`).toEqual([]);
});

check('Late and At risk tiles are visible without scrolling', async (page, size) => {
  await board(page);
  for (const tile of ['late', 'risk']) {
    const selector = `[data-count-tile="${tile}"]`;
    await expect
      .soft(page.locator(selector), `${size.name}: ${tile} tile`)
      .toBeVisible({ timeout: 3_000 });
    if ((await page.locator(selector).count()) > 0) {
      expect
        .soft(
          await within(page, selector, size.width, size.height),
          `${size.name}: ${tile} tile on screen`,
        )
        .toBe(true);
      await expect.soft(page.locator(selector)).toContainText(/\d/);
    }
  }
});

/** The list, by the phone's tab or, before it exists, today's toggle. */
async function toList(page: Page): Promise<void> {
  const tab = page.locator('[data-phone-tab="list"]');
  if ((await tab.count()) > 0) {
    await tab.tap();
    return;
  }
  const toggle = page.getByRole('button', { name: /^(Show|Hide) map$/ });
  if ((await toggle.count()) > 0 && /Hide map/.test((await toggle.textContent()) ?? '')) {
    await toggle.tap();
  }
  await page.locator('[data-row-id], [data-phone-card]').first().waitFor();
}

check('the Today strip and density are off the first screen', async (page, size) => {
  await board(page);
  await toList(page);
  await expect
    .soft(page.getByText('Today', { exact: true }), `${size.name}: Today strip`)
    .toBeHidden({ timeout: 2_000 });
  await expect
    .soft(page.getByRole('button', { name: 'Comfortable' }), `${size.name}: density`)
    .toBeHidden({ timeout: 2_000 });
});

check('search opens a full-width field from the top bar', async (page, size) => {
  await board(page);
  await page.locator('[data-phone-search]').tap({ timeout: 3_000 });
  const field = page.locator(
    '[data-phone-topbar] input[type="search"], [data-phone-topbar] input',
  );
  await expect(field).toBeVisible();
  const box = (await field.boundingBox())!;
  expect
    .soft(box.width, `${size.name}: search width`)
    .toBeGreaterThanOrEqual(size.width - 32);
});

check(
  'the tour does not open on a phone',
  async (page, size) => {
    await board(page);
    await expect
      .soft(page.getByText(/1 of 6/i), `${size.name}: tour`)
      .toHaveCount(0, { timeout: 2_000 });
  },
  { tourSeen: false },
);

check(
  'the login card fits the screen',
  async (page, size) => {
    await page.goto('/login');
    await page.getByLabel('Work email').waitFor();
    // The <form> IS the card.
    const fits = await page
      .locator('form')
      .first()
      .evaluate((card, vw) => {
        const box = card.getBoundingClientRect();
        return box.left >= 0 && box.right <= vw;
      }, size.width);
    expect.soft(fits, `${size.name}: login card inside the screen`).toBe(true);
  },
  { signedIn: false },
);

check(
  'feed down is visible, its sentence whole',
  async (page, size) => {
    await board(page);
    await expect
      .soft(page.locator('[data-phone-feed]'), `${size.name}: top-bar feed state`)
      .toContainText(/Feed down/, { timeout: 3_000 });
    const sentence = page
      .getByRole('alert')
      .filter({ hasText: 'Position feed' })
      .locator('p');
    const whole = await sentence.evaluate(
      (p, vw) =>
        p.scrollWidth <= p.clientWidth + 1 && p.getBoundingClientRect().right <= vw,
      size.width,
    );
    expect.soft(whole, `${size.name}: banner sentence whole`).toBe(true);
  },
  { feedDown: true },
);

check(
  'returning from the background refetches and says Updating…',
  async (page) => {
    await page.clock.install();
    await board(page);
    // Hidden for over a minute, then back — the event the way a browser sends it.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await page.clock.fastForward(61_000);
    // Hold the refetch so "Updating…" is observable while it is in flight.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let refetched = false;
    await page.route('**/api/fleet**', async (route) => {
      refetched = true;
      await held;
      await route.continue();
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await expect(page.locator('[data-phone-topbar] [data-updating]')).toBeVisible({
      timeout: 3_000,
    });
    // While it updates, no "Ns ago" for data over a minute old.
    await expect(page.locator('[data-phone-feed]')).not.toContainText(/\d+s ago/);
    expect(refetched).toBe(true);
    release();
    await expect(page.locator('[data-phone-topbar] [data-updating]')).toHaveCount(0, {
      timeout: 10_000,
    });
  },
  { sizes: [SIZES[3]] },
);

check('every row field is readable without sideways scrolling', async (page, size) => {
  await board(page);
  await page.locator('[data-phone-tab="list"]').tap({ timeout: 3_000 });
  const card = page.locator(`[data-phone-card="${IDS.truckChicago}"]`);
  await expect(card).toBeVisible();
  for (const field of ['truck', 'status', 'driver', 'city', 'time']) {
    const cell = card.locator(`[data-card-field="${field}"]`);
    await expect.soft(cell, `${size.name}: ${field}`).toBeVisible();
    const whole = await cell.evaluate(
      (el, vw) =>
        el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= vw,
      size.width,
    );
    expect.soft(whole, `${size.name}: ${field} readable whole`).toBe(true);
  }
  const sideways = await card.evaluate((el) => {
    let node: Element | null = el;
    while (node && node !== document.body) {
      if (
        (node as HTMLElement).scrollWidth > (node as HTMLElement).clientWidth + 1 &&
        getComputedStyle(node).overflowX !== 'visible'
      )
        return true;
      node = node.parentElement;
    }
    return false;
  });
  expect.soft(sideways, `${size.name}: list scrolls sideways`).toBe(false);
});

check('the map mounts once across List/Map switches', async (page, size) => {
  await board(page);
  await page.locator('[data-phone-tab="map"]').tap({ timeout: 3_000 });
  await page.locator('canvas.mapboxgl-canvas').waitFor();
  await page.evaluate(() => {
    (
      document.querySelector('canvas.mapboxgl-canvas') as HTMLCanvasElement & {
        __first?: boolean;
      }
    ).__first = true;
  });
  await page.locator('[data-phone-tab="list"]').tap();
  await page.locator('[data-phone-tab="map"]').tap();
  const same = await page.evaluate(
    () =>
      (
        document.querySelector('canvas.mapboxgl-canvas') as
          (HTMLCanvasElement & { __first?: boolean }) | null
      )?.__first === true,
  );
  expect.soft(same, `${size.name}: the same map, not a new one`).toBe(true);
});

check('the truck sheet fits and calls only a dialable number', async (page, size) => {
  await board(page);
  await page.locator(`[data-phone-card="${IDS.truckChicago}"]`).tap({ timeout: 3_000 });
  const sheet = page.locator('[data-truck-sheet]');
  await expect(sheet).toBeVisible();
  expect
    .soft(
      await within(page, '[data-truck-sheet]', size.width, size.height),
      `${size.name}: sheet fits`,
    )
    .toBe(true);
  for (const field of [
    'status',
    'next-stop',
    'appointment',
    'eta',
    'position',
    'gps-age',
    'load',
  ]) {
    await expect
      .soft(sheet.locator(`[data-sheet-field="${field}"]`), `${size.name}: ${field}`)
      .toBeVisible();
  }
  await expect
    .soft(sheet.locator('a[href^="tel:"]'))
    .toHaveAttribute('href', `tel:+1${ANA_PHONE}`);
  await expect.soft(sheet.locator('a[href^="sms:"]')).toHaveCount(0, { timeout: 2_000 });
  // Marko has no number: no call link at all.
  await page.locator(`[data-phone-card="${IDS.truckDallas}"]`).tap();
  await expect
    .soft(page.locator('[data-truck-sheet] a[href^="tel:"]'))
    .toHaveCount(0, { timeout: 2_000 });
});

check('the marker key is folded behind a button', async (page, size) => {
  await board(page);
  await page.locator('[data-phone-tab="map"]').tap({ timeout: 3_000 });
  await expect
    .soft(page.getByText('Marker key'), `${size.name}: key folded`)
    .toBeHidden({ timeout: 2_000 });
  await page.locator('[data-marker-key-toggle]').tap();
  await expect.soft(page.getByText('Marker key')).toBeVisible();
});

check('the timeline fits the screen width', async (page, size) => {
  await board(page);
  await page.locator(`[data-phone-card="${IDS.truckChicago}"]`).tap({ timeout: 3_000 });
  await page
    .locator('[data-truck-sheet]')
    .getByRole('button', { name: 'Timeline' })
    .tap();
  const panel = page
    .getByRole('dialog', { name: /Timeline for truck 101/ })
    .locator(':scope > div');
  const fits = await panel.evaluate((el, vw) => {
    const b = el.getBoundingClientRect();
    return b.left >= 0 && b.right <= vw;
  }, size.width);
  expect.soft(fits, `${size.name}: timeline inside the screen`).toBe(true);
});

check('the scope menu fits the screen', async (page, size) => {
  await board(page);
  await page
    .getByRole('button', { name: /^Scope/ })
    .first()
    .tap();
  const menu = page.getByRole('menu', { name: 'Lists and views' });
  await expect(menu).toBeVisible();
  const fits = await menu.evaluate(
    (el, [vw, vh]) => {
      const b = el.getBoundingClientRect();
      return b.left >= 0 && b.right <= vw! && b.bottom <= vh!;
    },
    [size.width, size.height],
  );
  expect.soft(fits, `${size.name}: scope menu inside the screen`).toBe(true);
});

check('no text under 12px', async (page, size) => {
  await board(page);
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent ?? '').trim();
      const el = node.parentElement;
      // Mapbox's own controls only: the credits footer is ours, and held to 12px.
      if (
        !text ||
        !el ||
        el.closest('.mapboxgl-ctrl-attrib, .mapboxgl-ctrl-logo, .sr-only')
      )
        continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 12) out.push(`${px}px "${text.slice(0, 20)}"`);
    }
    return [...new Set(out)];
  });
  expect.soft(small, `${size.name}: text under 12px`).toEqual([]);
});

/* -------------------- already true, and must stay true -------------------- */

check('editing stays hidden', async (page, size) => {
  await board(page);
  await expect
    .soft(page.getByRole('button', { name: 'Edit load' }), size.name)
    .toHaveCount(0, { timeout: 2_000 });
  await expect
    .soft(page.locator('[data-clear-stop]'), size.name)
    .toHaveCount(0, { timeout: 2_000 });
  await expect
    .soft(page.locator('[role="dialog"][aria-label^="Edit stop"]'), size.name)
    .toHaveCount(0, { timeout: 2_000 });
});

/**
 * Search, and every other phone piece, must not add keyboard handling: the
 * page's keydown listeners on a phone are exactly the desktop's.
 */
test('the phone view adds no keyboard listeners', async ({ browser }) => {
  await seed();
  const count = async (width: number, height: number, mobile: boolean) => {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: mobile,
      hasTouch: mobile,
      storageState: 'e2e/.auth/dispatcher.json',
    });
    await context.addInitScript(() => {
      try {
        localStorage.setItem('ft.tour.seen', '1');
      } catch {
        // See above.
      }
    });
    const page = await context.newPage();
    await board(page);
    const cdp = await context.newCDPSession(page);
    const listeners = async (expression: string) => {
      const { result } = await cdp.send('Runtime.evaluate', { expression });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {
        objectId: result.objectId!,
      });
      return listeners.filter((l) => l.type === 'keydown').length;
    };
    const total = (await listeners('window')) + (await listeners('document'));
    await context.close();
    return total;
  };
  expect(await count(390, 844, true)).toBe(await count(1280, 800, false));
});
