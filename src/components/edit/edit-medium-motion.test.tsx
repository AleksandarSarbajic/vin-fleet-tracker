// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditStopModal } from './EditStopModal';
import { fleetRow, nextStop } from '@/test/fleet-row';
import { primeLoadRead } from '@/test/load-read';
import { PU_SO_PASTED } from '@/test/ratecon-fixtures';
import { MODEL_REPLY, UNKNOWN_LAYOUT } from '@/test/model-read-fixtures';
import { recordAnimations, reduceMotion, type Played } from '@/test/animations';
import type { FleetRow } from '@/server/fleet-query';
import type { FleetResponse } from '@/hooks/useFleet';

/**
 * §12.157, the edit window's four medium motions: a stop added, a stop removed, a stop chosen,
 * and a fill. Each starts on its cause, at its own length written out, and on nothing else; a
 * poll starts nothing; reduced motion starts nothing and ends in the same place. Layout is
 * stated (happy-dom has none): tabs 56px apart in the column at 1008px and up, 206px apart in
 * the row below it. What only a browser shows is `e2e/new-motion.spec.ts`, "phase 3bp". Every
 * value is invented.
 */

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-08T15:00:00.000Z');
const CURVE = 'cubic-bezier(.22,.61,.36,1)';
const DROP_14 = {
  keyframes: [
    { opacity: 0, translate: '0 -14px' },
    { opacity: 1, translate: '0 0' },
  ],
  duration: 270,
  easing: CURVE,
};
const FADE_IN = { keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: 270, easing: 'linear' };
const FADE_OUT = { keyframes: [{ opacity: 1 }, { opacity: 0 }], duration: 270, easing: 'linear' };
const slid = (dx: number, dy: number) => ({
  keyframes: [{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }],
  duration: 270,
  easing: CURVE,
});
const highlight = (dx: number, dy: number) => ({
  keyframes: [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
  duration: 270,
  easing: CURVE,
});
const shape = (p: Played) => ({ keyframes: p.keyframes, ...p.options });

const EMPTY = fleetRow({ nextStop: null, openLoadCount: 0 });
const EXISTING = fleetRow({
  nextStop: nextStop({ type: 'PU', city: 'Joliet', state: 'IL', apptTz: TZ, apptType: 'APPT' }),
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let recorder: ReturnType<typeof recordAnimations>;
let restores: (() => void)[] = [];
let readAnswer: () => Promise<Response>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  recorder = recordAnimations();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  readAnswer = async () => json(200, { ok: true, reads: [MODEL_REPLY, MODEL_REPLY] });
  globalThis.fetch = vi.fn(async (url: string) => {
    if (url === '/api/ratecon/read') return readAnswer();
    return json(200, { ok: true });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
  recorder.restore();
  restores.reverse().forEach((r) => r());
  restores = [];
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

/**
 * Layout, stated: each tab 200×50, 56px apart down the column or 206px across the row, Add stop
 * 120×36 after the last, the box at (100, 200) on the screen. The highlight and the copy stand
 * where their `left` and `top` put them, as in a browser.
 */
function stubStops(layout: 'column' | 'row') {
  const step = (i: number) => (layout === 'column' ? { x: 0, y: i * 56 } : { x: i * 206, y: 0 });
  const tabIndex = (el: Element) =>
    [...(el.parentElement?.querySelectorAll(':scope > [role="tab"]') ?? [])].indexOf(el);
  const tabCount = (el: Element) =>
    el.closest('[data-stop-tabs]')?.querySelectorAll('[role="tab"]').length ?? 0;
  const at = (el: HTMLElement): { x: number; y: number } => {
    if (el.matches('[data-stop-slide], [data-leaving-copy]'))
      return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    if (el.matches('[role="tab"]')) return step(tabIndex(el));
    if (el.matches('[data-add-stop]')) return step(tabCount(el));
    return { x: 0, y: 0 };
  };
  const define = (name: string, get: (el: HTMLElement) => unknown) => {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return get(this);
      },
    });
    restores.push(() => {
      if (before) Object.defineProperty(HTMLElement.prototype, name, before);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    });
  };
  define('offsetLeft', (el) => at(el).x);
  define('offsetTop', (el) => at(el).y);
  define('offsetWidth', (el) => (el.matches('[role="tab"]') ? 200 : el.matches('[data-add-stop]') ? 120 : 0));
  define('offsetHeight', (el) => (el.matches('[role="tab"]') ? 50 : el.matches('[data-add-stop]') ? 36 : 0));
  define('offsetParent', (el) => {
    if (el.matches('[role="tab"], [data-stop-slide]')) return el.closest('[role="tablist"]');
    if (el.matches('[role="tablist"], [data-add-stop], [data-leaving-copy]')) return el.closest('[data-stop-tabs]');
    return el.parentElement;
  });
  const realRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function rect(this: Element): DOMRect {
    if (this.matches('[data-stop-tabs]')) return new DOMRect(100, 200, 600, 400);
    return realRect.call(this);
  };
  restores.push(() => {
    Element.prototype.getBoundingClientRect = realRect;
  });
}

const render = async (row: FleetRow = EMPTY, aiReader = false) => {
  primeLoadRead(client, row, { after: [] });
  client.setQueryData<FleetResponse>(['fleet'], { fleet: [row], fetchedAt: NOW.toISOString() } as FleetResponse);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EditStopModal, { row, drivers: [], role: 'admin', dispatchTz: TZ, aiReader, onClose: vi.fn(), onReload: vi.fn() }),
      ),
    );
  });
  await settle();
};

