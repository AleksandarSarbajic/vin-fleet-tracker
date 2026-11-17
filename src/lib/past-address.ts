import { z } from 'zod';

/**
 * §12.164, phase 3bx (QoL 2). An address this company has sent a truck to before, from its own
 * `stops`: what `GET /api/stops/addresses` answers, and what Street address suggests from while
 * a dispatcher types. No outside service: these are our own past stops, nothing else.
 */
export const PastAddress = z.object({
  addressLine: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  /** How many stops have used it. The list shows the most used first among what matches. */
  uses: z.number().int().positive(),
  /** When the newest load that used it was made: the route's order, and the tie-break here. */
  lastUsedAt: z.string(),
});
export type PastAddress = z.infer<typeof PastAddress>;
export const PastAddresses = z.object({ addresses: z.array(PastAddress) });

/** Nothing is suggested for fewer typed characters than this: one letter matches half the list. */
export const SUGGEST_MIN_CHARS = 2;
/** At most this many are shown, as in the demo; the field stays free text past them. */
export const SUGGEST_SHOWN = 6;

const words = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

/** The rest of the address, as the list shows it beside the street: `Chicago, IL 60601`. */
export const placeLine = (p: Pick<PastAddress, 'city' | 'state' | 'zip'>) =>
  [p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const haystack = (p: PastAddress) => words(`${p.addressLine} ${p.city ?? ''} ${p.state ?? ''} ${p.zip ?? ''}`);

/**
 * The past stops that hold what was typed, anywhere in their street, city, state or ZIP, most
 * used first, then the newest. Filtered here in the browser, from the one list fetched as the
 * window opened.
 */
export function matchAddresses(all: readonly PastAddress[], typed: string): PastAddress[] {
  const q = words(typed);
  if (q.length < SUGGEST_MIN_CHARS) return [];
  return all
    .filter((p) => haystack(p).includes(q))
    .sort((a, b) => b.uses - a.uses || (a.lastUsedAt < b.lastUsedAt ? 1 : a.lastUsedAt > b.lastUsedAt ? -1 : 0))
    .slice(0, SUGGEST_SHOWN);
}
