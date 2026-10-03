import { describe, expect, it } from 'vitest';
import {
  MISSING_ANCHOR,
  NOTHING_ELSE,
  NO_STATUS_LINE,
  lateDepartures,
  needsAnchor,
  planAnchors,
  readClose,
  recentlyClosedLine,
  reopenLines,
  reopenTitle,
  type CloseRecord,
  type ReopenStop,
} from './reopen-load';

/** §12.107. */

const TZ = 'America/Chicago';
const NOW = new Date('2026-10-03T15:00:00Z'); // Sat 10:00 CDT
const CLOSED_AT = '2026-10-03T13:04:00Z'; // Sat 08:04 CDT
const ANCHOR = { lat: 41.5, lng: -88.1, recordedAtUtc: '2026-10-03T12:40:00Z' };

const entry = (over: Partial<Parameters<typeof readClose>[0]>) => ({
  id: 'a-1',
  entity: 'load',
  createdAt: CLOSED_AT,
  actorName: 'Dee Dispatcher',
  before: null,
  after: null,
  ...over,
});

describe('reading a close from its audit entry', () => {
  it("Clear stop's entry: the status before, and each stop's anchor", () => {
    const close = readClose(
      entry({
        before: { loadStatus: 'AT_RECEIVER', stops: [{ stopId: 's-1', arrivalAnchor: ANCHOR }, { stopId: 's-2', arrivalAnchor: null }] },
        after: { loadStatus: 'DELIVERED', source: 'operator-clear-stop' },
      }),
    )!;
    expect(close.statusBefore).toBe('AT_RECEIVER');
    expect(close.closedStatus).toBe('DELIVERED');
    expect(close.anchors!.get('s-1')).toEqual(ANCHOR);
    expect(close.anchors!.get('s-2')).toBeNull();
  });

  it("the edit modal's entry: the status before, and no anchors (it never cleared one)", () => {
    const close = readClose(
      entry({ entity: 'stop', before: { loadStatus: 'LOADED' }, after: { loadStatus: 'TONU', loadId: 'l-1' } }),
    )!;
    expect(close.statusBefore).toBe('LOADED');
    expect(close.anchors).toBeNull();
  });

  it('a load created closed: a close with no status before', () => {
    const close = readClose(entry({ entity: 'stop', before: null, after: { loadStatus: 'DELIVERED', loadId: 'l-1' } }))!;
    expect(close.statusBefore).toBeNull();
  });

  it('is not a close: an open status written, or closed over closed', () => {
    expect(readClose(entry({ entity: 'stop', before: { loadStatus: 'LOADED' }, after: { loadStatus: 'AT_RECEIVER', loadId: 'l' } }))).toBeNull();
    expect(readClose(entry({ entity: 'stop', before: { loadStatus: 'DELIVERED' }, after: { loadStatus: 'DELIVERED', loadId: 'l' } }))).toBeNull();
    expect(readClose(entry({ entity: 'load', before: { loadStatus: 'DELIVERED' }, after: { loadStatus: 'AT_RECEIVER', source: 'operator-reopen-load' } }))).toBeNull();
    expect(readClose(entry({ entity: 'truck_list' }))).toBeNull();
  });
});

const stop = (over: Partial<ReopenStop> = {}): ReopenStop => ({
  stopId: 's-1',
  place: 'Joliet, IL',
  lat: 41.5,
  lng: -88.1,
  precision: 'zip',
  arrivedAt: '2026-10-03T12:40:00Z',
  arrivedSource: 'dispatcher',
  departedAt: null,
  anchor: null,
  ...over,
});
const close = (anchors: Map<string, typeof ANCHOR | null> | null): CloseRecord => ({
  closeAuditId: 'a-1',
  closedAt: CLOSED_AT,
  closedByName: 'Dee Dispatcher',
  closedStatus: 'DELIVERED',
  statusBefore: 'AT_RECEIVER',
  anchors,
});

