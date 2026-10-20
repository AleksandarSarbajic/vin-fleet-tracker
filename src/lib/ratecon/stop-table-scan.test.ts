import { beforeAll, describe, expect, it } from 'vitest';
import { SCAN_CHECK, fillLoad } from '@/components/edit/ratecon-fill';
import { loadFormFrom } from '@/components/edit/load-form';
import { nodePdfjs, nodeScanReading, scanOf, type PdfJs } from '@/test/ocr-node';
import { TABLE_MIDDLE, TABLE_STOPS, stopTable } from '@/test/ratecon-fixtures';
import { tinyPdf, type TinyRun } from '@/test/tiny-pdf';
import { linesFromPdf } from './read-pdf';
import { readRatecon, type RateconRead, type ReadOutcome } from './templates';

/**
 * Phase 3ak. The stop table, read both ways it arrives: as a text PDF,
 * through the real pdf.js, and as that same document scanned — drawn at
 * 300 dpi, saved as JPEG, wrapped with no text layer (`scanOf`) — and read
 * by OCR in Node with the browser's settings (§12.128, as `read-scan.test.ts`
 * reads its scans). Every document is invented (`stopTable`).
 */

/** OCR is seconds a page; under a full parallel run, more. */
const OCR = 90_000;

let pdfjs: PdfJs;
beforeAll(async () => {
  pdfjs = await nodePdfjs();
});

/** What a read says, without where it said it. */
const values = (outcome: ReadOutcome) => {
  if (!outcome.ok) return outcome;
  const read: RateconRead = outcome.read;
  return {
    layout: read.layout,
    loadNumber: read.loadNumber?.value ?? null,
    loadNumberCheck: read.loadNumberCheck,
    stops: read.stops.map((s) => ({
      type: s.type.value,
      street: s.street?.value,
      city: s.city?.value,
      state: s.state?.value,
      zip: s.zip?.value,
      time: s.time.kind === 'exact' || s.time.kind === 'range' ? { ...s.time, source: null } : s.time.kind,
    })),
  };
};

/** The same document as a text PDF and as its scan, each read. */
async function bothWays(pages: TinyRun[][]) {
  const pdf = tinyPdf(pages);
  const text = await linesFromPdf(pdf.slice(), pdfjs);
  const scan = await linesFromPdf(await scanOf(pdf, pdfjs, 300), pdfjs, nodeScanReading());
  if (!text.ok || !scan.ok) throw new Error('a PDF was not read');
  expect([text.fromScan, scan.fromScan]).toEqual([false, true]);
  return { text: readRatecon(text.lines), scan: readRatecon(scan.lines) };
}

const PICKUP = {
  type: 'PU',
  street: '4001 MAIN ST',
  city: 'BEMIDJI',
  state: 'MN',
  zip: '56601',
  time: { kind: 'range', date: '2026-10-12', time: '08:00', endDate: '2026-10-12', endTime: '16:00', flag: null, source: null },
};
const MIDDLE = {
  type: 'DEL',
  street: '77 DEPOT AVE',
  city: 'WILLISTON',
  state: 'ND',
  zip: '58801',
  time: { kind: 'exact', date: '2026-10-12', time: '18:00', flag: null, source: null },
};
const DELIVERY = {
  type: 'DEL',
  street: '1200 HARBOR RD',
  city: 'DICKINSON',
  state: 'ND',
  zip: '58601',
  time: { kind: 'range', date: '2026-10-13', time: '09:00', endDate: '2026-10-13', endTime: '10:30', flag: null, source: null },
};
const read = (stops: unknown[], loadNumber: string | null = '610042', loadNumberCheck: string | null = null) => ({
  layout: 'stop-table',
  loadNumber,
  loadNumberCheck,
  stops,
});

describe('the stop table, as a text PDF and as its scan read by OCR', () => {
  it(
    'one stop',
    async () => {
      const { text, scan } = await bothWays(stopTable([TABLE_STOPS[0]!]));
      expect(values(text)).toEqual(read([PICKUP]));
      expect(values(scan)).toEqual(read([PICKUP]));
    },
    OCR,
  );

  it(
    'two stops, a note after the first; from the scan, filled with every field marked Check, and the windows filled by their rules',
    async () => {
      const { text, scan } = await bothWays(stopTable(TABLE_STOPS));
      expect(values(text)).toEqual(read([PICKUP, DELIVERY]));
      expect(values(scan)).toEqual(read([PICKUP, DELIVERY]));

      const now = new Date('2026-10-10T15:00:00.000Z');
      const filled = fillLoad(loadFormFrom(null, now.toISOString(), null), scan.ok ? scan.read : (null as never), now.toISOString(), now, 'scan');
      if (!filled.ok) throw new Error(filled.message);
      expect(filled.form.loadNumber).toBe('610042');
      expect(filled.form.fill?.loadNumberCheck).toBe(SCAN_CHECK);
      expect(filled.form.stops.map((s) => [s.stopType, s.addressLine, s.city, s.state, s.zip])).toEqual([
        ['PU', '4001 Main St', 'Bemidji', 'MN', '56601'],
        ['DEL', '1200 Harbor Rd', 'Dickinson', 'ND', '58601'],
      ]);
      for (const stop of filled.form.stops) {
        for (const field of ['stopType', 'addressLine', 'city', 'state', 'zip', 'appointment'] as const) {
          expect(stop.fill?.checks[field], field).toContain(SCAN_CHECK);
        }
      }
      const [pu, del] = filled.form.stops.map((s) => s.appointment);
      expect(pu).toMatchObject({ enabled: true, type: 'FCFS', date: '2026-10-12', time: '08:00', endTime: '16:00' });
      expect(filled.form.stops[0]!.fill?.checks.appointment).toContain('is longer than 2 hours, so it is filled as FCFS receiving hours');
      expect(del).toMatchObject({ enabled: true, type: 'APPT', date: '2026-10-13', time: '09:00', windowMinutes: 90 });
    },
    OCR,
  );

  it(
    'three stops, the phone in three shapes: two tokens, one, and run together',
    async () => {
      const { text, scan } = await bothWays(stopTable([TABLE_STOPS[0]!, TABLE_MIDDLE, TABLE_STOPS[1]!]));
      expect(values(text)).toEqual(read([PICKUP, MIDDLE, DELIVERY]));
      expect(values(scan)).toEqual(read([PICKUP, MIDDLE, DELIVERY]));
    },
    OCR,
  );

  it(
    'a later page’s "Load No" that disagrees with the box: the load number blank and said, the stops read',
    async () => {
      const { text, scan } = await bothWays(stopTable(TABLE_STOPS, { later: '610043' }));
      const want = read([PICKUP, DELIVERY], null, 'More than one number is under “LOAD NUMBER” or after “Load No”: “610042”, “610043”.');
      expect(values(text)).toEqual(want);
      expect(values(scan)).toEqual(want);
    },
    OCR,
  );

  it(
    'a near miss — a stop’s line B with no phone, so where its street ends is not known — is refused whole, both ways',
    async () => {
      const pages = stopTable(TABLE_STOPS).map((p) => p.filter((run) => run.text !== '(555) 010-0100'));
      const { text, scan } = await bothWays(pages);
      expect(text).toEqual({ ok: false, reason: 'not-recognised' });
      expect(scan).toEqual({ ok: false, reason: 'not-recognised' });
    },
    OCR,
  );
});
