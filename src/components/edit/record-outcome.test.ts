// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_REPLY, SENTINEL, UNKNOWN_LAYOUT } from '@/test/model-read-fixtures';
import { prepareForReading } from '@/lib/ratecon/redact';
import { verifyRead } from '@/lib/ratecon/verify-read';
import { readCounts } from '@/lib/ratecon/session-counts';
import type { OutcomeBody } from '@/lib/ratecon/outcome-codes';
import { loadFormFrom, patchStop, type LoadForm } from './load-form';
import { fillLoad } from './ratecon-fill';
import { fillSnapshot } from './fill-outcome';
import { recordFillOutcome } from './record-outcome';

/**
 * Recording what the dispatcher did with an AI fill happens AFTER a load has
 * saved and must never touch it: it never throws, never rejects, and a
 * failure is counted in this tab and told to nobody.
 */

const NOW = new Date('2026-10-10T15:00:00.000Z');
const READ = '5b1e2c0a-7f3d-4c58-9a60-0e3f6d1b2a44';
const LAYOUT = ['00000001', '0a1b2c3d', 'ffffffff'];

const aiFilled = (): LoadForm => {
  const prepared = prepareForReading(UNKNOWN_LAYOUT);
  if (!prepared.ok) throw new Error(prepared.reason);
  const verified = verifyRead(MODEL_REPLY, prepared.lines, NOW);
  if (!verified.ok) throw new Error(verified.reason);
  const filled = fillLoad(loadFormFrom(null, NOW.toISOString(), null), verified.read, NOW.toISOString(), NOW);
  if (!filled.ok) throw new Error(filled.message);
  return filled.form;
};

beforeEach(() => window.sessionStorage.clear());

/** The tab's count is kept for the whole session, so each test compares with where it started. */
const notRecorded = () => readCounts().outcomeNotRecorded;

describe('recordFillOutcome', () => {
  it('posts the read id and the counts, once', async () => {
    const form = aiFilled();
    const post = vi.fn(async (_: OutcomeBody) => true);
    const before = notRecorded();
    await recordFillOutcome({ readId: READ, layout: LAYOUT, snapshot: fillSnapshot(form) }, form, post);
    expect(post).toHaveBeenCalledTimes(1);
    const sent = post.mock.calls[0]![0];
    expect(sent.readId).toBe(READ);
    expect(sent.layout).toEqual(LAYOUT);
    expect(sent.fields.map((f) => f.field)).toEqual(['load_number', 'stop_type', 'street', 'city', 'state', 'zip', 'appointment']);
    expect(notRecorded()).toBe(before);
  });

  it('what it posts holds no value: a sentinel typed into the form never leaves', async () => {
    const form = aiFilled();
    const saved = { ...form, loadNumber: SENTINEL, stops: form.stops.map((s) => patchStop(s, { addressLine: `${SENTINEL} Main St`, city: SENTINEL })) };
    const post = vi.fn(async (_: OutcomeBody) => true);
    await recordFillOutcome({ readId: READ, layout: LAYOUT, snapshot: fillSnapshot(form) }, saved, post);
    const text = JSON.stringify(post.mock.calls[0]![0]);
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('Main');
  });

  it('nothing pending: nothing is posted', async () => {
    const post = vi.fn(async () => true);
    await recordFillOutcome(null, aiFilled(), post);
    expect(post).not.toHaveBeenCalled();
  });

  it('a fill that put nothing in the form: nothing is posted', async () => {
    const empty = loadFormFrom(null, NOW.toISOString(), null);
    const post = vi.fn(async () => true);
    await recordFillOutcome({ readId: READ, layout: LAYOUT, snapshot: fillSnapshot(empty) }, empty, post);
    expect(post).not.toHaveBeenCalled();
  });

  it('a post that is refused is counted in this tab, and nothing is thrown', async () => {
    const form = aiFilled();
    const before = notRecorded();
    await expect(recordFillOutcome({ readId: READ, layout: LAYOUT, snapshot: fillSnapshot(form) }, form, async () => false)).resolves.toBeUndefined();
    expect(notRecorded()).toBe(before + 1);
  });

  it('a post that throws is counted and swallowed into that count, not into silence or a rejection', async () => {
    const form = aiFilled();
    const before = notRecorded();
    await expect(
      recordFillOutcome({ readId: READ, layout: LAYOUT, snapshot: fillSnapshot(form) }, form, async () => {
        throw new Error('network down');
      }),
    ).resolves.toBeUndefined();
    expect(notRecorded()).toBe(before + 1);
  });

  it('a summary that throws is the same: the save already happened', async () => {
    const form = aiFilled();
    const broken = { ...form, stops: null } as unknown as LoadForm;
    const post = vi.fn(async () => true);
    const before = notRecorded();
    await expect(recordFillOutcome({ readId: READ, layout: LAYOUT, snapshot: fillSnapshot(form) }, broken, post)).resolves.toBeUndefined();
    expect(post).not.toHaveBeenCalled();
    expect(notRecorded()).toBe(before + 1);
  });
});
