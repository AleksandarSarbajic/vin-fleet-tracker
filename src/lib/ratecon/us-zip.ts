/**
 * Whether a ZIP read from a rate confirmation can be a US ZIP at all. Pure,
 * offline: no lookup table, no service.
 *
 * 00501 is the lowest assigned US ZIP. A broker system can print a default
 * such as 00001 where it has none, and a reader copies it faithfully — so a
 * plausible wrong ZIP would reach the form with no mark. Anything below 00501
 * is therefore "no ZIP", and `fillLoad` treats it as one: blank and marked.
 *
 * Five digits, or ZIP+4 (with or without the hyphen); the cut is on the first
 * five digits and a +4 never lifts a placeholder over it. The readers only
 * produce five digits, so any other shape is not a ZIP either.
 */
const LOWEST_ASSIGNED_US_ZIP = 501;
const ZIP = /^(\d{5})(?:-?\d{4})?$/;

export function isRealUsZip(zip: string): boolean {
  const match = ZIP.exec(zip.trim());
  return match !== null && Number(match[1]) >= LOWEST_ASSIGNED_US_ZIP;
}
