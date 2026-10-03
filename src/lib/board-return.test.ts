// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { BOARD_RETURN_KEY, boardReturnHref, rememberBoard } from './board-return';

/** §12.104. */

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(window, 'sessionStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage,
    configurable: true,
  });
});

const LIST = '0b5c2f2e-7f39-4c5e-9d38-1f1b8c3a2e10';
const known = { listIds: [LIST], chips: ['late', 'risk', 'inactive'] };

describe('the way back to the board', () => {
  it('is / when nothing was saved, as on a fresh tab', () => {
    expect(boardReturnHref(known)).toBe('/');
  });

  it('is the board as it was left: list, chips, search and truck', () => {
    rememberBoard(`?list=${LIST}&chips=late,risk&q=ana&truck=101`);
    expect(boardReturnHref(known)).toBe(`/?list=${LIST}&chips=late%2Crisk&q=ana&truck=101`);
  });

  it('is the latest address, not the first', () => {
    rememberBoard(`?list=${LIST}&truck=101`);
    rememberBoard('truck=102');
    expect(boardReturnHref(known)).toBe('/?truck=102');
  });

  it('is / when the saved list has been deleted', () => {
    rememberBoard(`?list=${LIST}&truck=101`);
    expect(boardReturnHref({ ...known, listIds: [] })).toBe('/');
  });

  it('is / when the saved chips are not chips any more', () => {
    rememberBoard('?chips=late,retired-chip');
    expect(boardReturnHref(known)).toBe('/');
  });

  it('keeps only the board’s own parameters, and drops blank ones', () => {
    rememberBoard('?week=2026-W40&q=&truck=101&utm=x');
    expect(boardReturnHref(known)).toBe('/?truck=101');
  });

  it('drops what someone wrote into storage by hand', () => {
    store.set(BOARD_RETURN_KEY, 'redirect=https://example.com&truck=103');
    expect(boardReturnHref(known)).toBe('/?truck=103');
  });

  it('is / when storage throws', () => {
    Object.defineProperty(window, 'sessionStorage', {
      get: () => {
        throw new Error('blocked');
      },
      configurable: true,
    });
    rememberBoard('?truck=101');
    expect(boardReturnHref(known)).toBe('/');
  });
});
