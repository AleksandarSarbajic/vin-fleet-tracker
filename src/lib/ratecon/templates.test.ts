import { describe, expect, it } from 'vitest';
import {
  COLUMNS_STOPS,
  LABEL_ROWS,
  PU_SO,
  PU_SO_PASTED,
  ROUTE_STOPS,
  STOPS_SECTION,
  TABLE_MIDDLE,
  TABLE_STOPS,
  pickupDeliveryColumns,
  puSoBlocks,
  routeBlocks,
  stopTable,
  type ColumnsStop,
  type RouteStop,
  type TableStop,
} from '@/test/ratecon-fixtures';
import type { TinyRun } from '@/test/tiny-pdf';
import { linesFromRuns, linesFromText, type Line } from './lines';
import { SPLIT_CHECK, readRatecon, recognisedLayouts, type ReadOutcome, type RateconRead } from './templates';

/** §12.122. The six layouts, read from INVENTED documents (src/test/ratecon-fixtures.ts). */

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

describe('Pickup # / Delivery # columns (§12.125)', () => {
  const NOT = { ok: false, reason: 'not-recognised' };
  const doc = (stops: ColumnsStop[] = COLUMNS_STOPS) => lines(pickupDeliveryColumns(stops));
  const r = read(readRatecon(doc()));
  /** A run added to the stops page (page 2), at a height of its own. */
  const withRun = (x: number, y: number, text: string) =>
    lines(pickupDeliveryColumns(COLUMNS_STOPS).map((p, i) => (i === 1 ? [...p, { x, y, text }] : p)));

  it('is recognised, and claimed by no other reader, nor claims theirs', () => {
    expect(recognisedLayouts(doc())).toEqual(['pickup-delivery-columns']);
    for (const other of [lines(LABEL_ROWS), lines(STOPS_SECTION), lines(puSoBlocks(PU_SO))]) {
      expect(recognisedLayouts(other)).not.toContain('pickup-delivery-columns');
    }
  });

  it('reads the load number beside "Arrive Order", not "Load #" or "Shipment ID", and shows that label', () => {
    expect(r.loadNumber).toEqual({ value: '4455001', source: { text: 'Arrive Order  4455001', page: 1 } });
  });

  it('reads the pickup and the delivery from the address column, and nothing from the billing address or the page header', () => {
    expect(summary(r)).toEqual([
      ['PU', '4001 Main St', 'Fargo', 'ND', '58102'],
      ['DEL', '1200 Harbor Rd', 'Dickinson', 'ND', '58601'],
    ]);
    expect(r.stops[0]!.street?.source).toEqual({ text: '4001 Main St', page: 2 });
    expect(r.stops[0]!.city?.source).toEqual({ text: 'Fargo, ND 58102', page: 2 });
  });

  it('reads one date and time as exact, Earliest and Latest as a window, and APPT or FCFS from "Appt. Type"', () => {
    expect(r.stops[0]!.time).toMatchObject({ kind: 'exact', date: '2026-10-12', time: '14:30', flag: 'APPT' });
    expect(r.stops[1]!.time).toMatchObject({
      kind: 'range', date: '2026-10-13', time: '07:00', endDate: '2026-10-13', endTime: '09:00', flag: 'FCFS',
    });
  });

  it('never carries a rate, a phone, a PO or the carrier into what it read', () => {
    const said = JSON.stringify(r);
    for (const never of ['$', '1,900', '(555)', 'P-200', 'A-100', 'Sample Carrier', '20000', 'General Freight']) {
      expect(said).not.toContain(never);
    }
  });

  it('reads two Delivery blocks, in order', () => {
    const third: ColumnsStop = {
      ...COLUMNS_STOPS[1]!,
      name: 'North Yard',
      street: '77 Depot Ave',
      cityLine: 'Bismarck, ND 58501',
      when: { date: 'Oct 14, 2026', time: '06:00 CDT' },
      appt: 'By Appointment',
    };
    expect(summary(read(readRatecon(doc([...COLUMNS_STOPS, third]))))).toEqual([
      ['PU', '4001 Main St', 'Fargo', 'ND', '58102'],
      ['DEL', '1200 Harbor Rd', 'Dickinson', 'ND', '58601'],
      ['DEL', '77 Depot Ave', 'Bismarck', 'ND', '58501'],
    ]);
  });

  it('refuses a second address in a stop’s address column', () => {
    expect(readRatecon(withRun(23, 640, 'Moorhead, MN 56560'))).toEqual(NOT);
  });

  it('refuses an unlabelled address between the stops, or a second one after them', () => {
    expect(readRatecon(withRun(300, 580, 'Moorhead, MN 56560'))).toEqual(NOT);
    expect(readRatecon(withRun(275, 120, 'Moorhead, MN 56560'))).toEqual(NOT);
  });

  it('refuses when there is no Pickup heading, or no Delivery heading', () => {
    expect(readRatecon(doc([COLUMNS_STOPS[1]!]))).toEqual(NOT);
    expect(readRatecon(doc([COLUMNS_STOPS[0]!]))).toEqual(NOT);
  });

  it('refuses a stop without a city line, or a heading without its label row', () => {
    const noCity = pickupDeliveryColumns(COLUMNS_STOPS).map((p) => p.filter((run) => run.text !== 'Dickinson, ND 58601'));
    expect(readRatecon(lines(noCity))).toEqual(NOT);
    const noLabels = pickupDeliveryColumns(COLUMNS_STOPS).map((p) => p.filter((run) => run.text !== 'Delivery Address'));
    expect(readRatecon(lines(noLabels))).toEqual(NOT);
  });

  it('does not read the same document pasted as text: its columns cannot be told apart', () => {
    const pasted = pickupDeliveryColumns(COLUMNS_STOPS).flatMap((p) => p.map((run) => run.text)).join('\n');
    expect(readRatecon(linesFromText(pasted))).toEqual(NOT);
  });
});

