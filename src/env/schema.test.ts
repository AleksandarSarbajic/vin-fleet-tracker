import { describe, expect, it } from 'vitest';
import { ClientEnv, ServerEnv, isIanaZone } from './schema';

const REF = 'ywfotpjljshxrgxlgcdp';
const POOLER = 'aws-1-eu-west-1.pooler.supabase.com';

const validServer = {
  DATABASE_URL: `postgresql://postgres.${REF}:pw@${POOLER}:6543/postgres`,
  DIRECT_URL: `postgresql://postgres.${REF}:pw@${POOLER}:5432/postgres`,
  SUPABASE_SECRET_KEY: 'sb_secret_web',
  WORKER_SUPABASE_SECRET_KEY: 'sb_secret_worker',
  SAMSARA_API_TOKEN: 'samsara_api_x',
  SAMSARA_ORG_ID: '45975',
  DISPATCH_TZ: 'America/Chicago',
  NODE_ENV: 'test',
};

const validClient = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
  NEXT_PUBLIC_MAPBOX_TOKEN: 'pk.abc',
};

/** First error message for a given field, or '' if that field validated. */
function errorOn(result: { success: boolean; error?: unknown }, field: string): string {
  if (result.success) return '';
  const issues = (result.error as { issues: { path: PropertyKey[]; message: string }[] })
    .issues;
  return issues.find((i) => i.path[0] === field)?.message ?? '';
}