const dialog = () => container!.querySelector<HTMLElement>('[role="dialog"]') ?? container!;
const box = () => container!.querySelector<HTMLElement>('[data-stop-tabs]')!;
const tabs = () => [...container!.querySelectorAll<HTMLElement>('[role="tab"]')];
const addButton = () => container!.querySelector<HTMLButtonElement>('[data-add-stop]')!;
const form = () => container!.querySelector<HTMLElement>('[role="tabpanel"]')!;
const street = () => form().querySelector<HTMLInputElement>('input[data-fill="addressLine"]')!;
const button = (label: string) =>
  [...container!.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
  await settle();
};
const key = async (el: HTMLElement, k: string) => {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
  await settle();
};
const type = (el: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const pasteText = async (clip: string) => {
  const area = container!.querySelector('[data-ratecon-strip] textarea')!;
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => clip } });
  await act(async () => {
    area.dispatchEvent(event);
  });
  await settle();
};
const on = (el: Element | null) => recorder.played.filter((p) => p.el === el).map(shape);
/** Everything these four could move, played from `from` on: 3bj's strips are theirs (`strip-motion.test.tsx`). */
const OURS = '[role="tab"], [data-add-stop], [data-leaving-copy], [data-stop-slide], [role="tabpanel"], [data-fill], [data-fill-source]';
const since = (from: number) => recorder.played.slice(from).filter((p) => p.el.matches(OURS));
/** What one element played from `from` on. */
const onSince = (from: number, el: Element | null) => since(from).filter((p) => p.el === el).map(shape);
/** Three stops on a new load, each added by Add stop, with every motion of that ended. */
const threeStops = async () => {
  await render();
  await click(addButton());
  await click(addButton());
  act(() => recorder.finishAll());
  expect(tabs()).toHaveLength(3);
};
/** Nothing these four add is left once every motion has ended. */
const atRest = () => ({
  overlays: container!.querySelectorAll('[data-stop-slide]').length,
  copies: container!.querySelectorAll('[data-leaving-copy]').length,
  held: container!.querySelectorAll('[data-stop-target], [data-arriving]').length,
  styled: [box(), ...tabs(), addButton()].filter((el) => el.getAttribute('style')).length,
});
const AT_REST = { overlays: 0, copies: 0, held: 0, styled: 0 };

