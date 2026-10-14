import { CELL_GAP } from './redact';

/**
 * A layout fingerprint (docs/llm-reader-design.md §4; Alex, 2026-10-15): which
 * LAYOUT of rate confirmation a read was, so the layouts that recur can be
 * counted and the ones worth a template seen. Pure, run in the browser on the
 * lines that were SENT (already redacted), and again by local scripts.
 *
 * A label is the text just before a colon or a "#" in a cell: "Pick Up Date",
 * "Appointment#", "Delivery Time". The fingerprint is the set of labels in the
 * document, each as 8 hex characters of its hash, sorted, each once, at most
 * 64. No label text, value, name, address or load number is kept: the labels
 * go in only as hashes, and a value is never a label because it is not
 * before a colon.
 *
 * KNOWN LIMIT: any text directly before a colon is a label, so a name written
 * "Dana Example:" would be hashed too (8 hex characters; a dictionary could
 * test a guess against it). The redaction has already run on these lines, and
 * a run of more than five words is not taken for a label.
 */

/** At most this many labels are kept: the 64 with the smallest hashes, so the same document gives the same 64 whatever the order of its lines. */
export const MAX_LAYOUT_LABELS = 64;
/** Two reads are the same layout at this Jaccard similarity of their label sets, or more. */
export const GROUP_SIMILARITY = 0.7;

const MIN_LABEL = 2;
const MAX_LABEL = 40;
const MAX_LABEL_WORDS = 5;

/* -------------------------------- sha-256 -------------------------------- */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/**
 * SHA-256 of a string's UTF-8 bytes, as 64 hex characters. Written out so the
 * fingerprint is computed the same way, synchronously, in a browser, a test and
 * a script: Web Crypto is asynchronous and not everywhere. Checked against
 * Node's in the tests.
 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bits = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(padded.length - 4, bits >>> 0);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i += 1) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
    h[5] = (h[5]! + f) | 0;
    h[6] = (h[6]! + g) | 0;
    h[7] = (h[7]! + hh) | 0;
  }
  return [...h].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/** The first 8 hex characters of the hash of a lower-cased label. */
const hash8 = (label: string): string => sha256Hex(label.toLowerCase()).slice(0, 8);

/* --------------------------------- labels --------------------------------- */

const PLACEHOLDER_ANY = /\[(?:EMAIL|PHONE|AMOUNT|REMOVED|ID|URL)\]/;
/** The label characters at the end of the text before a delimiter: letters, digits (removed later), spaces, & ' . - */
const LABEL_RUN = /[\p{L}\p{N}][\p{L}\p{N} &'’.-]*$/u;
const EDGE_PUNCTUATION = /^[\s.&'’-]+|[\s.&'’-]+$/g;

/** The label in the text before a delimiter, or null: lower-cased, digits gone, words squeezed, 2 to 40 characters, at most five words. */
function labelBefore(segment: string): string | null {
  const run = LABEL_RUN.exec(segment.replace(/\s+$/, ''))?.[0];
  if (run === undefined) return null;
  const label = run.toLowerCase().replace(/\p{N}/gu, '').replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION, '');
  if (label.length < MIN_LABEL || label.length > MAX_LABEL || !/\p{L}/u.test(label)) return null;
  return label.split(' ').length > MAX_LABEL_WORDS ? null : label;
}

/**
 * The label texts of a document, each once. For tests and for local checks;
 * NEVER sent, stored or logged — only their hashes are (`layoutLabels`).
 * A cell holding a placeholder is ignored whole, labels and all.
 */
export function labelTexts(lines: readonly { text: string }[]): string[] {
  const labels = new Set<string>();
  for (const line of lines) {
    for (const cell of line.text.split(CELL_GAP)) {
      if (PLACEHOLDER_ANY.test(cell)) continue;
      const segments = cell.split(/[:#]/);
      // The last piece has no delimiter after it: it is a value, not a label.
      for (const segment of segments.slice(0, -1)) {
        const label = labelBefore(segment);
        if (label !== null) labels.add(label);
      }
    }
  }
  return [...labels];
}

/** The fingerprint: 8-hex hashes of the labels, sorted, each once, the 64 smallest if there are more. */
export function layoutLabels(lines: readonly { text: string }[]): string[] {
  return [...new Set(labelTexts(lines).map(hash8))].sort().slice(0, MAX_LAYOUT_LABELS);
}

/* ------------------------------- similarity ------------------------------- */

/** Intersection over union of two label sets; 0 when either is empty (no labels say nothing about a layout). */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const x of left) if (right.has(x)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export interface LayoutItem {
  id: string;
  /** When the read was made: the earliest read of a group is its anchor. Any sortable string. */
  at: string;
  labels: readonly string[];
}

export interface LayoutGroup {
  anchor: string;
  ids: string[];
}

/**
 * Groups reads by layout. Each read is counted with the EARLIEST read it is
 * `GROUP_SIMILARITY` similar to (itself, when none before it is), and only
 * that one: not transitive, so a chain of slowly drifting layouts does not
 * become one group. Reads with no labels are in no group. Largest group first.
 */
export function groupLayouts(items: readonly LayoutItem[], threshold = GROUP_SIMILARITY): { groups: LayoutGroup[]; unlabelled: string[] } {
  const order = [...items].sort((x, y) => (x.at === y.at ? (x.id < y.id ? -1 : 1) : x.at < y.at ? -1 : 1));
  const unlabelled = order.filter((i) => i.labels.length === 0).map((i) => i.id);
  const labelled = order.filter((i) => i.labels.length > 0);
  const byAnchor = new Map<string, string[]>();
  labelled.forEach((item, at) => {
    const anchor = labelled.slice(0, at + 1).find((earlier) => jaccard(earlier.labels, item.labels) >= threshold)!;
    byAnchor.set(anchor.id, [...(byAnchor.get(anchor.id) ?? []), item.id]);
  });
  const groups = [...byAnchor.entries()].map(([anchor, ids]) => ({ anchor, ids }));
  return { groups: groups.sort((x, y) => y.ids.length - x.ids.length), unlabelled };
}
