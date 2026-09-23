'use client';

import type { EmptyAction, EmptyState } from '@/lib/empty-state';

/**
 * §14 feature 7, the list half. **Interpretation** — turn 5 named the feature
 * and drew no screen, so this follows the console's existing voice rather
 * than a brief: the fact, then the way out.
 *
 * Deliberately quiet. An empty list is usually a filter doing its job, not a
 * fault, so there is no icon, no colour and no border — `text.secondary` on
 * the list's own ground, with the one control that undoes the cause. The
 * states that ARE a fault have banners above the list already (§9.8).
 *
 * `role="status"` rather than `alert`: it should reach a screen reader when
 * the list empties under a keystroke, without interrupting.
 */
export function EmptyList({
  state,
  onAction,
}: {
  state: EmptyState;
  onAction: (action: EmptyAction) => void;
}) {
  return (
    <div
      role="status"
      data-empty={state.kind}
      className="flex flex-col items-center gap-2 px-8 py-12 text-center"
    >
      <p className="font-cond text-[15px] uppercase tracking-[.1em] text-text-secondary">
        {state.headline}
      </p>
      <p className="max-w-[46ch] text-body text-text-muted">{state.detail}</p>
      {state.action ? (
        <button
          type="button"
          onClick={() => onAction(state.action!.key)}
          className="mt-1 border border-line-hair px-3 py-1 font-cond text-micro uppercase tracking-[.09em] text-accent hover:border-accent hover:text-accent-hover"
        >
          {state.action.label}
        </button>
      ) : null}
    </div>
  );
}
