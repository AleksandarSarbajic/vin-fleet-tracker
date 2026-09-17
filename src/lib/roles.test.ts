import { describe, expect, it } from 'vitest';
import { can, type Role } from './roles';

const ALL: Role[] = ['viewer', 'dispatcher', 'admin'];

describe('can', () => {
  it('lets every role satisfy viewer', () => {
    for (const role of ALL) expect(can(role, 'viewer')).toBe(true);
  });

  it('keeps a viewer out of dispatcher and admin work', () => {
    expect(can('viewer', 'dispatcher')).toBe(false);
    expect(can('viewer', 'admin')).toBe(false);
  });

  it('lets a dispatcher dispatch but not administer', () => {
    expect(can('dispatcher', 'dispatcher')).toBe(true);
    expect(can('dispatcher', 'admin')).toBe(false);
  });

  it('lets an admin do everything', () => {
    for (const minimum of ALL) expect(can('admin', minimum)).toBe(true);
  });

  it('is reflexive for every role', () => {
    for (const role of ALL) expect(can(role, role)).toBe(true);
  });
});
