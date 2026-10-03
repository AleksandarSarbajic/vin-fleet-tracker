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
  const digits = usDigits(phone);
  return digits === null ? null : `tel:+1${digits}`;
}

/**
 * The ten digits of a dialable North American number, or null. The one rule
 * behind both the `tel:` link and what a dispatcher may save (§12.106), so
 * a number the board accepts is always a number it can dial.
 */
function usDigits(phone: string): string | null {
  // Letters mean an extension or a note ("ext 12", "cell"); not guessed at.
  if (/[a-z]/i.test(phone)) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  // N11 is a service code (911, 411), never an area code or an exchange.
  if (digits.slice(1, 3) === '11' || digits.slice(4, 6) === '11') return null;
  return digits;
}

export type PhoneInput = { ok: true; phone: string | null } | { ok: false; message: string };

/**
 * §12.106. What a dispatcher types into a driver's phone field, as it is
 * stored: ten digits, no punctuation — the form every number on file was
 * already in. Blank clears the number.
 *
 * Takes the ways people write a US number ("708-555-0123",
 * "(708) 555 0123", "+1 708 555 0123", "708.555.0123") and refuses the
 * rest with a message that never repeats what was typed: the message is
 * shown, logged and returned by the route, and a number must not be.
 */
export function normalizePhone(input: string): PhoneInput {
  const typed = input.trim();
  if (typed === '') return { ok: true, phone: null };
  if (/[a-z]/i.test(typed)) {
    return { ok: false, message: 'Digits only — leave out extensions and notes.' };
  }
  if (!/^\+?[\d\s().-]+$/.test(typed)) {
    return { ok: false, message: 'Use digits, spaces, dashes, dots or brackets only.' };
  }
  // A country code other than +1 is a number this board cannot dial.
  if (typed.startsWith('+') && typed.replace(/\D/g, '')[0] !== '1') {
    return { ok: false, message: 'Only US numbers can be saved (+1).' };
  }
  const digits = usDigits(typed);
  if (digits === null) {
    return {
      ok: false,
      message: 'Not a dialable US number. Enter all 10 digits, like 708-555-0123.',
    };
  }
  return { ok: true, phone: digits };
}

/** A stored number as a dispatcher reads it: 708-555-0123. */
export function formatPhone(phone: string): string {
  const digits = usDigits(phone);
  return digits === null ? phone : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** A number as test output and screenshots may show it: all but the last three digits masked. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${'•'.repeat(Math.max(0, digits.length - 3))}${digits.slice(-3)}`;
}
