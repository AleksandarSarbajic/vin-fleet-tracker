import { describe, expect, it } from 'vitest';
import { ClientEnv, ServerEnv, WorkerEnv, isIanaZone } from './schema';

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

  it("caps the month at HERE's free allowance, never above it", () => {
    const r = ServerEnv.safeParse(validServer);
    /**
     * 5,000 (§12.61). The measured rule costs ~5,800/month, so no ceiling it
     * fits inside exists — and a ceiling ABOVE the free tier cannot guard
     * anything, because HERE's limit arrives first and the overage is a bill
     * rather than a degradation. The upper bound is the assertion that
     * matters; the exact value is allowed to fall.
     */
    expect(r.success && r.data.ROUTING_MONTHLY_CEILING).toBe(5_000);
    expect(r.success && r.data.ROUTING_MONTHLY_CEILING).toBeLessThanOrEqual(5_000);
  });
});

describe('WorkerEnv holds strictly less than the app does', () => {
  /** Exactly what the droplet's systemd EnvironmentFile carries. */
  const validWorker = {
    DIRECT_URL: `postgresql://postgres.${REF}:pw@${POOLER}:5432/postgres`,
    SAMSARA_API_TOKEN: 'samsara_api_x',
    SAMSARA_ORG_ID: '45975',
    NODE_ENV: 'production',
  };

  /**
   * THE POINT OF THE SPLIT. Validating the worker against `ServerEnv` demanded
   * SUPABASE_SECRET_KEY — the APP's key — before the worker would start, so
   * giving the worker its own host meant copying the app's credential onto a
   * machine that cannot use it: `lib/supabase/admin.ts` is the only consumer
   * of either key and imports `server-only`, which a standalone Node process
   * can never satisfy.
   *
   * That is the two-key rotation split being undone by a validation rule
   * rather than by anything that reads the value.
   */
  it('starts with no Supabase API key and no transaction pooler string', () => {
    const r = WorkerEnv.safeParse(validWorker);
    expect(r.success).toBe(true);
  });

  it('is what ServerEnv would have refused, which is why it exists', () => {
    // The same environment, judged by the app's schema: three missing secrets.
    const asApp = ServerEnv.safeParse(validWorker);
    expect(asApp.success).toBe(false);
    for (const field of ['DATABASE_URL', 'SUPABASE_SECRET_KEY', 'WORKER_SUPABASE_SECRET_KEY']) {
      expect(errorOn(asApp, field), `${field} should be required of the app`).not.toBe('');
    }
  });

  it('still insists on the session pooler — the mistake already made once', () => {
    const r = WorkerEnv.safeParse({
      ...validWorker,
      DIRECT_URL: `postgresql://postgres.${REF}:pw@${POOLER}:6543/postgres`,
    });
    expect(errorOn(r, 'DIRECT_URL')).toMatch(/SESSION pooler/);
  });

  it('still refuses the IPv6-only direct host', () => {
    const r = WorkerEnv.safeParse({
      ...validWorker,
      DIRECT_URL: `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`,
    });
    expect(errorOn(r, 'DIRECT_URL')).toMatch(/IPv6-only/);
  });

  it('keeps the routing ceiling default, so the guard exists without being set', () => {
    const r = WorkerEnv.safeParse(validWorker);
    expect(r.success && r.data.ROUTING_MONTHLY_CEILING).toBe(5_000);
  });
});

describe('the two Sentry projects', () => {
  const APP = 'https://abc123@o4512140256739328.ingest.de.sentry.io/4512140286558288';
  const WORKER = 'https://def456@o4512140256739328.ingest.de.sentry.io/4512140304580688';

  /**
   * The refine reads NEXT_PUBLIC_SENTRY_DSN off process.env, because that is
   * where Next will have inlined it from. Set and restored around each case.
   */
  const withPublicDsn = <T,>(value: string | undefined, body: () => T): T => {
    const before = process.env['NEXT_PUBLIC_SENTRY_DSN'];
    if (value === undefined) delete process.env['NEXT_PUBLIC_SENTRY_DSN'];
    else process.env['NEXT_PUBLIC_SENTRY_DSN'] = value;
    try {
      return body();
    } finally {
      if (before === undefined) delete process.env['NEXT_PUBLIC_SENTRY_DSN'];
      else process.env['NEXT_PUBLIC_SENTRY_DSN'] = before;
    }
  };

  it('accepts two different DSNs', () => {
    const r = withPublicDsn(APP, () =>
      ServerEnv.safeParse({ ...validServer, SENTRY_WORKER_DSN: WORKER }),
    );
    expect(r.success).toBe(true);
  });

  /**
   * The mistake this exists for: the two DSNs arrive together, look alike, and
   * pasting one into both variables breaks nothing visible. It silently merges
   * the worker's stream into the app's, so the 3am failures nobody is watching
   * end up behind the volume of the ones somebody already saw.
   */
  it('refuses one DSN used for both runtimes', () => {
    const r = withPublicDsn(APP, () =>
      ServerEnv.safeParse({ ...validServer, SENTRY_WORKER_DSN: APP }),
    );
    expect(r.success).toBe(false);
    expect(errorOn(r, 'SENTRY_WORKER_DSN')).toMatch(/separate Sentry projects/);
  });

  it('treats both as optional — reporting must not gate the worker starting', () => {
    // The same ruling as HERE_API_KEY (§12.31): an enrichment that can refuse
    // to boot the ingestion worker is a worse outage than the one it reports.
    const r = withPublicDsn(undefined, () => ServerEnv.safeParse(validServer));
    expect(r.success).toBe(true);
    expect(r.success && r.data.SENTRY_WORKER_DSN).toBeUndefined();
  });

  it('rejects a DSN that is not a URL', () => {
    const r = withPublicDsn(undefined, () =>
      ServerEnv.safeParse({ ...validServer, SENTRY_WORKER_DSN: 'not-a-dsn' }),
    );
    expect(errorOn(r, 'SENTRY_WORKER_DSN')).toMatch(/must be a Sentry DSN URL/);
  });

  it('accepts the app DSN on the client schema and tolerates its absence', () => {
    expect(ClientEnv.safeParse({ ...validClient, NEXT_PUBLIC_SENTRY_DSN: APP }).success).toBe(
      true,
    );
    expect(ClientEnv.safeParse(validClient).success).toBe(true);
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
