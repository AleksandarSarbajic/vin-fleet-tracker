import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { IDS, connect, resetWorld } from './fixtures';
import { maskPhone } from '../src/lib/dial';

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
  // Empty since stage 4: every check passes at every size.
};

/** The shared list `seed` makes: "Bob's trucks", trucks 200–211. */
let bobsList = '';

async function seed(options: { feedDown?: boolean } = {}): Promise<void> {
  // 101 and 102 late (appointment 2 h gone, drivers), 103 unassigned, 12 more.
  await resetWorld({
    extraTrucks: 12,
    appointmentUtc: new Date(Date.now() - 2 * 3_600_000),
  });
  const sql = connect();
  try {
    await sql`update drivers set phone = ${ANA_PHONE} where id = ${IDS.driverAna}`;
    const [list] = await sql<{ id: string }[]>`
      insert into truck_lists (name) values (${"Bob's trucks"}) returning id`;
    await sql`insert into truck_list_members (list_id, truck_id)
              select ${list!.id}, id from trucks where truck_number between 200 and 211`;
    bobsList = list!.id;
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
  // Both tabs: the list first, as the board opens, then the map.
  for (const tab of ['list', 'map'] as const) {
    if (tab === 'map') await page.locator('[data-phone-tab="map"]').tap();
    const cut = (await controls(page, size.width))
      .filter((c) => c.cut)
      .map((c) => c.name);
    expect
      .soft(cut, `${size.name}, ${tab} tab: controls past the screen edge`)
      .toEqual([]);
  }
});

/**
 * The map footer's credit links (`map-credits`) are the one exemption: text
 * links the Mapbox terms require, not controls anyone uses to check the board.
 * Their TEXT is held to 12px like everything else we draw (below).
 *
 * Split by tab in stage 2: the board opens on the List tab, where the hidden
 * map's controls have no size and are not measured at all. The Map tab's
 * controls (zoom, style, the marker key) are stage 3's.
 */
const under44 = async (page: Page, vw: number) =>
  (await controls(page, vw))
    .filter((c) => !c.credit && (c.h < 44 || c.w < 44))
    .map((c) => `${c.name} ${c.w}x${c.h}`);

