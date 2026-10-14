import { uncitedAddressLines } from './address-cue';
import { agreePair, type Agreement, type PairRead } from './agree-reads';
import type { ModelRead } from './model-read';
import type { PreparedLine } from './redact';
import { verifyRead, type Verified } from './verify-read';

/**
 * A PAIR of AI reads, from the two replies to what the form is filled from
 * (docs/llm-reader-design.md §3–§5; Alex, 2026-10-14). Pure, and the ONE place
 * it is done: the browser strip and `ratecon:eval-ai` both call it, so what
 * the evaluation measured is what the app runs and the two cannot drift.
 *
 * It does what the route leaves to the browser, in order:
 *   1. verifies each reply against exactly the lines that were sent
 *      (`verifyRead`) — a reply that confirms nothing is `nothing_confirmed`;
 *   2. merges the two reads by `agreePair`: only what both said stands;
 *   3. the dropped-stop cue, on the lines neither read cited.
 *
 * A pair FAILS AS A WHOLE when either side failed — the adapter, the schema
 * (the caller passes those as `{ ok: false, code }`) or the verifier. The
 * code is read A's when A failed, else read B's. It never falls back to the
 * read that stood, and the failure carries no read at all: there is nothing
 * to fill from.
 */

/** One side of a pair, as the caller has it: a schema-valid reply, or the code its read failed with. */
export type PairSide<C extends string> = { ok: true; reply: ModelRead } | { ok: false; code: C };

type VerifiedRead = Extract<Verified, { ok: true }>;

/** What one side came to: `ok`, the code it failed with, or `nothing_confirmed`. */
export type SideCode<C extends string> = 'ok' | C | 'nothing_confirmed';

export type PairOutcome<C extends string> =
  | {
      ok: true;
      /** The two reads found the same stop count and no field differed. */
      agreed: boolean;
      /** The merged read, the strip's notices, the stop counts when they differ, and each field that differed. */
      agreement: Agreement;
      /** Each read on its own — A then B — for a caller that scores them apart. */
      reads: [{ reply: ModelRead; verified: VerifiedRead }, { reply: ModelRead; verified: VerifiedRead }];
      /** Sent lines that look like an address that neither read cited (line numbers only). */
      cue: number[];
    }
  | { ok: false; code: C | 'nothing_confirmed'; codes: [SideCode<C>, SideCode<C>] };

type Judged<C extends string> =
  | { code: 'ok'; reply: ModelRead; verified: VerifiedRead }
  | { code: C | 'nothing_confirmed' };

function judge<C extends string>(side: PairSide<C>, sent: readonly PreparedLine[], now: Date): Judged<C> {
  if (!side.ok) return { code: side.code };
  const verified = verifyRead(side.reply, sent, now);
  return verified.ok ? { code: 'ok', reply: side.reply, verified } : { code: 'nothing_confirmed' };
}

export function readPair<C extends string>(
  a: PairSide<C>,
  b: PairSide<C>,
  sent: readonly PreparedLine[],
  now: Date,
): PairOutcome<C> {
  const [ja, jb] = [judge(a, sent, now), judge(b, sent, now)];
  const side = (j: Judged<C>): PairRead<C | 'nothing_confirmed'> =>
    j.code === 'ok' && 'verified' in j ? { ok: true, read: j.verified.read } : { ok: false, code: j.code as C | 'nothing_confirmed' };
  const merged = agreePair(side(ja), side(jb));
  if (!merged.ok) return { ok: false, code: merged.code, codes: [ja.code, jb.code] };
  // A pair that agreed has two verified reads, each with its reply.
  if (!('verified' in ja) || !('verified' in jb)) throw new Error('A pair that agreed lacks a verified read.');
  const { agreement } = merged;
  // A line either read cited is used.
  const citedByB = new Set(uncitedAddressLines(jb.reply, sent));
  return {
    ok: true,
    agreed: agreement.stopCounts === null && agreement.differed.length === 0,
    agreement,
    reads: [
      { reply: ja.reply, verified: ja.verified },
      { reply: jb.reply, verified: jb.verified },
    ],
    cue: uncitedAddressLines(ja.reply, sent).filter((n) => citedByB.has(n)),
  };
}
