// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow } from '@/test/fleet-row';
import type { FleetResponse } from '@/hooks/useFleet';
import { primeLoadRead } from '@/test/load-read';
import { FADING_COPY } from '@/components/overlay/dialog-motion';

/**
 * Phase 3bc. "Discard changes?" by keyboard: while it is open the keyboard is
 * its, exactly as it is ClearStopConfirm's and ReopenConfirm's. Before this, the
 * form behind it kept the focus, so Cmd/Ctrl+Enter SAVED the form the dispatcher
 * was being asked about, and typing edited it.
 *
 * The real keys and the real Tab are in `e2e/dialog-motion.spec.ts`.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let onClose: ReturnType<typeof vi.fn<() => void>>;

const ROW = fleetRow();

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<FleetResponse>(['fleet'], {
    fleet: [ROW],
    fetchedAt: '2026-09-18T12:00:00.000Z',
  } as FleetResponse);
  primeLoadRead(client, ROW);
  globalThis.fetch = vi.fn(
    () => new Promise<Response>(() => {}),
  ) as unknown as typeof fetch;
  onClose = vi.fn<() => void>();
});

afterEach(async () => {
  act(() => root?.unmount());
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  document.querySelectorAll(`[${FADING_COPY}]`).forEach((n) => n.remove());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

const modal = () =>
  createElement(
    QueryClientProvider,
    { client },
    createElement(EditStopModal, {
      row: ROW,
      drivers: [],
      role: 'admin' as const,
      dispatchTz: 'America/Chicago',
      onClose,
    }),
  );

const buttonNamed = (name: string): HTMLButtonElement => {
  const found = Array.from(container!.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
const zip = (): HTMLInputElement => {
  const match = Array.from(container!.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').trim().startsWith('ZIP'),
  );
  const input = match?.querySelector('input');
  if (!input) throw new Error('No ZIP field');
  return input;
};
const setValue = (el: HTMLInputElement, text: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const confirmOpen = () => (container!.textContent ?? '').includes('Discard changes?');

/** A key as the browser sends it: from what has focus, and cancellable. */
const press = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  let delivered = true;
  act(() => {
    delivered = (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return { defaultPrevented: !delivered };
};

/** The form is dirty, the caret is in ZIP, and Esc raises the confirm. */
async function openConfirm() {
  await act(async () => root!.render(modal()));
  const field = zip();
  await act(async () => setValue(field, '58104'));
  act(() => field.focus());
  expect(document.activeElement).toBe(field);
  press('Escape');
  expect(confirmOpen()).toBe(true);
  return field;
}

const posts = () =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

describe('Discard changes? by keyboard (phase 3bc)', () => {
  it('focus goes to Keep editing when it opens', async () => {
    await openConfirm();
    expect(document.activeElement).toBe(buttonNamed('Keep editing'));
  });

  it('it says what it is, and its panel holds the focus', async () => {
    await openConfirm();
    const dialog = document.activeElement?.closest('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Discard changes?');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
  });

  it('opened by Cancel with the mouse, focus goes to Keep editing too', async () => {
    await act(async () => root!.render(modal()));
    await act(async () => setValue(zip(), '58104'));
    await act(async () => buttonNamed('Cancel').click());
    expect(confirmOpen()).toBe(true);
    expect(document.activeElement).toBe(buttonNamed('Keep editing'));
  });

  it('Tab stays inside, both ways round', async () => {
    await openConfirm();
    const keep = buttonNamed('Keep editing');
    const discard = buttonNamed('Discard');

    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(discard);

    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(keep);
  });

  it('Esc means Keep editing: the form stays, and focus goes back where it was', async () => {
    const field = await openConfirm();
    const { defaultPrevented } = press('Escape');
    expect(defaultPrevented).toBe(true);
    expect(confirmOpen()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(zip().value).toBe('58104');
    expect(document.activeElement).toBe(field);
  });

  it('Esc again, from the form, raises it again', async () => {
    await openConfirm();
    press('Escape');
    expect(confirmOpen()).toBe(false);
    press('Escape');
    expect(confirmOpen()).toBe(true);
    expect(document.activeElement).toBe(buttonNamed('Keep editing'));
  });

  for (const [name, init] of [
    ['Cmd+Enter', { metaKey: true }],
    ['Ctrl+Enter', { ctrlKey: true }],
  ] as const) {
    it(`${name} does nothing: no save, and no click on the focused button`, async () => {
      await openConfirm();
      const { defaultPrevented } = press('Enter', init);
      // Prevented, because a browser turns Enter on a focused button into a click.
      expect(defaultPrevented).toBe(true);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(posts()).toHaveLength(0);
      expect(confirmOpen()).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
    });
  }

  it('typing reaches nothing: not the form, and not the board behind it', async () => {
    await openConfirm();
    const board = vi.fn();
    window.addEventListener('keydown', board);
    try {
      for (const key of ['d', '1', '0', '/', 'g', 'h', 'p', 'v', '?', 'k', 'ArrowDown']) {
        press(key);
      }
      press('k', { metaKey: true });
      expect(board).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', board);
    }
    expect(zip().value).toBe('58104');
    expect(confirmOpen()).toBe(true);
    expect(document.activeElement).toBe(buttonNamed('Keep editing'));
  });

  it('a browser key is left to the browser: nothing is prevented for it', async () => {
    await openConfirm();
    expect(press('c', { metaKey: true }).defaultPrevented).toBe(false);
    expect(press('r', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('Enter and Space are left for the button that has focus', async () => {
    await openConfirm();
    expect(press('Enter').defaultPrevented).toBe(false);
    expect(press(' ').defaultPrevented).toBe(false);
    expect(confirmOpen()).toBe(true);
  });

  it('the mouse works as it did: Keep editing, and Discard', async () => {
    await openConfirm();
    await act(async () => buttonNamed('Keep editing').click());
    expect(confirmOpen()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    press('Escape');
    expect(confirmOpen()).toBe(true);
    await act(async () => buttonNamed('Discard').click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('with the confirm closed, Cmd+Enter still saves the form', async () => {
    await openConfirm();
    press('Escape');
    expect(confirmOpen()).toBe(false);
    press('Enter', { metaKey: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(posts().length).toBeGreaterThan(0);
  });
});
