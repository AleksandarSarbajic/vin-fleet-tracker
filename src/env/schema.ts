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
     * Routing for the ETA (§12.31). SERVER ONLY, and never the browser token.
     *
     * Optional: absent, the board degrades to the straight-line estimate
     * exactly as it does when Mapbox is down. Refusing to boot would take the
     * whole dispatch console off the air over an enrichment it already knows
     * how to live without.
     */
    MAPBOX_DIRECTIONS_TOKEN: z.string().min(1).optional(),

    /**
     * Monthly ceiling on routing calls. A quarter of the free tier by
     * default, because there is no hard spend cap on the account and a
     * caching bug should cost accuracy, not money.
     */
    ROUTING_MONTHLY_CEILING: z.coerce.number().int().positive().default(25_000),

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
  .refine(
    (e) =>
      e.MAPBOX_DIRECTIONS_TOKEN === undefined ||
      e.MAPBOX_DIRECTIONS_TOKEN !== process.env['NEXT_PUBLIC_MAPBOX_TOKEN'],
    {
      path: ['MAPBOX_DIRECTIONS_TOKEN'],
      message:
        'MAPBOX_DIRECTIONS_TOKEN is the same token as NEXT_PUBLIC_MAPBOX_TOKEN, ' +
        'which ships to every browser. Issue a separate SECRET (sk.) token, so ' +
        'a metered API is not callable from a network tab and either token can ' +
        'be rotated alone.',
    },
  );

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
