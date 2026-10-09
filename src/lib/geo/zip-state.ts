import { ZIP3_STATE_DATA } from './zip3-states.data';
import { ZONE_BY_STATE } from './zone-by-state';

/**
 * §12.122. A ZIP whose first three digits are never found in the state
 * beside it: one of the two is wrong. Pure, offline.
 */

let table: Map<string, string[]> | null = null;

function load(): Map<string, string[]> {
  if (table) return table;
  const next = new Map<string, string[]>();
  for (const entry of ZIP3_STATE_DATA.split(/\s+/)) {
    const [prefix, states] = entry.split(':');
    if (prefix && states) next.set(prefix, states.split('/'));
  }
  table = next;
  return next;
}

/** What to say, or null when they agree — or when there is nothing to go on. */
export function zipStateCheck(state: string, zip: string): string | null {
  const code = state.trim().toUpperCase();
  const digits = zip.replace(/\D/g, '');
  if (!(code in ZONE_BY_STATE) || digits.length < 5) return null;
  const states = load().get(digits.slice(0, 3));
  // A prefix with no land at all (PO-box and military ZIPs) says nothing.
  if (!states || states.includes(code)) return null;
  return `ZIP ${digits.slice(0, 5)} is in ${states.join(' or ')}, not ${code}.`;
}
