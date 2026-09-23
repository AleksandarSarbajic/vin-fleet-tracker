'use client';

import { useEffect, useState } from 'react';
import { Overlay, useOverlay } from './OverlayLayer';
import { TOUR, markTourSeen, shouldAutoOpen, stepKeys } from '@/lib/tour';

/**
 * §14 feature 12 — the onboarding tour. **Interpretation**: turn 5 listed it
 * and drew no screen.
 *
 * On the shared overlay layer, which is §14.5's ruling and also what decided
 * its shape: three surfaces that "share one scrim and one layer" cannot
 * include one that cuts a hole in the scrim to point at a control. So it
 * names the surfaces rather than pointing at them — and every key it names is
 * looked up in `KEYMAP`, so it cannot advertise a binding the console does
 * not have. See `lib/tour`.
 *
 * "⌘K during the tour ends the tour" needs no code: opening another overlay
 * replaces this one, because the layer holds a single value.
 */
export function OnboardingTour() {
  const { open, show } = useOverlay();
  const isOpen = open === 'tour';
  const [index, setIndex] = useState(0);

  /**
   * Opens itself once, and only when it can record having done so. Reading
   * `localStorage` in an effect rather than during render, the same as pins,
   * density and views: it is invisible to the server, so reading it while
   * rendering is a hydration mismatch and not a preference.
   */
  useEffect(() => {
    if (shouldAutoOpen()) show('tour');
  }, [show]);

  useEffect(() => {
    if (isOpen) setIndex(0);
  }, [isOpen]);

  /**
   * Dismissing counts as having seen it, and so does finishing.
   *
   * The alternative — only "Done" marks it seen — means someone who closes it
   * with Esc gets it again on the next load, which teaches them to close it
   * faster rather than to read it. The sheet still offers it back.
   */
  useEffect(() => {
    if (isOpen) return;
    markTourSeen();
  }, [isOpen]);

  const step = TOUR[index];
  if (!step) return null;
  const last = index === TOUR.length - 1;

  return (
    <Overlay name="tour" label="What this console does" width="w-[520px]">
      <div className="p-5">
        <p className="font-cond text-micro uppercase tracking-[.11em] text-text-mutedOnOverlay">
          {index + 1} of {TOUR.length}
        </p>
        <h2 className="mt-1 font-cond text-[19px] font-semibold uppercase leading-[1.15] tracking-[.05em] text-text">
          {step.title}
        </h2>
        <p className="mt-2 text-body leading-[1.55] text-text-secondary">{step.body}</p>

        {stepKeys(step).length > 0 ? (
          <p className="mt-3 flex flex-wrap items-center gap-2">
            {stepKeys(step).map((keys) => (
              <span key={keys.join('')} className="flex items-center gap-[2px]">
                {keys.map((key) => (
                  <kbd
                    key={key}
                    className="border border-line-hair bg-surface-base px-1 font-mono text-[11px] leading-[1.6] text-text"
                  >
                    {key}
                  </kbd>
                ))}
              </span>
            ))}
          </p>
        ) : null}

        {/* Progress as dots, because six steps is a number you can see. */}
        <div className="mt-5 flex items-center gap-4">
          <span className="flex items-center gap-1" aria-hidden="true">
            {TOUR.map((s, i) => (
              <span
                key={s.id}
                className={`h-[5px] w-[5px] ${i === index ? 'bg-accent' : 'bg-line-grip'}`}
              />
            ))}
          </span>

          <button
            type="button"
            onClick={() => show(null)}
            className="ml-auto font-cond text-micro uppercase tracking-[.09em] text-text-muted hover:text-text-secondary"
          >
            Skip
          </button>
          {index > 0 ? (
            <button
              type="button"
              onClick={() => setIndex((i) => i - 1)}
              className="border border-line-hair px-3 py-1 font-cond text-micro uppercase tracking-[.09em] text-text-secondary hover:bg-row-hover"
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => (last ? show(null) : setIndex((i) => i + 1))}
            className="bg-accent px-3 py-1 font-cond text-micro font-semibold uppercase tracking-[.09em] text-text-inverse hover:bg-accent-hover"
          >
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
