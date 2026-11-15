import { describe, expect, it } from 'vitest';
import { databaseHost, refuseUnlessLoopback } from '../../e2e/loopback';

/**
 * Phase 3bw (§12.162). The e2e suite's loopback refusal, now called by `playwright.config.ts` as
 * it loads, before any web server starts. Invented URLs only: nothing here connects to anything.
 * 192.0.2.1 is from the documentation range (RFC 5737), where nothing answers.
 */
describe('the e2e loopback refusal', () => {
  it('passes 127.0.0.1 and localhost, and says which host it passed', () => {
    expect(refuseUnlessLoopback('postgres://postgres@127.0.0.1:55432/fleet_e2e')).toBe('127.0.0.1');
    expect(refuseUnlessLoopback('postgresql://u@localhost:5432/x')).toBe('localhost');
  });

  it.each([
    ['a public host name', 'postgres://u@db.example.com:5432/x', 'db.example.com'],
    ['a 10.x address', 'postgres://u@10.1.2.3:5432/x', '10.1.2.3'],
    ['a documentation address', 'postgres://u@192.0.2.1:5432/x', '192.0.2.1'],
  ])('refuses %s, naming it', (_what, url, host) => {
    expect(() => refuseUnlessLoopback(url)).toThrow(`not on this machine (${host}). Refusing to run.`);
  });

  /**
   * The WHATWG parser keeps an IPv6 host's brackets, so the old list's `'::1'` never matched.
   * Refused on purpose: the cluster listens on 127.0.0.1 only, and the app's own check has the
   * same unbracketed entry (e2e/loopback.ts says why).
   */
  it('refuses IPv6 loopback, whose host the parser keeps in brackets', () => {
    expect(new URL('http://[::1]:5432/x').hostname).toBe('[::1]');
    expect(databaseHost('postgres://u@[::1]:5432/x')).toBe('[::1]');
    expect(() => refuseUnlessLoopback('postgres://u@[::1]:5432/x')).toThrow('not on this machine ([::1])');
  });

  it('refuses what is not a URL at all, without echoing it', () => {
    expect(() => refuseUnlessLoopback('not a url')).toThrow('could not be read as a URL. Refusing to run.');
  });

  it('is the check the config runs: loading it with the default URL does not throw', async () => {
    const config = await import('../../playwright.config');
    expect(config.default.testDir).toBe('./e2e');
  });
});