describe('which anchors come back', () => {
  it('only for a hand-marked, undeparted, area-level or unlocated stop', () => {
    expect(needsAnchor(stop())).toBe(true);
    expect(needsAnchor(stop({ precision: 'block' }))).toBe(true);
    expect(needsAnchor(stop({ precision: null, lat: null, lng: null }))).toBe(true);
    expect(needsAnchor(stop({ precision: 'street' }))).toBe(false);
    expect(needsAnchor(stop({ arrivedSource: 'detected' }))).toBe(false);
    expect(needsAnchor(stop({ departedAt: '2026-10-03T13:00:00Z' }))).toBe(false);
    expect(needsAnchor(stop({ arrivedAt: null, arrivedSource: null }))).toBe(false);
  });

  it('from the close’s record; missing when it has none; a stop that kept one keeps it', () => {
    expect(planAnchors([stop()], close(new Map([['s-1', ANCHOR]])))).toEqual({
      restored: [{ stopId: 's-1', place: 'Joliet, IL', anchor: ANCHOR }],
      missing: [],
    });
    expect(planAnchors([stop()], close(new Map([['s-1', null]])))).toEqual({
      restored: [],
      missing: [{ stopId: 's-1', place: 'Joliet, IL' }],
    });
    expect(planAnchors([stop({ anchor: ANCHOR })], close(null))).toEqual({ restored: [], missing: [] });
  });
});

describe('late departures', () => {
  const plan = planAnchors([stop()], close(new Map([['s-1', ANCHOR]])));
  it('warned when the newest position is outside the departure radius of the restored anchor', () => {
    expect(lateDepartures([stop()], plan, { lat: 41.0, lng: -88.1 })).toEqual([{ stopId: 's-1', place: 'Joliet, IL' }]);
  });
  it('not while the truck is still there, nor with no position, nor once departed', () => {
    expect(lateDepartures([stop()], plan, { lat: 41.5001, lng: -88.1 })).toEqual([]);
    expect(lateDepartures([stop()], plan, null)).toEqual([]);
    expect(lateDepartures([stop({ departedAt: '2026-10-03T13:00:00Z' })], plan, { lat: 41, lng: -88.1 })).toEqual([]);
  });
  it('not for a stop with no anchor to measure from: that one never clears by itself', () => {
    const none = planAnchors([stop()], close(new Map([['s-1', null]])));
    expect(lateDepartures([stop()], none, { lat: 41, lng: -88.1 })).toEqual([]);
  });
});

describe('the confirm step', () => {
  const base = {
    truckName: '141',
    loadNumber: '12120640',
    close: { closedAt: CLOSED_AT, closedByName: 'Dee Dispatcher', closedStatus: 'DELIVERED' as const, statusBefore: 'AT_RECEIVER' as const },
    others: [],
    plan: { restored: [], missing: [] },
    late: [],
    dispatchTz: TZ,
    now: NOW,
  };

  it('a plain reopen: where it goes back to, and what is not changed', () => {
    expect(reopenTitle('12120640')).toBe('Reopen load 12120640?');
    expect(reopenLines(base)).toEqual([
      'It goes back to At receiver, the status it had before Dee Dispatcher closed it as Delivered at 08:04 CDT.',
      NOTHING_ELSE,
    ]);
  });

  it('the day is named when the close was not today', () => {
    const line = reopenLines({ ...base, now: new Date('2026-10-05T15:00:00Z') })[0]!;
    expect(line).toContain('on Sat 08:04 CDT.');
  });

  it('with no status recorded, it asks', () => {
    expect(reopenLines({ ...base, close: { ...base.close, statusBefore: null } })[0]).toBe(NO_STATUS_LINE);
  });

  it('+1 load, a load entered after the close, a restored and a missing anchor, a late departure', () => {
    const lines = reopenLines({
      ...base,
      others: [
        { loadId: 'l-2', loadNumber: '200584', createdAt: '2026-10-03T13:05:00Z' },
        { loadId: 'l-3', loadNumber: null, createdAt: '2026-10-02T13:00:00Z' },
      ],
      plan: {
        restored: [{ place: 'Joliet, IL' }],
        missing: [{ place: 'Elwood, IL' }],
      },
      late: [{ place: 'Joliet, IL' }],
    });
    expect(lines).toEqual([
      'It goes back to At receiver, the status it had before Dee Dispatcher closed it as Delivered at 08:04 CDT.',
      'Truck 141 will hold 3 open loads: 12120640, 200584 and one with no number. The board follows the earlier deadline and tags the row +1 load.',
      '200584, entered 08:05 CDT, is not changed.',
      'Joliet, IL: arrival anchor restored, so its departure is measured as before.',
      `Elwood, IL: ${MISSING_ANCHOR}`,
      'Truck 141 has left Joliet, IL since. Its departure will be recorded from the first position after this reopen, so it can be much later than the real one.',
      NOTHING_ELSE,
    ]);
  });

  it('the row in "Recently closed on this truck"', () => {
    expect(recentlyClosedLine({ loadNumber: '12120640', close: base.close }, TZ, NOW)).toBe(
      '12120640 · Delivered · 08:04 CDT by Dee Dispatcher',
    );
  });
});
