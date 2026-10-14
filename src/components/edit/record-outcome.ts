import { postOutcome } from '@/lib/ratecon/outcome-client';
import type { OutcomeBody } from '@/lib/ratecon/outcome-codes';
import { bumpCount } from '@/lib/ratecon/session-counts';
import { outcomeFields, type FillSnapshot } from './fill-outcome';
import type { LoadForm } from './load-form';

/**
 * An AI read that filled the form, waiting for the first save after it:
 * which read it was, and what it put where (in this browser's memory only).
 */
export interface PendingOutcome {
  readId: string;
  /** The read's layout fingerprint: hashes of the labels in the text that was sent (`layoutLabels`). */
  layout: string[];
  snapshot: FillSnapshot;
}

/**
 * Tells the server what the dispatcher did with an AI fill (docs/
 * llm-reader-design.md §4; Alex, 2026-10-14): counts per field name, and the
 * read's layout fingerprint (hashes only, 2026-10-15), once, the first time
 * the load is saved after the fill.
 *
 * It runs AFTER the save, is not awaited by it, and cannot fail it: nothing
 * escapes this function. A summary that throws, a post that throws or is
 * refused, are each counted in this tab (`outcomeNotRecorded`) and shown to
 * nobody. The server logs what it sees fail; this is the count of what never
 * reached it.
 */
export async function recordFillOutcome(
  pending: PendingOutcome | null,
  saved: LoadForm,
  post: (body: OutcomeBody) => Promise<boolean> = postOutcome,
): Promise<void> {
  if (!pending) return;
  try {
    const fields = outcomeFields(pending.snapshot, saved);
    if (fields.length === 0) return;
    if (!(await post({ readId: pending.readId, fields, layout: pending.layout }))) bumpCount('outcomeNotRecorded');
  } catch {
    // Counted, not shown: the load has already saved.
    bumpCount('outcomeNotRecorded');
  }
}
