'use client';

import { useLayoutEffect, useRef } from 'react';
import type { FleetRow } from '@/server/fleet-query';
import { STATUS_LABEL, isProblem } from '@/lib/status';
import { MOTION_MS } from '@/design/tokens';
import { fadeIn } from '@/lib/appear-motion';
import { rollNumber, settleRoll } from '@/lib/number-roll';

/**
 * design-spec §3.1. The replacement for the retired no-scroll promise: the
 * problem set is always at the top, and anything below the fold is counted
 * here by status — including the explicit "0 problems below the fold", which
 * is the whole point. A dispatcher never has to scroll to find out whether
 * scrolling matters.
 */
export function ListFooter({
  rows,
  firstVisible,
  lastVisible,
  cause,
}: {
  rows: FleetRow[];
  firstVisible: number;
  lastVisible: number;
  /**
   * §12.156. The chips, by name: what may roll the numbers and fade the words. It changes on a
   * person's chip (a click, its key, Clear filters, a view) and at no other time. The numbers
   * also change on every scroll and on a poll, and with this unchanged they change at once.
   */
  cause: string;
}) {
  const below = rows.slice(lastVisible + 1);
  const problems = below.filter((r) => isProblem(r.status)).length;

  const counts = new Map<string, number>();
  for (const row of below) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  const breakdown = [...counts.entries()]
    .map(([status, n]) => `${n} ${STATUS_LABEL[status as keyof typeof STATUS_LABEL].toLowerCase()}`)
    .join(', ');

  // Before the virtualizer has measured its scroller — server render, and the
  // first client paint — nothing is visible yet. "Showing 1-0 of 23" is worse
  // than saying nothing, so the range collapses to 0.
  const nothingVisible = lastVisible < firstVisible;
  const from = rows.length === 0 || nothingVisible ? 0 : firstVisible + 1;
  const to = nothingVisible ? 0 : Math.min(lastVisible + 1, rows.length);
  const total = rows.length;
  const problemWords =
    problems === 0
      ? '0 problems below the fold'
      : `${problems} ${problems === 1 ? 'problem' : 'problems'} below the fold`;
  const belowWords = below.length > 0 ? `${below.length} below: ${breakdown}` : '';

  /**
   * §12.156. On a person's chip the numbers that changed roll, as a count does (§12.149), and
   * the words that changed fade in, all in the footer's own 360ms. Compared with the commit
   * before, cause and all: a commit with the same chips (a scroll, a poll, a resize, a list, the
   * search) changes them at once, and ends what was rolling or fading in them.
   */
  const fromBox = useRef<HTMLSpanElement | null>(null);
  const toBox = useRef<HTMLSpanElement | null>(null);
  const totalBox = useRef<HTMLSpanElement | null>(null);
  const problemsEl = useRef<HTMLSpanElement | null>(null);
  const belowEl = useRef<HTMLSpanElement | null>(null);
  const fades = useRef<{ problems: Animation | null; below: Animation | null }>({
    problems: null,
    below: null,
  });
  const before = useRef({ cause, from, to, total, problemWords, belowWords });
  useLayoutEffect(() => {
    const was = before.current;
    before.current = { cause, from, to, total, problemWords, belowWords };
    const chip = was.cause !== cause && MOTION_MS.footRoll > 0;
    for (const [box, now, old] of [
      [fromBox.current, from, was.from],
      [toBox.current, to, was.to],
      [totalBox.current, total, was.total],
    ] as const) {
      const number = box?.firstElementChild;
      if (!box || !(number instanceof HTMLElement) || now === old) continue;
      if (chip) rollNumber(box, number, old, MOTION_MS.footRoll);
      else settleRoll(box);
    }
    for (const [slot, el, now, old] of [
      ['problems', problemsEl.current, problemWords, was.problemWords],
      ['below', belowEl.current, belowWords, was.belowWords],
    ] as const) {
      if (now === old) continue;
      fades.current[slot]?.cancel();
      fades.current[slot] = chip && el && now !== '' ? fadeIn(el, MOTION_MS.footRoll) : null;
    }
  });

  return (
    <div className="flex h-[30px] shrink-0 items-center justify-between border-t border-line-hair bg-surface-bar px-4 text-small text-text-secondary">
      <span>
        Showing <span className="tabular-nums text-text">
          <span ref={fromBox} data-foot="from">
            <span>{from}</span>
          </span>
          –
          <span ref={toBox} data-foot="to">
            <span>{to}</span>
          </span>
        </span> of{' '}
        <span ref={totalBox} data-foot="total" className="tabular-nums text-text">
          <span>{total}</span>
        </span>
      </span>

      <span className="flex items-center gap-[14px]">
        <span
          ref={problemsEl}
          data-foot="problems"
          className={`tabular-nums ${problems === 0 ? 'text-status-ontime-fg' : 'text-status-late-fg'}`}
        >
          {problemWords}
        </span>
        {belowWords !== '' ? (
          <span ref={belowEl} data-foot="below" className="tabular-nums text-text-muted">
            {belowWords}
          </span>
        ) : null}
      </span>
    </div>
  );
}
