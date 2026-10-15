import type { PreparedLine } from './redact';

/**
 * The app's 24-hour rule (3x), in one place: the language-model reader's
 * verifier (`verify-read.ts`) and the Route blocks template (`templates.ts`)
 * both read a bare HH:MM by it. Pure. Moved here unchanged in phase 3aa, so
 * the two modules do not import each other.
 */

/** A time with AM/PM: "8 AM", "8:00 pm", "7:00 A.M.", "8:00P", the end of "7-10 AM". Any one of these, anywhere, rules out a 24-hour document. */
const AM_PM_TIME = /\b\d{1,2}(?::\d{2})?\s*[ap]\.?\s?m\b|\b\d{1,2}:\d{2}\s*[ap]\b(?![a-z.])/i;
/** An unambiguous 24-hour clock: an hour past 12, or a two-digit hour with a leading zero. "10:00" is not one. */
const TWENTY_FOUR_HOUR_TIME = /\b(?:0\d|1[3-9]|2[0-3]):[0-5]\d\b/;

/**
 * Is the DOCUMENT on a 24-hour clock? It holds at least one unambiguous 24-hour
 * time (13:30, 08:00) and no time with AM/PM at all. Computed once, from the
 * lines that were sent. Then a bare "11:00" is 11:00; otherwise it is not
 * guessed (§12.122).
 */
export function documentIs24Hour(sent: readonly PreparedLine[]): boolean {
  const text = sent.map((l) => l.text).join('\n');
  return TWENTY_FOUR_HOUR_TIME.test(text) && !AM_PM_TIME.test(text);
}
