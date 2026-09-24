import { z } from 'zod';

/**
 * Pure schemas — no process.env access, no side effects, so they can be
 * unit tested. client.ts and server.ts do the parsing.
 */

/**
 * A Sentry DSN (phase 6, item 4).
 *
 * NOT a secret, and the one place in this file where that is true. A DSN is a
 * write-only ingest address: it can file an event and cannot read one, which
 * is why Sentry's own browser SDK is built around shipping it to every client.
 * So `NEXT_PUBLIC_SENTRY_DSN` is a deliberate exception to the rule the rest
 * of this schema enforces, and it is an exception on the merits rather than
 * for convenience — the alternative is proxying every browser error through
 * our own route, which is a lot of machinery to hide a value that is designed
 * to be seen.
 *
 * Validated as a URL rather than by prefix: Sentry's ingest hostnames are
 * region-specific (this org is on `.ingest.de.sentry.io`) and a `startsWith`
 * check would have to be edited the first time a project moved region.
 */
const sentryDsn = (which: string) =>
  z
    .string()
    .url(`${which} must be a Sentry DSN URL (https://<key>@<org>.ingest.<region>.sentry.io/<id>)`)
    .refine((u) => u.includes('sentry.io') || u.includes('sentry'), {
      message: `${which} does not look like a Sentry DSN`,
    });

/**
 * An optional variable that is PRESENT BUT BLANK is absent.
 *
 * `.env.example` ships `SENTRY_WORKER_DSN=` with no value, and the schema's own
 * error message tells people to copy that file. Without this, following that
 * instruction produces empty strings, which are not `undefined`, so `.optional()`
 * does not apply — the URL check fails and the two blank DSNs then collide as
 * "the same DSN". The app refuses to start, and the advice it gives you is the
 * thing that broke it.
 *
 * vitest.setup.ts already learned this and wrote it down: it DELETES the
 * production credentials rather than blanking them, "because an empty string is
 * a value that a `??` will happily keep". Same defect, other direction.
 */
const blankIsAbsent = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);

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

  /**
   * The APP's Sentry project. Optional: error reporting must not be able to
   * stop the console from loading, for the same reason the worker treats its
   * own DSN as optional.
   */
  NEXT_PUBLIC_SENTRY_DSN: blankIsAbsent(sentryDsn('NEXT_PUBLIC_SENTRY_DSN').optional()),
});

const secretKey = (which: string) =>
  z
    .string()
    .startsWith(
      'sb_secret_',
      `${which} must be a secret key (sb_secret_…). The legacy service_role ` +
        `JWT is deprecated and newer projects do not have one.`,
    );

/**
 * Hosts that cannot be anybody's production database.
 *
 * Defined here rather than in the test helpers because the app's own schema is
 * now the thing that has to recognise them, and `src/test/url.ts` re-exports
 * this rather than keeping a second copy. One list, one meaning of "local".
 */