describe('stopAdd: a stop added, on Add stop', () => {
  it('in the column: the new tab drops 14px in 270ms, and Add stop slides down from where it stood, 56px', async () => {
    stubStops('column');
    await render();
    const from = recorder.played.length;
    const add = addButton();
    await click(add);
    expect(tabs()).toHaveLength(2);
    expect(on(tabs()[1]!)).toEqual([DROP_14]);
    expect(on(add)).toEqual([slid(0, -56)]);
    // Nothing else moved: the first tab stayed where it was.
    expect(on(tabs()[0]!)).toEqual([]);
    expect(since(from)).toHaveLength(2);
    act(() => recorder.finishAll());
    expect(atRest()).toEqual(AT_REST);
  });

  it('in the row below 1008px: Add stop slides across from the left, 206px, and the new tab still drops', async () => {
    stubStops('row');
    await render();
    const add = addButton();
    await click(add);
    expect(on(tabs()[1]!)).toEqual([DROP_14]);
    expect(on(add)).toEqual([slid(-206, 0)]);
  });

  it('§12.119: the new stop’s street box has the focus as the stop is added, and when every motion has ended', async () => {
    stubStops('column');
    await render();
    // Every change of focus from the press on: the street box's, and nothing before or after it.
    const focused: Element[] = [];
    const note = (event: FocusEvent) => focused.push(event.target as Element);
    document.addEventListener('focusin', note);
    try {
      await click(addButton());
      // The commit Add stop causes: the motions have started, and none has ended.
      expect(recorder.played.every((p) => p.animation.playState === 'running')).toBe(true);
      expect(form().getAttribute('data-stop-form')).toBe('2');
      expect(document.activeElement).toBe(street());
      act(() => recorder.finishAll());
      await settle();
      expect(document.activeElement).toBe(street());
      expect(focused).toEqual([street()]);
    } finally {
      document.removeEventListener('focusin', note);
    }
  });

  it('the new tab’s place reaches it while it drops, and Add stop’s place reaches Add stop while it slides', async () => {
    stubStops('column');
    await render();
    await click(addButton());
    expect(tabs()[1]!.hasAttribute('data-arriving')).toBe(true);
    expect(addButton().hasAttribute('data-arriving')).toBe(true);
    // A click on the box at Add stop's resting place (x 100–220, y 200+112–148): nothing drawn there yet.
    const added = tabs().length;
    await act(async () => {
      box().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 150, clientY: 330 }));
    });
    await settle();
    expect(tabs()).toHaveLength(added + 1);
    act(() => recorder.finishAll());
    expect(atRest()).toEqual(AT_REST);
  });

  it('a stop that comes without Add stop drops nothing: a fill’s stops are simply there', async () => {
    stubStops('column');
    await render();
    const from = recorder.played.length;
    await pasteText(PU_SO_PASTED);
    expect(tabs()).toHaveLength(2);
    expect(since(from).filter((p) => p.el.matches('[role="tab"], [data-add-stop]'))).toEqual([]);
  });

  it('reduced motion: the tab and Add stop are simply in their places, and focus is in the street box', async () => {
    stubStops('column');
    restores.push(reduceMotion());
    await render();
    await click(addButton());
    expect(recorder.played).toEqual([]);
    expect(tabs()).toHaveLength(2);
    expect(document.activeElement).toBe(street());
    expect(atRest()).toEqual(AT_REST);
  });
});

