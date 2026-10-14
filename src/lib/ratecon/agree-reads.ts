import type { RateconRead, Sourced, StopRead, TimeRead } from './templates';

/**
 * Two-read agreement (phase 3d; after evaluation run 1, where one read of
 * three dropped a stop and one appointment was wrong three times out of
 * three). Pure. Two reads of the same lines, each ALREADY VERIFIED
 * (`verifyRead`), merged so that only what both said stands:
 *
 *   - the stop count: when it differs, the read with MORE stops gives them
 *     (each is verified against its own quotes), and a notice names both
 *     counts — a dropped stop is the error the verifier cannot see;
 *   - stop by stop, by index: a field the reads differ on is left blank and
 *     marked; a field both left blank or unconfirmed stays as it was;
 *   - an appointment: ANY difference (kind, date, time, end date, end time,
 *     flag) blanks and marks the whole of it;
 *   - the stop type has no blank: the base read's value stays, marked;
 *   - the load number, likewise.
 *
 * Comparing by index has a cost: a stop dropped from the MIDDLE shifts the
 * rest, which then compare as different and are blanked. That is the safe
 * side: a blank is seen, a wrong value may not be.
 *
 * The result is what `fillLoad` takes (layout 'model'), with `notices` for
 * the strip to say, and `differed` for the evaluation to count. Neither
 * input is changed.
 *
 * THE CALLER'S CONTRACT (Alex, 2026-10-14): `agreeReads` takes two VERIFIED
 * reads only. A pair where either read fails — the adapter, the schema, or
 * nothing confirmed — FAILS AS A WHOLE with that code and fills nothing. It
 * never falls back to the read that succeeded: one read alone is exactly
 * what agreement exists to distrust. `agreePair` is that contract in code;
 * call it, not `agreeReads`, with the two outcomes. (Design §4, §5: a failed
 * pair is one read against the cap, and the strip says the AI read did not
 * complete.)
 */

export const AGREE_DIFFERED = 'The two AI reads differed.';
const BLANKED = `${AGREE_DIFFERED} Enter it by hand.`;
const KEPT = `${AGREE_DIFFERED} Check it.`;

export type AgreeField = 'load number' | 'type' | 'street' | 'city' | 'state' | 'zip' | 'appointment';

export interface Agreement {
  read: RateconRead;
  notices: string[];
  /** Both counts when they differ; null when the reads found the same number of stops. */
  stopCounts: { a: number; b: number } | null;
  /** Each field the reads differed on: its stop (1-based; null for the load number) and its name. */
  differed: { stop: number | null; field: AgreeField }[];
}

const sameValue = <T>(x: Sourced<T> | null, y: Sourced<T> | null) => (x === null ? y === null : y !== null && x.value === y.value);

/** A time the verifier confirmed: an exact time or a range. `none` and `unreadable` are both "not confirmed". */
const confirmed = (t: TimeRead) => t.kind === 'exact' || t.kind === 'range';

function sameTime(x: TimeRead, y: TimeRead): boolean {
  if (!confirmed(x) && !confirmed(y)) return true;
  if (x.kind === 'exact' && y.kind === 'exact') return x.date === y.date && x.time === y.time && x.flag === y.flag;
  if (x.kind === 'range' && y.kind === 'range') {
    return x.date === y.date && x.time === y.time && x.endDate === y.endDate && x.endTime === y.endTime && x.flag === y.flag;
  }
  return false;
}

const ADDRESS = ['street', 'city', 'state', 'zip'] as const;

function agreeStop(base: StopRead, other: StopRead, n: number, differed: Agreement['differed']): StopRead {
  const out: StopRead = { ...base, fieldChecks: { ...base.fieldChecks } };
  if (base.type.value !== other.type.value) {
    out.typeCheck = KEPT;
    differed.push({ stop: n, field: 'type' });
  }
  for (const field of ADDRESS) {
    if (sameValue(base[field], other[field])) continue;
    out[field] = null;
    out.fieldChecks = { ...out.fieldChecks, [field]: BLANKED };
    differed.push({ stop: n, field });
  }
  if (!sameTime(base.time, other.time)) {
    out.time = { kind: 'unreadable', date: null, quoted: '', source: base.time.source ?? other.time.source ?? { text: '', page: null } };
    out.timeCheck = BLANKED;
    differed.push({ stop: n, field: 'appointment' });
  }
  return out;
}

export function agreeReads(a: RateconRead, b: RateconRead): Agreement {
  const [base, other] = b.stops.length > a.stops.length ? [b, a] : [a, b];
  const differed: Agreement['differed'] = [];
  const notices: string[] = [];

  let loadNumber = base.loadNumber;
  let loadNumberCheck = base.loadNumberCheck;
  if (!sameValue(base.loadNumber, other.loadNumber)) {
    loadNumber = null;
    loadNumberCheck = BLANKED;
    differed.push({ stop: null, field: 'load number' });
  }

  const stops = base.stops.map((stop, i) => {
    const theirs = other.stops[i];
    return theirs ? agreeStop(stop, theirs, i + 1, differed) : stop;
  });

  const stopCounts = a.stops.length === b.stops.length ? null : { a: a.stops.length, b: b.stops.length };
  if (stopCounts) {
    notices.push(
      `The two AI reads found ${stopCounts.a} and ${stopCounts.b} stops. The ${stops.length} shown are the read with more; check each against the document.`,
    );
  }
  if (differed.length > 0) {
    notices.push(`The two AI reads differed on ${differed.length} ${differed.length === 1 ? 'field' : 'fields'}; each is left blank and marked.`);
  }
  return { read: { layout: 'model', loadNumber, loadNumberCheck, stops }, notices, stopCounts, differed };
}

/** One side of a pair: a verified read, or the code its read failed with. */
export type PairRead<C extends string> = { ok: true; read: RateconRead } | { ok: false; code: C };

/**
 * The pair, by the contract above: the agreement of two verified reads, or
 * the pair's failure — read A's code when A failed, else read B's. Nothing
 * from a failed pair is ever filled.
 */
export function agreePair<C extends string>(a: PairRead<C>, b: PairRead<C>): { ok: true; agreement: Agreement } | { ok: false; code: C } {
  if (!a.ok) return { ok: false, code: a.code };
  if (!b.ok) return { ok: false, code: b.code };
  return { ok: true, agreement: agreeReads(a.read, b.read) };
}
