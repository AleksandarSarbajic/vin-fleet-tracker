import 'server-only';
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
