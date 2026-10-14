import { z } from 'zod/v4';
import { MAX_STOPS_PER_LOAD } from '@/lib/load-edit';
import { MAX_LAYOUT_LABELS } from './layout';

/**
 * The wire contract between the edit modal and `POST /api/ratecon/outcome`
 * (docs/llm-reader-design.md §4; Alex, 2026-10-14): what the dispatcher did
 * with an AI read, as COUNTS. Shared, pure.
 *
 * It names a read and, per field NAME from a fixed list, five small counts, and
 * the read's layout as at most 64 hashes of 8 hex characters.
 * There is no place in it for a value, a quote, an address or a load number,
 * and the server parses it strictly: an unknown key, a field name off the
 * list, a count a read cannot produce, or a field twice is refused. The
 * browser is untrusted; this is stored and nothing more.
 */

export const OUTCOME_ROUTE = '/api/ratecon/outcome';

/** The request body is a read id, at most seven small rows, and at most 64 short hashes. */
export const OUTCOME_BODY_LIMIT_BYTES = 4 * 1024;

/** The fields an AI read can fill, by name. The database type (`ratecon_ai_field`, migration 0028) is the same list. */
export const OUTCOME_FIELDS = ['load_number', 'stop_type', 'street', 'city', 'state', 'zip', 'appointment'] as const;
export type OutcomeField = (typeof OUTCOME_FIELDS)[number];

/** What a read can fill of a field: one load number; at most one of any other per stop, and a load holds ten stops. */
export const maxCount = (field: OutcomeField): number => (field === 'load_number' ? 1 : MAX_STOPS_PER_LOAD);

const count = z.number().int().min(0).max(MAX_STOPS_PER_LOAD);

export const FieldCounts = z
  .strictObject({
    field: z.enum(OUTCOME_FIELDS),
    /** Filled by the read and saved as it was. */
    kept: count,
    /** Filled by the read and saved as something else. */
    changed: count,
    /** Filled by the read and saved empty (or its stop removed). */
    cleared: count,
    /** Left blank and marked by the read, and filled by the dispatcher. */
    blankFilled: count,
    /** Left blank and marked by the read, and still blank at the save. */
    blankLeft: count,
  })
  .refine((c) => c.kept + c.changed + c.cleared + c.blankFilled + c.blankLeft <= maxCount(c.field), {
    message: 'more than a read can fill',
  });
export type FieldCounts = z.infer<typeof FieldCounts>;

/**
 * The read's layout fingerprint (`layoutLabels`): at most 64 hashes of 8 lower-case
 * hex characters, strictly ascending, so each is once and the stored array is
 * canonical. Nothing else can be in it — not a label, not a value. Optional so a
 * page loaded before this shipped still records its counts.
 */
export const LayoutHashes = z
  .array(z.string().regex(/^[0-9a-f]{8}$/))
  .max(MAX_LAYOUT_LABELS)
  .refine((hashes) => hashes.every((h, i) => i === 0 || hashes[i - 1]! < h), { message: 'sorted, each once' });

export const OutcomeBody = z
  .strictObject({
    readId: z.string().uuid(),
    fields: z.array(FieldCounts).min(1).max(OUTCOME_FIELDS.length),
    layout: LayoutHashes.optional(),
  })
  .refine((b) => new Set(b.fields.map((f) => f.field)).size === b.fields.length, { message: 'a field twice' });
export type OutcomeBody = z.infer<typeof OutcomeBody>;

export type OutcomeFailCode = 'disabled' | 'forbidden' | 'rate_limited' | 'too_large' | 'bad_request' | 'unknown_read' | 'error';

/**
 * The answer. `recorded: false` is a second post for a read already recorded:
 * ignored, and not an error. A read that is not the caller's, does not exist
 * or never answered is the same `unknown_read`, so the answer tells a caller
 * nothing about other people's reads.
 */
export type OutcomeResponse = { ok: true; recorded: boolean } | { ok: false; code: OutcomeFailCode; reference?: string };