check('every control on the List tab is at least 44px', async (page, size) => {
  await board(page);
  await expect(page.locator('[data-phone-tab="list"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect
    .soft(await under44(page, size.width), `${size.name}: controls under 44px`)
    .toEqual([]);
});

check('every control on the Map tab is at least 44px', async (page, size) => {
  await board(page);
  await page.locator('[data-phone-tab="map"]').tap({ timeout: 3_000 });
  await page.locator('canvas.mapboxgl-canvas').waitFor();
  expect
    .soft(await under44(page, size.width), `${size.name}: controls under 44px`)
    .toEqual([]);
});

/** §12.96, stage 2: "Bob's trucks" whole in the scope button, at 320 too. */
check("a list's name reads whole in the scope button", async (page, size) => {
  await board(page, `/?list=${bobsList}`);
  const name = page.locator('[data-phone-scope-name]');
  await expect(name).toHaveText("Bob's trucks");
  const whole = await name.evaluate(
    (el, vw) =>
      el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= vw,
    size.width,
  );
  expect.soft(whole, `${size.name}: the list's name is cut`).toBe(true);
});

/**
 * §12.96, stage 2. On its side a phone is 375px tall: the top bar, the feed
 * and the tiles (with the List | Map tabs) take about a third of it at most.
 */
check(
  'on its side, the top bar and tiles take a third of the height at most',
  async (page, size) => {
    await board(page);
    const bottom = await page
      .locator('[data-phone-tiles]')
      .evaluate((el) => el.getBoundingClientRect().bottom);
    expect
      .soft(bottom, `${size.name}: bottom edge of the bar and tiles`)
      .toBeLessThanOrEqual(Math.ceil(size.height / 3) + 2);
    await expect(page.locator('[data-phone-feed]')).toBeVisible();
  },
  { sizes: [SIZES[5]] },
);

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
    expect
      .soft(await smallText(page), `${size.name}: text under 12px on the login card`)
      .toEqual([]);
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
    const banner = page.getByRole('alert').filter({ hasText: 'Position feed' });
    const sentence = banner.locator('p');
    const whole = await sentence.evaluate(
      (p, vw) =>
        p.scrollWidth <= p.clientWidth + 1 &&
        p.scrollHeight <= p.clientHeight + 1 &&
        p.getBoundingClientRect().right <= vw,
      size.width,
    );
    expect.soft(whole, `${size.name}: banner sentence whole`).toBe(true);
    // The clause that is the point of the banner, on screen.
    await expect.soft(sentence).toContainText('do not quote an ETA from this screen');
    expect
      .soft(
        await within(page, '[role="alert"] p', size.width, size.height),
        `${size.name}: sentence on screen`,
      )
      .toBe(true);
    const retry = banner.getByRole('button', { name: /Retry now|Retrying/ });
    const box = (await retry.boundingBox())!;
    expect
      .soft(Math.round(box.height), `${size.name}: Retry now height`)
      .toBeGreaterThanOrEqual(44);
    expect
      .soft(box.x + box.width, `${size.name}: Retry now on screen`)
      .toBeLessThanOrEqual(size.width);
    expect
      .soft(await smallText(page), `${size.name}: text under 12px with the banner up`)
      .toEqual([]);
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
  // Nothing cut: the facts scroll inside the sheet, never sideways.
  const sideways = await sheet.evaluate((el) =>
    [el, ...el.querySelectorAll('*')].some(
      (n) =>
        (n as HTMLElement).scrollWidth > (n as HTMLElement).clientWidth + 1 &&
        getComputedStyle(n).overflowX !== 'visible',
    ),
  );
  expect.soft(sideways, `${size.name}: the sheet scrolls sideways`).toBe(false);
  const close = sheet.getByRole('button', { name: 'Close' });
  expect
    .soft(Math.round((await close.boundingBox())!.height), `${size.name}: Close height`)
    .toBeGreaterThanOrEqual(44);
  for (const field of [
    'status',
    'next-stop',
    'appointment',
    'eta',
    'position',
    'speed',
    'gps-age',
    'load',
    'driver',
  ]) {
    await expect
      .soft(sheet.locator(`[data-sheet-field="${field}"]`), `${size.name}: ${field}`)
      .toBeVisible();
  }
  await expect
    .soft(sheet.locator('[data-sheet-field="eta"]'))
    .toContainText(/routed|straight-line estimate|estimated from last route/);
  await expect
    .soft(sheet.locator('[data-desktop-only]'))
    .toHaveText('Editing is on the desktop console');
  // Ana's number dials. Compared, never printed: a failure names the last
  // three digits only.
  const call = sheet.locator('a[href^="tel:"]');
  await expect.soft(call, `${size.name}: Call driver`).toHaveCount(1);
  const href = (await call.getAttribute('href')) ?? '';
  expect
    .soft(
      href === `tel:+1${ANA_PHONE}`,
      `${size.name}: calls tel:+1${maskPhone(ANA_PHONE)}`,
    )
    .toBe(true);
  expect
    .soft(Math.round((await call.boundingBox())!.height), `${size.name}: Call height`)
    .toBeGreaterThanOrEqual(44);
  await expect.soft(page.locator('a[href^="sms:"]')).toHaveCount(0);
  // Marko has no number: no call link at all.
  await close.tap();
  // Gone before the next tap. A second touch 50ms after the first cancels
  // the first one's click in Chrome — no hand taps twice that fast — and
  // at 320 the sheet covers the card, so the tap landed on the sheet.
  await expect(page.locator('[data-truck-sheet]')).toHaveCount(0);
  await page.locator(`[data-phone-card="${IDS.truckDallas}"]`).tap();
  await expect(page.locator('[data-truck-sheet]')).toHaveAttribute(
    'aria-label',
    'Truck 102',
  );
  await expect.soft(page.locator('[data-truck-sheet] a[href^="tel:"]')).toHaveCount(0);
});

/**
 * A marker's tap opens the sheet too. "Show on map" pans the map to the truck,
 * so its marker is then the canvas's centre (on a phone the popup is not drawn,
 * so nothing nudges the map off it). Dallas, alone on the map.
 */
