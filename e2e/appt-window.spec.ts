import { expect, test, type Page } from '@playwright/test';
import { IDS, TRUCK_NUMBERS, connect, resetWorld } from './fixtures';

/**
 * §12.115 end to end: the real modal, the real route, the real database.
 *
 * An APPT stop's window opens as it was saved and a note-only save writes it
 * back unchanged. Before this, the modal opened every stop at "±30 min", so
 * a note saved on an exact-time appointment moved its deadline 30 minutes.
 */

test.beforeEach(async () => {
  await resetWorld();
});

const rowOf = (page: Page) => page.locator(`[data-row-id="${IDS.truckChicago}"]`);
const editModal = (page: Page) =>
  page.getByRole('dialog', { name: `Edit load for truck ${TRUCK_NUMBERS.chicago}` });

async function openModal(page: Page) {
  await page.goto('/');
  await rowOf(page).click();
  await page.keyboard.press('Enter');
  await expect(editModal(page)).toBeVisible();
  return editModal(page);
}

/**
 * The window dropdown. Found by its Exact choice: the label wraps the select,
 * so its accessible name carries every option's text too.
 */
const windowControl = (page: Page) =>
  editModal(page).locator('select:has(option:text-is("Exact time"))');

/** Sets the stored window directly, the way a script or an old save left it. */
async function storeWindow(minutes: number) {
  const sql = connect();
  try {
    await sql`
      update stops
         set appointment_end_utc = appointment_start_utc + make_interval(mins => ${minutes}::int)
       where id = ${IDS.stopChicago}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function stored() {
  const sql = connect();
  try {
    const [row] = await sql<{ minutes: number }[]>`
      select round(extract(epoch from appointment_end_utc - appointment_start_utc) / 60)::int
             as minutes
        from stops where id = ${IDS.stopChicago}`;
    const [audit] = await sql<
      {
        before: { appointmentStartUtc: string; appointmentEndUtc: string };
        after: { appointmentStartUtc: string; appointmentEndUtc: string };
      }[]
    >`
      select before, after from audit_log
       where entity = 'stop' and entity_id = ${IDS.stopChicago} and before is not null
       order by created_at desc limit 1`;
    return { minutes: row!.minutes, audit };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function saveNote(page: Page, text: string) {
  const modal = editModal(page);
  await modal.locator('textarea').fill(text);
  await expect(modal).toContainText('Unsaved changes — note.');
  await modal.getByRole('button', { name: /^Save$/ }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
}

test('an exact time stays exact through a note-only save', async ({ page }) => {
  await storeWindow(0);
  const modal = await openModal(page);
  await expect(modal).toBeVisible();
  await expect(windowControl(page)).toHaveValue('0');
  await saveNote(page, 'gate 4');
  expect((await stored()).minutes).toBe(0);
});

test('a stored 45 minutes is offered, kept, and survives a note-only save', async ({ page }) => {
  await storeWindow(45);
  const modal = await openModal(page);
  await expect(modal).toBeVisible();
  const control = windowControl(page);
  await expect(control).toHaveValue('45');
  await expect(control.locator('option:checked')).toHaveText('+45 min');
  await saveNote(page, 'gate 4');
  expect((await stored()).minutes).toBe(45);
});

test('changing the window changes it, and the audit records old and new', async ({ page }) => {
  await storeWindow(30);
  const modal = await openModal(page);
  await windowControl(page).selectOption('60');
  await expect(modal).toContainText('Unsaved changes — appointment window.');
  await modal.getByRole('button', { name: /^Save$/ }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });

  const { minutes, audit } = await stored();
  expect(minutes).toBe(60);
  // Each end measured from its own start: the fixture's start carries
  // seconds (now + 26 h) and a save stores whole minutes, so the starts
  // differ by those seconds and the ends cannot be compared to each other.
  const windowOf = (side: { appointmentStartUtc: string; appointmentEndUtc: string }) =>
    Math.round((Date.parse(side.appointmentEndUtc) - Date.parse(side.appointmentStartUtc)) / 60_000);
  expect(windowOf(audit!.before)).toBe(30);
  expect(windowOf(audit!.after)).toBe(60);
});
