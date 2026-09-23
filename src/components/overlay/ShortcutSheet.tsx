'use client';

import { useEffect } from 'react';
import {
  GROUP_LABEL,
  KEY_GROUPS,
  bindingsIn,
  isTypingTarget,
  type Binding,
} from '@/lib/keymap';
import { Overlay, useOverlay } from './OverlayLayer';

/**
 * The keyboard cheat sheet (§14, feature 1).
 *
 * **Interpretation — no screen was drawn for this.** §14.1 gave the contents
 * and §14.3 gave the binding rule; the layout follows the console's existing
 * modal conventions (condensed uppercase headings, `text-small` body, hair
 * rules) rather than inventing a second dialect.
 *
 * Every row comes from `KEYMAP`. Nothing here is a list of keys — that is the
 * whole point of the registry, and the reason the design brief's caveat
 * ("the keymap can't be pulled from source") does not apply to what shipped.
 */

function Cap({ children }: { children: React.ReactNode }) {
  // §14.4's kbd cap: primary ink on base with a hair edge, 14.91:1.
  return (
    <kbd className="inline-flex min-w-[22px] items-center justify-center border border-line-hair bg-surface-base px-1.5 py-0.5 font-mono text-[11px] leading-none text-text">
      {children}
    </kbd>
  );
}

function Row({ binding }: { binding: Binding }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 py-1.5 ${
        binding.planned ? 'opacity-45' : ''
      }`}
    >
      <span className="flex items-center gap-1">
        {binding.keys.map((key, i) =>
          // A bare separator between caps is not itself a key.
          key === '–' ? (
            <span key={i} className="text-text-mutedOnOverlay">
              –
            </span>
          ) : (
            <Cap key={i}>{key}</Cap>
          ),
        )}
      </span>
      <span className="text-right text-small text-text-secondary">
        {binding.label}
        {/*
          A sheet that lists a key which does nothing is worse than one that
          admits the key is absent — the reader tries it, nothing happens, and
          now the whole sheet is suspect.

          "not yet" rather than "soon": the sheet knows the key does nothing
          today and knows nothing at all about when it will, and a schedule
          nobody promised is the kind of thing a reader remembers.
        */}
        {binding.planned ? (
          <span className="ml-1.5 font-cond text-micro uppercase tracking-[.09em] text-text-mutedOnOverlay">
            not yet
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function ShortcutSheet() {
  const { show, toggle, open } = useOverlay();

  /**
   * §14.3: matched on the key VALUE, not the physical key — on US layouts `?`
   * shares a key with `/`, and matching the code would bind the wrong one on
   * every other layout.
   *
   * `?` inside the palette types a "?" (§14.5), so the binding stands down
   * whenever any overlay is already open; Esc closes those.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '?') return;
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (open !== null && open !== 'shortcuts') return;
      event.preventDefault();
      toggle('shortcuts');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, open]);

  return (
    <Overlay name="shortcuts" label="Keyboard shortcuts" width="w-[460px]">
      <div className="flex items-baseline justify-between border-b border-line-soft px-4 py-3">
        <h2 className="font-cond text-[17px] font-semibold uppercase leading-[1.1] tracking-[.06em] text-text">
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          onClick={() => show(null)}
          className="font-cond text-micro uppercase tracking-[.09em] text-text-mutedOnOverlay hover:text-text"
        >
          Esc
        </button>
      </div>

      <div className="px-4 py-3">
        {KEY_GROUPS.map((group) => {
          const bindings = bindingsIn(group);
          if (bindings.length === 0) return null;
          return (
            <section key={group} className="mb-3 last:mb-0">
              <h3 className="mb-1 border-b border-line-soft pb-1 font-cond text-micro uppercase tracking-[.11em] text-text-mutedOnOverlay">
                {GROUP_LABEL[group]}
              </h3>
              {bindings.map((b) => (
                <Row key={`${b.group}-${b.keys.join('')}`} binding={b} />
              ))}
            </section>
          );
        })}
      </div>

      {/*
        §14 feature 12's way back in. The tour opens itself once and then
        never again, so without this it would be unreachable — and it is not
        worth a binding of its own (§14 proposed five keys and no more).
        Opening it REPLACES this sheet, because the layer holds one value.
      */}
      <div className="border-t border-line-soft px-4 py-2">
        <button
          type="button"
          onClick={() => show('tour')}
          className="font-cond text-micro uppercase tracking-[.09em] text-accent hover:text-accent-hover"
        >
          Take the tour again
        </button>
      </div>
    </Overlay>
  );
}