describe('stopRemove: a stop removed, on Remove stop', () => {
  it('in the column: a copy of its tab fades where it stood (270ms, linear), and the tab after it and Add stop slide up 56px', async () => {
    stubStops('column');
    await threeStops();
    await click(tabs()[1]!);
    act(() => recorder.finishAll());
    const [, second, third] = tabs();
    const add = addButton();
    const from = recorder.played.length;
    await click(button('Remove stop'));
    expect(tabs()).toHaveLength(2);
    expect(tabs()[1]).toBe(third);
    expect(second!.isConnected).toBe(false);
    const copy = box().querySelector<HTMLElement>('[data-leaving-copy]')!;
    expect(copy).not.toBeNull();
    expect([copy.style.left, copy.style.top, copy.style.width, copy.style.height]).toEqual(['0px', '56px', '200px', '50px']);
    expect(onSince(from, copy)).toEqual([FADE_OUT]);
    expect(onSince(from, third!)).toEqual([slid(0, 56)]);
    expect(onSince(from, add)).toEqual([slid(0, 56)]);
    expect(onSince(from, tabs()[0]!)).toEqual([]);
    // The copy, the tab and Add stop: the form that takes the stop's place is simply there.
    expect(since(from)).toHaveLength(3);
    // The box clips while they come up into it, never the scroller.
    expect(box().style.overflow).toBe('clip');
    act(() => recorder.finishAll());
    expect(atRest()).toEqual(AT_REST);
  });

  it('the copy can take no press and is found by nothing: not a button, no id, no role, inert, hidden, no pointer, behind the tabs', async () => {
    stubStops('column');
    await threeStops();
    await click(tabs()[1]!);
    await click(button('Remove stop'));
    const copy = box().querySelector<HTMLElement>('[data-leaving-copy]')!;
    expect(copy.tagName).toBe('SPAN');
    expect(copy.querySelectorAll('button, [role], [id]')).toHaveLength(0);
    expect([copy.id, copy.getAttribute('role'), copy.getAttribute('aria-selected')]).toEqual(['', null, null]);
    expect(copy.hasAttribute('inert')).toBe(true);
    expect(copy.getAttribute('aria-hidden')).toBe('true');
    expect(copy.classList.contains('pointer-events-none')).toBe(true);
    expect(copy.classList.contains('-z-10')).toBe(true);
    // Its words, as they stood.
    expect(copy.textContent).toContain('New stop');
  });

  it('in the row below 1008px: the tab after it and Add stop come in from the right, 206px', async () => {
    stubStops('row');
    await threeStops();
    await click(tabs()[0]!);
    act(() => recorder.finishAll());
    const [, second, third] = tabs();
    const add = addButton();
    const from = recorder.played.length;
    await click(button('Remove stop'));
    expect(onSince(from, second!)).toEqual([slid(206, 0)]);
    expect(onSince(from, third!)).toEqual([slid(206, 0)]);
    expect(onSince(from, add)).toEqual([slid(206, 0)]);
  });

  it('the last stop removed: its copy fades and Add stop slides up into its place; no tab moves', async () => {
    stubStops('column');
    await threeStops();
    const [first, second] = tabs();
    const add = addButton();
    const from = recorder.played.length;
    await click(button('Remove stop'));
    expect(tabs()).toEqual([first, second]);
    expect(onSince(from, add)).toEqual([slid(0, 56)]);
    expect(since(from).filter((p) => p.el.matches('[role="tab"]'))).toEqual([]);
  });

  it('reduced motion: the stop is simply gone, with no copy', async () => {
    stubStops('column');
    restores.push(reduceMotion());
    await threeStops();
    await click(button('Remove stop'));
    expect(recorder.played).toEqual([]);
    expect(tabs()).toHaveLength(2);
    expect(atRest()).toEqual(AT_REST);
  });
});

