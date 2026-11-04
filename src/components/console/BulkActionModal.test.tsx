// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkActionModal } from './BulkActionModal';
import { fleetRow } from '@/test/fleet-row';
import { FADING_COPY } from '@/components/overlay/dialog-motion';

/**
 * Phase 3bc. Esc does exactly what Cancel does in the same state. Cancel is never
 * disabled, not even while the write is on its way, so neither is Esc.
 */
let root: Root | null = null;
let container: HTMLDivElement | null = null;
let onClose: ReturnType<typeof vi.fn<() => void>>;
let onDone: ReturnType<typeof vi.fn<() => void>>;

const ROW = fleetRow();

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onClose = vi.fn<() => void>();
  onDone = vi.fn<() => void>();
  // The write never answers: a test that wants "busy" stays busy.
  globalThis.fetch = vi.fn(
    () => new Promise<Response>(() => {}),
  ) as unknown as typeof fetch;
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

const render = (action: 'status' | 'note' = 'status') =>
  act(() =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BulkActionModal, {
          action,
          rows: [ROW],
          checked: new Set([ROW.id]),
          onDone,
          onClose,
        }),
      ),
    ),
  );

const press = (key: string, from: Element = document.activeElement ?? document.body) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  let delivered = true;
  act(() => {
    delivered = from.dispatchEvent(event);
  });
  return { defaultPrevented: !delivered };
};

const button = (name: RegExp) =>
  Array.from(container!.querySelectorAll('button')).find((b) =>
    name.test((b.textContent ?? '').trim()),
  )!;

describe('Esc on the bulk modal (phase 3bc)', () => {
  it('closes it, once, as Cancel does', () => {
    render();
    const { defaultPrevented } = press('Escape');
    expect(defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('from the note field too, with something typed', () => {
    render('note');
    const note = container!.querySelector('textarea')!;
    act(() => note.focus());
    press('Escape', note);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('while the write is on its way, as Cancel still does', async () => {
    render('status');
    await act(async () => button(/^Apply to/).click());
    expect(button(/^Applying/)).toBeDefined();
    expect(button(/^Cancel$/).disabled).toBe(false);
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('it stops there: the board behind does not also clear the checked rows', () => {
    render();
    const board = vi.fn();
    window.addEventListener('keydown', board);
    try {
      press('Escape');
    } finally {
      window.removeEventListener('keydown', board);
    }
    expect(board).not.toHaveBeenCalled();
  });

  it('any other key is none of its business', () => {
    render();
    press('a');
    press('Enter');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is gone with the modal', () => {
    render();
    act(() => root!.render(null));
    press('Escape', document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});