describe('Route blocks (3aa)', () => {
  const NOT = { ok: false, reason: 'not-recognised' };
  const doc = (stops: RouteStop[] = ROUTE_STOPS, summaryLine?: string) => lines(routeBlocks(stops, summaryLine));
  const r = read(readRatecon(doc()));
  /** The two-stop document with every run of one text replaced. */
  const edited = (from: string, to: string) =>
    lines(routeBlocks(ROUTE_STOPS).map((p) => p.map((run) => (run.text === from ? { ...run, text: to } : run))));
  /** The two-stop document with a run added to page 1. */
  const withRun = (x: number, y: number, text: string, stops: RouteStop[] = ROUTE_STOPS) =>
    lines(routeBlocks(stops).map((p, i) => (i === 0 ? [...p, { x, y, text }] : p)));
  const pickupTime = (time: RouteStop['time'], extra?: string) => {
    const stops = [{ ...ROUTE_STOPS[0]!, time }, ROUTE_STOPS[1]!];
    return read(readRatecon(extra ? withRun(49, 300, extra, stops) : doc(stops))).stops[0]!.time;
  };
  const MIDDLE: RouteStop = {
    kind: 'Delivery',
    name: 'North Yard',
    street: '77 Depot Ave',
    city: 'Bismarck',
    state: 'ND',
    zip: '58501',
    date: 'Oct 13, 2026',
    time: '06:00 Apt',
    number: '20000002',
  };
  const others = () => [lines(LABEL_ROWS), lines(STOPS_SECTION), lines(puSoBlocks(PU_SO)), lines(pickupDeliveryColumns(COLUMNS_STOPS)), linesFromText(PU_SO_PASTED)];

  it('is recognised as this layout only; every other layout still matches exactly its own', () => {
    expect(recognisedLayouts(doc())).toEqual(['route-blocks']);
    expect(others().map((o) => recognisedLayouts(o))).toEqual([
      ['label-rows'],
      ['stops-section'],
      ['pu-so-blocks'],
      ['pickup-delivery-columns'],
      ['pu-so-blocks'],
    ]);
  });

  it('reads the ID under "Shipment ID" in the page header as the load number, not a Pickup # or Delivery # number', () => {
    expect(r.layout).toBe('route-blocks');
    expect(r.loadNumber).toEqual({ value: '40000-100001', source: { text: 'Shipment ID  40000-100001', page: 1 } });
    expect(r.loadNumberCheck).toBeNull();
  });

  it('reads a two-stop document in full, the street apart from the city where the summary line names the city', () => {
    expect(summary(r)).toEqual([
      ['PU', '4001 Main St', 'Fargo', 'ND', '58102'],
      ['DEL', '1200 Harbor Rd Unit 4', 'West Fargo', 'ND', '58078'],
    ]);
    expect(r.stops[1]!.city?.source).toEqual({ text: '1200 Harbor Rd Unit 4 West Fargo, ND 58078', page: 1 });
    expect(r.stops[0]!.type.source).toEqual({ text: 'Route  Pickup  Prairie Cold Storage', page: 1 });
    expect(r.stops.every((s) => s.typeCheck === null && s.fieldChecks === undefined)).toBe(true);
  });

  it('reads "HH:MM Apt", in one run or two, as an appointment at that time', () => {
    expect(r.stops[0]!.time).toEqual({
      kind: 'exact', date: '2026-10-12', time: '14:30', flag: 'APPT', source: { text: 'Oct 12, 2026 · 14:30 Apt', page: 1 },
    });
    expect(r.stops[1]!.time).toMatchObject({ kind: 'exact', date: '2026-10-13', time: '08:00', flag: 'APPT' });
  });

  it('reads "10:00 Apt" as 10:00 only on a 24-hour document; a leading zero or an hour past 12 stands on its own', () => {
    expect(pickupTime('10:00 Apt')).toMatchObject({ kind: 'exact', time: '10:00' });
    expect(pickupTime('10:00 Apt', 'Gate opens at 7 AM')).toEqual({
      kind: 'unreadable', date: '2026-10-12', quoted: 'Oct 12, 2026 10:00 Apt', source: { text: 'Oct 12, 2026 · 10:00 Apt', page: 1 },
    });
    expect(pickupTime('08:00 Apt', 'Gate opens at 7 AM')).toMatchObject({ kind: 'exact', time: '08:00' });
    expect(pickupTime('14:30 Apt', 'Gate opens at 7 AM')).toMatchObject({ kind: 'exact', time: '14:30' });
  });

  it('quotes any other time or date shape as unreadable, and never guesses one', () => {
    for (const time of ['14:30 - 16:30 Apt', 'FCFS', '2:30 PM Apt', '14:30', '14:30 Appt', '9:30 Apt', 'TBD'] as const) {
      expect(pickupTime(time), time).toMatchObject({ kind: 'unreadable', date: '2026-10-12', quoted: `Oct 12, 2026 ${time}` });
    }
    expect(read(readRatecon(edited('Oct 12, 2026', '10/12/2026'))).stops[0]!.time).toMatchObject({
      kind: 'unreadable', date: null, quoted: '10/12/2026 14:30 Apt',
    });
  });

  it('reads a three-stop document: the middle stop split by the app and marked, the named stops unmarked (3ac)', () => {
    const three = read(readRatecon(doc([ROUTE_STOPS[0]!, MIDDLE, ROUTE_STOPS[1]!])));
    expect(summary(three)).toEqual([
      ['PU', '4001 Main St', 'Fargo', 'ND', '58102'],
      ['DEL', '77 Depot Ave', 'Bismarck', 'ND', '58501'],
      ['DEL', '1200 Harbor Rd Unit 4', 'West Fargo', 'ND', '58078'],
    ]);
    const check = SPLIT_CHECK('77 Depot Ave Bismarck');
    expect(three.stops.map((s) => s.fieldChecks)).toEqual([undefined, { street: check, city: check }, undefined]);
    expect(three.stops[1]!.city?.source).toEqual({ text: '77 Depot Ave Bismarck, ND 58501', page: 1 });
  });

  it('reads a four-stop document: both middle stops split and marked', () => {
    const second: RouteStop = { ...MIDDLE, name: 'East Yard', street: '1907 4th Ave NW Unit 200', city: 'West Fargo', zip: '58078', number: '20000003' };
    const four = read(readRatecon(doc([ROUTE_STOPS[0]!, MIDDLE, second, ROUTE_STOPS[1]!])));
    expect(summary(four).map((s) => [s[1], s[2]])).toEqual([
      ['4001 Main St', 'Fargo'],
      ['77 Depot Ave', 'Bismarck'],
      ['1907 4th Ave NW Unit 200', 'West Fargo'],
      ['1200 Harbor Rd Unit 4', 'West Fargo'],
    ]);
    expect(four.stops.map((s) => s.fieldChecks !== undefined)).toEqual([false, true, true, false]);
  });

  it('reads a middle stop with a unit phrase, a directional then a unit, or a city beginning WEST or NEW', () => {
    const middle = (street: string, city: string) =>
      read(readRatecon(doc([ROUTE_STOPS[0]!, { ...MIDDLE, street, city }, ROUTE_STOPS[1]!]))).stops[1]!;
    for (const [street, city] of [
      ['77 Depot Ave Ste 4', 'Bismarck'],
      ['1907 4th Ave NW Unit 200', 'Mandan'],
      ['77 Depot Ave', 'West Fargo'],
      ['77 Depot Ave', 'New Salem'],
    ] as const) {
      const s = middle(street, city);
      expect([s.street?.value, s.city?.value], `${street} ${city}`).toEqual([street, city]);
      expect(s.fieldChecks?.street).toBe(SPLIT_CHECK(`${street} ${city}`));
    }
  });

  it('refuses the whole document when a middle stop divides no way, or more than one', () => {
    for (const [street, city] of [
      ['123 Main St', 'St Louis'],
      ['123 Main St', 'Park Ridge'],
      ['123 Broadway', 'Fargo'],
      ['123 Main St Ste 4 Unit 5', 'Fargo'],
      ['123 Main St', 'Big Stone Gap City'],
    ] as const) {
      const three = doc([ROUTE_STOPS[0]!, { ...MIDDLE, street, city }, ROUTE_STOPS[1]!]);
      expect(recognisedLayouts(three)).toEqual(['route-blocks']);
      expect(readRatecon(three), `${street} ${city}`).toEqual(NOT);
    }
  });

  it('refuses when the summary line is missing or doubled, or names another first or last facility', () => {
    expect(readRatecon(doc(ROUTE_STOPS, 'Prairie Cold Storage to Lakeside DC'))).toEqual(NOT);
    expect(readRatecon(withRun(117, 300, 'Prairie Cold Storage (Fargo, ND) > Lakeside DC (West Fargo, ND)'))).toEqual(NOT);
    expect(readRatecon(doc(ROUTE_STOPS, 'Other Plant (Fargo, ND) > Lakeside DC (West Fargo, ND)'))).toEqual(NOT);
    expect(readRatecon(doc(ROUTE_STOPS, 'Prairie Cold Storage (Fargo, ND) > Other DC (West Fargo, ND)'))).toEqual(NOT);
  });

  it("refuses an address that does not end in the summary's city and state, or does not start like a street", () => {
    expect(readRatecon(doc(ROUTE_STOPS, 'Prairie Cold Storage (Fargo, ND) > Lakeside DC (Moorhead, ND)'))).toEqual(NOT);
    expect(readRatecon(doc(ROUTE_STOPS, 'Prairie Cold Storage (Fargo, ND) > Lakeside DC (West Fargo, MN)'))).toEqual(NOT);
    expect(readRatecon(doc([ROUTE_STOPS[0]!, { ...ROUTE_STOPS[1]!, street: 'Harbor Rd' }]))).toEqual(NOT);
  });

  it('refuses a stop with no city line, or whose number says another type', () => {
    expect(readRatecon(edited('1200 Harbor Rd Unit 4 West Fargo, ND 58078', '1200 Harbor Rd Unit 4 West Fargo'))).toEqual(NOT);
    // A "Delivery #" elsewhere keeps the layout recognised, so the refusal is the reader's own.
    const mismatch = lines(
      routeBlocks(ROUTE_STOPS).map((p, i) => [
        ...p.map((run) => (run.text.startsWith('Delivery # ') ? { ...run, text: run.text.replace('Delivery', 'Pickup') } : run)),
        ...(i === 0 ? [{ x: 49, y: 300, text: 'Delivery # 0 means none' }] : []),
      ]),
    );
    expect(recognisedLayouts(mismatch)).toEqual(['route-blocks']);
    expect(readRatecon(mismatch)).toEqual(NOT);
  });

  it('refuses a block of any other shape: a line missing, a line too many, a cell beyond the columns', () => {
    const noLast = routeBlocks(ROUTE_STOPS).map((p) => p.filter((run) => !(run.text === 'dock_check_in-EXA' && run.y === 674)));
    expect(readRatecon(lines(noLast))).toEqual(NOT);
    expect(readRatecon(withRun(298, 668, 'Dock 4'))).toEqual(NOT);
    expect(readRatecon(withRun(420, 698, 'Dock 4'))).toEqual(NOT);
  });

  it('refuses a city line anywhere but a stop’s address', () => {
    expect(readRatecon(withRun(117, 300, '77 Depot Ave Bismarck, ND 58501'))).toEqual(NOT);
    expect(readRatecon(withRun(298, 668, '77 Depot Ave Bismarck, ND 58501'))).toEqual(NOT);
  });

  it('refuses a document with no delivery', () => {
    const second: RouteStop = { ...ROUTE_STOPS[0]!, name: 'Second Plant', street: '9 Mill Rd', city: 'Casselton', zip: '58012' };
    const pickups = withRun(49, 300, 'Delivery # 0 means none', [ROUTE_STOPS[0]!, second]);
    expect(recognisedLayouts(pickups)).toEqual(['route-blocks']);
    expect(readRatecon(pickups)).toEqual(NOT);
  });

  it('does not read the same document pasted as text: its columns cannot be told apart', () => {
    const pasted = linesFromText(doc().map((l) => l.text).join('\n'));
    expect(recognisedLayouts(pasted)).toEqual(['route-blocks']);
    expect(readRatecon(pasted)).toEqual(NOT);
  });

  it('says so when the page headers disagree on the shipment ID, and reads the stops anyway', () => {
    const pages = routeBlocks(ROUTE_STOPS).map((p, i) => (i === 1 ? p.map((run) => (run.text === '40000-100001' ? { ...run, text: '40000-100002' } : run)) : p));
    const disagree = read(readRatecon(lines(pages)));
    expect(disagree.loadNumber).toBeNull();
    expect(disagree.loadNumberCheck).toBe('More than one number is under “Shipment ID”: “40000-100001”, “40000-100002”.');
    expect(disagree.stops).toHaveLength(2);
  });

  it('never carries a rate, a phone, the carrier, the contact or a stop’s number into what it read', () => {
    const said = JSON.stringify(r);
    for (const never of ['$', '1,900', '(555)', 'Sample Carrier', 'Dana Example', 'example.com', '10000001', '20000001', 'dock_check_in']) {
      expect(said).not.toContain(never);
    }
  });
});

