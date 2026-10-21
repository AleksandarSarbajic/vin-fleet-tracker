// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DriverSelect } from './DriverSelect';
import { DriverName, NoEldTag } from '@/components/DriverName';
import type { BoardDriver } from '@/server/assignments';

/**
 * §12.136. Night desk is the assignment page's look, and only its.
 *
 * DriverSelect is the edit modal's picker too, and DriverName / NoEldTag
 * render every driver name on every surface. Each takes a `look` prop that
 * defaults to the console. These tests hold the scope two ways:
 *
 *   1. With no `look`, each renders EXACTLY the markup it rendered before 3an
 *      (captured from the pre-3an source, commit b0673a9, and pinned here),
 *      so no other surface's look can have moved.
 *   2. Only the assignment board asks for `'nightDesk'` (a source scan).
 *
 * The test DOM draws nothing: this proves the classes, not the pixels. The
 * pixels are the e2e baselines' (desktop 60, history 12: expected unchanged).
 */

const DRIVERS: BoardDriver[] = [
  { id: 'd-1', name: 'Samsara Sam', active: true, source: 'samsara', samsaraDriverId: 'sam-1', phone: null, truckId: null, truckLabel: null },
  { id: 'd-2', name: 'Hand Entered Hal', active: true, source: 'app', samsaraDriverId: null, phone: null, truckId: null, truckLabel: null },
];

/** `useId` values depend on render order; they are not part of the look. */
const clean = (html: string) => html.replace(/ (id|aria-controls)="[^"]*"/g, '');

function markup(element: React.ReactElement, then?: (c: HTMLElement) => void): string {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  act(() => root.render(element));
  if (then) act(() => then(c));
  const html = clean(c.innerHTML);
  act(() => root.unmount());
  c.remove();
  return html;
}

const select = (props: Partial<Parameters<typeof DriverSelect>[0]>) =>
  createElement(DriverSelect, {
    drivers: DRIVERS,
    value: null,
    claimedBy: new Map(),
    truckLabel: '137',
    disabled: false,
    onChange: vi.fn(),
    ...props,
  });
const open = (c: HTMLElement) => c.querySelector('input')!.click();

const CASES: Record<string, [React.ReactElement, ((c: HTMLElement) => void)?]> = {
  tag: [createElement(NoEldTag)],
  name: [createElement(DriverName, { name: 'Hand Entered Hal', source: 'app', samsaraDriverId: null })],
  nameStruck: [
    createElement(DriverName, { name: 'Hand Entered Hal', source: 'app', samsaraDriverId: null, struck: true }),
  ],
  fallbackStruck: [
    createElement(DriverName, { name: null, source: null, samsaraDriverId: null, fallback: '—', struck: true }),
  ],
  modalClosed: [select({ value: 'd-2' })],
  modalEmpty: [select({})],
  modalOpen: [select({ value: 'd-2', claimedBy: new Map([['d-1', '200']]) }), open],
  quietRow: [select({ value: 'd-2', quiet: true, size: 'row' })],
  quietLocked: [
    select({ value: 'd-1', quiet: true, size: 'row', disabled: true, disabledReason: 'Your role is viewer.' }),
  ],
};

