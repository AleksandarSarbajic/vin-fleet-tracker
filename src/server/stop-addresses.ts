import { sql } from 'drizzle-orm';
import type { PastAddress } from '@/lib/past-address';
import type { Db, Tx } from './audit';

/**
 * §12.164, phase 3bx (QoL 2). The company's own past stop addresses, for Street address to suggest
 * from. Read-only, over `stops` and the `loads` they belong to; nothing is written, no outside
 * service is asked, and nothing is cached: the edit window fetches this once as it opens.
 *
 * **Distinct** by the four fields as a dispatcher would read them: the street and city compared
 * without case or the spaces around them, state and ZIP as stored (the check constraints keep
 * them two capitals and five digits). The newest spelling is the one offered, and `uses` counts
 * every stop that used it. A stop with no street is not an address to offer.
 *
 * **The cap: the newest `PAST_ADDRESS_CAP` addresses,** by the newest load that used each. The
 * list exists for the places this company goes again, and those are the recent ones; a street
 * not used in the newest 500 is not a place it keeps going. 500 rows of four short fields is
 * tens of kilobytes, fetched once per window, and filtering it per keystroke is nothing. At the
 * rate HANDOFF 3bf counted (90 loads from 2026-10-15 to 2026-11-06, a few stops each, many of
 * them the same places) that is more than a year of distinct addresses: an estimate, not
 * measured against the hosted database.
 */
export const PAST_ADDRESS_CAP = 500;

export async function pastAddresses(db: Db | Tx, cap = PAST_ADDRESS_CAP): Promise<PastAddress[]> {
  const rows = (await db.execute(sql`
    with spelled as (
      select s.address_line, s.city, s.state, s.zip, l.created_at,
             lower(btrim(s.address_line)) as k_line,
             lower(btrim(coalesce(s.city, ''))) as k_city,
             coalesce(s.state, '') as k_state,
             coalesce(s.zip, '') as k_zip
        from stops s
        join loads l on l.id = s.load_id
       where s.address_line is not null and btrim(s.address_line) <> ''
    ),
    places as (
      select distinct on (k_line, k_city, k_state, k_zip)
             btrim(address_line) as address_line, btrim(city) as city, state, zip,
             count(*) over (partition by k_line, k_city, k_state, k_zip) as uses,
             max(created_at) over (partition by k_line, k_city, k_state, k_zip) as last_used_at
        from spelled
       order by k_line, k_city, k_state, k_zip, created_at desc
    )
    select address_line, city, state, zip, uses::int as uses, last_used_at
      from places
     order by last_used_at desc, address_line
     limit ${cap}
  `)) as unknown as {
    address_line: string;
    city: string | null;
    state: string | null;
    zip: string | null;
    uses: number;
    last_used_at: string | Date;
  }[];

  return rows.map((r) => ({
    addressLine: r.address_line,
    city: r.city === '' ? null : r.city,
    state: r.state,
    zip: r.zip,
    uses: Number(r.uses),
    lastUsedAt: r.last_used_at instanceof Date ? r.last_used_at.toISOString() : new Date(r.last_used_at).toISOString(),
  }));
}
