import { ZIP_ZONE_DATA } from './zip-zones.data';
import { ZONE_BY_STATE, zoneForState } from './zone-by-state';

/**
 * §12.120. A facility's time zone from its state, and in a state with more
 * than one, from its ZIP. Pure, offline, no network.
 *
 * Never a guess: a ZIP that crosses a zone line, or that the table does not
 * carry (a PO box, a typo, a ZIP newer than the 2020 ZCTAs), is UNCERTAIN,
 * and the modal asks the dispatcher to confirm the zone before it saves.
 */
export type ZoneVerdict =
  /** A state with one zone. */
  | { kind: 'state'; zone: string }
  /** A state with more than one; the ZIP settled it. */
  | { kind: 'zip'; zone: string }
  /** Not settled. `zone` is the state's usual zone, offered, not concluded. */
  | { kind: 'uncertain'; zone: string; reason: UncertainReason };

export type UncertainReason =
  /** A state with more than one zone, and no ZIP yet. */
  | 'no-zip'
  /** The ZIP crosses a zone line, or touches a county one cuts through. */
  | 'zip-crosses'
  /** The table has no such ZIP in this state. */
  | 'zip-unknown'
  /** Two letters that are not a US state: Ontario, a typo. */
  | 'not-a-state';

let table: Map<string, Map<string, string>> | null = null;

/** Parsed once, on first use: state → ZIP → zone, or `?`. */
function load(): Map<string, Map<string, string>> {
  if (table) return table;
  const next = new Map<string, Map<string, string>>();
  for (const line of ZIP_ZONE_DATA.split('\n')) {
    if (line === '') continue;
    const [state, zone, list] = line.split(' ');
    if (!state || !zone || !list) continue;
    if (!next.has(state)) next.set(state, new Map());
    const zips = next.get(state)!;
    let zip = 0;
    for (const delta of list.split(',')) {
      zip += parseInt(delta, 36);
      zips.set(String(zip).padStart(5, '0'), zone);
    }
  }
  table = next;
  return next;
}

/** The states with more than one zone — the ones the table carries. */
export function isSplitState(state: string): boolean {
  return load().has(state.trim().toUpperCase());
}

/**
 * Null until there is a state to go on: blank, or anything but two letters
 * (the state field's own rule says what is wrong with "Illinois").
 */
export function zoneForAddress(state: string, zip: string): ZoneVerdict | null {
  const code = state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  if (!(code in ZONE_BY_STATE)) {
    return { kind: 'uncertain', zone: zoneForState(code), reason: 'not-a-state' };
  }
  const zips = load().get(code);
  if (!zips) return { kind: 'state', zone: zoneForState(code) };

  const usual = zoneForState(code);
  const digits = zip.replace(/\D/g, '');
  if (digits === '') return { kind: 'uncertain', zone: usual, reason: 'no-zip' };
  const zone = digits.length >= 5 ? zips.get(digits.slice(0, 5)) : undefined;
  if (zone === undefined) return { kind: 'uncertain', zone: usual, reason: 'zip-unknown' };
  if (zone === '?') return { kind: 'uncertain', zone: usual, reason: 'zip-crosses' };
  return { kind: 'zip', zone };
}

/** Every zone the table can answer with — the modal must offer each. */
export function tableZones(): string[] {
  const zones = new Set<string>();
  for (const zips of load().values()) for (const zone of zips.values()) zones.add(zone);
  zones.delete('?');
  return [...zones].sort();
}
