/**
 * §12.122. What a field says under itself when there is something to check:
 * "Check: …", once. Some messages carry the word already (`ZIP_NOT_REAL`,
 * the fill's appointment checks), and a field adding its own made "Check:
 * Check: …" (found in 3aj). Every place that prefixes a check says it
 * through this.
 */
export function checkSaid(message: string): string {
  return /^Check:\s/.test(message) ? message : `Check: ${message}`;
}
