import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { maskPhone } from '../src/lib/dial';
import { DRIVER_NAMES, IDS, connect, resetWorld } from './fixtures';
import { SIZES, onPhone } from './phone-helpers';

/**
 * §12.106 — a driver's phone on the assignment board, through the real app.
 *
 * Made-up 555 numbers only. No full number is printed: stored values are
 * compared by equality with a masked label, and every screenshot masks the
 * number's text and the field it is typed into.
 */

async function setRole(role: 'viewer' | 'dispatcher') {
  const sql = connect();
  try {
    await sql`update profiles set role = ${role} where id = ${process.env['E2E_USER_ID']!}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function stored(): Promise<{ phone: string | null; audits: { before: unknown; after: unknown }[] }> {
  const sql = connect();
  try {
    const [row] = await sql<{ phone: string | null }[]>`select phone from drivers where id = ${IDS.driverAna}`;
    const audits = await sql<{ before: unknown; after: unknown }[]>`
      select before, after from audit_log where entity = 'driver' and entity_id = ${IDS.driverAna}
      order by created_at`;
    return { phone: row?.phone ?? null, audits };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const anaPhone = (page: Page) => page.locator(`[data-driver-phone="${IDS.driverAna}"]`);
/** Every place a whole number can be on screen: a shown number, and the field it is typed in. */
const numbers = (page: Page) => [
  page.locator('[data-driver-phone-value]').filter({ hasText: /\d/ }),
  page.locator('input[type="tel"]'),
];
const shot = (page: Page, info: TestInfo, name: string) =>
  page.screenshot({ path: info.outputPath(`${name}.png`), mask: numbers(page) });

test.beforeEach(async () => {
  await resetWorld();
});

test('a dispatcher adds, changes and clears a number; refusals say why and save nothing', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/assignments');
  await expect(anaPhone(page)).toContainText('No phone');
  await shot(page, info, '1-no-phone');

  // Add, typed the way people type it.
  await anaPhone(page).getByRole('button', { name: `Add the phone for ${DRIVER_NAMES.ana}` }).click();
  await anaPhone(page).getByLabel(`Phone for ${DRIVER_NAMES.ana}`).fill('(708) 555 0123');
  await shot(page, info, '2-typing');
  await anaPhone(page).getByRole('button', { name: 'Save' }).click();
  await expect(anaPhone(page).locator('[data-driver-phone-value]')).toHaveText(/^\d{3}-\d{3}-\d{4}$/);
  let now = await stored();
  expect(now.phone === '7085550123', `stored ${maskPhone(now.phone ?? '')}`).toBe(true);
  await shot(page, info, '3-saved');

  // Refused: too short, and not a US number. Nothing is written.
  await anaPhone(page).getByRole('button', { name: `Change the phone for ${DRIVER_NAMES.ana}` }).click();
  const field = anaPhone(page).getByLabel(`Phone for ${DRIVER_NAMES.ana}`);
  await field.fill('555-0199');
  await anaPhone(page).getByRole('button', { name: 'Save' }).click();
  await expect(anaPhone(page).getByRole('alert')).toHaveText(
    'Not a dialable US number. Enter all 10 digits, like 708-555-0123.',
  );
  await shot(page, info, '4-refused');
  await field.fill('+44 20 7946 0958');
  await anaPhone(page).getByRole('button', { name: 'Save' }).click();
  await expect(anaPhone(page).getByRole('alert')).toHaveText('Only US numbers can be saved (+1).');
  now = await stored();
  expect(now.phone === '7085550123').toBe(true);
  expect(now.audits).toHaveLength(1);

  // Changed, then cleared with an empty value.
  await field.fill('+1 708 555 0456');
  await anaPhone(page).getByRole('button', { name: 'Save' }).click();
  await expect(anaPhone(page).getByRole('button', { name: /^Change the phone/ })).toBeVisible();
  await anaPhone(page).getByRole('button', { name: `Change the phone for ${DRIVER_NAMES.ana}` }).click();
  await anaPhone(page).getByLabel(`Phone for ${DRIVER_NAMES.ana}`).fill('');
  await anaPhone(page).getByRole('button', { name: 'Save' }).click();
  await expect(anaPhone(page)).toContainText('No phone');

  now = await stored();
  expect(now.phone).toBeNull();
  // Three changes, each with the masked old and new numbers and nothing longer.
  expect(now.audits.map((a) => [(a.before as { phone: string | null }).phone, (a.after as { phone: string | null }).phone])).toEqual([
    [null, '•••••••123'],
    ['•••••••123', '•••••••456'],
    ['•••••••456', null],
  ]);
  for (const a of now.audits) {
    expect((a.after as { source: string }).source).toBe('operator-driver-phone');
    expect(JSON.stringify(a).match(/\d{4,}/)).toBeNull();
  }
});

test('a viewer sees the control disabled with the reason, and the route refuses them', async ({
  page,
}, info) => {
  await setRole('viewer');
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/assignments');
    const add = anaPhone(page).getByRole('button', { name: `Add the phone for ${DRIVER_NAMES.ana}` });
    await expect(add).toBeDisabled();
    await expect(add).toHaveAttribute('title', 'Your role is viewer. Phone numbers need dispatcher.');
    await shot(page, info, '5-viewer');
    const response = await page.request.post('/api/drivers', {
      data: { action: 'phone', driverId: IDS.driverAna, phone: '708-555-0123' },
    });
    expect(response.status()).toBe(403);
    expect((await stored()).phone).toBeNull();
  } finally {
    await setRole('dispatcher');
  }
});

test('on a phone the page says where assignments are, and offers no edit', async ({ browser }, info) => {
  const sql = connect();
  try {
    await sql`update drivers set phone = '7085550123' where id = ${IDS.driverAna}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
  const { context, page } = await onPhone(browser, SIZES[3]);
  try {
    // Nothing on the phone board links here (the header that does is desktop-only).
    await page.goto('/');
    await page.locator('[data-phone-topbar]').waitFor();
    await expect(page.locator('a[href="/assignments"]').filter({ visible: true })).toHaveCount(0);

    // Typed by hand: the message, a way back, and no board.
    await page.goto('/assignments');
    await expect(page.getByText('Assignments are on the desktop console.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the board' })).toBeVisible();
    await expect(anaPhone(page)).toBeHidden();
    await expect(page.locator('input[type="tel"]').filter({ visible: true })).toHaveCount(0);
    await expect(page.getByRole('button').filter({ visible: true })).toHaveCount(0);
    await shot(page, info, '6-phone-desktop-only');
  } finally {
    await context.close();
  }
});
