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
     * Monthly ceiling on routing calls (§12.59).
     *
     * **3,000 against HERE's 5,000/month free Base allowance** — 60% of it.
     * Mapbox's free tier was 100,000 and this default was 25,000; the tier
     * shrank by 20x and the ceiling has to shrink with it or it guards
     * nothing.
     *
     * Sized from MEASURED traffic, not from the §12.31 simulation:
     *
     *     measured     2.62 calls per worker-hour over 99 hours of real
     *                  operation (259 calls) -> ~1,950/month at 24/7
     *     restarts     every lane is `no-route` on a cold start; the worst
     *                  observed hour was 72 calls across three restarts
     *     projected    ~2,700/month including restarts
     *     §12.31 said  ~516 calls/day = ~15,480/month
     *
     * **The documented projection does not fit and the real traffic does.**
     * §12.31 simulated 23 trucks all running long lanes at once; the fleet
     * actually moves about seven at a time. If utilisation rises to what
     * §12.31 assumed, this ceiling is reached around day 6 and the board
     * spends the rest of the month on lane estimates — which is the budget
     * guard working, not failing, and is the right failure to choose.
     */
    ROUTING_MONTHLY_CEILING: z.coerce.number().int().positive().default(3_000),

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
