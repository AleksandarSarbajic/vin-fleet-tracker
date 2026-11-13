// @vitest-environment happy-dom
import { createElement, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boardElement, NO_FLEET, testQueryClient } from '@/test/assignment-board';
import { recordAnimations, reduceMotion, type Played } from '@/test/animations';
import type { AssignmentBoard as Board, BoardDriver } from '@/server/assignments';
import type { OpenMergeCandidate } from '@/server/drivers';

/**
 * §12.158, the Assignments board's two medium motions.
 *
 * - **asgTab**: a tab a person chose. The rows that stay glide from where they were drawn to
 *   their new places in 390ms, the rows that come fade in where they land, and the rows that go
 *   are gone at once. Not the picker's own `setFilter('all')`, the search, a refresh or a poll.
 * - **asgMerge**: the duplicate-driver prompt. Arriving by itself, from a fetch, it only fades
 *   in, 270ms, and what is below it jumps. Answered by a person, it goes, and the column header
 *   and the rows slide up from where they stood, 270ms, in the table's section, which clips.
 *
 * The 3bq rule: the prompt's list lands through a fetch, so the tests wait on what the page
 * shows, an act at a time, never one tick of their own, and a Profiler reads what had played by
 * the commit the change first appeared in. Every name and number is invented.
 */

const arrival = vi.hoisted(() => ({ byChange: false }));
vi.mock('@/lib/page-arrival', () => ({ cameByPageChange: () => arrival.byChange, arrive: () => true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const driver = (id: string, name: string, truckId: string | null): BoardDriver => ({
  id,
  name,
  active: true,
  source: 'samsara',
  samsaraDriverId: `sam-${id}`,
  phone: null,
  truckId,
  truckLabel: null,
});
const truck = (id: string, number: number, driverId: string | null, driverName: string | null) => ({
  id,
  truckNumber: number,
  samsaraName: `Truck ${number}`,
  driverId,
  driverName,
  driverSource: driverId === null ? null : ('samsara' as const),
  driverSamsaraId: driverId === null ? null : `sam-${driverId}`,
  since: null,
});
/** Two trucks with a driver and two without, in turn: a tab always keeps some and drops some. */
const BOARD: Board = {
  trucks: [
    truck('t-1', 137, 'd-a', 'Ada Quill'),
    truck('t-2', 143, null, null),
    truck('t-3', 150, 'd-b', 'Bo Reyes'),
    truck('t-4', 160, null, null),
  ],
  drivers: [driver('d-a', 'Ada Quill', 't-1'), driver('d-b', 'Bo Reyes', 't-3'), driver('d-c', 'Cy Tamm', null)],
};
const candidate = (id: string, name: string): OpenMergeCandidate => ({
  id,
  appDriverId: `app-${id}`,
  samsaraDriverId: `sam-${id}`,
  samsaraDriverName: name,
  appDriverName: name,
  appDriverCreatedAt: '2026-09-01T12:00:00.000Z',
});

const GLIDE = (dy: number, ms = 390) => ({
  keyframes: [{ translate: `0px ${dy}px` }, { translate: '0 0' }],
  duration: ms,
  easing: 'cubic-bezier(.22,.61,.36,1)',
});
const FADE = (ms: number) => ({ keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: ms, easing: 'linear' });
const shape = (p: Played) => ({ keyframes: p.keyframes, ...p.options });
/** Markup, with React's `useId` names left out: they count per root, and each run here mounts its own. */
const markup = (el: Element) => el.outerHTML.replace(/_r_[0-9a-z]+_/g, '_id_');

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;
/** What /api/drivers lists now, an answer the test holds until it lands it, and one that fails. */
let open: OpenMergeCandidate[];
let holdList: (() => void) | null;
let listHeld: boolean;
let answerFails: boolean;
let fleetCalls: number;
let commits: { prompt: boolean; played: number }[];
const realRect = HTMLElement.prototype.getBoundingClientRect;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  arrival.byChange = false;
  recorder = recordAnimations();
  open = [];
  holdList = null;
  listHeld = false;
  answerFails = false;
  fleetCalls = 0;
  commits = [];
  /**
   * happy-dom lays nothing out. The rows are 44px, one under the other, from 60px in their box.
   * In the table's section the prompt, when it is drawn, stands above the column header: 80px
   * and 60px a driver it asks about, plus the 20px over it. The rows' box is 40px under the
   * header. Everything else is the scroller's 1000 by 800.
   */
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.hasAttribute('data-asg-row')) {
      const rows = [...(this.parentElement?.querySelectorAll(':scope > [data-asg-row]') ?? [])];
      return new DOMRect(0, 60 + rows.indexOf(this) * 44, 1000, 44);
    }
    const prompt = document.querySelector('[data-merge-prompt]');
    const above = prompt ? 20 + 80 + 60 * prompt.querySelectorAll('li').length : 0;
    if (this.hasAttribute('data-asg-head')) return new DOMRect(0, 20 + above, 1000, 40);
    if (this.hasAttribute('data-asg-rows') && this.parentElement?.tagName === 'SECTION') {
      return new DOMRect(0, 60 + above, 1000, 400);
    }
    return new DOMRect(0, 0, 1000, 800);
  };
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/drivers' && init?.method === 'POST') {
      if (answerFails) return json({ error: 'That could not be completed.' }, 500);
      const body = JSON.parse(String(init.body)) as { candidateId?: string; appDriverId?: string };
      open = open.filter((c) => c.id !== body.candidateId && c.appDriverId !== body.appDriverId);
      return json({ ok: true });
    }
    if (url === '/api/drivers') {
      const list = open;
      if (listHeld) await new Promise<void>((resolve) => (holdList = resolve));
      return json({ candidates: list });
    }
    if (url === '/api/fleet') {
      fleetCalls += 1;
      return json({ ...NO_FLEET, fetchedAt: `2026-10-28T12:00:${String(fleetCalls).padStart(2, '0')}.000Z` });
    }
    return json({ assigned: 0, cleared: 0, unchanged: 0 });
  }) as unknown as typeof fetch;
  client = testQueryClient();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  client.clear();
  container?.remove();
  root = null;
  container = null;
  recorder.restore();
  unreduce?.();
  unreduce = null;
  HTMLElement.prototype.getBoundingClientRect = realRect;
  vi.restoreAllMocks();
});

