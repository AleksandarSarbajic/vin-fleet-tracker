import type { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * The phone view's measuring tools, shared by the board's phone checks
 * (`phone.spec.ts`, §12.96) and the driver history page's (`history-phone.spec.ts`,
 * §12.102), so both are held to the same rules by the same code. Moved here
 * unchanged from `phone.spec.ts`.
 */

export const SIZES = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x640', width: 360, height: 640 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '667x375', width: 667, height: 375 },
] as const;

export async function onPhone(
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

/**
 * Interactive controls a person can see. Mapbox's OWN logo and attribution
 * control are skipped; the product's credits are our footer, not theirs.
 *
 * Measured against the PHONE's width, never `window.innerWidth`: with mobile
 * emulation Chrome widens the layout to fit content that overflows, and then
 * the page's own width reports that everything fits.
 */
export async function controls(page: Page, vw: number) {
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

export const within = async (page: Page, selector: string, vw: number, vh: number) =>
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

export async function smallText(page: Page): Promise<string[]> {
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