/** Captured from the source before 3an (b0673a9). Do not regenerate to make a test pass. */
const BEFORE: Record<string, string> = {
  tag:
    "<span title=\"Added here, not in Samsara — there is no ELD behind this driver, so the truck's position comes from the vehicle only.\" class=\"shrink-0 border border-line-hair px-1 font-cond text-micro uppercase leading-[1.4] tracking-[.08em] text-text-muted\">No ELD</span>",
  name:
    "<span class=\"inline-flex items-baseline gap-1.5 \"><span class=\"truncate\">Hand Entered Hal</span><span title=\"Added here, not in Samsara — there is no ELD behind this driver, so the truck's position comes from the vehicle only.\" class=\"shrink-0 border border-line-hair px-1 font-cond text-micro uppercase leading-[1.4] tracking-[.08em] text-text-muted\">No ELD</span></span>",
  nameStruck:
    "<span class=\"inline-flex items-baseline gap-1.5 \"><span class=\"truncate line-through\">Hand Entered Hal</span><span title=\"Added here, not in Samsara — there is no ELD behind this driver, so the truck's position comes from the vehicle only.\" class=\"shrink-0 border border-line-hair px-1 font-cond text-micro uppercase leading-[1.4] tracking-[.08em] text-text-muted\">No ELD</span></span>",
  fallbackStruck:
    "<span class=\"line-through\">—</span>",
  modalClosed:
    "<div class=\"relative\"><input role=\"combobox\" aria-expanded=\"false\" aria-autocomplete=\"list\" aria-label=\"Driver for truck 137\" placeholder=\"\" class=\"h-9 w-full border px-2.5 text-body outline-offset-[-2px] disabled:opacity-45 text-text bg-surface-sunken border-line-hair pr-16\" type=\"text\" value=\"Hand Entered Hal\"><span class=\"absolute right-2 top-0 flex h-9 items-center\"><span title=\"Added here, not in Samsara — there is no ELD behind this driver, so the truck's position comes from the vehicle only.\" class=\"shrink-0 border border-line-hair px-1 font-cond text-micro uppercase leading-[1.4] tracking-[.08em] text-text-muted\">No ELD</span></span></div>",
  modalEmpty:
    "<div class=\"relative\"><input role=\"combobox\" aria-expanded=\"false\" aria-autocomplete=\"list\" aria-label=\"Driver for truck 137\" placeholder=\"Unassigned\" class=\"h-9 w-full border px-2.5 text-body outline-offset-[-2px] disabled:opacity-45 text-text-muted bg-surface-sunken border-line-soft \" type=\"text\" value=\"\"></div>",
  modalOpen:
    "<div class=\"relative\"><input role=\"combobox\" aria-expanded=\"true\" aria-autocomplete=\"list\" aria-label=\"Driver for truck 137\" placeholder=\"\" class=\"h-9 w-full border px-2.5 text-body outline-offset-[-2px] disabled:opacity-45 text-text bg-surface-sunken border-line-hair \" type=\"text\" value=\"\"><ul role=\"listbox\" class=\"absolute left-0 top-[38px] z-20 max-h-[264px] w-max min-w-full max-w-[420px] overflow-y-auto overflow-x-hidden border border-line-hair bg-surface-raised py-1\"><li><button type=\"button\" class=\"flex w-full items-center whitespace-nowrap px-2.5 py-1.5 text-left text-body text-text-secondary hover:bg-row-hover\">Unassigned — clear this truck</button></li><li><button type=\"button\" role=\"option\" aria-selected=\"true\" class=\"flex w-full items-baseline justify-between gap-3 whitespace-nowrap px-2.5 py-1.5 text-left text-body bg-row-hover text-text\"><span class=\"flex min-w-0 items-baseline gap-1.5\"><span class=\"truncate\" title=\"Hand Entered Hal\">Hand Entered Hal</span><span title=\"Added here, not in Samsara — there is no ELD behind this driver, so the truck's position comes from the vehicle only.\" class=\"shrink-0 border border-line-hair px-1 font-cond text-micro uppercase leading-[1.4] tracking-[.08em] text-text-muted\">No ELD</span></span><span class=\"shrink-0 font-cond text-micro uppercase tracking-[.08em] text-text-muted\">no truck</span></button></li><li data-first-on-a-truck=\"\" class=\"border-t border-line-soft\"><button type=\"button\" role=\"option\" aria-selected=\"false\" class=\"flex w-full items-baseline justify-between gap-3 whitespace-nowrap px-2.5 py-1.5 text-left text-body  text-text-muted\"><span class=\"flex min-w-0 items-baseline gap-1.5\"><span class=\"truncate\" title=\"Samsara Sam\">Samsara Sam</span></span><span class=\"shrink-0 font-cond text-micro uppercase tracking-[.08em] text-text-muted\">on truck 200</span></button></li></ul></div>",
  quietRow:
    "<div class=\"relative\"><input role=\"combobox\" aria-expanded=\"false\" aria-autocomplete=\"list\" aria-label=\"Driver for truck 137\" placeholder=\"\" class=\"h-8 w-full border px-2.5 text-body outline-offset-[-2px] disabled:opacity-45 text-text cursor-text border-transparent bg-transparent hover:border-line-hair hover:bg-surface-sunken focus:border-line-hair focus:bg-surface-sunken pr-16\" type=\"text\" value=\"Hand Entered Hal\"><span class=\"absolute right-2 top-0 flex h-8 items-center\"><span title=\"Added here, not in Samsara — there is no ELD behind this driver, so the truck's position comes from the vehicle only.\" class=\"shrink-0 border border-line-hair px-1 font-cond text-micro uppercase leading-[1.4] tracking-[.08em] text-text-muted\">No ELD</span></span></div>",
  quietLocked:
    "<div class=\"relative\"><input role=\"combobox\" aria-expanded=\"false\" aria-autocomplete=\"list\" aria-label=\"Driver for truck 137\" disabled=\"\" title=\"Your role is viewer.\" placeholder=\"\" class=\"h-8 w-full border px-2.5 text-body outline-offset-[-2px] disabled:opacity-45 text-text bg-surface-sunken border-line-hair \" type=\"text\" value=\"Samsara Sam\"></div>",
};

