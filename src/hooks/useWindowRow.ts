'use client';

import { useEffect, useRef } from 'react';
import type { FleetRow } from '@/server/fleet-query';

/**
 * The truck behind an open window. A window stays open until its own user closes it.
 *
 * Read from every truck, not from the rows the list and the chips left: a truck that
 * arrived under the Late chip, went inactive or came off a list would otherwise take
 * the edit window down on the next poll, and the typed work with it, with no question
 * and no key pressed. The row stays live: it is this poll's row whenever there is one.
 *
 * `/api/fleet` selects every truck and nothing in the app deletes one, so a truck
 * should only be missing from an answer if someone deleted it by hand. Then the window
 * stays on the last row it had, and its save says what went wrong.
 */
export function useWindowRow(id: string | null, all: readonly FleetRow[]): FleetRow | null {
  const last = useRef<FleetRow | null>(null);
  const found = id === null ? undefined : all.find((row) => row.id === id);
  const row = found ?? (last.current?.id === id ? last.current : null);
  useEffect(() => {
    last.current = row;
  }, [row]);
  return row;
}
