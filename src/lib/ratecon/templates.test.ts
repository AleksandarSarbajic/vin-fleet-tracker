import { describe, expect, it } from 'vitest';
import { LABEL_ROWS, PU_SO, PU_SO_PASTED, STOPS_SECTION, puSoBlocks } from '@/test/ratecon-fixtures';
import type { TinyRun } from '@/test/tiny-pdf';
import { linesFromRuns, linesFromText, type Line } from './lines';
import { readRatecon, recognisedLayouts, type ReadOutcome, type RateconRead } from './templates';

/** §12.122. The three layouts, read from INVENTED documents (src/test/ratecon-fixtures.ts). */

const lines = (pages: TinyRun[][]): Line[] =>
  linesFromRuns(pages.flatMap((runs, i) => runs.map((r) => ({ page: i + 1, ...r }))));
const read = (outcome: ReadOutcome): RateconRead => {
  if (!outcome.ok) throw new Error('not recognised');
  return outcome.read;
};
const summary = (r: RateconRead) =>
  r.stops.map((s) => [s.type.value, s.street?.value, s.city?.value, s.state?.value, s.zip?.value]);

describe('label rows', () => {
  const r = read(readRatecon(lines(LABEL_ROWS)));

  it('is recognised, and reads the number under "Order ID"', () => {
    expect(r.layout).toBe('label-rows');
    expect(r.loadNumber?.value).toBe('550123');
    expect(r.loadNumber?.source).toEqual({ text: '550123', page: 1 });
  });

  it('reads the pickup and the delivery, in order, and nothing from the billing address', () => {
    expect(summary(r)).toEqual([
      ['PU', '4001 MAIN ST', 'FARGO', 'ND', '58102'],
      ['DEL', '1200 HARBOR RD', 'DICKINSON', 'ND', '58601'],
    ]);
    expect(r.stops[0]!.city?.source).toEqual({ text: 'CITY, STATE  FARGO, ND 58102', page: 1 });
  });

  it('reads a 12-hour time and a 24-hour window', () => {
    expect(r.stops[0]!.time).toMatchObject({ kind: 'exact', date: '2026-10-12', time: '07:30', flag: 'APPT' });
    expect(r.stops[1]!.time).toMatchObject({
      kind: 'range', date: '2026-10-13', time: '08:00', endDate: '2026-10-13', endTime: '09:30',
    });
  });

  it('quotes a time it cannot read, and never guesses one', () => {
    const odd = LABEL_ROWS.map((page) =>
      page.map((run) =>
        run.text.startsWith('10/13/2026') ? { ...run, text: '10/13/2026 (Tuesday) DELIVERY TIME: BY 10P OR 10/14 7-10A' } : run,
      ),
    );
    expect(read(readRatecon(lines(odd))).stops[1]!.time).toEqual({
      kind: 'unreadable',
      date: '2026-10-13',
      quoted: 'BY 10P OR 10/14 7-10A',
      source: { text: 'DELIVERY DATE  10/13/2026 (Tuesday) DELIVERY TIME: BY 10P OR 10/14 7-10A', page: 1 },
    });
  });

  it('reads "7-10A" as both morning, and refuses a bare "8:00"', () => {
    const at = (time: string) =>
      read(
        readRatecon(
          lines(LABEL_ROWS.map((p) => p.map((run) => (run.text.startsWith('10/12/2026') ? { ...run, text: `10/12/2026 (Monday) PICKUP TIME: ${time}` } : run)))),
        ),
      ).stops[0]!.time;
    expect(at('7-10A')).toMatchObject({ kind: 'range', time: '07:00', endTime: '10:00' });
    expect(at('8:00')).toMatchObject({ kind: 'unreadable', quoted: '8:00' });
    expect(at('12:15PM')).toMatchObject({ kind: 'exact', time: '12:15' });
  });
});

