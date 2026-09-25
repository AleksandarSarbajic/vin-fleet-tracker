import { describe, expect, it } from 'vitest';
import { AppEnv, ClientEnv, MigrateEnv, WorkerEnv, isIanaZone } from './schema';

const REF = 'ywfotpjljshxrgxlgcdp';
const POOLER = 'aws-1-eu-west-1.pooler.supabase.com';

const TRANSACTION = `postgresql://postgres.${REF}:pw@${POOLER}:6543/postgres`;
const SESSION = `postgresql://postgres.${REF}:pw@${POOLER}:5432/postgres`;
const IPV6_DIRECT = `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`;

/** What a Vercel project holds, server side (§12.75). */
const validApp = {
  DATABASE_URL: TRANSACTION,
  DISPATCH_TZ: 'America/Chicago',
  NODE_ENV: 'test',
};

/** Exactly what the droplet's systemd EnvironmentFile carries. */
const validWorker = {
  DIRECT_URL: SESSION,
  SAMSARA_API_TOKEN: 'samsara_api_x',
  SAMSARA_ORG_ID: '45975',
  NODE_ENV: 'production',
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

describe('AppEnv', () => {
  it('accepts the transaction pooler and nothing else', () => {
    expect(AppEnv.safeParse(validApp).success).toBe(true);
  });

  it('rejects the session pooler as DATABASE_URL', () => {
    const r = AppEnv.safeParse({ ...validApp, DATABASE_URL: SESSION });
    expect(r.success).toBe(false);
    expect(errorOn(r, 'DATABASE_URL')).toMatch(/TRANSACTION pooler/);
  });

  it('rejects the direct host as DATABASE_URL', () => {
    const r = AppEnv.safeParse({ ...validApp, DATABASE_URL: IPV6_DIRECT });
    expect(errorOn(r, 'DATABASE_URL')).toMatch(/TRANSACTION pooler/);
  });

  it('rejects a bogus dispatch timezone', () => {
    const r = AppEnv.safeParse({ ...validApp, DISPATCH_TZ: 'America/Chicago/' });
    expect(r.success).toBe(false);
  });

  it('defaults the dispatch timezone to America/Chicago', () => {
    const { DISPATCH_TZ: _omitted, ...withoutTz } = validApp;
    const r = AppEnv.safeParse(withoutTz);
    expect(r.success && r.data.DISPATCH_TZ).toBe('America/Chicago');
  });
});

describe('the pooler pair, each half on the side that uses it', () => {
  /**
   * The swap this rule was written for: 5432 where 6543 belongs and the other
   * way round. The two strings now live in different schemas, so each side
   * refuses the other's.
   */
  it('refuses the ports swapped, from both sides', () => {
    expect(errorOn(AppEnv.safeParse({ ...validApp, DATABASE_URL: SESSION }), 'DATABASE_URL')).toMatch(
      /TRANSACTION pooler/,
    );
    expect(
      errorOn(WorkerEnv.safeParse({ ...validWorker, DIRECT_URL: TRANSACTION }), 'DIRECT_URL'),
    ).toMatch(/SESSION pooler/);
  });

  it('rejects the IPv6-only direct host for the worker', () => {
    // Verified 2026-09-17: db.<ref>.supabase.co has an AAAA record and no A
    // record. Most worker hosts have no outbound IPv6, so this string simply
    // cannot connect from them.
    const r = WorkerEnv.safeParse({ ...validWorker, DIRECT_URL: IPV6_DIRECT });
    expect(errorOn(r, 'DIRECT_URL')).toMatch(/IPv6-only/);
  });

  it('migrations take the session pooler, and only that', () => {
    expect(MigrateEnv.safeParse({ DIRECT_URL: SESSION }).success).toBe(true);
    expect(errorOn(MigrateEnv.safeParse({ DIRECT_URL: TRANSACTION }), 'DIRECT_URL')).toMatch(
      /SESSION pooler/,
    );
  });

  it('rejects a non-numeric Samsara org id', () => {
    const r = WorkerEnv.safeParse({ ...validWorker, SAMSARA_ORG_ID: 'org-45975' });
    expect(r.success).toBe(false);
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
      WorkerEnv.safeParse({ ...validWorker, HERE_API_KEY: 'here-secret' }),
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
      WorkerEnv.safeParse({ ...validWorker, HERE_API_KEY: 'here-secret' }),
    );
    expect(r.success).toBe(false);
    expect(errorOn(r, 'HERE_API_KEY')).toContain('ships to every browser');
  });

  it('refuses it whichever public variable happens to hold it', () => {
    const r = withPublic({ NEXT_PUBLIC_MAPBOX_TOKEN: 'shared-value' }, () =>
      WorkerEnv.safeParse({ ...validWorker, HERE_API_KEY: 'shared-value' }),
    );
    expect(r.success).toBe(false);
  });

  it('boots without one, because the board degrades rather than falling over', () => {
    // Absent, every lane falls back to the lane estimate or the straight
    // line. Refusing to start would take the whole console off the air over
    // an enrichment it already knows how to live without.
    const r = WorkerEnv.safeParse(validWorker);
    expect(r.success).toBe(true);
    expect(r.success && r.data.HERE_API_KEY).toBeUndefined();
  });

  it("caps the month at HERE's free allowance, never above it", () => {
    const r = WorkerEnv.safeParse(validWorker);
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

describe('the loopback exception for the e2e suite', () => {
  const LOCAL = 'postgres://postgres@127.0.0.1:55432/fleet_test';

  /**
   * Playwright runs the REAL app against ./.testdb so its fixtures are
   * disposable. Without this the app refuses to boot for the browser suite,
   * and the only alternatives are pointing e2e at production data or not
   * testing the app at all.
   */
  it('accepts a loopback cluster on both sides', () => {
    expect(AppEnv.safeParse({ ...validApp, DATABASE_URL: LOCAL }).success).toBe(true);
    expect(WorkerEnv.safeParse({ ...validWorker, DIRECT_URL: LOCAL }).success).toBe(true);
  });

  /**
   * And the guard it must NOT have weakened. What this rule really catches is
   * 5432-vs-6543 confusion against a Supabase host; 127.0.0.1 is not a way of
   * getting that wrong, but pointing DATABASE_URL at the session pooler still
   * is.
   */
  it('still refuses the session pooler as DATABASE_URL', () => {
    const r = AppEnv.safeParse({ ...validApp, DATABASE_URL: SESSION });
    expect(errorOn(r, 'DATABASE_URL')).toMatch(/TRANSACTION pooler/);
  });

  it('still refuses the IPv6-only host, which loopback must not excuse', () => {
    const r = WorkerEnv.safeParse({ ...validWorker, DIRECT_URL: IPV6_DIRECT });
    expect(errorOn(r, 'DIRECT_URL')).toMatch(/IPv6-only/);
  });
});

describe('the app and the worker share no credential (§12.75)', () => {
  /**
   * THE POINT OF BOTH SPLITS. Each runtime once had to hold the other's
   * secrets to boot: the worker needed the app's Supabase key (fixed in phase
   * 6), and the app needed DIRECT_URL, both Samsara values and the worker's
   * key (fixed in §12.75). Neither read what it demanded; the validation rule
   * alone undid the separation the two hosts exist for.
   */
  it('the worker starts with no Supabase API key and no transaction pooler string', () => {
    expect(WorkerEnv.safeParse(validWorker).success).toBe(true);
  });

  it('the app starts with none of the worker\'s variables', () => {
    expect(AppEnv.safeParse(validApp).success).toBe(true);
    const r = AppEnv.safeParse({ ...validApp, ...validWorker, DATABASE_URL: TRANSACTION });
    expect(r.success && Object.keys(r.data).sort()).toEqual(['DATABASE_URL', 'DISPATCH_TZ', 'NODE_ENV']);
  });

  it('and each refuses to stand in for the other', () => {
    // The worker's environment judged by the app's schema: no transaction
    // pooler. The app's judged by the worker's: no session pooler, no Samsara.
    expect(errorOn(AppEnv.safeParse(validWorker), 'DATABASE_URL')).not.toBe('');
    const asWorker = WorkerEnv.safeParse(validApp);
    for (const field of ['DIRECT_URL', 'SAMSARA_API_TOKEN', 'SAMSARA_ORG_ID']) {
      expect(errorOn(asWorker, field), `${field} should be required of the worker`).not.toBe('');
    }
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
      WorkerEnv.safeParse({ ...validWorker, SENTRY_WORKER_DSN: WORKER }),
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
      WorkerEnv.safeParse({ ...validWorker, SENTRY_WORKER_DSN: APP }),
    );
    expect(r.success).toBe(false);
    expect(errorOn(r, 'SENTRY_WORKER_DSN')).toMatch(/separate Sentry projects/);
  });

  it('treats both as optional — reporting must not gate the worker starting', () => {
    // The same ruling as HERE_API_KEY (§12.31): an enrichment that can refuse
    // to boot the ingestion worker is a worse outage than the one it reports.
    const r = withPublicDsn(undefined, () => WorkerEnv.safeParse(validWorker));
    expect(r.success).toBe(true);
    expect(r.success && r.data.SENTRY_WORKER_DSN).toBeUndefined();
  });

  it('rejects a DSN that is not a URL', () => {
    const r = withPublicDsn(undefined, () =>
      WorkerEnv.safeParse({ ...validWorker, SENTRY_WORKER_DSN: 'not-a-dsn' }),
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

describe('a blank optional variable is an absent one', () => {
  /**
   * `.env.example` ships `SENTRY_WORKER_DSN=` with no value, and the schema's
   * own failure message tells people to copy that file. Blank strings are not
   * `undefined`, so `.optional()` did not apply: the URL check failed, the two
   * blank DSNs then collided as "the same DSN", and the app refused to start
   * on the advice it had just given. Caught by the Playwright web server,
   * which passes empty strings to switch Sentry off.
   */
  it('accepts the environment produced by copying .env.example', () => {
    const r = WorkerEnv.safeParse({
      ...validWorker,
      SENTRY_WORKER_DSN: '',
      SENTRY_RELEASE: '',
      HERE_API_KEY: '',
    });
    expect(r.success, JSON.stringify(r.success ? {} : r.error.issues)).toBe(true);
    expect(r.success && r.data.SENTRY_WORKER_DSN).toBeUndefined();
    expect(r.success && r.data.HERE_API_KEY).toBeUndefined();
  });

  it('does not read two blanks as one shared Sentry project', () => {
    const before = process.env['NEXT_PUBLIC_SENTRY_DSN'];
    process.env['NEXT_PUBLIC_SENTRY_DSN'] = '';
    try {
      const r = WorkerEnv.safeParse({ ...validWorker, SENTRY_WORKER_DSN: '' });
      expect(errorOn(r, 'SENTRY_WORKER_DSN')).toBe('');
    } finally {
      if (before === undefined) delete process.env['NEXT_PUBLIC_SENTRY_DSN'];
      else process.env['NEXT_PUBLIC_SENTRY_DSN'] = before;
    }
  });

  it('still rejects a non-blank value that is not a DSN', () => {
    const r = WorkerEnv.safeParse({ ...validWorker, SENTRY_WORKER_DSN: 'nonsense' });
    expect(errorOn(r, 'SENTRY_WORKER_DSN')).toMatch(/must be a Sentry DSN URL/);
  });

  it('accepts a blank client DSN too', () => {
    expect(ClientEnv.safeParse({ ...validClient, NEXT_PUBLIC_SENTRY_DSN: '' }).success).toBe(true);
  });
});
