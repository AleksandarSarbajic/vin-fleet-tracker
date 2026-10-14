import 'server-only';
import type { ReaderProblem } from '@/env/schema';
import type { ReadFailCode } from '@/lib/ratecon/read-codes';

/**
 * The language-model reader's ONE log line (docs/llm-reader-design.md §5).
 *
 * It takes these fields and nothing else, so no caller can hand it an error
 * message, a reply or a line: a vendor's or Zod's message can quote the
 * document, and Vercel keeps function logs. `errorName` is a class name
 * (`Error`, `TypeError`), never a message.
 */
export function logReadFailure(entry: {
  reference: string;
  code: ReadFailCode;
  errorName: string;
  vendorStatus: number | null;
}): void {
  // eslint-disable-next-line no-restricted-globals -- the one sanctioned log line; it takes no text from a document.
  console.error('ratecon read failed', {
    reference: entry.reference,
    code: entry.code,
    errorName: entry.errorName,
    vendorStatus: entry.vendorStatus,
  });
}

/**
 * The reader's settings have a problem, so it is off (`parseReaderEnv`).
 * Names each setting and a fixed word for what is wrong — never a value:
 * one of them is a key.
 */
export function logReaderMisconfigured(problems: readonly ReaderProblem[]): void {
  // eslint-disable-next-line no-restricted-globals -- a configuration fault, said once; names only, no values.
  console.error('ratecon reader is off: its settings have problems', {
    problems: problems.map(({ setting, fault }) => ({ setting, fault })),
  });
}

/**
 * An outcome that could not be recorded (docs/llm-reader-design.md §4). A
 * code, a reference and a class name — nothing from the request, which holds
 * a read id and counts, and nothing from the error, whose message can quote
 * whatever the database was handed.
 */
export function logOutcomeFailure(entry: { reference: string; code: 'error'; errorName: string }): void {
  // eslint-disable-next-line no-restricted-globals -- the one sanctioned line for a failed outcome; no value, no message.
  console.error('ratecon outcome not recorded', { reference: entry.reference, code: entry.code, errorName: entry.errorName });
}
