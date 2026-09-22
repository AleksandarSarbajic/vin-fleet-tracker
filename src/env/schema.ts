import { z } from 'zod';

/**
 * Pure schemas — no process.env access, no side effects, so they can be
 * unit tested. client.ts and server.ts do the parsing.
 */

export const ClientEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a URL')
    .refine((u) => new URL(u).pathname.replace(/\/+$/, '') === '', {
      message:
        'NEXT_PUBLIC_SUPABASE_URL must be the bare origin ' +
        '(https://<ref>.supabase.co) with no path. supabase-js appends ' +
        '/rest/v1 itself; a baked-in path produces /rest/v1/rest/v1/...',
    }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .startsWith(
      'sb_publishable_',
      'Must be the publishable key (sb_publishable_…). The legacy anon JWT ' +
        'is deprecated, and a secret key here would ship to browsers.',
    ),
  NEXT_PUBLIC_MAPBOX_TOKEN: z
    .string()
    .startsWith('pk.', 'Mapbox browser tokens start with pk. — sk. is secret.'),
});

const secretKey = (which: string) =>
  z
    .string()
    .startsWith(
      'sb_secret_',
      `${which} must be a secret key (sb_secret_…). The legacy service_role ` +
        `JWT is deprecated and newer projects do not have one.`,
    );

export function isIanaZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const ServerEnv = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .refine((u) => u.includes('pooler.supabase.com:6543'), {
        message:
          'DATABASE_URL must be the TRANSACTION pooler (…pooler.supabase.com:6543). ' +
          'Using the session pooler or a direct connection here exhausts ' +
          'connections under load and looks like an application bug.',
      }),

    DIRECT_URL: z
      .string()
      .url()
      .refine((u) => !/db\.[a-z0-9]+\.supabase\.co/.test(u), {
        message:
          'DIRECT_URL must not be db.<ref>.supabase.co — that host is ' +
          'IPv6-only without the paid add-on and most worker hosts have no ' +
          'outbound IPv6. Use the SESSION pooler (…pooler.supabase.com:5432).',
      })
      .refine((u) => u.includes('pooler.supabase.com:5432'), {
        message: 'DIRECT_URL must be the SESSION pooler (…pooler.supabase.com:5432).',
      }),

    SUPABASE_SECRET_KEY: secretKey('SUPABASE_SECRET_KEY'),
    WORKER_SUPABASE_SECRET_KEY: secretKey('WORKER_SUPABASE_SECRET_KEY'),

    /**
     * HERE Routing v8, truck profile (§12.59). SERVER ONLY.
     *
     * Replaced `MAPBOX_DIRECTIONS_TOKEN`, which is gone rather than left
     * lying about: a token for a provider nothing calls is a credential with
     * no owner, and the next person to find it in `.env` has to work out
     * whether it matters.
     *
     * Optional: absent, the board degrades to the straight-line estimate
     * exactly as it did when Mapbox was down. Refusing to boot would take the
     * whole dispatch console off the air over an enrichment it already knows
     * how to live without.
     */
    HERE_API_KEY: z.string().min(1).optional(),

    /**
     * Monthly ceiling on routing calls (§12.59, §12.61).
     *
     * **5,000 — HERE's free Base allowance exactly.**
     *
     * It was 3,000, sized from a measurement that turned out to be an
     * average of the wrong thing: 2.62 calls per worker-hour over 99 hours,
     * which included long stretches with the fleet parked and the worker
     * idle. Projected ~2,700/month, so 3,000 looked like a conservative
     * ceiling with 40% of the free tier in reserve.
     *
     * A full working day, counted rather than averaged:
     *
     *     measured      168 calls in 24 h of a real dispatch day
     *     simulated     187/day, replaying `needsRecompute` over 110,777
     *                   real position fixes across 18 truck-lanes
     *     projected     5,797/month at the simulated rate
     *
     * The simulation overshoots the count by 11%, which is close enough to
     * trust and pessimistic in the safe direction. **The rule that is running
     * costs about 5,800 calls a month and the free tier is 5,000.**
     *
     * So there is no honest ceiling that the current rule fits inside, and
     * the question is only which limit the guard should be. It is the
     * vendor's. A ceiling above 5,000 cannot guard anything — HERE's limit
     * arrives first and the overage is a bill, not a degradation — and a
     * ceiling below 5,000 gives up free capacity while still being breached.
     * At 5,000 the guard fires exactly where the free tier ends.
     *
     * The consequence is meant to be visible, not smoothed away: at the
     * measured rate the ceiling is reached **around day 27**, and the board
     * spends the last few days of the month on lane-ratio estimates. That is
     * the guard working. It is also the standing argument for a recompute
     * rule that costs less — see §12.61 for what was measured and rejected.
     *
     * Raising this above 5,000 is a decision to pay HERE for overage, and
     * should be made with a price in hand rather than to quiet a warning.
     */
    ROUTING_MONTHLY_CEILING: z.coerce.number().int().positive().default(5_000),

    SAMSARA_API_TOKEN: z.string().min(1),
    SAMSARA_ORG_ID: z.string().regex(/^\d+$/, 'SAMSARA_ORG_ID must be numeric'),

    DISPATCH_TZ: z
      .string()
      .refine(isIanaZone, { message: 'DISPATCH_TZ must be a valid IANA zone' })
      .default('America/Chicago'),

    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })
  .refine((e) => e.SUPABASE_SECRET_KEY !== e.WORKER_SUPABASE_SECRET_KEY, {
    path: ['WORKER_SUPABASE_SECRET_KEY'],
    message:
      'SUPABASE_SECRET_KEY and WORKER_SUPABASE_SECRET_KEY are identical. ' +
      'Issue a separate key per service so either can be rotated alone.',
  })
  /**
   * §12.59. The HERE key must not be any value that reaches a browser.
   *
   * Broader than the guard it replaces, which compared one token against one
   * named counterpart. `NEXT_PUBLIC_*` is the whole client surface — Next
   * inlines every one of them into the bundle by literal substitution — so
   * this compares against all of them, and therefore also catches the
   * mistake the narrow version could not: someone adding
   * `NEXT_PUBLIC_HERE_API_KEY` to make it reachable from a map component.
   *
   * A routing key in a network tab is a metered API anyone can spend, and
   * HERE's free allowance is 5,000 transactions a month — one afternoon of
   * somebody else's script.
   */
  .refine(
    (e) => e.HERE_API_KEY === undefined || publicValues().every((v) => v !== e.HERE_API_KEY),
    {
      path: ['HERE_API_KEY'],
      message:
        'HERE_API_KEY is also exposed as a NEXT_PUBLIC_* variable, which ' +
        'ships to every browser. Routing is metered: keep the key server-side ' +
        'and issue a separate one if a client ever genuinely needs HERE.',
    },
  );

/** Every value Next will inline into the client bundle. */
function publicValues(): string[] {
  return Object.entries(process.env)
    .filter(([key, value]) => key.startsWith('NEXT_PUBLIC_') && typeof value === 'string')
    .map(([, value]) => value as string);
}

export function report(scope: string, error: z.ZodError): string {
  const lines = error.issues.map(
    (i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`,
  );
  return [
    `Invalid ${scope} environment — refusing to start.`,
    ...lines,
    '',
    'Copy .env.example to .env.local and fill it in.',
  ].join('\n');
}