describe('Stop table (3ak)', () => {
  const NOT = { ok: false, reason: 'not-recognised' };
  type Options = Parameters<typeof stopTable>[1];
  const doc = (stops: TableStop[] = TABLE_STOPS, options?: Options) => lines(stopTable(stops, options));
  const r = read(readRatecon(doc()));
  /** Every run of one text replaced, on every page. */
  const edited = (from: string, to: string, stops: TableStop[] = TABLE_STOPS) =>
    lines(stopTable(stops).map((p) => p.map((run) => (run.text === from ? { ...run, text: to } : run))));
  /** Every run of these texts taken out. */
  const without = (...texts: string[]) => lines(stopTable(TABLE_STOPS).map((p) => p.filter((run) => !texts.includes(run.text))));
  /** A run added to page 1. */
  const withRun = (x: number, y: number, text: string, stops: TableStop[] = TABLE_STOPS) =>
    lines(stopTable(stops).map((p, i) => (i === 0 ? [...p, { x, y, text }] : p)));
  /** Page 1's runs on line `y` that start at these x run together into one, as OCR gives two cells that nearly touch. */
  const joined = (y: number, xs: number[], stops: TableStop[] = TABLE_STOPS) =>
    lines(
      stopTable(stops).map((p, i) => {
        if (i > 0) return p;
        const parts = p.filter((run) => run.y === y && xs.includes(run.x)).sort((a, b) => a.x - b.x);
        return [...p.filter((run) => !parts.includes(run)), { x: parts[0]!.x, y, text: parts.map((run) => run.text).join(' ') }];
      }),
    );
  /** The fixture's rows: stop 1's line A and B, its note, stop 2's lines A and B, then "Commodity". */
  const Y = { a1: 580, b1: 568, note: 552, a2: 532, b2: 520, end: 496 };
  const pickup = (patch: Partial<TableStop>): TableStop[] => [{ ...TABLE_STOPS[0]!, ...patch }, TABLE_STOPS[1]!];
  const others = () => [
    lines(LABEL_ROWS),
    lines(STOPS_SECTION),
    lines(puSoBlocks(PU_SO)),
    lines(pickupDeliveryColumns(COLUMNS_STOPS)),
    lines(routeBlocks(ROUTE_STOPS)),
    linesFromText(PU_SO_PASTED),
  ];

  it('is recognised as this layout only; every other layout still matches exactly its own', () => {
    expect(recognisedLayouts(doc())).toEqual(['stop-table']);
    expect(others().map((o) => recognisedLayouts(o))).toEqual([
      ['label-rows'],
      ['stops-section'],
      ['pu-so-blocks'],
      ['pickup-delivery-columns'],
      ['route-blocks'],
      ['pu-so-blocks'],
    ]);
  });

  it('reads the number in the "LOAD NUMBER" box as the load number', () => {
    expect(r.layout).toBe('stop-table');
    expect(r.loadNumber).toEqual({ value: '610042', source: { text: 'LOAD NUMBER  610042', page: 1 } });
    expect(r.loadNumberCheck).toBeNull();
  });

  it('reads a two-stop table: the type from PU/Del, the city and state by their columns, the street and ZIP around the phone', () => {
    expect(summary(r)).toEqual([
      ['PU', '4001 MAIN ST', 'BEMIDJI', 'MN', '56601'],
      ['DEL', '1200 HARBOR RD', 'DICKINSON', 'ND', '58601'],
    ]);
    const s = r.stops[0]!;
    expect([s.type.source, s.street?.source, s.city?.source, s.state?.source, s.zip?.source]).toEqual([
      { text: '1 PU', page: 1 },
      { text: '4001 MAIN ST', page: 1 },
      { text: 'BEMIDJI MN', page: 1 },
      { text: 'BEMIDJI MN', page: 1 },
      { text: '56601', page: 1 },
    ]);
    expect(r.stops.every((x) => x.typeCheck === null && x.fieldChecks === undefined)).toBe(true);
  });

  it('reads each stop from its From date and time to its To date and time, the year from the document’s date; the window rules decide the rest', () => {
    expect(r.stops[0]!.time).toEqual({
      kind: 'range', date: '2026-10-12', time: '08:00', endDate: '2026-10-12', endTime: '16:00', flag: null,
      source: { text: '10/12 10/12 · 08:00 16:00', page: 1 },
    });
    expect(r.stops[1]!.time).toMatchObject({ kind: 'range', date: '2026-10-13', time: '09:00', endTime: '10:30', flag: null });
  });

  it('reads one stop, and three: a stop at one time is exact', () => {
    expect(summary(read(readRatecon(doc([TABLE_STOPS[0]!]))))).toEqual([['PU', '4001 MAIN ST', 'BEMIDJI', 'MN', '56601']]);
    const three = read(readRatecon(doc([TABLE_STOPS[0]!, TABLE_MIDDLE, TABLE_STOPS[1]!])));
    expect(summary(three)).toEqual([
      ['PU', '4001 MAIN ST', 'BEMIDJI', 'MN', '56601'],
      ['DEL', '77 DEPOT AVE', 'WILLISTON', 'ND', '58801'],
      ['DEL', '1200 HARBOR RD', 'DICKINSON', 'ND', '58601'],
    ]);
    expect(three.stops[1]!.time).toMatchObject({ kind: 'exact', date: '2026-10-12', time: '18:00' });
  });

  it('reads past a note, and a note wrapped onto the next line under its text; never reads the note', () => {
    expect(read(readRatecon(withRun(105, Y.note - 12, 'NO STRONG ODORS')))).toEqual(r);
    expect(JSON.stringify(r)).not.toContain('CLEAN DRY');
  });

  it('finds the phone in every shape it comes in, and the street ends there', () => {
    // Three stops: "(555) 010-0100", "(555)010-0102" run together, "555-010-0101".
    expect(summary(read(readRatecon(doc([TABLE_STOPS[0]!, TABLE_MIDDLE, TABLE_STOPS[1]!])))).map((s) => [s[1], s[4]])).toEqual([
      ['4001 MAIN ST', '56601'],
      ['77 DEPOT AVE', '58801'],
      ['1200 HARBOR RD', '58601'],
    ]);
    // The phone in two cells, or run into the street's cell.
    const split = lines(stopTable(TABLE_STOPS).map((p, i) => (i > 0 ? p : p.flatMap((run) => (run.text === '(555) 010-0100' ? [{ ...run, text: '(555)' }, { ...run, x: 322, text: '010-0100' }] : [run])))));
    expect(read(readRatecon(split))).toEqual(r);
    expect(summary(read(readRatecon(joined(Y.b1, [156, 295]))))).toEqual(summary(r));
  });

  it('reads the cells OCR runs together where they hold a fixed shape: the number and type, a date and the name, a time and the street, the state and the ref', () => {
    for (const [y, xs] of [[Y.a1, [45, 65]], [Y.a1, [127, 156]], [Y.b1, [127, 156]], [Y.a1, [392, 431]]] as const) {
      const got = read(readRatecon(joined(y, [...xs])));
      expect(summary(got), `${y}: ${xs.join('+')}`).toEqual(summary(r));
      expect(got.stops[0]!.time, `${y}: ${xs.join('+')}`).toMatchObject({ kind: 'range', date: '2026-10-12', time: '08:00', endTime: '16:00' });
    }
  });

  it('says so when a later page’s "Load No" disagrees with the box, or there is no box, and reads the stops anyway', () => {
    const disagree = read(readRatecon(doc(TABLE_STOPS, { later: '610043' })));
    expect(disagree.loadNumber).toBeNull();
    expect(disagree.loadNumberCheck).toBe('More than one number is under “LOAD NUMBER” or after “Load No”: “610042”, “610043”.');
    expect(summary(disagree)).toEqual(summary(r));
    const noBox = read(readRatecon(without('LOAD NUMBER')));
    expect([noBox.loadNumber, noBox.loadNumberCheck]).toEqual([null, 'No number under “LOAD NUMBER”.']);
    expect(noBox.stops[0]!.time).toEqual(r.stops[0]!.time);
  });

  it('puts a date with no year in the year nearest the document’s date, across New Year; with no date anywhere, quotes it', () => {
    const newYear = read(readRatecon(doc([{ ...TABLE_STOPS[0]!, from: '12/31', to: '12/31' }, { ...TABLE_STOPS[1]!, from: '1/2', to: '1/2' }], { date: '12/30/2026', laterDate: '12/30/26' })));
    expect(newYear.stops.map((s) => (s.time.kind === 'range' ? [s.time.date, s.time.endDate] : s.time.kind))).toEqual([
      ['2026-12-31', '2026-12-31'],
      ['2027-01-02', '2027-01-02'],
    ]);
    // The box's date gone, the "Load No" line's is used; both gone, nothing is guessed.
    expect(read(readRatecon(without('10/9/2026'))).stops[0]!.time).toEqual(r.stops[0]!.time);
    expect(read(readRatecon(without('10/9/2026', 'Load No 610042 - 10/9/26'))).stops[0]!.time).toEqual({
      kind: 'unreadable', date: null, quoted: '10/12 10/12 08:00 16:00', source: { text: '10/12 10/12 · 08:00 16:00', page: 1 },
    });
  });

  it('reads "10:00" only on a 24-hour document; a leading zero or an hour past 12 stands on its own', () => {
    const stops = pickup({ fromTime: '10:00', toTime: '11:00' });
    expect(read(readRatecon(doc(stops))).stops[0]!.time).toMatchObject({ kind: 'range', time: '10:00', endTime: '11:00' });
    expect(read(readRatecon(withRun(42, 300, 'Office opens at 7 AM', stops))).stops[0]!.time).toMatchObject({
      kind: 'unreadable', date: '2026-10-12', quoted: '10/12 10/12 10:00 11:00',
    });
    expect(read(readRatecon(withRun(42, 300, 'Office opens at 7 AM'))).stops[0]!.time).toMatchObject({ kind: 'range', time: '08:00', endTime: '16:00' });
  });

  it('does not read the Appt column: Yes or No changes nothing', () => {
    expect(read(readRatecon(doc(TABLE_STOPS.map((s) => ({ ...s, appt: s.appt === 'Yes' ? ('No' as const) : ('Yes' as const) })))))).toEqual(r);
  });

  it('refuses the whole document when a name and a city come in one cell: nothing under "City", and words are never divided', () => {
    expect(readRatecon(joined(Y.a1, [156, 295]))).toEqual(NOT);
    expect(readRatecon(joined(Y.a1, [295, 392]))).toEqual(NOT);
  });

  it('refuses a line B with no phone, or no five-digit ZIP after it, or a street that does not start like one', () => {
    expect(readRatecon(without('(555) 010-0100'))).toEqual(NOT);
    expect(readRatecon(edited('56601', '5660'))).toEqual(NOT);
    expect(readRatecon(edited('4001 MAIN ST', 'MAIN ST'))).toEqual(NOT);
  });

  it('refuses a stop of another type, a state that is not one, stops out of order, or a line A without its line B', () => {
    expect(readRatecon(edited('Del', 'SO'))).toEqual(NOT);
    expect(readRatecon(edited('MN', 'ON'))).toEqual(NOT);
    expect(readRatecon(edited('2', '3'))).toEqual(NOT);
    expect(readRatecon(without('09:00', '10:30', '1200 HARBOR RD', '555-010-0101', '58601', 'A-2002'))).toEqual(NOT);
  });

  it('refuses a first stop that is not a pickup, or a last stop of several that is not a delivery', () => {
    expect(readRatecon(doc([TABLE_STOPS[1]!, TABLE_STOPS[0]!]))).toEqual(NOT);
    expect(readRatecon(doc([TABLE_STOPS[0]!, { ...TABLE_STOPS[1]!, type: 'PU' }]))).toEqual(NOT);
  });

  it('refuses any other line in the table, a note’s line that is not under its text, or a table with no "Commodity" after it on its page', () => {
    expect(readRatecon(withRun(45, Y.b2 - 12, 'SEE ATTACHED'))).toEqual(NOT);
    expect(readRatecon(withRun(200, Y.note - 12, 'STRAY TEXT'))).toEqual(NOT);
    expect(readRatecon(without('Commodity', 'Description', 'Pieces', 'Weight', 'GENERAL FREIGHT', '20,000', '$100 FEE FOR LATE PAPERWORK'))).toEqual(NOT);
  });

  it('refuses a city or state that does not start under its heading', () => {
    const moved = (text: string, x: number) => lines(stopTable(TABLE_STOPS).map((p) => p.map((run) => (run.text === text ? { ...run, x } : run))));
    expect(readRatecon(moved('BEMIDJI', 320))).toEqual(NOT);
    expect(readRatecon(moved('MN', 405))).toEqual(NOT);
  });

  it('refuses a heading that is not its own cell; is not recognised without the header’s second line', () => {
    expect(recognisedLayouts(joined(610, [295, 392]))).toEqual(['stop-table']);
    expect(readRatecon(joined(610, [295, 392]))).toEqual(NOT);
    expect(recognisedLayouts(without('Contact'))).toEqual([]);
  });

  it('does not read the same document pasted as text: its columns cannot be told apart', () => {
    const pasted = linesFromText(doc().map((l) => l.text).join('\n'));
    expect(recognisedLayouts(pasted)).toEqual(['stop-table']);
    expect(readRatecon(pasted)).toEqual(NOT);
  });

  it('never carries a rate, a phone, a ref, a name, a note or the carrier into what it read', () => {
    const said = JSON.stringify(read(readRatecon(doc([TABLE_STOPS[0]!, TABLE_MIDDLE, TABLE_STOPS[1]!]))));
    for (const never of ['$', '1,900', '555', 'R-1001', 'A-2002', 'PRAIRIE', 'LAKESIDE', 'NORTH YARD', 'CLEAN DRY', 'SAMPLE', '000000', 'Yes']) {
      expect(said).not.toContain(never);
    }
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