describe('stopChoose: another stop chosen, by its tab or an arrow key', () => {
  it('in the column, a click: the highlight slides from the stop it was on, 56px in 270ms, behind the tabs; the form drops 14px in 270ms', async () => {
    stubStops('column');
    await threeStops();
    await click(tabs()[0]!);
    act(() => recorder.finishAll());
    const from = recorder.played.length;
    await click(tabs()[1]!);
    const overlay = box().querySelector<HTMLElement>('[data-stop-slide]')!;
    expect(overlay).not.toBeNull();
    expect(overlay.parentElement?.getAttribute('role')).toBe('tablist');
    expect(overlay.className).toContain('-z-10');
    expect(overlay.className).toContain('pointer-events-none');
    expect([overlay.style.left, overlay.style.top, overlay.style.width, overlay.style.height]).toEqual(['0px', '56px', '200px', '50px']);
    expect(on(overlay)).toEqual([highlight(0, -56)]);
    expect(tabs()[1]!.hasAttribute('data-stop-target')).toBe(true);
    expect(on(form())).toEqual([DROP_14]);
    expect(form().getAttribute('data-stop-form')).toBe('2');
    // The highlight and the form, and nothing else: no tab moves.
    expect(since(from)).toHaveLength(2);
    act(() => recorder.finishAll());
    expect(atRest()).toEqual(AT_REST);
  });

  it('an arrow key, in the row below 1008px: the highlight comes across, 206px, and the form drops', async () => {
    stubStops('row');
    await threeStops();
    await click(tabs()[0]!);
    act(() => recorder.finishAll());
    await key(tabs()[0]!, 'ArrowRight');
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
    const overlay = box().querySelector('[data-stop-slide]');
    expect(on(overlay)).toEqual([highlight(-206, 0)]);
    expect(on(form())).toEqual([DROP_14]);
    // The arrow key moves the focus to the tab, as it always did: the motion takes none.
    expect(document.activeElement).toBe(tabs()[1]);
  });

  it('a second choice while it slides: one highlight at a time, taken up from where it is drawn', async () => {
    stubStops('column');
    await threeStops();
    await click(tabs()[0]!);
    act(() => recorder.finishAll());
    await click(tabs()[1]!);
    await click(tabs()[2]!);
    expect(box().querySelectorAll('[data-stop-slide]')).toHaveLength(1);
    expect(box().querySelectorAll('[data-stop-target]')).toHaveLength(1);
    expect(tabs()[2]!.hasAttribute('data-stop-target')).toBe(true);
    act(() => recorder.finishAll());
    expect(atRest()).toEqual(AT_REST);
  });

  it('the stop already chosen, Add stop, Remove stop and a fill choose a stop too: no highlight slides, and no form drops', async () => {
    stubStops('column');
    await threeStops();
    let from = recorder.played.length;
    await click(tabs()[2]!);
    expect(since(from)).toEqual([]);
    from = recorder.played.length;
    await click(button('Remove stop'));
    expect(since(from).filter((p) => p.el.matches('[data-stop-slide], [role="tabpanel"]'))).toEqual([]);
    act(() => recorder.finishAll());
    from = recorder.played.length;
    await click(addButton());
    expect(since(from).filter((p) => p.el.matches('[data-stop-slide], [role="tabpanel"]'))).toEqual([]);
    act(() => recorder.finishAll());
    // A fill chooses the first stop of what it filled: from the third, here, typed into.
    await type(form().querySelector<HTMLInputElement>('input[data-fill="city"]')!, 'Moorhead');
    from = recorder.played.length;
    await pasteText(PU_SO_PASTED);
    await click(button('Replace'));
    expect(form().getAttribute('data-stop-form')).toBe('1');
    expect(since(from).filter((p) => p.el.matches('[data-stop-slide], [role="tabpanel"]'))).toEqual([]);
    act(() => recorder.finishAll());
    expect(atRest()).toEqual(AT_REST);
  });

  it('a save the server refused, naming the second stop, chooses it: no highlight slides and no form drops', async () => {
    stubStops('column');
    await render();
    await pasteText(PU_SO_PASTED);
    act(() => recorder.finishAll());
    globalThis.fetch = vi.fn(async (url: string) =>
      url === '/api/stops'
        ? json(400, { error: 'Check the stops.', fields: [{ field: 'stops.1.city', message: 'Enter the city on the rate confirmation.' }] })
        : json(200, { ok: true }),
    ) as unknown as typeof fetch;
    expect(form().getAttribute('data-stop-form')).toBe('1');
    const from = recorder.played.length;
    await click(button('Save'));
    expect(form().getAttribute('data-stop-form')).toBe('2');
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
    expect(since(from).filter((p) => p.el.matches('[data-stop-slide], [role="tabpanel"]'))).toEqual([]);
    expect(atRest()).toEqual(AT_REST);
  });

  it('reduced motion: the choice is at once, with no highlight and no drop', async () => {
    stubStops('column');
    restores.push(reduceMotion());
    await threeStops();
    await click(tabs()[0]!);
    expect(recorder.played).toEqual([]);
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(atRest()).toEqual(AT_REST);
  });
});

/** Each of a fill's controls as drawn: its value, or its pressed choice for a group of buttons. */
const drawnFill = () =>
  new Map(
    [...dialog().querySelectorAll<HTMLElement>('[data-fill]')].map((el) => [
      el.getAttribute('data-fill')!,
      el instanceof HTMLInputElement && el.type === 'checkbox'
        ? String(el.checked)
        : el instanceof HTMLInputElement || el instanceof HTMLSelectElement
          ? el.value
          : (el.querySelector('[aria-pressed="true"]')?.textContent ?? el.textContent ?? ''),
    ]),
  );

