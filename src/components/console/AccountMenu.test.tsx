// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §12.45. The header circle, which for four phases was a `<span>` with two
 * letters and nothing behind it.
 *
 * Both writes are server actions, which cannot run in this process — so they
 * are mocked at the module boundary and the test asserts what the menu SENDS.
 * A mock that cannot express the bug cannot verify the fix (§12.38), so the
 * rename mock reads the FormData rather than merely recording a call.
 */

const rename = vi.fn(async (_prev: unknown, form: FormData) => ({
  error: null,
  savedName: String(form.get('fullName') ?? ''),
}));
const signOutMock = vi.fn(async () => {});

vi.mock('@/app/actions/profile', () => ({ updateDisplayName: rename }));
vi.mock('@/app/login/actions', () => ({ signOut: signOutMock }));

const { AccountMenu } = await import('./AccountMenu');

let root: Root | null = null;
let container: HTMLDivElement | null = null;

import type { AccountUser } from './AccountMenu';

const USER: AccountUser = {
  fullName: 'Sam Leasar',
  email: 'sam@vinlogistics.test',
  role: 'admin',
};

beforeEach(() => {
  rename.mockClear();
  signOutMock.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const render = async (user = USER) => {
  await act(async () => {
    root!.render(createElement(AccountMenu, { user }));
  });
  return container!;
};

const triggerButton = () =>
  container!.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;

const byText = (needle: string): HTMLElement | null =>
  (Array.from(container!.querySelectorAll('button, p, label')).find((el) =>
    (el.textContent ?? '').includes(needle),
  ) as HTMLElement | null) ?? null;

const open = async () => {
  await act(async () => {
    triggerButton().click();
  });
};

/** Clicks the Save button in the rename form, as a dispatcher would. */
const saveName = async () => {
  const form = container!
    .querySelector<HTMLInputElement>('input[name="fullName"]')!
    .closest('form')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  await act(async () => {
    submit.click();
  });
};

const setValue = (el: HTMLInputElement, text: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('the header circle is a menu (§12.45)', () => {
  it('renders the initials, derived rather than passed in', async () => {
    const el = await render();
    expect(triggerButton().textContent).toBe('SL');
    // Closed by default: the menu must not be part of the first paint.
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(triggerButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('shows name, email and role when opened', async () => {
    const el = await render();
    await open();

    expect(el.querySelector('[role="menu"]')).not.toBeNull();
    expect(el.textContent).toContain('Sam Leasar');
    expect(el.textContent).toContain('sam@vinlogistics.test');
    expect(el.textContent).toContain('admin');
    expect(triggerButton().getAttribute('aria-expanded')).toBe('true');
  });

  it('offers sign out', async () => {
    const el = await render();
    await open();
    expect(byText('Sign out')).not.toBeNull();
    expect(el.querySelectorAll('[role="menuitem"]').length).toBeGreaterThanOrEqual(2);
  });

  /**
   * Focus has to have MOVED for the return to mean anything.
   *
   * The first version of this test opened the menu and pressed Escape without
   * ever focusing anything inside it — so the trigger still held focus, the
   * assertion was trivially true, and the test passed with `useReturnFocus`
   * commented out. Verified: it does not any more.
   */
  it('closes on Escape and gives focus back to the circle', async () => {
    await render();
    act(() => triggerButton().focus());
    await open();

    // Tab into the menu, as a keyboard user does.
    act(() => byText('Edit display name')!.focus());
    expect(document.activeElement).not.toBe(triggerButton());

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(container!.querySelector('[role="menu"]')).toBeNull();
    // Without the return, focus lands on the document body and a keyboard
    // user is stranded at the top of the page.
    expect(document.activeElement).toBe(triggerButton());
  });

  it('closes on an outside click', async () => {
    await render();
    await open();
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container!.querySelector('[role="menu"]')).toBeNull();
  });

  it('renders no email line when the account has none', async () => {
    const el = await render({ ...USER, email: null });
    await open();
    // Not the string "null", which is what a bare {user.email} would print.
    expect(el.textContent).not.toContain('null');
    expect(el.textContent).toContain('Sam Leasar');
  });
});

describe('editing the display name', () => {
  it('opens an editor pre-filled with the current name', async () => {
    const el = await render();
    await open();
    await act(async () => {
      byText('Edit display name')!.click();
    });

    const input = el.querySelector<HTMLInputElement>('input[name="fullName"]');
    expect(input).not.toBeNull();
    expect(input!.value).toBe('Sam Leasar');
  });

  /**
   * The §12.37 lesson: assert what the click DOES, not that a control exists.
   * "The name will be saved" is exactly the sentence that has been wrong
   * twice this session when written without exercising it.
   */
  it('sends the typed name to the action', async () => {
    const el = await render();
    await open();
    await act(async () => {
      byText('Edit display name')!.click();
    });

    const input = el.querySelector<HTMLInputElement>('input[name="fullName"]')!;
    await act(async () => {
      setValue(input, 'Sam T. Leasar');
    });
    await saveName();

    expect(rename).toHaveBeenCalled();
    const form = rename.mock.calls[0]?.[1];
    expect(form?.get('fullName')).toBe('Sam T. Leasar');
  });

  it('returns to the summary once the server accepts it', async () => {
    const el = await render();
    await open();
    await act(async () => {
      byText('Edit display name')!.click();
    });
    await saveName();

    // The editor closes on the SERVER's answer, not optimistically — a
    // rejected name must not look saved.
    expect(el.querySelector('input[name="fullName"]')).toBeNull();
  });

  it('reopens on the summary, never mid-edit from last time', async () => {
    const el = await render();
    await open();
    await act(async () => {
      byText('Edit display name')!.click();
    });
    expect(el.querySelector('input[name="fullName"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await open();

    expect(el.querySelector('input[name="fullName"]')).toBeNull();
    expect(el.textContent).toContain('Sam Leasar');
  });
});
