import { expect, test, type Page } from '@playwright/test';
import { makeFeedStale, resetWorld } from './fixtures';

/**
 * The feed banner's "auto-retry in Ns" counts 20 → 0 between polls. It used
 * to size itself to its text, so every time it crossed 10 the one-digit
 * number was narrower and "Retry now" beside it jumped sideways — in front of
 * a dispatcher, and in the desktop baselines, where the countdown is hidden
 * but still took its width (§12.98).
 *
 * Watched for a whole poll cycle in the real app, at a desktop width and two
 * phone widths: the button may not move by a pixel, whatever the number.
 */

const SIZES = [
  { name: 'desktop 1440', width: 1440, height: 900 },
  { name: 'phone 390', width: 390, height: 844 },
  { name: 'phone 320', width: 320, height: 568 },
] as const;

interface Sample {
  text: string;
  box: { x: number; y: number; width: number; height: number };
}

/** Samples the countdown and the button every 100 ms for one full cycle. */
async function watchOneCycle(page: Page): Promise<Sample[]> {
  const banner = page.getByRole('alert').filter({ hasText: 'Position feed' });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  const retry = banner.getByRole('button', { name: /Retry now|Retrying/ });
  const samples: Sample[] = [];
  const until = Date.now() + 22_000;
  while (Date.now() < until) {
    const text = (await banner.innerText()).match(/auto-retry in \d+s|retrying now/)?.[0] ?? '';
    const box = await retry.boundingBox();
    if (box) samples.push({ text, box });
    await page.waitForTimeout(100);
  }
  return samples;
}

for (const size of SIZES) {
  test(`${size.name}: "Retry now" stays put while the countdown runs 20 → 0`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await resetWorld({ feedAgeMinutes: 1 });
    await makeFeedStale(180);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');

    const samples = await watchOneCycle(page);
    const seen = new Set(samples.map((s) => s.text));
    // The cycle really crossed 10: both widths of number were on screen.
    expect([...seen].some((t) => /in \d{2}s$/.test(t)), [...seen].join(', ')).toBe(true);
    expect([...seen].some((t) => /in \ds$/.test(t)), [...seen].join(', ')).toBe(true);

    const places = new Set(samples.map((s) => `${s.box.x},${s.box.y},${s.box.width}`));
    expect([...places], 'Retry now moved while the countdown ran').toHaveLength(1);
  });
}