describe('ServerEnv', () => {
  it('accepts a correctly split pooler pair', () => {
    const r = ServerEnv.safeParse(validServer);
    expect(r.success).toBe(true);
  });

  it('rejects the IPv6-only direct host', () => {
    // Verified 2026-09-17: db.<ref>.supabase.co has an AAAA record and no A
    // record. Most worker hosts have no outbound IPv6, so this string simply
    // cannot connect from them.
    const r = ServerEnv.safeParse({
      ...validServer,
      DIRECT_URL: `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`,
    });
    expect(r.success).toBe(false);
    expect(errorOn(r, 'DIRECT_URL')).toMatch(/IPv6-only/);
  });

  it('rejects the pooler ports being swapped', () => {
    const swapped = ServerEnv.safeParse({
      ...validServer,
      DATABASE_URL: validServer.DIRECT_URL,
      DIRECT_URL: validServer.DATABASE_URL,
    });
    expect(swapped.success).toBe(false);
    expect(errorOn(swapped, 'DATABASE_URL')).toMatch(/TRANSACTION pooler/);
    expect(errorOn(swapped, 'DIRECT_URL')).toMatch(/SESSION pooler/);
  });

  it('rejects a publishable key in a secret slot', () => {
    const r = ServerEnv.safeParse({
      ...validServer,
      SUPABASE_SECRET_KEY: 'sb_publishable_oops',
    });
    expect(r.success).toBe(false);
    expect(errorOn(r, 'SUPABASE_SECRET_KEY')).toMatch(/sb_secret_/);
  });

  it('rejects the legacy service_role JWT', () => {
    const r = ServerEnv.safeParse({
      ...validServer,
      SUPABASE_SECRET_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.x.y',
    });
    expect(r.success).toBe(false);
  });

  it('rejects one secret key reused for both services', () => {
    // They exist separately so either can be rotated without downing the
    // other. Equal keys defeat the point.
    const r = ServerEnv.safeParse({
      ...validServer,
      WORKER_SUPABASE_SECRET_KEY: validServer.SUPABASE_SECRET_KEY,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-numeric Samsara org id', () => {
    const r = ServerEnv.safeParse({ ...validServer, SAMSARA_ORG_ID: 'org-45975' });
    expect(r.success).toBe(false);
  });

  it('rejects a bogus dispatch timezone', () => {
    const r = ServerEnv.safeParse({ ...validServer, DISPATCH_TZ: 'America/Chicago/' });
    expect(r.success).toBe(false);
  });

  it('defaults the dispatch timezone to America/Chicago', () => {
    const { DISPATCH_TZ: _omitted, ...withoutTz } = validServer;
    const r = ServerEnv.safeParse(withoutTz);
    expect(r.success && r.data.DISPATCH_TZ).toBe('America/Chicago');
  });
});

describe('ClientEnv', () => {
  it('accepts a bare project origin', () => {
    expect(ClientEnv.safeParse(validClient).success).toBe(true);
  });

  it.each([`https://${REF}.supabase.co/rest/v1/`, `https://${REF}.supabase.co/rest/v1`])(
    'rejects a project URL carrying a path: %s',
    (url) => {
      // supabase-js appends /rest/v1 itself; a baked-in path yields
      // /rest/v1/rest/v1/... and every request 404s.
      const r = ClientEnv.safeParse({ ...validClient, NEXT_PUBLIC_SUPABASE_URL: url });
      expect(r.success).toBe(false);
      expect(errorOn(r, 'NEXT_PUBLIC_SUPABASE_URL')).toMatch(/bare origin/);
    },
  );

  it('tolerates a single trailing slash', () => {
    const r = ClientEnv.safeParse({
      ...validClient,
      NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co/`,
    });
    expect(r.success).toBe(true);
  });

  it('refuses to ship a secret key to the browser', () => {
    const r = ClientEnv.safeParse({
      ...validClient,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_leaked',
    });
    expect(r.success).toBe(false);
  });

  it('refuses a secret Mapbox token', () => {
    const r = ClientEnv.safeParse({ ...validClient, NEXT_PUBLIC_MAPBOX_TOKEN: 'sk.abc' });
    expect(r.success).toBe(false);
  });
});

describe('the HERE routing key stays server-side (§12.59)', () => {
  /**
   * Routing is metered, and HERE's free Base allowance is 5,000 transactions
   * a month — one afternoon of somebody else's script if the key reaches a
   * browser. Next inlines every `NEXT_PUBLIC_*` value into the bundle by
   * literal substitution, so that prefix IS the client surface.
   */
  const withPublic = <T>(vars: Record<string, string>, run: () => T): T => {
    const before = { ...process.env };
    Object.assign(process.env, vars);
    try {
      return run();
    } finally {
      for (const key of Object.keys(vars)) delete process.env[key];
      Object.assign(process.env, before);
    }
  };

  it('accepts a key that is nowhere in the client bundle', () => {
    const r = withPublic({ NEXT_PUBLIC_MAPBOX_TOKEN: 'pk.abc' }, () =>
      ServerEnv.safeParse({ ...validServer, HERE_API_KEY: 'here-secret' }),
    );
    expect(r.success).toBe(true);
  });

  it('refuses a key that is ALSO published under any NEXT_PUBLIC_ name', () => {
    /**
     * The mistake the narrow guard it replaced could not catch: the old rule
     * compared one token against one named counterpart, so inventing a new
     * public variable walked straight past it.
     */
    const r = withPublic({ NEXT_PUBLIC_HERE_API_KEY: 'here-secret' }, () =>
      ServerEnv.safeParse({ ...validServer, HERE_API_KEY: 'here-secret' }),
    );
    expect(r.success).toBe(false);
    expect(errorOn(r, 'HERE_API_KEY')).toContain('ships to every browser');
  });

  it('refuses it whichever public variable happens to hold it', () => {
    const r = withPublic({ NEXT_PUBLIC_MAPBOX_TOKEN: 'shared-value' }, () =>
      ServerEnv.safeParse({ ...validServer, HERE_API_KEY: 'shared-value' }),
    );
    expect(r.success).toBe(false);
  });

  it('boots without one, because the board degrades rather than falling over', () => {
    // Absent, every lane falls back to the lane estimate or the straight
    // line. Refusing to start would take the whole console off the air over
    // an enrichment it already knows how to live without.
    const r = ServerEnv.safeParse(validServer);
    expect(r.success).toBe(true);
    expect(r.success && r.data.HERE_API_KEY).toBeUndefined();
  });

  it('caps the month well under HERE\'s free allowance by default', () => {
    const r = ServerEnv.safeParse(validServer);
    // 3,000 of 5,000. The Mapbox-era default was 25,000 against a tier of
    // 100,000; the tier shrank 20x and a ceiling above it guards nothing.
    expect(r.success && r.data.ROUTING_MONTHLY_CEILING).toBe(3_000);
    expect(r.success && r.data.ROUTING_MONTHLY_CEILING).toBeLessThan(5_000);
  });
});

describe('isIanaZone', () => {
  it.each(['America/Chicago', 'America/Phoenix', 'Europe/Belgrade', 'UTC'])(
    'accepts %s',
    (tz) => expect(isIanaZone(tz)).toBe(true),
  );

  it.each(['CDT', 'Not/AZone', ''])('rejects %s', (tz) =>
    expect(isIanaZone(tz)).toBe(false),
  );
});
