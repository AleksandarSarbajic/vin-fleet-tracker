// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { ReassignConfirm } from './ReassignConfirm';
import { fleetRow } from '@/test/fleet-row';
import type { FleetResponse } from '@/hooks/useFleet';
import { loadReadKey } from '@/hooks/useLoadRead';
import { loadReadFor, primeLoadRead } from '@/test/load-read';
import { FADING_COPY } from '@/components/overlay/dialog-motion';
import { MOTION_MS } from '@/design/tokens';
import type { PreviewSide } from '@/server/reassign';

/**
 * §12.148 on the seven dialogs of step 1: the edit modal (its reading panel
 * and its editor) and the six confirms. The motion itself is
 * DialogFrame.test.tsx's; this is the wiring — that each dialog draws through
 * the frame, and that the modal's own remounts never replay its opening.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let now = 1_000;

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
  // The load read never answers: a test that wants the editor primes it.
  globalThis.fetch = vi.fn(
    () => new Promise<Response>(() => {}),
  ) as unknown as typeof fetch;
  now = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(async () => {
  act(() => root?.unmount());
  await settle();
  document.querySelectorAll(`[${FADING_COPY}]`).forEach((n) => n.remove());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

const modal = (key = 'a') =>
  createElement(
    QueryClientProvider,
    { client },
    createElement(EditStopModal, {
      key,
      row: ROW,
      drivers: [],
      role: 'admin' as const,
      dispatchTz: 'America/Chicago',
      onClose: () => {},
    }),
  );

/** Answers the load read. React Query tells its observers on a setTimeout(0). */
const answerRead = () =>
  act(async () => {
    client.setQueryData(loadReadKey(ROW)!, loadReadFor(ROW));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const scrims = () => Array.from(container!.querySelectorAll<HTMLElement>('.bg-scrim'));
const panelOf = (scrim: HTMLElement) => scrim.firstElementChild as HTMLElement;
const copies = () => document.querySelectorAll<HTMLElement>(`[${FADING_COPY}]`);

const setValue = (el: HTMLInputElement, text: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const fieldLabelled = (label: string): HTMLInputElement => {
  const match = Array.from(container!.querySelectorAll('label')).find((l) =>
    (l.textContent ?? '').trim().startsWith(label),
  );
  const input = match?.querySelector('input');
  if (!input) throw new Error(`No field labelled ${label}`);
  return input;
};
const buttonNamed = (name: string): HTMLButtonElement => {
  const found = Array.from(container!.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};

describe('the edit modal opens once (§12.148)', () => {
  it('opens its reading panel with motion', () => {
    act(() => root!.render(modal()));
    const [scrim] = scrims();
    expect(scrim!.getAttribute('aria-busy')).toBe('true');
    expect(scrim!.className).toContain('animate-scrim-in');
    expect(panelOf(scrim!).className).toContain('animate-dialog-in');
  });

  it('the editor takes the opening up where the reading panel left it', async () => {
    act(() => root!.render(modal()));
    now += 40;
    await answerRead();
    const [scrim] = scrims();
    expect(scrim!.hasAttribute('aria-busy')).toBe(false);
    expect(panelOf(scrim!).className).toContain('animate-dialog-in');
    expect(panelOf(scrim!).style.animationDelay).toBe('-40ms');
  });

  it('the editor simply appears when the read came after the opening ended', async () => {
    act(() => root!.render(modal()));
    now += MOTION_MS.dialogIn + 200;
    await answerRead();
    const [scrim] = scrims();
    expect(scrim!.hasAttribute('aria-busy')).toBe(false);
    expect(scrim!.className).not.toContain('animate-');
    expect(panelOf(scrim!).className).not.toContain('animate-');
    await settle();
    expect(copies()).toHaveLength(0);
  });

  it('a remount (Reload, a landed save) does not replay it or leave a copy', async () => {
    primeLoadRead(client, ROW);
    await act(async () => root!.render(modal('a')));
    expect(panelOf(scrims()[0]!).className).toContain('animate-dialog-in');
    now += 2_000;
    await act(async () => root!.render(modal('b')));
    expect(scrims()).toHaveLength(1);
    expect(panelOf(scrims()[0]!).className).not.toContain('animate-');
    await settle();
    expect(copies()).toHaveLength(0);
  });
});

describe('the Discard confirm (§12.148)', () => {
  it('opens with motion over the modal, and a copy of it fades when it closes', async () => {
    primeLoadRead(client, ROW);
    await act(async () => root!.render(modal()));
    // The modal's own opening has ended (happy-dom never says so itself).
    act(() => {
      panelOf(scrims()[0]!).dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(panelOf(scrims()[0]!).className).not.toContain('animate-');
    now += 5_000;
    await act(async () => setValue(fieldLabelled('ZIP'), '58104'));
    await act(async () => buttonNamed('Cancel').click());

    expect(container!.textContent).toContain('Discard changes?');
    const confirm = scrims().find((s) =>
      (s.textContent ?? '').includes('Discard changes?'),
    )!;
    expect(confirm.className).toContain('z-[60]');
    expect(panelOf(confirm).className).toContain('animate-dialog-in');

    await act(async () => buttonNamed('Keep editing').click());
    expect(container!.textContent).not.toContain('Discard changes?');
    // The modal under it is untouched: still there, and not replayed.
    expect(scrims()).toHaveLength(1);
    expect(panelOf(scrims()[0]!).className).not.toContain('animate-');
    await settle();
    const fading = copies();
    expect(fading).toHaveLength(1);
    expect(fading[0]!.className).toContain('z-[60]');
    expect(fading[0]!.textContent).toContain('Discard changes?');
  });
});

describe('a confirm opens with motion (§12.148)', () => {
  const side = (over: Partial<PreviewSide>): PreviewSide => ({
    truckId: 't-1',
    truckLabel: '310',
    driverId: 'd-1',
    driverName: 'Samsara Sam',
    driverSource: 'samsara',
    driverSamsaraId: 'sam-1',
    nextApptUtc: null,
    nextApptTz: null,
    ...over,
  });

  it('Reassign', () => {
    act(() =>
      root!.render(
        createElement(ReassignConfirm, {
          busy: false,
          onCancel: vi.fn(),
          onConfirm: vi.fn(),
          preview: {
            gaining: { ...side({}), toDriverId: 'd-2', toDriverName: 'Hand Entered Hal' },
            losing: null,
            summary: 'Reassigns 310 from Samsara Sam to Hand Entered Hal.',
            note: 'Nothing is sent to either driver.',
            token: 'tok',
          },
        }),
      ),
    );
    const scrim = container!.querySelector<HTMLElement>(
      '[aria-label="Confirm reassignment"]',
    )!;
    expect(scrim.className).toContain('animate-scrim-in');
    expect(panelOf(scrim).className).toContain('animate-dialog-in');
  });
});

describe('the seven dialogs of step 1 draw through DialogFrame (§12.148)', () => {
  /**
   * A hand-rolled scrim would open with no motion and leave no background,
   * and nothing else would notice. Each file names its frames, and none may
   * draw a `bg-scrim` div of its own.
   */
  const FRAMES: Record<string, number> = {
    'EditStopModal.tsx': 3, // reading panel, editor, Discard changes
    'ClearStopConfirm.tsx': 1,
    'ReassignConfirm.tsx': 1,
    'ReopenConfirm.tsx': 1,
    'PreviousLoadQuestion.tsx': 1,
    'ReachedStopQuestion.tsx': 1,
  };

  for (const [file, count] of Object.entries(FRAMES)) {
    it(`${file}: ${count} frame${count === 1 ? '' : 's'}, and no scrim of its own`, () => {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source.match(/<DialogFrame\b/g) ?? []).toHaveLength(count);
      expect(source).not.toMatch(/<div[^>]*\bbg-scrim\b/);
    });
  }
});
