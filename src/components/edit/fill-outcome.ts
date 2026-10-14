import { OUTCOME_FIELDS, type FieldCounts, type OutcomeField } from '@/lib/ratecon/outcome-codes';
import { aiMarkedFields } from './ratecon-fill';
import type { FillField, LoadForm, StopForm } from './load-form';

/**
 * What the dispatcher did with an AI fill, by field NAME and by outcome
 * (docs/llm-reader-design.md §4; Alex, 2026-10-14). Pure.
 *
 * Two steps. `fillSnapshot` is taken the moment the read fills the form: for
 * each field the read FILLED, its value then; for each it left BLANK and
 * marked, that it did. `outcomeFields` is taken at the first save after: each
 * filled field is kept (the same value), changed (another) or cleared (empty,
 * or its stop removed); each blank one was filled by the dispatcher or left.
 * Summed over stops, one row a field name.
 *
 * The values are compared HERE, in the browser, and never leave it: what goes
 * on is the counts, which carry no value, text, address or load number.
 * Values are compared trimmed, so a space at an end is not a change, and by
 * value, so a field edited and put back is kept.
 */

type Cell = { filled: true; value: string } | { filled: false; value: string };

export interface FillSnapshot {
  loadNumber: Cell | null;
  stops: { key: string; cells: Partial<Record<OutcomeField, Cell>> }[];
}

const NAME: Record<FillField, OutcomeField> = {
  stopType: 'stop_type',
  addressLine: 'street',
  city: 'city',
  state: 'state',
  zip: 'zip',
  appointment: 'appointment',
};

/** A stop's field as a comparable string; empty means "nothing there". */
function valueOf(stop: StopForm, field: FillField): string {
  switch (field) {
    case 'stopType':
      return stop.stopType;
    case 'addressLine':
      return stop.addressLine.trim();
    case 'city':
      return stop.city.trim();
    case 'state':
      return stop.state.trim();
    case 'zip':
      return stop.zip.trim();
    case 'appointment': {
      const a = stop.appointment;
      // The zone follows the address and is not the dispatcher's edit of the appointment.
      return a.enabled && a.time.trim() !== '' ? JSON.stringify([a.type, a.date, a.time, a.endTime, a.windowMinutes]) : '';
    }
  }
}

/** The fields a model read filled or left blank and marked, as the form holds them right after the fill. */
export function fillSnapshot(form: LoadForm): FillSnapshot {
  // Only a model read is recorded. A stop carries the AI mark whenever the model filled the form; the
  // load number's alone does not (a read with no load number has none), so the stops say.
  if (!form.stops.some((s) => s.fill?.ai)) return { loadNumber: null, stops: [] };
  const loadNumber = form.loadNumber.trim();
  const loadCell: Cell | null =
    form.fill?.loadNumber && loadNumber !== ''
      ? { filled: true, value: loadNumber }
      : form.fill?.loadNumberCheck
        ? { filled: false, value: loadNumber }
        : null;
  return {
    loadNumber: loadCell,
    stops: form.stops.map((stop) => {
      const cells: Partial<Record<OutcomeField, Cell>> = {};
      const filled = new Set<FillField>(aiMarkedFields(stop));
      for (const field of filled) cells[NAME[field]] = { filled: true, value: valueOf(stop, field) };
      for (const field of Object.keys(stop.fill?.checks ?? {}) as FillField[]) {
        if (!filled.has(field)) cells[NAME[field]] = { filled: false, value: valueOf(stop, field) };
      }
      return { key: stop.key, cells };
    }),
  };
}

type Tally = Omit<FieldCounts, 'field'>;
const empty = (): Tally => ({ kept: 0, changed: 0, cleared: 0, blankFilled: 0, blankLeft: 0 });

function tally(into: Tally, cell: Cell, now: string): void {
  if (cell.filled) {
    if (now === '') into.cleared += 1;
    else if (now === cell.value) into.kept += 1;
    else into.changed += 1;
  } else if (now !== '' && now !== cell.value) into.blankFilled += 1;
  else into.blankLeft += 1;
}

/** The counts for the form as saved, against the snapshot of the fill; fields with nothing to count are left out. */
export function outcomeFields(snapshot: FillSnapshot, saved: LoadForm): FieldCounts[] {
  const rows = new Map<OutcomeField, Tally>();
  const row = (field: OutcomeField) => {
    const have = rows.get(field);
    if (have) return have;
    const fresh = empty();
    rows.set(field, fresh);
    return fresh;
  };
  if (snapshot.loadNumber) tally(row('load_number'), snapshot.loadNumber, saved.loadNumber.trim());
  for (const filledStop of snapshot.stops) {
    const stop = saved.stops.find((s) => s.key === filledStop.key);
    for (const [name, cell] of Object.entries(filledStop.cells) as [OutcomeField, Cell][]) {
      const field = (Object.keys(NAME) as FillField[]).find((f) => NAME[f] === name)!;
      // A stop taken off the load has nothing in it.
      tally(row(name), cell, stop ? valueOf(stop, field) : '');
    }
  }
  return OUTCOME_FIELDS.flatMap((field) => {
    const counts = rows.get(field);
    return counts ? [{ field, ...counts }] : [];
  });
}