describe('outside the assignment page, the shared parts render as before 3an', () => {
  for (const [name, [element, then]] of Object.entries(CASES)) {
    it(`${name}: the same markup, character for character`, () => {
      expect(markup(element, then)).toBe(BEFORE[name]);
    });
  }

  it('passing look="console" is the same as passing nothing', () => {
    expect(markup(createElement(NoEldTag, { look: 'console' }))).toBe(BEFORE.tag);
    expect(markup(select({ value: 'd-2', look: 'console' }))).toBe(BEFORE.modalClosed);
  });
});

describe('look="nightDesk" (the assignment page)', () => {
  it('sets the No ELD tag in Night desk: sentence case, its face, its colours', () => {
    const html = markup(createElement(NoEldTag, { look: 'nightDesk' }));
    expect(html).toContain('text-nightDesk-tagInk');
    expect(html).toContain('border-nightDesk-control');
    expect(html).not.toContain('uppercase');
    expect(html).not.toContain('font-cond');
    expect(html).toContain('>No ELD<');
  });

  it('lets a long name truncate before its tag, whole in its title; struck on the name only', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() =>
      root.render(
        createElement(DriverName, {
          name: 'Hand Entered Hal',
          source: 'app',
          samsaraDriverId: null,
          struck: true,
          look: 'nightDesk',
        }),
      ),
    );
    const name = c.querySelector('[title="Hand Entered Hal"]')!;
    expect(name.className).toContain('min-w-0');
    expect(name.className).toContain('truncate');
    expect(name.className).toContain('line-through');
    const tag = c.querySelector('[title*="not in Samsara"]')!;
    expect(tag.className).toContain('text-nightDesk-tagInk');
    expect(tag.className).not.toContain('line-through');
    act(() => root.unmount());
    c.remove();
  });

  it('draws the picker field, its tag and its list in Night desk', () => {
    const html = markup(
      select({ value: 'd-2', claimedBy: new Map([['d-1', '200']]), quiet: true, size: 'row', look: 'nightDesk' }),
      open,
    );
    expect(html).toContain('bg-nightDesk-raisedHigh');
    expect(html).toContain('border-b-nightDesk-accent');
    expect(html).toContain('rounded-nightDesk border border-nightDesk-control bg-nightDesk-raised');
    expect(html).toContain('focus-visible:outline-nightDesk-accent');
    expect(html).not.toContain('font-cond');
    expect(html).not.toContain('bg-surface-');
  });

  it('shows an empty truck as an empty slot (a dashed box) at rest', () => {
    const html = markup(select({ quiet: true, size: 'row', look: 'nightDesk' }));
    expect(html).toContain('border-dashed border-nightDesk-control');
  });

  it('keeps a viewer’s locked field boxed, in muted ink, with a not-allowed cursor', () => {
    const html = markup(
      select({ value: 'd-1', quiet: true, size: 'row', disabled: true, disabledReason: 'Your role is viewer.', look: 'nightDesk' }),
    );
    expect(html).toContain('cursor-not-allowed');
    expect(html).toContain('border-nightDesk-border');
    expect(html).toContain('text-nightDesk-muted');
    expect(html).toContain('title="Your role is viewer."');
  });
});

describe('only the assignment board asks for Night desk', () => {
  const ROOT = join(process.cwd(), 'src');
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
    });

  it('finds look="nightDesk" in AssignmentBoard and DriverName only', () => {
    const asking = sources(ROOT)
      .filter((file) => /look="nightDesk"/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(`${ROOT}/`, ''))
      .sort();
    // DriverName passes it on to its own tag, inside its Night desk branch.
    expect(asking).toEqual(['components/DriverName.tsx', 'components/assignments/AssignmentBoard.tsx']);
  });

  it('finds the Night desk faces loaded by the assignments route only', () => {
    const loading = sources(ROOT)
      .filter((file) => /--font-nightdesk-/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(`${ROOT}/`, ''));
    expect(loading).toEqual(['app/assignments/layout.tsx']);
  });

  it('finds the edit modal’s picker passing no look', () => {
    const strip = readFileSync(join(ROOT, 'components/edit/LoadStrip.tsx'), 'utf8');
    expect(strip).toContain('<DriverSelect');
    expect(strip).not.toMatch(/look=/);
  });
});
