'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FleetRow } from '@/server/fleet-query';
import type { Role } from '@/lib/roles';
import { editingAllowedNow } from '@/lib/editing';
import { isWindowOpen } from '@/lib/keymap';
import {
  NO_FILE_HANDED,
  carriesFiles,
  fileMayFill,
  nothingRead,
  rowFillRule,
} from '@/components/edit/window-drop';

/**
 * §12.164, phase 3bx (QoL 1). A PDF dragged over the board: the row under the pointer is marked
 * and names its truck; let go, and that truck's window opens with the read started, through the
 * strip's own way in (`RateconStrip`'s `takeFile`, 3bw). Nothing saves until Save.
 *
 * Only a truck with no next stop takes one, by the one rule the window and the strip ask
 * (`fileMayFill`): a fill replaces stops, and a saved stop is never replaced. A row that cannot
 * take it says why while the file is over it, and takes nothing.
 *
 * **Taken everywhere on the board,** so the browser never opens the file and the page is never
 * left (3bf's found wrong 2). `dropEffect` is `copy` everywhere, as in the window (3bw): with
 * `none` the browser cancels the drop and the board could not say why nothing was read.
 *
 * **Not ours:** a drag carrying text or a link (the browser's, as before); anything the edit
 * window or its strip already took (`defaultPrevented`: they answer for themselves, §12.163); and
 * anything below the editing width (§12.94), where nothing new is offered and the browser does
 * what it always did.
 */

export interface DropMark {
  id: string;
  /** The row takes the file. */
  takes: boolean;
  /** What the row says while the file is over it. */
  text: string;
}

const labelOf = (row: FleetRow) => String(row.truckNumber ?? row.samsaraName);

/** What a row says while a file is over it: whose window it opens, or why it takes nothing. */
export function dropMarkOf(row: FleetRow, role: Role): DropMark {
  const offer = fileMayFill(rowFillRule(row, role));
  const label = labelOf(row);
  return offer.offered
    ? { id: row.id, takes: true, text: `Read this for truck ${label}${row.driverName ? ` · ${row.driverName}` : ''}` }
    : { id: row.id, takes: false, text: `Truck ${label}: ${offer.reason}` };
}

/** Said when a file is let go on the board but not on a row. */
export const OFF_THE_ROWS = nothingRead("a rate confirmation is read only when it is let go on a truck's row");
/** Said when a file is let go over a window that does not take one (the timeline, a list). */
export const BEHIND_A_WINDOW = nothingRead("a window is open; close it, then let go on a truck's row");

/** What a file let go on the board does: opens a truck's window with it, or is refused with why. */
export function boardDrop({
  row,
  role,
  file,
  windowOpen,
}: {
  /** The row it was let go on, or null. */
  row: FleetRow | null;
  role: Role;
  /** Read in the event: once it returns, the browser hands over nothing. */
  file: File | undefined;
  windowOpen: boolean;
}): { take: { id: string; file: File } } | { said: string } {
  if (windowOpen) return { said: BEHIND_A_WINDOW };
  if (!row) return { said: OFF_THE_ROWS };
  const offer = fileMayFill(rowFillRule(row, role));
  if (!offer.offered) return { said: nothingRead(offer.reason, labelOf(row)) };
  if (!file) return { said: NO_FILE_HANDED };
  return { take: { id: row.id, file } };
}

export function useBoardDrop({
  rows,
  role,
  onTake,
  onDragStart,
}: {
  /** The rows the board shows, pinned ones included: a row under the pointer is one of these. */
  rows: readonly FleetRow[];
  role: Role;
  /** A file a row took: its window opens with the read started. */
  onTake: (id: string, file: File) => void;
  /** A file drag came onto the page: the row menu closes (QoL 8). */
  onDragStart?: () => void;
}): { mark: DropMark | null; notice: string | null; dismiss: () => void } {
  const [mark, setMark] = useState<DropMark | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Read in the listeners, which are registered once. */
  const latest = useRef({ rows, role, onTake, onDragStart });
  latest.current = { rows, role, onTake, onDragStart };

  useEffect(() => {
    /** Counted, because moving onto a child enters it before it leaves the parent: at 0 the drag has gone. */
    let depth = 0;
    const ours = (event: DragEvent) => carriesFiles(event.dataTransfer?.types) && editingAllowedNow();
    const rowUnder = (event: DragEvent): FleetRow | null => {
      const el = event.target instanceof Element ? event.target.closest('[data-row-id]') : null;
      const id = el?.getAttribute('data-row-id');
      return id ? (latest.current.rows.find((r) => r.id === id) ?? null) : null;
    };
    const show = (next: DropMark | null) =>
      setMark((was) =>
        was?.id === next?.id && was?.takes === next?.takes && was?.text === next?.text ? was : next,
      );

    const onEnter = (event: DragEvent) => {
      if (!ours(event)) return;
      if (depth === 0) {
        // A new drag: the last one's answer goes, and so does an open row menu.
        setNotice(null);
        latest.current.onDragStart?.();
      }
      depth += 1;
    };
    const onOver = (event: DragEvent) => {
      if (!ours(event)) return;
      // The edit window and its strip took it and answer for it (§12.163).
      if (event.defaultPrevented) {
        show(null);
        return;
      }
      // Taken, so the browser never opens the file: on a row or not, behind a window or not.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      const row = isWindowOpen() ? null : rowUnder(event);
      show(row ? dropMarkOf(row, latest.current.role) : null);
    };
    const onLeave = (event: DragEvent) => {
      if (!ours(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) show(null);
    };
    const onDrop = (event: DragEvent) => {
      if (!ours(event)) return;
      depth = 0;
      show(null);
      if (event.defaultPrevented) return;
      event.preventDefault();
      const windowOpen = isWindowOpen();
      const answer = boardDrop({
        row: windowOpen ? null : rowUnder(event),
        role: latest.current.role,
        file: event.dataTransfer?.files[0],
        windowOpen,
      });
      if ('said' in answer) {
        setNotice(answer.said);
        return;
      }
      setNotice(null);
      latest.current.onTake(answer.take.id, answer.take.file);
    };
    const onEnd = () => {
      depth = 0;
      show(null);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onEnd);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onEnd);
    };
  }, []);

  const dismiss = useCallback(() => setNotice(null), []);
  return { mark, notice, dismiss };
}
