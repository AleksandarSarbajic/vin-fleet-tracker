'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { linesFromText, type Line } from '@/lib/ratecon/lines';
import { READ_MESSAGES, type ReadFailCode } from '@/lib/ratecon/read-codes';
import { requestModelRead } from '@/lib/ratecon/read-client';
import { linesFromPdfFile } from '@/lib/ratecon/read-pdf';
import { prepareForReading, type Prepared } from '@/lib/ratecon/redact';
import { bumpCount, readCounts, type FillCounts } from '@/lib/ratecon/session-counts';
import { LAYOUT_NAME, readRatecon, type RateconRead } from '@/lib/ratecon/templates';
import { verifyRead } from '@/lib/ratecon/verify-read';

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
 *
 * "Read with AI" (docs/llm-reader-design.md §1): when the server offers it,
 * a template miss offers it — never automatically. It says how many lines it
 * sends, shows them on request ("Show what is sent"), sends only those, and
 * fills only what `verifyRead` confirms against them. Every failure is one
 * fixed sentence and fills nothing; the button stays.
 */

export const NOT_RECOGNISED = 'Layout not recognised, nothing filled.';

type PreparedOk = Extract<Prepared, { ok: true }>;
type Said = { tone: 'fault' | 'done'; text: string };

type Status =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'said'; tone: 'fault' | 'done'; text: string }
  | { kind: 'confirm'; read: RateconRead }
  /** A template miss, with "Read with AI" offered when the document can be prepared. */
  | { kind: 'missed'; prepared: Prepared; note: Said | null }
  | { kind: 'ai-reading'; prepared: PreparedOk };

const notPrepared = (prepared: Exclude<Prepared, { ok: true }>): string =>
  READ_MESSAGES[prepared.reason === 'too-large' ? 'too_large' : 'not_redacted'];

const failure = (code: ReadFailCode, reference?: string) =>
  reference ? `${READ_MESSAGES[code]} Reference ${reference}.` : READ_MESSAGES[code];

