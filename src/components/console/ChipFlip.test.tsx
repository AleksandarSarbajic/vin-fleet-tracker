// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChipFlip } from './ChipFlip';
import { MOTION_MS } from '@/design/tokens';
import type { Status } from '@/lib/status';

/** §14.4's chip flip: "old fades out as the new fades in, 160ms. Width snaps." */

let container: HTMLDivElement;
let root: Root;

const render = (status: Status, reducedMotion = false) => {
  act(() => {
    root.render(
      <ChipFlip
        status={status}
        forced={false}
        label={undefined}
        reducedMotion={reducedMotion}
      />,
    );
  });
};

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, MOTION_MS.chip + 40));
  });
};

/**
 * One icon per chip (§5.1 — every state carries hue + shape + icon + word),
 * which counts chips without matching the positioning wrapper the way a class
 * selector did.
 */
const chips = () => [...container.querySelectorAll('svg')];
const ghost = () => container.querySelector('.animate-chip-out');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the flip', () => {
  it('shows one chip when nothing has changed', () => {
    render('ON_TIME');
    expect(ghost()).toBeNull();
    expect(container.textContent).toContain('On time');
  });

  it('keeps the old chip on screen while the new one arrives', () => {
    render('AT_RISK');
    render('LATE');
    expect(container.textContent).toContain('At risk');
    expect(container.textContent).toContain('Late');
  });

  /**
   * The outgoing copy is out of flow. That is what makes §14.4's "width
   * SNAPS" true: the box is sized by the incoming chip from the first frame,
   * so `At risk` becoming `Late` never drags the column with it.
   */
  it('takes the old chip out of the layout so the width snaps', () => {
    render('AT_RISK');
    render('LATE');
    expect(ghost()?.className).toContain('absolute');
    expect(ghost()?.className).toContain('right-0');
  });

  /** Two chips saying two different things is one announcement too many. */
  it('hides the old chip from assistive tech', () => {
    render('AT_RISK');
    render('LATE');
    expect(ghost()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is down to one chip again after 160ms', async () => {
    render('AT_RISK');
    render('LATE');
    await settle();
    expect(ghost()).toBeNull();
    expect(container.textContent).not.toContain('At risk');
  });

  /** The forced glyph and " · forced" change the chip without changing status. */
  it('flips when a status is forced onto the status it already had', () => {
    act(() => {
      root.render(
        <ChipFlip status="LATE" forced={false} label={undefined} reducedMotion={false} />,
      );
    });
    act(() => {
      root.render(
        <ChipFlip status="LATE" forced label={undefined} reducedMotion={false} />,
      );
    });
    expect(ghost()).not.toBeNull();
  });
});

describe('under reduced motion', () => {
  it('swaps with no ghost at all — 0ms means 0ms', () => {
    render('AT_RISK', true);
    render('LATE', true);
    expect(ghost()).toBeNull();
    expect(chips()).toHaveLength(1);
    expect(container.textContent).toContain('Late');
    // The WORD is what carries the state (§5.1), and it is already correct.
    expect(container.textContent).not.toContain('At risk');
  });
});
