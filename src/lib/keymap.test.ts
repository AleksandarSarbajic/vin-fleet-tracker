// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { FILTER_KEYS } from '@/components/console/FilterChips';
import {
  KEYMAP,
  KEY_GROUPS,
  GROUP_LABEL,
  bindingsIn,
  isTypingTarget,
  isWindowOpen,
} from './keymap';

/**
 * §14.1. The registry exists so the cheat sheet cannot drift from the
 * application. These are the assertions that make that true rather than
 * merely intended.
 */

describe('the typing guard (§14.3)', () => {
  const el = (html: string) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.firstElementChild as HTMLElement;
  };

  it('holds every single-key binding inside a text field', () => {
    expect(isTypingTarget(el('<input>'))).toBe(true);
    expect(isTypingTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isTypingTarget(el('<select></select>'))).toBe(true);
  });

  it('holds inside contenteditable, which all three old copies missed', () => {
    expect(isTypingTarget(el('<div contenteditable="true">x</div>'))).toBe(true);
    // And on a child of one: a click can land the target on a text node's
    // parent rather than on the editable host itself.
    const host = el('<div contenteditable="true"><span>x</span></div>');
    expect(isTypingTarget(host.querySelector('span'))).toBe(true);
  });

  it('does not hold on contenteditable="false", which is a normal element', () => {
    expect(isTypingTarget(el('<div contenteditable="false">x</div>'))).toBe(false);
  });

  it('does not hold on the list, a button, or nothing at all', () => {
    expect(isTypingTarget(el('<button>Edit</button>'))).toBe(false);
    expect(isTypingTarget(el('<tr data-row-id="x"><td>1</td></tr>'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('the window guard', () => {
  const draw = (html: string) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    return host;
  };

  afterEach(() => document.body.replaceChildren());

  it('is false with nothing open', () => {
    draw('<button>Edit</button>');
    expect(isWindowOpen()).toBe(false);
  });

  it('is true while a window is open, and false once it is gone', () => {
    const host = draw('<div role="dialog" aria-modal="true"><button>Close</button></div>');
    expect(isWindowOpen()).toBe(true);
    host.remove();
    expect(isWindowOpen()).toBe(false);
  });

  it('counts a window whose panel carries the mark, as the phone sheets do', () => {
    draw('<div class="fixed"><div role="dialog" aria-modal="true"></div></div>');
    expect(isWindowOpen()).toBe(true);
  });

  it('a menu is not a window, and neither is a dialog that says it is not modal', () => {
    draw('<div role="menu"></div><div role="dialog"></div><div aria-modal="false"></div>');
    expect(isWindowOpen()).toBe(false);
  });

  it('does not count a window nobody can see: a phone sheet at desktop width', () => {
    draw('<div style="display: none"><div role="dialog" aria-modal="true"></div></div>');
    expect(isWindowOpen()).toBe(false);
  });

  it('a hidden window does not hide a real one', () => {
    draw('<div style="display: none"><div aria-modal="true"></div></div>');
    draw('<div aria-modal="true"></div>');
    expect(isWindowOpen()).toBe(true);
  });

  it('where the browser cannot say, a window counts as seen', () => {
    const host = draw('<div style="display: none"><div aria-modal="true"></div></div>');
    const sheet = host.querySelector('[aria-modal]');
    Object.defineProperty(sheet, 'checkVisibility', { value: undefined });
    expect(isWindowOpen()).toBe(true);
  });
});

describe('the registry describes what the console actually binds', () => {
  it('covers the number keys the chips actually have', () => {
    // §8.1 is "1–7 toggle, 0 resets". If a chip is added or removed, the
    // sheet's range is wrong and this is what says so.
    //
    // §12.78: Drivers only is the LAST key and has a row of its own, so the
    // range stops one short of it and its own digit is the chip count.
    const toggle = KEYMAP.find((b) => b.label === 'Toggle a status filter');
    expect(FILTER_KEYS.at(-1)).toBe('drivers');
    expect(toggle?.keys).toEqual(['1', '–', String(FILTER_KEYS.length - 1)]);
    const drivers = KEYMAP.find((b) => b.label.startsWith('Drivers only'));
    expect(drivers?.keys).toEqual([String(FILTER_KEYS.length)]);
  });

  it('gives every binding a group that is rendered and an owner to find', () => {
    for (const b of KEYMAP) {
      expect(KEY_GROUPS, b.label).toContain(b.group);
      expect(b.owner.length, b.label).toBeGreaterThan(0);
      expect(b.keys.length, b.label).toBeGreaterThan(0);
      expect(b.label.trim(), b.owner).toBe(b.label);
    }
  });

  it('labels every group, so the sheet can never render a blank heading', () => {
    for (const g of KEY_GROUPS) expect(GROUP_LABEL[g]).toBeTruthy();
  });

  it('puts every binding in exactly one group, and loses none to grouping', () => {
    const grouped = KEY_GROUPS.flatMap((g) => bindingsIn(g));
    expect(grouped).toHaveLength(KEYMAP.length);
  });

  /**
   * §12.95. `E` ("Edit the selected stop") sat in the sheet for months with no
   * handler behind it: a key the sheet promised and the console ignored.
   * Editing opens with Enter or a double-click; there is no edit letter.
   */
  it('lists no E: there is no single-letter edit key', () => {
    expect(KEYMAP.some((b) => b.keys.includes('E'))).toBe(false);
    expect(KEYMAP.some((b) => /edit/i.test(b.label) && b.keys.join('') !== 'Enter')).toBe(
      false,
    );
  });

  it('marks as planned exactly the keys §14 proposes but has not built', () => {
    // The brief proposed ? ⌘K P X D. All five have shipped — `⌘K` last, with
    // the command palette — so nothing is planned any more. This is an
    // assertion and not a deletion: a binding added to the map without a
    // handler should fail here rather than appear in the sheet as a live key.
    const planned = KEYMAP.filter((b) => b.planned).map((b) => b.keys.join(''));
    expect(planned).toEqual([]);
  });
});