export function RateconStrip({
  hasEntries,
  toCheck,
  aiMarks = null,
  aiReader = false,
  onFill,
  countsVersion,
  editsVersion,
}: {
  /** The form already holds a load number or an address someone typed. */
  hasEntries: boolean;
  /** "4 fields to check" — live, from the modal. Null before any fill. */
  toCheck: number | null;
  /** The language-model reader's marks still standing, counted apart from `toCheck`. */
  aiMarks?: { stops: number; fields: number } | null;
  /** The server offers "Read with AI" to this user (the flag, a vendor, a dispatcher). */
  aiReader?: boolean;
  /** Fill the form; returns why it could not, or null. */
  onFill: (read: RateconRead) => string | null;
  /** Bumped by the modal when it counts an edit, so the counts line re-reads. */
  countsVersion: number;
  /** Bumped by the modal whenever the dispatcher types into the load: the strip folds. */
  editsVersion: number;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [over, setOver] = useState(false);
  const [counts, setCounts] = useState<FillCounts>({ notRecognised: 0, editedAfterFill: 0, readWithAi: 0 });
  const fileInput = useRef<HTMLInputElement>(null);
  /** The read in flight, so Cancel can stop it and closing the modal does. */
  const inFlight = useRef<AbortController | null>(null);
  /** Read when the AI's answer lands, not when the click happened: the load may have been typed into meanwhile. */
  const entries = useRef(hasEntries);
  entries.current = hasEntries;

  useEffect(() => setCounts(readCounts()), [countsVersion]);
  useEffect(() => () => inFlight.current?.abort(), []);
  // Typing into the load folds the strip back to its one line — but a read
  // in flight stays on it, and is not cancelled.
  const seenEdits = useRef(editsVersion);
  useEffect(() => {
    if (editsVersion === seenEdits.current) return;
    seenEdits.current = editsVersion;
    setStatus((s) => (s.kind === 'ai-reading' ? s : { kind: 'idle' }));
  }, [editsVersion]);

  const fill = useCallback(
    (read: RateconRead) => {
      const refused = onFill(read);
      const n = read.stops.length;
      setStatus(
        refused
          ? { kind: 'said', tone: 'fault', text: refused }
          : {
              kind: 'said',
              tone: 'done',
              text:
                read.layout === 'model'
                  ? `Filled ${n} ${n === 1 ? 'stop' : 'stops'}, read by AI. Check each stop against its quote, then press Looks right. Nothing is saved until Save.`
                  : `Filled ${n} ${n === 1 ? 'stop' : 'stops'} from ${LAYOUT_NAME[read.layout]}. Nothing is saved until Save.`,
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
        setStatus(
          aiReader
            ? { kind: 'missed', prepared: prepareForReading(lines), note: null }
            : { kind: 'said', tone: 'fault', text: NOT_RECOGNISED },
        );
        return;
      }
      if (hasEntries) setStatus({ kind: 'confirm', read: outcome.read });
      else fill(outcome.read);
    },
    [aiReader, fill, hasEntries],
  );

  const readWithAi = useCallback(
    async (prepared: PreparedOk) => {
      const abort = new AbortController();
      inFlight.current = abort;
      setStatus({ kind: 'ai-reading', prepared });
      const out = await requestModelRead(prepared.lines, abort.signal);
      inFlight.current = null;
      const missed = (text: string): Status => ({ kind: 'missed', prepared, note: { tone: 'fault', text } });
      if (!out.ok) {
        setStatus(missed(failure(out.code, out.reference)));
        return;
      }
      // The verifier, against exactly the lines that were sent, decides what stands.
      const verified = verifyRead(out.reply, prepared.lines, new Date());
      if (!verified.ok) {
        setStatus(missed(READ_MESSAGES.nothing_confirmed));
        return;
      }
      setCounts(bumpCount('readWithAi'));
      if (entries.current) setStatus({ kind: 'confirm', read: verified.read });
      else fill(verified.read);
    },
    [fill],
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
        {aiMarks && aiMarks.stops > 0 ? (
          <span
            data-ai-to-confirm=""
            className="shrink-0 font-cond text-micro font-semibold uppercase tracking-[.09em] text-text-secondary"
          >
            {aiMarks.stops} {aiMarks.stops === 1 ? 'stop' : 'stops'} read by AI to confirm
          </span>
        ) : null}
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
          {status.kind === 'missed' ? (
            <>
              <p className="text-small text-status-risk-fg">{NOT_RECOGNISED}</p>
              {status.prepared.ok ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
                    <button
                      type="button"
                      data-read-with-ai=""
                      onClick={() => {
                        const prepared = status.prepared;
                        if (!prepared.ok) return;
                        readWithAi(prepared).catch(() =>
                          setStatus({ kind: 'missed', prepared, note: { tone: 'fault', text: READ_MESSAGES.error } }),
                        );
                      }}
                      className="h-[26px] border border-line-hair px-2.5 font-cond text-micro font-semibold uppercase tracking-[.09em] text-text-secondary"
                    >
                      Read with AI
                    </button>
                    <span className="text-text-mutedOnOverlay">
                      sends {status.prepared.lines.length} {status.prepared.lines.length === 1 ? 'line' : 'lines'}, with
                      rates, contacts, phones, emails and driver names removed. Nothing is saved until Save.
                    </span>
                  </div>
                  <details data-ratecon-sent="" className="text-small text-text-mutedOnOverlay">
                    <summary className="cursor-pointer">Show what is sent</summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words border border-line-hair bg-surface-sunken p-2 text-small">
                      {status.prepared.text}
                    </pre>
                  </details>
                </>
              ) : (
                <p className="text-small text-status-risk-fg">{notPrepared(status.prepared)}</p>
              )}
              {status.note ? (
                <p data-ratecon-said={status.note.tone} className="text-small text-status-risk-fg">
                  {status.note.text}
                </p>
              ) : null}
            </>
          ) : null}
          {status.kind === 'ai-reading' ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
              <p className="text-text-mutedOnOverlay">Reading with AI…</p>
              <button
                type="button"
                onClick={() => inFlight.current?.abort()}
                className="h-[26px] border border-line-hair px-2.5 font-cond text-micro uppercase tracking-[.09em] text-text-secondary"
              >
                Cancel
              </button>
            </div>
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
            {counts.editedAfterFill === 1 ? 'field' : 'fields'} edited afterwards
            {counts.readWithAi > 0 ? ` · ${counts.readWithAi} read with AI` : ''}. Counts only, kept in this browser tab.
          </p>
        </div>
      ) : null}
    </section>
  );
}