check('a marker tap opens the truck sheet', async (page, size) => {
  await board(page);
  await page.locator(`[data-phone-card="${IDS.truckDallas}"]`).tap({ timeout: 3_000 });
  await page
    .locator('[data-truck-sheet]')
    .getByRole('button', { name: 'Show on map' })
    .tap();
  await expect(page.locator('[data-truck-sheet]')).toHaveCount(0);
  await expect(page.locator('[data-phone-tab="map"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const canvas = page.locator('canvas.mapboxgl-canvas');
  await expect(async () => {
    const box = (await canvas.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('[data-truck-sheet]')).toHaveAttribute(
      'aria-label',
      'Truck 102',
      {
        timeout: 1_000,
      },
    );
  }, `${size.name}: the marker opens the sheet`).toPass({ timeout: 10_000 });
  // The map's own controls stand aside while it is open.
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeHidden();
});

check('the marker key is folded behind a button', async (page, size) => {
  await board(page);
  await page.locator('[data-phone-tab="map"]').tap({ timeout: 3_000 });
  await expect
    .soft(page.getByText('Marker key'), `${size.name}: key folded`)
    .toBeHidden({ timeout: 2_000 });
  await page.locator('[data-marker-key-toggle]').tap({ timeout: 3_000 });
  await expect.soft(page.getByText('Marker key')).toBeVisible();
  // Open, it covers neither the zoom nor the style buttons.
  const rect = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => {
        const b = el.getBoundingClientRect();
        return { l: b.left, r: b.right, t: b.top, b: b.bottom };
      });
  const key = await rect('[data-marker-key-panel]');
  for (const [name, sel] of [
    ['zoom', '[data-map-control]:has(> button[aria-label="Zoom in"])'],
    ['style', '[role="group"][aria-label="Basemap"]'],
  ] as const) {
    const other = await rect(sel);
    const overlaps =
      key.l < other.r && key.r > other.l && key.t < other.b && key.b > other.t;
    expect
      .soft(overlaps, `${size.name}: the open key covers the ${name} buttons`)
      .toBe(false);
  }
  // A tap anywhere on the map folds it — here its empty top-left corner.
  const canvas = (await page.locator('canvas.mapboxgl-canvas').boundingBox())!;
  await page.touchscreen.tap(canvas.x + 24, canvas.y + 24);
  await expect
    .soft(page.getByText('Marker key'), `${size.name}: folded by a map tap`)
    .toBeHidden({ timeout: 3_000 });
});

check('the timeline fits the screen width', async (page, size) => {
  await board(page);
  await page.locator(`[data-phone-card="${IDS.truckChicago}"]`).tap({ timeout: 3_000 });
  await page
    .locator('[data-truck-sheet]')
    .getByRole('button', { name: 'Timeline' })
    .tap({ timeout: 3_000 });
  const panel = page
    .getByRole('dialog', { name: /Timeline for truck 101/ })
    .locator(':scope > div');
  const fits = await panel.evaluate((el, vw) => {
    const b = el.getBoundingClientRect();
    return b.left >= 0 && b.right <= vw;
  }, size.width);
  expect.soft(fits, `${size.name}: timeline inside the screen`).toBe(true);
  const sideways = await panel.evaluate((el) =>
    [el, ...el.querySelectorAll('*')].some(
      (n) =>
        (n as HTMLElement).scrollWidth > (n as HTMLElement).clientWidth + 1 &&
        getComputedStyle(n).overflowX !== 'visible',
    ),
  );
  expect.soft(sideways, `${size.name}: the timeline scrolls sideways`).toBe(false);
});

check('the scope menu fits the screen', async (page, size) => {
  // With a shared list, so the lists section is in the menu too.
  await board(page, `/?list=${bobsList}`);
  await page
    .locator('[data-phone-topbar]')
    .getByRole('button', { name: /^Scope/ })
    .tap();
  const menu = page.getByRole('menu', { name: 'Lists and views' });
  await expect(menu).toBeVisible();
  const fits = await menu.evaluate(
    (el, [vw, vh]) => {
      const b = el.getBoundingClientRect();
      return b.left >= 0 && b.right <= vw! && b.top >= 0 && b.bottom <= vh!;
    },
    [size.width, size.height],
  );
  expect.soft(fits, `${size.name}: scope menu inside the screen`).toBe(true);
  // Nothing in it clipped, "Save current view…" least of all.
  const save = menu.getByRole('menuitem', { name: /Save current view|already saved/ });
  await save.scrollIntoViewIfNeeded();
  const whole = await save.evaluate(
    (el, vw) =>
      el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= vw,
    size.width,
  );
  expect.soft(whole, `${size.name}: "Save current view…" whole`).toBe(true);
  const sideways = await menu.evaluate((el) =>
    [...el.querySelectorAll('*')].some(
      (n) =>
        (n as HTMLElement).scrollWidth > (n as HTMLElement).clientWidth + 1 &&
        getComputedStyle(n).overflowX !== 'visible',
    ),
  );
  expect
    .soft(sideways, `${size.name}: something in the menu scrolls sideways`)
    .toBe(false);
  // Every item a finger can hit.
  const small = await menu.evaluate((el) =>
    [...el.querySelectorAll('button, [role="menuitem"], input')]
      .map((n) => ({
        name: (n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 24),
        h: Math.round(n.getBoundingClientRect().height),
      }))
      .filter((c) => c.h > 0 && c.h < 44)
      .map((c) => `${c.name} ${c.h}px`),
  );
  expect.soft(small, `${size.name}: menu items under 44px`).toEqual([]);
});

/**
 * Text under 12px, on every phone state, not only the first screen. Mapbox's
 * own logo and attribution control are exempt (not ours to resize); the
 * credits footer is ours and is measured. Screen-reader-only text is not
 * drawn. A state's offenders are named with the state.
 */
async function smallText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent ?? '').trim();
      const el = node.parentElement;
      if (
        !text ||
        !el ||
        el.closest('.mapboxgl-ctrl-attrib, .mapboxgl-ctrl-logo, .sr-only')
      )
        continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 12) out.push(`${px}px "${text.slice(0, 24)}"`);
    }
    return [...new Set(out)];
  });
}

