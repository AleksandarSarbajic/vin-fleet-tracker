'use client';

import { useEffect, useRef, useState } from 'react';
import { MOTION_MS } from '@/design/tokens';
import type { Status } from '@/lib/status';
import { StatusChip } from './StatusChip';

/**
 * §14.4's chip flip.
 *
 * > Old chip fades out as the new fades in, 160ms. Width **snaps** — no
 * > layout animation.
 *
 * A crossfade needs both chips on screen at once, so this keeps the outgoing
 * one for 160ms and renders it out of flow, right-aligned over the incoming
 * one. Out of flow is what makes the width snap: the box is sized by the new
 * chip from the first frame, and `At risk` becoming `Late` never drags the
 * column with it.
 *
 * ## Why this is not inside StatusChip
 *
 * `StatusChip` is a pure function of its props, with no state and no
 * `'use client'`, and it renders in five places — the row, the map popup, the
 * edit modal, the detail panel. Only the row flips. Putting a clock inside it
 * would make every one of those a client component to animate a change four
 * of them cannot have.
 *
 * Right-aligned because the Status column is (§4.1). Two chips of different
 * widths have to agree on an edge, and it is the one the column already uses.
 */
export function ChipFlip({
  status,
  forced,
  label,
  reducedMotion,
}: {
  status: Status;
  forced: boolean;
  label: string | undefined;
  reducedMotion: boolean;
}) {
  const [ghost, setGhost] = useState<{
    status: Status;
    forced: boolean;
    label: string | undefined;
  } | null>(null);
  const previous = useRef({ status, forced, label });

  /**
   * Every dependency is a primitive, deliberately. An object would change
   * identity on every poll, the effect would re-run, and its cleanup would
   * clear the timer that was about to remove the ghost — so the outgoing chip
   * would sit there at full opacity until the next status change.
   */
  useEffect(() => {
    const was = previous.current;
    if (was.status === status && was.forced === forced && was.label === label) return;
    previous.current = { status, forced, label };
    // 0ms under the preference (§8.3). The new chip is simply there — the
    // WORD changed, and the word is what carries the state (§5.1).
    if (reducedMotion) return;
    setGhost(was);
    const timer = window.setTimeout(() => setGhost(null), MOTION_MS.chip);
    return () => window.clearTimeout(timer);
  }, [status, forced, label, reducedMotion]);

  return (
    <span className="relative inline-flex">
      {ghost ? (
        <span
          className="pointer-events-none absolute inset-y-0 right-0 animate-chip-out"
          aria-hidden="true"
        >
          <StatusChip status={ghost.status} forced={ghost.forced} label={ghost.label} />
        </span>
      ) : null}
      <StatusChip
        status={status}
        forced={forced}
        label={label}
        className={ghost ? 'animate-chip' : ''}
      />
    </span>
  );
}
