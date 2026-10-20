import type { Locator } from '@playwright/test';

/**
 * A form field (`Field.tsx`), found by its OWN label word, for the rate-con
 * specs. Not `getByLabel`: a Field's <label> also wraps its check and its
 * source line, and `getByLabel` matches any part of the whole label's text,
 * ignoring case. After a scan filled the load, `getByLabel('City')` found
 * ZIP, City and State, whose source line read "CITY, STATE FARGO, ND 58102"
 * (3aj, second follow-up).
 *
 * Here the label must hold an element whose whole text is exactly the word,
 * case and all. Only the label word itself can be: a check starts "Check:",
 * a source line "From …" or "Read by AI …".
 */
export function fieldLabel(scope: Locator, word: string): Locator {
  return scope.locator('label').filter({ has: scope.page().getByText(word, { exact: true }) });
}

/** That field's input. */
export function field(scope: Locator, word: string): Locator {
  return fieldLabel(scope, word).locator('input');
}
