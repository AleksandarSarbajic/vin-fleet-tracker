'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { linesFromText, type Line } from '@/lib/ratecon/lines';
import { linesFromPdfFile } from '@/lib/ratecon/read-pdf';
import { bumpCount, readCounts, type FillCounts } from '@/lib/ratecon/session-counts';
import { LAYOUT_NAME, readRatecon, type RateconRead } from '@/lib/ratecon/templates';

/**
 * §12.122. "Fill from rate confirmation": drop a PDF, choose one, or paste
 * its text. Read here, in the browser — the file goes nowhere — and handed to
 * the modal as a read; the modal fills the form. Nothing is saved.
 *
 * ONE slim line (36 px) until it has something to say: what a read did, a
 * question before replacing what was typed, and the session's counts open
 * under it only after a PDF or text is given, and fold away again the moment
 * the dispatcher types into the load. The "fields to check" count lives on
 * the line itself, so folding never hides it.
 *
 * Offered only on a new load, or one whose stops are all unsaved: a fill
 * replaces stops, and a saved stop is never replaced by one.
 */

export const NOT_RECOGNISED = 'Layout not recognised, nothing filled.';

type Status =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'said'; tone: 'fault' | 'done'; text: string }
  | { kind: 'confirm'; read: RateconRead };

export function RateconStrip({
  hasEntries,
  toCheck,
  onFill,
  countsVersion,
  editsVersion,
}: {
  /** The form already holds a load number or an address someone typed. */
  hasEntries: boolean;
  /** "4 fields to check" — live, from the modal. Null before any fill. */
  toCheck: number | null;
  /** Fill the form; returns why it could not, or null. */
  onFill: (read: RateconRead) => string | null;
  /** Bumped by the modal when it counts an edit, so the counts line re-reads. */
  countsVersion: number;
  /** Bumped by the modal whenever the dispatcher types into the load: the strip folds. */
  editsVersion: number;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [over, setOver] = useState(false);
  const [counts, setCounts] = useState<FillCounts>({ notRecognised: 0, editedAfterFill: 0 });
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setCounts(readCounts()), [countsVersion]);
  // Typing into the load folds the strip back to its one line.
  const seenEdits = useRef(editsVersion);
  useEffect(() => {
    if (editsVersion === seenEdits.current) return;
    seenEdits.current = editsVersion;
    setStatus({ kind: 'idle' });
  }, [editsVersion]);

  const fill = useCallback(
    (read: RateconRead) => {
      const refused = onFill(read);
      setStatus(
        refused
          ? { kind: 'said', tone: 'fault', text: refused }
          : {
              kind: 'said',
              tone: 'done',
              text: `Filled ${read.stops.length} ${read.stops.length === 1 ? 'stop' : 'stops'} from ${LAYOUT_NAME[read.layout]}. Nothing is saved until Save.`,
            },
      );
    },
    [onFill],
  );

  const take = useCallback(
    (lines: Line[]) => {
      const outcome = readRatecon(lines);
      if (!outcome.ok) {
        setCounts(bumpCount('notRecognised'));
        setStatus({ kind: 'said', tone: 'fault', text: NOT_RECOGNISED });
        return;
      }
      if (hasEntries) setStatus({ kind: 'confirm', read: outcome.read });
      else fill(outcome.read);
    },
    [fill, hasEntries],
  );

  const readFile = useCallback(
    async (file: File) => {
      setStatus({ kind: 'reading' });
      const pdf = await linesFromPdfFile(file);
      if (!pdf.ok) setStatus({ kind: 'said', tone: 'fault', text: pdf.message });
      else take(pdf.lines);
    },
    [take],
  );

  const onFile = (file: File | undefined) => {
    if (!file) return;
    readFile(file).catch(() => setStatus({ kind: 'said', tone: 'fault', text: 'This PDF could not be read.' }));
  };

  const open = status.kind !== 'idle';

  return (
    <section
      aria-label="Fill from rate confirmation"
      data-ratecon-strip=""
      data-open={open ? 'true' : 'false'}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFile(e.dataTransfer.files[0]);
      }}
      className={`border-b border-line-hair px-4 ${over ? 'bg-surface-sunken' : ''}`}
    >
      {/* The one line: 36 px. */}
      <div data-ratecon-line="" className="flex h-9 items-center gap-3">
        <span className="shrink-0 font-cond text-micro font-semibold uppercase tracking-[.09em] text-text-secondary">
          Fill from rate confirmation
        </span>
        <span className="shrink-0 text-small text-text-mutedOnOverlay">Drop a PDF or paste text</span>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="h-[26px] shrink-0 border border-line-hair px-2.5 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
        >
          Choose PDF
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          aria-label="Rate confirmation PDF"
          className="sr-only"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <textarea
          aria-label="Or paste the rate confirmation's text"
          placeholder="…or paste its text"
          rows={1}
          value=""
          onChange={() => undefined}
          onPaste={(e) => {
            e.preventDefault();
            take(linesFromText(e.clipboardData.getData('text/plain')));
          }}
          className="h-[26px] min-w-[120px] flex-1 resize-none border border-line-hair bg-surface-sunken px-2 py-0.5 text-small text-text"
        />
        {toCheck !== null && toCheck > 0 ? (
          <span
            data-to-check=""
            className="shrink-0 font-cond text-micro font-semibold uppercase tracking-[.09em] text-status-risk-fg"
          >
            {toCheck} {toCheck === 1 ? 'field' : 'fields'} to check
          </span>
        ) : null}
      </div>

      {/* Only once a PDF or text has been given; folds when the load is typed into. */}
      {open ? (
        <div data-ratecon-detail="" aria-live="polite" className="flex flex-col gap-1.5 pb-2.5">
          {status.kind === 'reading' ? <p className="text-small text-text-mutedOnOverlay">Reading…</p> : null}
          {status.kind === 'said' ? (
            <p
              data-ratecon-said={status.tone}
              className={`text-small ${status.tone === 'fault' ? 'text-status-risk-fg' : 'text-text-secondary'}`}
            >
              {status.text}
            </p>
          ) : null}
          {status.kind === 'confirm' ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
              <p className="text-status-risk-fg">
                Replace the load number and stops you have entered with this rate confirmation?
              </p>
              <button
                type="button"
                onClick={() => fill(status.read)}
                className="h-[26px] border border-status-risk-bd px-2.5 font-cond text-micro font-semibold uppercase tracking-[.09em] text-status-risk-fg"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => setStatus({ kind: 'said', tone: 'done', text: 'Kept what you entered; nothing filled.' })}
                className="h-[26px] border border-line-hair px-2.5 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
              >
                Keep mine
              </button>
            </div>
          ) : null}
          <p data-ratecon-counts="" className="text-micro text-text-mutedOnOverlay">
            This session: {counts.notRecognised} not recognised · {counts.editedAfterFill} filled{' '}
            {counts.editedAfterFill === 1 ? 'field' : 'fields'} edited afterwards. Counts only, kept in this browser tab.
          </p>
        </div>
      ) : null}
    </section>
  );
}
