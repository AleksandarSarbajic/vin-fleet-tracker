import { describe, expect, it } from 'vitest';
import { timeInZone } from '@/lib/format';
import { needsReachedAnswer, reachedPrompt } from './reached-stop';

/**
 * A reached stop saved with a new city or load number is asked about, every
 * time — never guessed at. The rule is shared by the modal, which asks before
 * sending, and the server, which refuses a save that skipped the question.
 */

const TZ = 'America/Chicago';

/** Truck 141 on 2026-09-28: load 12120640 detected at Joliet, not yet departed. */
const reached = {
  arrivedAt: '2026-09-28T12:40:00.000Z',
  city: 'Joliet',
  loadNumber: '12120640',
};
const unreached = { ...reached, arrivedAt: null };

describe('when the question is asked', () => {
  it.each([
    ['a new city', { city: 'Des Plaines', loadNumber: '12120640' }],
    ['a new load number', { city: 'Joliet', loadNumber: '200584' }],
    ['the load number cleared', { city: 'Joliet', loadNumber: null }],
    ['the city cleared', { city: null, loadNumber: '12120640' }],
    // No "typo-sized" exemption: the dispatcher answers, not a heuristic.
    ['the same city in other capitals', { city: 'JOLIET', loadNumber: '12120640' }],
  ])('asks on a reached stop given %s', (_, edit) => {
    expect(needsReachedAnswer(reached, edit)).toBe(true);
  });

  it('asks when a reached stop that had no city is given one', () => {
    expect(needsReachedAnswer({ ...reached, city: null }, { city: 'Joliet', loadNumber: '12120640' })).toBe(true);
  });

  it('does not ask on a stop that was not reached, whatever changed', () => {
    expect(needsReachedAnswer(unreached, { city: 'Des Plaines', loadNumber: '200584' })).toBe(false);
  });

  it('does not ask when neither the city nor the number changed', () => {
    expect(needsReachedAnswer(reached, { city: 'Joliet', loadNumber: '12120640' })).toBe(false);
  });

  it('reads an omitted load number as "left alone", not as cleared (§12.21)', () => {
    expect(needsReachedAnswer(reached, { city: 'Joliet', loadNumber: undefined })).toBe(false);
  });
});

describe('the question', () => {
  it('gives the arrival in dispatch time', () => {
    const sameDay = new Date('2026-09-28T18:00:00.000Z');
    expect(reachedPrompt(reached.arrivedAt, TZ, sameDay)).toMatch(
      /^This stop was reached at 07:40 \S+\. Is this a correction, or the next trip\?$/,
    );
    expect(reachedPrompt(reached.arrivedAt, TZ, sameDay)).toContain(
      timeInZone(new Date(reached.arrivedAt), TZ),
    );
  });

  it('adds the weekday when the arrival was not today in dispatch time', () => {
    const nextDay = new Date('2026-09-29T18:00:00.000Z');
    expect(reachedPrompt(reached.arrivedAt, TZ, nextDay)).toMatch(/reached at Mon 07:40 \S+\./);
  });
});
