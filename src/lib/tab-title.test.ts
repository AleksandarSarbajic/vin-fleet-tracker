import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_TITLE } from './brand';
import { NOT_UPDATING_AFTER_MS, NOT_UPDATING_HIDDEN_AFTER_MS, RETURN_GRACE_MS, titleNotUpdating } from './sync-state';
import { tabTitle } from './tab-title';
import { FLEET_HIDDEN_POLL_MS, FLEET_POLL_MS } from '@/hooks/useFleet';

/** Phase 3bx, QoL 5 (§12.164): what the tab says, and when it says the board is not updating. */

describe('tabTitle (QoL 5)', () => {
  it('the late count, the plain title otherwise', () => {
    expect(tabTitle({ late: 3, feedStale: false, notUpdating: false })).toBe('3 late · Fleet Tracker');
    expect(tabTitle({ late: 1, feedStale: false, notUpdating: false })).toBe('1 late · Fleet Tracker');
    expect(tabTitle({ late: 0, feedStale: false, notUpdating: false })).toBe(APP_TITLE);
  });

  it('a stale feed claims nothing, though the chip still counts late there', () => {
    expect(tabTitle({ late: 3, feedStale: true, notUpdating: false })).toBe('Feed down · Fleet Tracker');
    expect(tabTitle({ late: 0, feedStale: true, notUpdating: false })).toBe('Feed down · Fleet Tracker');
  });

  it('not updating comes first: nothing on the board is current then, the feed included', () => {
    expect(tabTitle({ late: 3, feedStale: true, notUpdating: true })).toBe('Not updating · Fleet Tracker');
    expect(tabTitle({ late: 0, feedStale: false, notUpdating: true })).toBe('Not updating · Fleet Tracker');
  });

  it("the plain title is the layout's own: one constant, read by app/layout.tsx", () => {
    expect(APP_TITLE).toBe('Fleet Tracker — Vin Logistics');
    const layout = readFileSync(join(import.meta.dirname, '..', 'app', 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/^\s*title: APP_TITLE,$/m);
  });
});

describe('titleNotUpdating (QoL 5)', () => {
  const T = 10_000_000;
  const seen = (ago: number, visible: boolean, back: number | null = null) => ({
    lastSuccessAt: T - ago,
    visible,
    visibleSince: back === null ? null : T - back,
  });

  it("visible: the header's own rule, a minute with no answer", () => {
    expect(titleNotUpdating(seen(NOT_UPDATING_AFTER_MS - 1, true), T)).toBe(false);
    expect(titleNotUpdating(seen(NOT_UPDATING_AFTER_MS + 1, true), T)).toBe(true);
  });

  it('hidden: three hidden polls with no answer, where the header says nothing', () => {
    expect(NOT_UPDATING_HIDDEN_AFTER_MS).toBe(3 * FLEET_HIDDEN_POLL_MS);
    expect(NOT_UPDATING_AFTER_MS).toBe(3 * FLEET_POLL_MS);
    expect(titleNotUpdating(seen(NOT_UPDATING_HIDDEN_AFTER_MS - 1, false), T)).toBe(false);
    expect(titleNotUpdating(seen(NOT_UPDATING_HIDDEN_AFTER_MS + 1, false), T)).toBe(true);
  });

  it('just back from a tab that was not hearing from us: it does not take it back during the grace', () => {
    expect(titleNotUpdating(seen(NOT_UPDATING_HIDDEN_AFTER_MS + 1, true, RETURN_GRACE_MS - 1), T)).toBe(true);
    // A tab that was hearing from us is not called down in those moments.
    expect(titleNotUpdating(seen(NOT_UPDATING_AFTER_MS + 1, true, RETURN_GRACE_MS - 1), T)).toBe(false);
  });
});