describe('loadStrip: a fill, on Replace or a read landing', () => {
  it('Replace: each field whose value changed fades in (270ms, linear), each its own, with its source line dropping 14px; a field that did not change does not move', async () => {
    stubStops('column');
    await render();
    // The city is the one the fill brings: it will not change.
    await type(form().querySelector<HTMLInputElement>('input[data-fill="city"]')!, 'Fargo');
    await pasteText(PU_SO_PASTED);
    const before = drawnFill();
    const from = recorder.played.length;
    await click(button('Replace'));
    const after = drawnFill();
    // Judged on the controls drawn both before and after: one the fill brings into view (the
    // appointment's, once it is ticked) is new with the value it had, and fades only if that changed.
    const both = [...after.keys()].filter((name) => before.has(name));
    const changed = both.filter((name) => before.get(name) !== after.get(name));
    const same = both.filter((name) => before.get(name) === after.get(name));
    expect(changed).toEqual(expect.arrayContaining(['loadNumber', 'addressLine', 'state', 'zip']));
    expect(same).toContain('city');

    const fields = since(from).filter((p) => p.el.hasAttribute('data-fill'));
    const faded = fields.map((p) => p.el.getAttribute('data-fill'));
    expect(faded).toEqual(expect.arrayContaining(changed));
    for (const name of same) expect(faded).not.toContain(name);
    for (const p of fields) expect(shape(p)).toEqual(FADE_IN);
    // Each its own start: one animation an element, none shared.
    expect(new Set(fields.map((p) => p.animation)).size).toBe(fields.length);

    const lines = since(from).filter((p) => p.el.hasAttribute('data-fill-source'));
    for (const p of lines) expect(shape(p)).toEqual(DROP_14);
    expect(lines.map((p) => p.el.getAttribute('data-fill-source'))).toEqual(
      expect.arrayContaining(['loadNumber', 'addressLine', 'state', 'zip']),
    );
    // The city's own line came with the fill, and is simply there.
    const cityLine = form().querySelector('[data-fill-source="city"]');
    expect(cityLine).not.toBeNull();
    expect(on(cityLine)).toEqual([]);
    expect(on(form().querySelector('input[data-fill="city"]'))).toEqual([]);
  });

  it('a read landing with nothing to replace: the same, and the focus and caret stay where the person is typing', async () => {
    stubStops('column');
    let land: (r: Response) => void = () => {};
    readAnswer = () => new Promise<Response>((resolve) => (land = resolve));
    await render(EMPTY, true);
    await pasteText(UNKNOWN_LAYOUT.map((l) => l.text).join('\n'));
    await click(button('Read with AI'));
    // While it reads, the person types in the driver search, outside anything a fill touches.
    const search = dialog().querySelector<HTMLInputElement>('input[role="combobox"]')!;
    act(() => search.focus());
    await type(search, 'Sm');
    search.setSelectionRange(1, 1);
    const from = recorder.played.length;
    await act(async () => land(json(200, { ok: true, reads: [MODEL_REPLY, MODEL_REPLY] })));
    await settle();
    expect(dialog().querySelector<HTMLInputElement>('input[data-fill="loadNumber"]')!.value).not.toBe('');
    const fields = since(from).filter((p) => p.el.hasAttribute('data-fill'));
    expect(fields.length).toBeGreaterThan(0);
    for (const p of fields) expect(shape(p)).toEqual(FADE_IN);
    expect(document.activeElement).toBe(search);
    expect([search.value, search.selectionStart, search.selectionEnd]).toEqual(['Sm', 1, 1]);
    expect(on(search)).toEqual([]);
    act(() => recorder.finishAll());
    expect(document.activeElement).toBe(search);
    expect([search.selectionStart, search.selectionEnd]).toEqual([1, 1]);
  });

  it('a field focused when the fill changes it keeps the focus: opacity only, nothing focused, nothing moved', async () => {
    stubStops('column');
    await render();
    await type(form().querySelector<HTMLInputElement>('input[data-fill="city"]')!, 'Moorhead');
    await pasteText(PU_SO_PASTED);
    const loadNumber = dialog().querySelector<HTMLInputElement>('input[data-fill="loadNumber"]')!;
    act(() => loadNumber.focus());
    const from = recorder.played.length;
    await click(button('Replace'));
    expect(document.activeElement).toBe(loadNumber);
    const own = since(from).filter((p) => p.el === loadNumber).map(shape);
    expect(own).toEqual([FADE_IN]);
    expect(own.every((s) => s.keyframes.every((k) => Object.keys(k).join() === 'opacity'))).toBe(true);
  });

  it('nothing else plays it: typing, Keep mine, a paste not recognised, an address pasted into Street', async () => {
    stubStops('column');
    await render();
    const from = recorder.played.length;
    await type(form().querySelector<HTMLInputElement>('input[data-fill="city"]')!, 'Moorhead');
    await pasteText(PU_SO_PASTED);
    await click(button('Keep mine'));
    await pasteText('Dear carrier,\nPlease find the load attached.');
    const area = street();
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => '4001 Main St, Fargo, ND 58102' } });
    await act(async () => {
      area.dispatchEvent(event);
    });
    await settle();
    expect(since(from).filter((p) => p.el.matches('[data-fill], [data-fill-source]'))).toEqual([]);
  });

  it('reduced motion: the values are simply there', async () => {
    stubStops('column');
    restores.push(reduceMotion());
    await render();
    await pasteText(PU_SO_PASTED);
    expect(recorder.played).toEqual([]);
    expect(dialog().querySelector<HTMLInputElement>('input[data-fill="loadNumber"]')!.value).toBe('88123');
  });
});

