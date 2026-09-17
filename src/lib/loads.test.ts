import { describe, expect, it } from 'vitest';
import {
  LOAD_STATUSES,
  LOAD_STATUS_LABEL,
  canTransition,
  isOpen,
  isTerminal,
  type LoadStatus,
} from './loads';

describe('load status vocabulary', () => {
  it('has exactly the eight agreed values, in order', () => {
    expect(LOAD_STATUSES).toEqual([
      'AVAILABLE',
      'DISPATCHED',
      'AT_SHIPPER',
      'LOADED',
      'AT_RECEIVER',
      'DELIVERED',
      'TONU',
      'CANCELLED',
    ]);
  });

  it('labels every status', () => {
    for (const s of LOAD_STATUSES) expect(LOAD_STATUS_LABEL[s]).toBeTruthy();
  });
});

describe('isTerminal', () => {
  it('treats exactly DELIVERED, TONU and CANCELLED as terminal', () => {
    const terminal = LOAD_STATUSES.filter(isTerminal);
    expect(terminal).toEqual(['DELIVERED', 'TONU', 'CANCELLED']);
  });

  it('keeps TONU separate from CANCELLED', () => {
    // TONU is billable — the broker cancelled after we committed a truck.
    // Collapsing the two would lose revenue the dispatcher needs to see.
    expect(isTerminal('TONU')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(LOAD_STATUS_LABEL.TONU).not.toBe(LOAD_STATUS_LABEL.CANCELLED);
  });

  it('isOpen is the inverse', () => {
    for (const s of LOAD_STATUSES) expect(isOpen(s)).toBe(!isTerminal(s));
  });
});

describe('canTransition', () => {
  const open = LOAD_STATUSES.filter(isOpen);

  it('allows any jump between non-terminal states — loads skip constantly', () => {
    for (const from of open) {
      for (const to of LOAD_STATUSES) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  it('allows DISPATCHED straight to TONU, skipping every middle state', () => {
    expect(canTransition('DISPATCHED', 'TONU')).toBe(true);
  });

  it('allows going backwards — a dispatcher fixing a mis-click', () => {
    expect(canTransition('LOADED', 'AT_SHIPPER')).toBe(true);
  });

  it('refuses to reopen a terminal load', () => {
    const terminal: LoadStatus[] = ['DELIVERED', 'TONU', 'CANCELLED'];
    for (const from of terminal) {
      for (const to of open) expect(canTransition(from, to)).toBe(false);
    }
  });

  it('treats a no-op as allowed even from a terminal state', () => {
    expect(canTransition('DELIVERED', 'DELIVERED')).toBe(true);
  });
});
