/**
 * §12.96, stage 3 — Call driver: a plain `tel:` link, and only for a number
 * that can be dialled as it stands. Nothing is sent to anyone (CLAUDE.md:
 * never build SMS or any driver notification); a tap hands the number to the
 * phone's own dialler, and the dispatcher decides whether to call.
 *
 * Dialable means a North American number: ten digits once the punctuation
 * and an optional leading country code 1 are gone, with an area code and an
 * exchange that do not start with 0 or 1. Everything on file today is a bare
 * ten-digit number of that shape (all 8 of them, 2026-10-01). Anything else
 * — an extension, a short number, a stray letter — gets no link rather than
 * a guess: a wrong number is worse than none.
 */
export function dialableTel(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Letters mean an extension or a note ("ext 12", "cell"); not guessed at.
  if (/[a-z]/i.test(phone)) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `tel:+1${digits}`;
}

/** A number as test output and screenshots may show it: all but the last three digits masked. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${'•'.repeat(Math.max(0, digits.length - 3))}${digits.slice(-3)}`;
}
