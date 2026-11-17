import type { FleetRow } from '@/server/fleet-query';
import { can, type Role } from '@/lib/roles';
import { keyCopyText, loadCopyText } from './key-copy';

/**
 * §12.164, phase 3bx (QoL 8). What a right-click on a row offers: the demo's menu without Mark
 * arrived (feature 3 is not built). Each item does what its own control or key does, through
 * that code (Console wires them): Edit load is Enter's, Copy address is C's, Copy load info is the
 * row's load copy control's text, Pin is the star's, Timeline is T's, Check is X's and the box's.
 *
 * Disabled, never hidden (§12.14, `roles.ts`), and always with the reason, in the words the
 * control or key already uses when it refuses.
 */
export type RowMenuItemId = 'edit' | 'address' | 'load' | 'pin' | 'timeline' | 'check';

export interface RowMenuItem {
  id: RowMenuItemId;
  label: string;
  /** The key that does the same for the selected truck, shown beside it; null where none does. */
  key: string | null;
  /** Why it does nothing here, or null. */
  disabled: string | null;
}

export function rowMenuItems(
  row: FleetRow,
  { role, pinned, checked }: { role: Role; pinned: boolean; checked: boolean },
): RowMenuItem[] {
  const address = keyCopyText(row);
  const load = loadCopyText(row);
  return [
    {
      id: 'edit',
      label: 'Edit load',
      key: 'Enter',
      // The edit window's own words for a viewer (EditStopModal's `lockedReason`).
      disabled: can(role, 'dispatcher') ? null : `Your role is ${role}. Editing needs dispatcher.`,
    },
    { id: 'address', label: 'Copy address', key: 'C', disabled: 'refused' in address ? address.refused : null },
    /**
     * "Copy load info", not the demo's "Copy load number": it goes through the row's load copy
     * control, whose text is the load labelled with its truck, driver and stop (`loadText`).
     * A number alone would be a second path (HANDOFF 3bx).
     */
    { id: 'load', label: 'Copy load info', key: null, disabled: 'refused' in load ? load.refused : null },
    { id: 'pin', label: pinned ? 'Unpin' : 'Pin', key: 'P', disabled: null },
    { id: 'timeline', label: 'Timeline', key: 'T', disabled: null },
    { id: 'check', label: checked ? 'Uncheck' : 'Check', key: 'X', disabled: null },
  ];
}