check('no text under 12px', async (page, size) => {
  const offenders: string[] = [];
  const measure = async (state: string) => {
    for (const o of await smallText(page)) offenders.push(`${state}: ${o}`);
  };
  await board(page);
  await measure('list');

  await page.locator('[data-phone-more]').tap();
  await measure('More sheet');
  await page.getByRole('button', { name: 'Done' }).tap();

  await page
    .locator('[data-phone-topbar]')
    .getByRole('button', { name: /^Scope/ })
    .tap();
  await measure('scope menu');
  await page
    .locator('[data-phone-topbar]')
    .getByRole('button', { name: /^Scope/ })
    .tap();

  await page.locator('[data-phone-account]').tap();
  await measure('account menu');
  await page.locator('[data-phone-account]').tap();

  await page.locator('[data-phone-search]').tap();
  await page.locator('[data-phone-topbar] input').fill('chi');
  await measure('search');
  await page.getByRole('button', { name: 'Close search' }).tap();

  await page.locator('[data-phone-tab="map"]').tap();
  await page.locator('canvas.mapboxgl-canvas').waitFor();
  await page.locator('[data-marker-key-toggle]').tap();
  await measure('map, key open');
  await page.locator('[data-marker-key-toggle]').tap();

  await page.locator('[data-phone-tab="list"]').tap();
  await page.locator(`[data-phone-card="${IDS.truckChicago}"]`).tap();
  await measure('truck sheet');
  await page
    .locator('[data-truck-sheet]')
    .getByRole('button', { name: 'Timeline' })
    .tap();
  await page.getByRole('dialog', { name: /Timeline for truck 101/ }).waitFor();
  await page.waitForTimeout(400);
  await measure('timeline');

  expect.soft(offenders, `${size.name}: text under 12px`).toEqual([]);
});

/**
 * §12.96, stage 4. A truck going late raises a toast. On a phone it sits in
 * the pane under the tiles — never over the top bar or the tiles — inside the
 * screen, below the truck sheet when one is open, and clears with a 44px tap.
 */
check('a toast stays under the tiles and clears with a 44px tap', async (page, size) => {
  const sql = connect();
  try {
    // 101 upcoming at first load, then late at the next fetch: one crossing.
    await sql`update stops set appointment_start_utc = ${new Date(Date.now() + 26 * 3_600_000)}
              where id = ${IDS.stopChicago}`;
    await board(page);
    await page.locator(`[data-phone-card="${IDS.truckDallas}"]`).tap();
    await sql`update stops set appointment_start_utc = ${new Date(Date.now() - 2 * 3_600_000)}
              where id = ${IDS.stopChicago}`;
  } finally {
    await sql.end();
  }
  // Fetch now rather than in 20s: the return-from-background refetch.
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible'] as const) {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => state,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    }
  });
  const toast = page.locator('[data-toast]');
  await expect(toast, `${size.name}: a toast`).toBeVisible({ timeout: 10_000 });

  // The sheet stays above it: its buttons take the tap, not the toast.
  for (const name of ['Close', 'Timeline', 'Show on map']) {
    const b = (await page
      .locator('[data-truck-sheet]')
      .getByRole('button', { name })
      .boundingBox())!;
    const onTop = await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('[data-truck-sheet]'),
      [b.x + b.width / 2, b.y + b.height / 2],
    );
    expect.soft(onTop, `${size.name}: the toast covers the sheet's ${name}`).toBe(true);
  }
  await page.locator('[data-truck-sheet]').getByRole('button', { name: 'Close' }).tap();

  const tilesBottom = await page
    .locator('[data-phone-tiles]')
    .evaluate((el) => el.getBoundingClientRect().bottom);
  const box = (await toast.boundingBox())!;
  expect
    .soft(box.y, `${size.name}: toast under the tiles`)
    .toBeGreaterThanOrEqual(tilesBottom);
  expect
    .soft(
      box.x >= 0 && box.x + box.width <= size.width,
      `${size.name}: toast inside the screen`,
    )
    .toBe(true);
  for (const name of [/^Open$/, /^Dismiss/]) {
    const h = Math.round(
      (await toast.getByRole('button', { name }).boundingBox())!.height,
    );
    expect.soft(h, `${size.name}: ${name} height`).toBeGreaterThanOrEqual(44);
  }
  expect
    .soft(await smallText(page), `${size.name}: text under 12px with a toast`)
    .toEqual([]);
  await toast.getByRole('button', { name: /^Dismiss/ }).tap();
  await expect(toast, `${size.name}: dismissed`).toHaveCount(0, { timeout: 3_000 });
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