describe('a Stops section', () => {
  const r = read(readRatecon(lines(STOPS_SECTION)));

  it('reads the load ID and the stops from the section, across the page break', () => {
    expect(r.layout).toBe('stops-section');
    expect(r.loadNumber?.value).toBe('77001');
    expect(summary(r)).toEqual([
      ['PU', '4001 Main St', 'Fargo', 'ND', '58102'],
      ['DEL', '1200 Harbor Rd', 'Dickinson', 'ND', '58601'],
    ]);
    expect(r.stops[1]!.city?.source.page).toBe(2);
  });

  it('reads a date wrapped across lines in its own column', () => {
    expect(r.stops[0]!.time).toMatchObject({ kind: 'range', date: '2026-10-12', time: '08:00', endTime: '09:30', flag: 'APPT' });
    expect(r.stops[1]!.time).toMatchObject({ kind: 'range', date: '2026-10-13', time: '07:00', endTime: '15:00', flag: 'APPT' });
  });
});

describe('PU / SO blocks', () => {
  it('reads past a facility code line, and a state and ZIP run together', () => {
    const r = read(readRatecon(lines(puSoBlocks(PU_SO))));
    expect(r.layout).toBe('pu-so-blocks');
    expect(r.loadNumber?.value).toBe('88123');
    expect(summary(r)).toEqual([
      ['PU', '4001 Main St', 'FARGO', 'ND', '58102'],
      ['DEL', '1200 Harbor Rd', 'DICKINSON', 'ND', '58601'],
    ]);
  });

  it('reads two equal times as one, and two different ones as a window', () => {
    const r = read(readRatecon(lines(puSoBlocks(PU_SO))));
    expect(r.stops[0]!.time).toMatchObject({ kind: 'exact', date: '2026-10-12', time: '08:00' });
    expect(r.stops[1]!.time).toMatchObject({ kind: 'range', time: '07:00', endTime: '15:00' });
  });

  it('reads the order date at the top as nothing', () => {
    const r = read(readRatecon(lines(puSoBlocks(PU_SO))));
    expect(r.stops.every((s) => s.time.kind !== 'none' && 'date' in s.time && s.time.date !== '2026-10-01')).toBe(true);
  });

  it('reads "Load Number:" as the load number too', () => {
    expect(read(readRatecon(lines(puSoBlocks(PU_SO, 'Load Number:')))).loadNumber?.value).toBe('88123');
  });

  it('says so when an SO before the last stop is read as a delivery', () => {
    const three = [PU_SO[0]!, { ...PU_SO[1]!, kind: 'SO' as const }, { ...PU_SO[1]!, kind: 'SO' as const }];
    const r = read(readRatecon(lines(puSoBlocks(three))));
    expect(r.stops.map((s) => s.typeCheck !== null)).toEqual([false, true, false]);
  });

  it('reads the same document pasted as text', () => {
    const r = read(readRatecon(linesFromText(PU_SO_PASTED)));
    expect(summary(r)).toEqual([
      ['PU', '4001 Main St', 'FARGO', 'ND', '58102'],
      ['DEL', '1200 Harbor Rd', 'DICKINSON', 'ND', '58601'],
    ]);
    expect(r.stops[0]!.city?.source).toEqual({ text: 'FARGO ND 58102 Contact: Dock', page: null });
  });
});

describe('not recognised: nothing is read', () => {
  it('when one label of the layout is missing', () => {
    const without = (pages: TinyRun[][], text: string) => pages.map((p) => p.filter((r) => r.text !== text));
    expect(readRatecon(lines(without(LABEL_ROWS, 'ORDER CONFIRMATION')))).toEqual({ ok: false, reason: 'not-recognised' });
    expect(readRatecon(lines(without(STOPS_SECTION, 'Customer')))).toEqual({ ok: false, reason: 'not-recognised' });
    expect(readRatecon(lines(without(puSoBlocks(PU_SO), 'Driver Load:')))).toEqual({ ok: false, reason: 'not-recognised' });
  });

  it('when two layouts both match: neither is chosen', () => {
    const both = [...lines(LABEL_ROWS), ...lines(puSoBlocks(PU_SO))];
    expect(recognisedLayouts(both)).toHaveLength(2);
    expect(readRatecon(both)).toEqual({ ok: false, reason: 'not-recognised' });
  });

  it('for text that is not a rate confirmation', () => {
    expect(readRatecon(linesFromText('Dear carrier,\nPlease find attached.'))).toEqual({ ok: false, reason: 'not-recognised' });
  });
});