export const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** Is this connection string pointed at a disposable cluster on this machine? */
export function isLoopbackDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function isIanaZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const serverShape = z.object({
    DATABASE_URL: z
      .string()
      .url()
      /**
       * The transaction pooler, OR a loopback cluster.
       *
       * The loopback exception exists for the Playwright suite, which runs the
       * real app against `./.testdb` so that its fixtures are disposable. The
       * guard is not weakened by it: what it is really catching is 5432-vs-6543
       * confusion against a Supabase host, and `127.0.0.1` is not a way of
       * getting that wrong. A loopback URL in production points at nothing and
       * fails loudly on the first query rather than quietly under load, which
       * is the failure mode this rule exists to prevent.
       */
      .refine((u) => u.includes('pooler.supabase.com:6543') || isLoopbackDatabase(u), {
        message:
          'DATABASE_URL must be the TRANSACTION pooler (…pooler.supabase.com:6543), ' +
          'or a loopback test cluster. Using the session pooler or a direct ' +
          'connection here exhausts connections under load and looks like an ' +
          'application bug.',
      }),

    DIRECT_URL: z
      .string()
      .url()
      .refine((u) => isLoopbackDatabase(u) || !/db\.[a-z0-9]+\.supabase\.co/.test(u), {
        message:
          'DIRECT_URL must not be db.<ref>.supabase.co — that host is ' +
          'IPv6-only without the paid add-on and most worker hosts have no ' +
          'outbound IPv6. Use the SESSION pooler (…pooler.supabase.com:5432).',
      })
      /** Loopback for the same reason as DATABASE_URL above. */
      .refine((u) => u.includes('pooler.supabase.com:5432') || isLoopbackDatabase(u), {
        message:
          'DIRECT_URL must be the SESSION pooler (…pooler.supabase.com:5432), ' +
          'or a loopback test cluster.',
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
    HERE_API_KEY: blankIsAbsent(z.string().min(1).optional()),

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

    /**
     * The WORKER's Sentry project — a different project from the app's, not a
     * second copy of the same DSN. The two runtimes fail differently: the app
     * fails per-request in front of somebody who can see it, the worker fails
     * alone at 3am. Pointed at one project, the second kind disappears behind
     * the volume of the first, and neither gets its own quota.
     *
     * Optional, like HERE_API_KEY and for the same reason (§12.31): an
     * enrichment must never be able to take the ingestion worker off the air.
     * A fleet nobody can see is worse than errors nobody records.
     */
    SENTRY_WORKER_DSN: blankIsAbsent(sentryDsn('SENTRY_WORKER_DSN').optional()),

    /** Usually the deployed commit, so an event can name the code it came from. */
    SENTRY_RELEASE: blankIsAbsent(z.string().min(1).optional()),

    SAMSARA_API_TOKEN: z.string().min(1),
    SAMSARA_ORG_ID: z.string().regex(/^\d+$/, 'SAMSARA_ORG_ID must be numeric'),

    DISPATCH_TZ: z
      .string()
      .refine(isIanaZone, { message: 'DISPATCH_TZ must be a valid IANA zone' })
      .default('America/Chicago'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

/**
 * The two Sentry projects must stay two projects.
 *
 * Pasting one DSN into both variables is the easy mistake — they look alike,
 * they arrive at the same time, and nothing downstream errors. The result is
 * that worker events and app events land in one stream and the separation the
 * two projects exist to provide is silently gone, which is discovered weeks
 * later while looking for something else.
 *
 * Shared by both schemas below, because both runtimes can get it wrong.
 */
const sentryProjectsDiffer = (e: { SENTRY_WORKER_DSN?: string | undefined }): boolean => {
  const app = process.env['NEXT_PUBLIC_SENTRY_DSN']?.trim();
  // Two blanks are two absences, not one shared project.
  if (!e.SENTRY_WORKER_DSN || !app) return true;
  return e.SENTRY_WORKER_DSN !== app;
};

const SENTRY_PROJECTS_DIFFER = {
  path: ['SENTRY_WORKER_DSN'],
  message:
    'SENTRY_WORKER_DSN and NEXT_PUBLIC_SENTRY_DSN are the same DSN. They ' +
    'are meant to be separate Sentry projects so the worker and the app ' +
    'keep separate streams and separate quotas.',
};

/**
 * §12.59. The HERE key must not be any value that reaches a browser.
 *
 * Broader than the guard it replaces, which compared one token against one
 * named counterpart. `NEXT_PUBLIC_*` is the whole client surface — Next
 * inlines every one of them into the bundle by literal substitution — so this
 * compares against all of them, and therefore also catches the mistake the
 * narrow version could not: someone adding `NEXT_PUBLIC_HERE_API_KEY` to make
 * it reachable from a map component.
 *
 * A routing key in a network tab is a metered API anyone can spend, and HERE's
 * free allowance is 5,000 transactions a month — one afternoon of somebody
 * else's script.
 */
const hereKeyIsNotPublic = (e: { HERE_API_KEY?: string | undefined }): boolean =>
  e.HERE_API_KEY === undefined || publicValues().every((v) => v !== e.HERE_API_KEY);

const HERE_KEY_IS_NOT_PUBLIC = {
  path: ['HERE_API_KEY'],
  message:
    'HERE_API_KEY is also exposed as a NEXT_PUBLIC_* variable, which ' +
    'ships to every browser. Routing is metered: keep the key server-side ' +
    'and issue a separate one if a client ever genuinely needs HERE.',
};

/**
 * What the NEXT APP needs. Everything.
 */
export const ServerEnv = serverShape
  .refine((e) => e.SUPABASE_SECRET_KEY !== e.WORKER_SUPABASE_SECRET_KEY, {
    path: ['WORKER_SUPABASE_SECRET_KEY'],
    message:
      'SUPABASE_SECRET_KEY and WORKER_SUPABASE_SECRET_KEY are identical. ' +
      'Issue a separate key per service so either can be rotated alone.',
  })
  .refine(sentryProjectsDiffer, SENTRY_PROJECTS_DIFFER)
  .refine(hereKeyIsNotPublic, HERE_KEY_IS_NOT_PUBLIC);

/**
 * What the WORKER needs, which is strictly less (phase 6, item 2).
 *
 * The worker's only database credential is `DIRECT_URL`. It holds NO Supabase
 * API key and no transaction-pooler string, because it uses neither: its data
 * access is `createDirectDb`, and `lib/supabase/admin.ts` — the only consumer
 * of either secret key — imports `server-only` and is therefore unreachable
 * from a standalone Node process by construction.
 *
 * Validating the worker against the full `ServerEnv` is what forced the
 * question. It demanded `SUPABASE_SECRET_KEY` — the APP's key — before the
 * worker would boot, so deploying the worker to its own host meant copying the
 * app's credential onto a machine that cannot use it. That is precisely the
 * coupling the two-key split exists to prevent (§ the `.refine` above: "so
 * either can be rotated alone"), reintroduced by a validation rule rather than
 * by any code that reads the value.
 *
 * So the worker host now holds four secrets, not seven, and rotating the app's
 * Supabase key does not involve it at all.
 */
export const WorkerEnv = serverShape
  .pick({
    DIRECT_URL: true,
    SAMSARA_API_TOKEN: true,
    SAMSARA_ORG_ID: true,
    HERE_API_KEY: true,
    ROUTING_MONTHLY_CEILING: true,
    SENTRY_WORKER_DSN: true,
    SENTRY_RELEASE: true,
    DISPATCH_TZ: true,
    NODE_ENV: true,
  })
  .refine(sentryProjectsDiffer, SENTRY_PROJECTS_DIFFER)
  .refine(hereKeyIsNotPublic, HERE_KEY_IS_NOT_PUBLIC);

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