const prompt = () => container!.querySelector<HTMLElement>('[data-merge-prompt]');
const render = async (board: Board = BOARD, role: 'admin' | 'dispatcher' = 'dispatcher') => {
  await act(async () => {
    root!.render(
      // A Profiler's onRender runs in each commit, after its children's layout effects.
      createElement(
        Profiler,
        { id: 'board', onRender: () => void commits.push({ prompt: prompt() !== null, played: recorder.played.length }) },
        boardElement(client, { board, role }),
      ),
    );
  });
};
/** Phase 3bq: waits on the page, an act at a time, and returns at the first act that shows it. */
const untilShown = async (what: string, shown: () => boolean, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (!shown()) {
    if (Date.now() > deadline) throw new Error(`not shown within ${timeoutMs}ms: ${what}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};
const rowOf = (id: string) => container!.querySelector<HTMLElement>(`[data-asg-row="${id}"]`)!;
const rowIds = () => [...container!.querySelectorAll('[data-asg-row]')].map((r) => r.getAttribute('data-asg-row'));
const rowsBox = () => container!.querySelector<HTMLElement>('section > [data-asg-rows]')!;
const head = () => container!.querySelector<HTMLElement>('section > [data-asg-head]')!;
const section = () => container!.querySelector<HTMLElement>('section')!;
const tab = (name: RegExp) =>
  [...container!.querySelectorAll<HTMLButtonElement>('[aria-label="Filter the trucks"] button')].find((b) =>
    name.test(b.textContent ?? ''),
  )!;
const button = (name: string) =>
  [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => (b.textContent ?? '').trim() === name || b.getAttribute('aria-label') === name,
  )!;
const onRows = () => recorder.played.filter((p) => p.el.hasAttribute('data-asg-row'));
const on = (el: Element | null) => recorder.played.filter((p) => p.el === el);
const click = async (b: HTMLButtonElement) => {
  await act(async () => b.click());
};

describe('asgTab: a tab a person chose glides the rows that stay, and fades in the rows that come', () => {
  it('No driver: the two that stay glide up, 44px and 88px, in 390ms, the two that go are gone at once, nothing fades', async () => {
    await render();
    await click(tab(/^No driver/));
    expect(rowIds()).toEqual(['t-2', 't-4']);
    expect(onRows().map((p) => p.el)).toEqual([rowOf('t-2'), rowOf('t-4')]);
    expect(onRows().map(shape)).toEqual([GLIDE(44), GLIDE(88)]);
  });

  it('All again: the two that come fade in for 390ms where they land, opacity only, linear, and the two that stay glide back down', async () => {
    await render();
    await click(tab(/^No driver/));
    recorder.finishAll();
    const before = recorder.played.length;
    await click(tab(/^All/));
    expect(rowIds()).toEqual(['t-1', 't-2', 't-3', 't-4']);
    const played = recorder.played.slice(before);
    expect(played.map((p) => p.el.getAttribute('data-asg-row'))).toEqual(['t-2', 't-4', 't-1', 't-3']);
    expect(played.map(shape)).toEqual([GLIDE(-44), GLIDE(-88), FADE(390), FADE(390)]);
  });

  it('the rows’ own box clips while they move, never the scroller, and lets go after the last, leaving nothing', async () => {
    await render();
    await click(tab(/^No driver/));
    expect(rowsBox().style.overflow).toBe('clip');
    const scroller = section().parentElement!;
    expect(scroller.getAttribute('style')).toBeNull();
    onRows()[0]!.animation.finish();
    expect(rowsBox().style.overflow).toBe('clip');
    recorder.finishAll();
    expect(rowsBox().getAttribute('style')).toBeNull();
    expect([...container!.querySelectorAll('[data-asg-row]')].filter((r) => r.getAttribute('style'))).toEqual([]);
  });

  it('the column header stays over the rows: sticky at the top, z-10, opaque, before the rows’ box and outside it', async () => {
    await render();
    await click(tab(/^No driver/));
    expect(head().nextElementSibling).toBe(rowsBox());
    expect(rowsBox().contains(head())).toBe(false);
    expect(head().className).toMatch(/(^| )sticky( |$)/);
    expect(head().className).toMatch(/(^| )top-0( |$)/);
    expect(head().className).toMatch(/(^| )z-10( |$)/);
    expect(head().className).toMatch(/(^| )bg-surface-base( |$)/);
    // The box is a plain block, so the rows are laid out exactly as before.
    expect(rowsBox().getAttribute('class')).toBeNull();
  });

  it('a truck’s chip in the panel, for a truck the tab hides, sets the tab back to All by code: nothing plays on any row', async () => {
    await render();
    await click(tab(/^No phone/));
    expect(rowIds()).toEqual(['t-1', 't-3']);
    recorder.finishAll();
    const before = recorder.played.length;
    await click(button('Assign a driver to truck 143'));
    expect(rowIds()).toEqual(['t-1', 't-2', 't-3', 't-4']);
    expect(recorder.played.slice(before).filter((p) => p.el.hasAttribute('data-asg-row'))).toEqual([]);
    expect(recorder.played.slice(before).filter((p) => p.options.duration === 390)).toEqual([]);
  });

  it('the tab already chosen, the search, a refresh and a poll play nothing', async () => {
    await render();
    await click(tab(/^All/));
    const search = container!.querySelector<HTMLInputElement>('input[aria-label="Search trucks, drivers or phones"]')!;
    const typeIn = async (text: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, text);
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await typeIn('15');
    expect(rowIds()).toEqual(['t-3']);
    await typeIn('');
    // A refresh: another dispatcher put Cy on 143.
    await render({
      ...BOARD,
      trucks: BOARD.trucks.map((t) => (t.id === 't-2' ? truck('t-2', 143, 'd-c', 'Cy Tamm') : t)),
    });
    const polls = fleetCalls;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['fleet'] });
    });
    await untilShown('a poll', () => fleetCalls > polls);
    expect(recorder.played).toEqual([]);
  });

  it('under reduced motion nothing plays, and the rows end the same as with motion', async () => {
    await render();
    await click(tab(/^No driver/));
    await click(tab(/^All/));
    recorder.finishAll();
    const moved = markup(rowsBox());
    act(() => root!.unmount());
    root = createRoot(container!);
    recorder.played.length = 0;
    unreduce = reduceMotion();
    await render();
    await click(tab(/^No driver/));
    expect(rowIds()).toEqual(['t-2', 't-4']);
    await click(tab(/^All/));
    expect(recorder.played).toEqual([]);
    expect(markup(rowsBox())).toBe(moved);
  });
});

describe('asgMerge: the prompt fades in by itself, and a person’s answer slides what was below it up', () => {
  const answered = () =>
    recorder.played.filter((p) => p.el.hasAttribute('data-asg-head') || p.el.hasAttribute('data-asg-rows'));

  it('arriving by itself: the prompt fades in for 270ms, opacity only, linear, in the commit it lands in; nothing below it moves', async () => {
    open = [candidate('c-1', 'Ada Lovelace')];
    listHeld = true;
    await render();
    expect(prompt()).toBeNull();
    await untilShown('the list asked for', () => holdList !== null);
    holdList!();
    await untilShown('the prompt', () => prompt() !== null);
    expect(recorder.played.map((p) => p.el)).toEqual([prompt()]);
    expect(recorder.played.map(shape)).toEqual([FADE(270)]);
    // The commit it lands in already has its fade.
    expect(commits.find((c) => c.prompt)).toEqual({ prompt: true, played: 1 });
  });

  it('answered, Different people: it goes, and the column header and the rows slide up from where they stood, 160px in 270ms', async () => {
    open = [candidate('c-1', 'Ada Lovelace')];
    await render();
    await untilShown('the prompt', () => prompt() !== null);
    recorder.finishAll();
    const before = recorder.played.length;
    const at = commits.length;
    await click(button('Different people'));
    await untilShown('the prompt gone', () => prompt() === null);
    expect(answered().map((p) => p.el)).toEqual([head(), rowsBox()]);
    expect(answered().map(shape)).toEqual([GLIDE(160, 270), GLIDE(160, 270)]);
    expect(recorder.played.slice(before)).toEqual(answered());
    // The commit it went in already had both slides.
    expect(commits.slice(at).find((c) => !c.prompt)).toEqual({ prompt: false, played: before + 2 });
  });

  it('the section clips while they slide, never the scroller, and lets go after the last, leaving nothing', async () => {
    open = [candidate('c-1', 'Ada Lovelace')];
    await render();
    await untilShown('the prompt', () => prompt() !== null);
    await click(button('Different people'));
    await untilShown('the prompt gone', () => prompt() === null);
    expect(section().style.overflow).toBe('clip');
    expect(section().parentElement!.getAttribute('style')).toBeNull();
    answered()[0]!.animation.finish();
    expect(section().style.overflow).toBe('clip');
    recorder.finishAll();
    expect(section().getAttribute('style')).toBeNull();
    expect(head().getAttribute('style')).toBeNull();
    expect(rowsBox().getAttribute('style')).toBeNull();
  });

  it('Same person, with two to ask: that one goes, the rows slide up by its 60px, and the prompt does not fade again', async () => {
    open = [candidate('c-1', 'Ada Lovelace'), candidate('c-2', 'Bo Lindqvist')];
    await render(BOARD, 'admin');
    await untilShown('the prompt, asking twice', () => prompt()?.querySelectorAll('li').length === 2);
    recorder.finishAll();
    const before = recorder.played.length;
    const link = [...prompt()!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      (b.textContent ?? '').startsWith('Same person'),
    )!;
    await click(link);
    await untilShown('the prompt, asking once', () => prompt()?.querySelectorAll('li').length === 1);
    expect(recorder.played.slice(before).map(shape)).toEqual([GLIDE(60, 270), GLIDE(60, 270)]);
    expect(on(prompt())).toHaveLength(1);
  });

  it('an answer that fails: the prompt stays and says so, and nothing slides or fades', async () => {
    open = [candidate('c-1', 'Ada Lovelace')];
    await render();
    await untilShown('the prompt', () => prompt() !== null);
    recorder.finishAll();
    const before = recorder.played.length;
    answerFails = true;
    await click(button('Different people'));
    await untilShown('the refusal', () => Boolean(prompt()?.querySelector('[role="alert"]')));
    expect(recorder.played.slice(before)).toEqual([]);
  });

  it('a poll and a refresh with the prompt on the page play nothing', async () => {
    open = [candidate('c-1', 'Ada Lovelace')];
    await render();
    await untilShown('the prompt', () => prompt() !== null);
    const before = recorder.played.length;
    const polls = fleetCalls;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['fleet'] });
    });
    await untilShown('a poll', () => fleetCalls > polls);
    await render({ ...BOARD, trucks: BOARD.trucks.map((t) => ({ ...t })) });
    expect(prompt()).not.toBeNull();
    expect(recorder.played.slice(before)).toEqual([]);
  });

  it('under reduced motion nothing plays, arriving or answered, and the page ends the same as with motion', async () => {
    open = [candidate('c-1', 'Ada Lovelace')];
    await render();
    await untilShown('the prompt', () => prompt() !== null);
    await click(button('Different people'));
    await untilShown('the prompt gone', () => prompt() === null);
    recorder.finishAll();
    const moved = markup(section());
    act(() => root!.unmount());
    root = createRoot(container!);
    recorder.played.length = 0;
    unreduce = reduceMotion();
    open = [candidate('c-1', 'Ada Lovelace')];
    await render();
    await untilShown('the prompt', () => prompt() !== null);
    await click(button('Different people'));
    await untilShown('the prompt gone', () => prompt() === null);
    expect(recorder.played).toEqual([]);
    expect(markup(section())).toBe(moved);
  });
});
