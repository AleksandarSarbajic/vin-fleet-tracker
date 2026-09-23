// @vitest-environment happy-dom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KEYMAP } from '@/lib/keymap';
import { OverlayProvider, Overlay, useOverlay } from './OverlayLayer';
import { ShortcutSheet } from './ShortcutSheet';

/**
 * §14 feature 1, and §14.5's rule that the three overlays share one layer.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
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

function mount(node: React.ReactNode) {
  act(() => root!.render(createElement(OverlayProvider, null, node)));
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });

const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"]'));
const dialogNamed = (name: string) =>
  dialogs().find((d) => d.getAttribute('aria-label') === name) ?? null;
const text = () => container?.textContent ?? '';

describe('the cheat sheet (§14 feature 1)', () => {
  it('is closed until asked for, and ? opens it', () => {
    mount(<ShortcutSheet />);
    expect(dialogs()).toHaveLength(0);
    press('?');
    expect(dialogNamed('Keyboard shortcuts')).toBeTruthy();
  });

  it('? closes it again, so one key both shows and hides', () => {
    mount(<ShortcutSheet />);
    press('?');
    press('?');
    expect(dialogs()).toHaveLength(0);
  });

  it('Esc closes it', () => {
    mount(<ShortcutSheet />);
    press('?');
    press('Escape');
    expect(dialogs()).toHaveLength(0);
  });

  it('does not open while the user is typing (§14.3)', () => {
    mount(<ShortcutSheet />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    expect(dialogs()).toHaveLength(0);
    input.remove();
  });

  it("does not open on ⌘? or ctrl+? — those belong to the browser", () => {
    mount(<ShortcutSheet />);
    press('?', { metaKey: true });
    press('?', { ctrlKey: true });
    expect(dialogs()).toHaveLength(0);
  });

  it('lists every binding the registry declares', () => {
    // The assertion that makes the registry load-bearing. Add a key to
    // KEYMAP and forget to render it, and this is what says so — which is
    // the drift the design brief warned about when it could not read the
    // keymap from source.
    mount(<ShortcutSheet />);
    press('?');
    for (const binding of KEYMAP) {
      expect(text(), binding.label).toContain(binding.label);
    }
  });

  it('marks the keys that do not work yet, without promising when they will', () => {
    mount(<ShortcutSheet />);
    press('?');
    const planned = KEYMAP.filter((b) => b.planned).length;
    expect(text().match(/not yet/g) ?? []).toHaveLength(planned);
  });
});

describe('the shared overlay layer (§14.5)', () => {
  function Harness() {
    const { show } = useOverlay();
    return (
      <div>
        <button onClick={() => show('palette')}>open palette</button>
        <ShortcutSheet />
        <Overlay name="palette" label="Command palette">
          palette body
        </Overlay>
      </div>
    );
  }

  const clickPalette = () => {
    const button = Array.from(container!.querySelectorAll('button')).find(
      (b) => b.textContent === 'open palette',
    )!;
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };

  it('never shows two at once — opening one replaces the other', () => {
    mount(<Harness />);
    press('?');
    expect(dialogNamed('Keyboard shortcuts')).toBeTruthy();
    clickPalette();
    expect(dialogs()).toHaveLength(1);
    expect(dialogNamed('Command palette')).toBeTruthy();
  });

  it('stands ? down while another overlay owns the keyboard (§14.5)', () => {
    // "? inside the palette types a ?" — so it must not also toggle a sheet
    // open behind it.
    mount(<Harness />);
    clickPalette();
    press('?');
    expect(dialogNamed('Command palette')).toBeTruthy();
    expect(dialogNamed('Keyboard shortcuts')).toBeNull();
  });

  it('closes on a click on the scrim, not on the panel', () => {
    mount(<Harness />);
    press('?');
    const scrim = dialogNamed('Keyboard shortcuts')!;
    const panel = scrim.firstElementChild!;
    act(() => panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(dialogs()).toHaveLength(1);
    act(() => scrim.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(dialogs()).toHaveLength(0);
  });
});