describe('a poll while the window is open moves nothing in it', () => {
  it('a poll with changed data, on a load and on a new one: 0 animations', async () => {
    stubStops('column');
    for (const row of [EXISTING, EMPTY]) {
      await render(row);
      const from = recorder.played.length;
      const polled = {
        ...row,
        status: 'LATE' as const,
        computed: 'LATE' as const,
        nextStop: row.nextStop ? { ...row.nextStop, city: 'Aurora', etaUtc: '2026-10-09T01:00:00.000Z' } : null,
      } as FleetRow;
      client.setQueryData<FleetResponse>(['fleet'], { fleet: [polled], fetchedAt: NOW.toISOString() } as FleetResponse);
      await act(async () => {
        root!.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(EditStopModal, { row: polled, drivers: [], role: 'admin', dispatchTz: TZ, onClose: vi.fn(), onReload: vi.fn() }),
          ),
        );
      });
      await settle();
      expect(since(from)).toEqual([]);
      act(() => root!.unmount());
      root = createRoot(container!);
    }
  });
});

describe('reduced motion: every end state is the one motion ends in', () => {
  /** The window as it stands, every motion over: the same markup, motion or not. */
  const steps = async () => {
    const pictures: string[] = [];
    const picture = () => {
      act(() => recorder.finishAll());
      // React counts `useId` across every root on the page, so a second mount numbers them on. The
      // window's own opening (§12.148) is CSS that comes off at `animationend`, which happy-dom
      // never sends; it is not one of these four, and reduced motion never adds it.
      pictures.push(
        dialog()
          .outerHTML.replace(/_r_[0-9a-z]+_/g, '_r_')
          .replace(/ animate-(scrim|dialog)-in/g, ''),
      );
    };
    await render();
    await click(addButton());
    picture();
    await click(addButton());
    picture();
    await click(tabs()[0]!);
    picture();
    await key(tabs()[0]!, 'ArrowDown');
    picture();
    await click(button('Remove stop'));
    picture();
    // Nothing typed, so the fill lands at once.
    await pasteText(PU_SO_PASTED);
    picture();
    return pictures;
  };

  it('Add stop twice, a click, an arrow key, Remove stop and a fill: the same window after each', async () => {
    stubStops('column');
    const moving = await steps();
    act(() => root!.unmount());
    root = createRoot(container!);
    restores.push(reduceMotion());
    const played = recorder.played.length;
    const still = await steps();
    expect(recorder.played.length).toBe(played);
    expect(still).toEqual(moving);
  });
});
