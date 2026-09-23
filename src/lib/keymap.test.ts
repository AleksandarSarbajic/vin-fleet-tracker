// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { FILTER_KEYS } from '@/components/console/FilterChips';
import { KEYMAP, KEY_GROUPS, GROUP_LABEL, bindingsIn, isTypingTarget } from './keymap';

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

describe('the registry describes what the console actually binds', () => {
  it('covers the number keys the chips actually have', () => {
    // §8.1 is "1–7 toggle, 0 resets". If a chip is added or removed, the
    // sheet's range is wrong and this is what says so.
    const toggle = KEYMAP.find((b) => b.label === 'Toggle a status filter');
    expect(toggle?.keys).toEqual(['1', '–', String(FILTER_KEYS.length)]);
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

  it('marks as planned exactly the keys §14 proposes but has not built', () => {
    // The brief proposes ? ⌘K P X D. `?` ships with the sheet itself; the
    // other four arrive with their features, and until then the sheet says
    // so rather than listing a key that does nothing.
    const planned = KEYMAP.filter((b) => b.planned).map((b) => b.keys.join(''));
    expect(planned.sort()).toEqual(['D', 'P', 'X', '⌘K']);
  });
});
