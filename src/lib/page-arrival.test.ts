import { describe, expect, it } from 'vitest';
import { arrive, cameByPageChange } from './page-arrival';

/**
 * §12.153. Which page a load landed on. `PageRise` calls `arrive` once per page, after the
 * page's own mount has asked; the pages ask `cameByPageChange` while they mount.
 */
describe('the page a load lands on, and the ones after it', () => {
  it('the first page says “load”, before and as it is marked; every later one says “change”', () => {
    expect(cameByPageChange()).toBe(false);
    expect(arrive()).toBe(false);
    expect(cameByPageChange()).toBe(true);
    expect(arrive()).toBe(true);
    expect(cameByPageChange()).toBe(true);
  });
});
