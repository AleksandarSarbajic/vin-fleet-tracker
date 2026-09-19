-- ---------------------------------------------------------------------------
-- Who says the truck arrived (§12.57), and an honest reason for saying it.
--
-- `arrived_at` has had exactly one writer since phase 2: the arrival sweep,
-- which anchors it to a GPS fix inside a radius at a speed below a threshold.
-- The edit modal is about to become a second writer, and what a dispatcher
-- enters is a DIFFERENT KIND OF CLAIM — a belief about where a truck is,
-- typed by someone who may be reading it off a phone call. Both are useful.
-- Storing them in one column with no discriminator would make them
-- indistinguishable everywhere except `audit_log`, which nothing on the board
-- reads.
--
-- WHY A COLUMN RATHER THAN A DERIVATION. Two derivations were considered and
-- both are the confident-wrong-answer shape this codebase keeps refusing:
--
--   * "arrived_at matches some position's recorded_at" — a join per row, and
--     a coincidence misclassifies silently.
--   * "the seconds are zero, so a human typed it" — true of most hand entries
--     and of any GPS fix that lands on the minute. Usually right is the
--     problem, not the solution.
--
-- WHY NOT `arrived_by uuid REFERENCES profiles`, mirroring `note_by`. That
-- column answers WHO, and null would have to mean "the sweep" — so deleting a
-- profile (`ON DELETE SET NULL`) would silently reclassify a dispatcher's
-- entry as a detection. The kind of claim must not depend on whether the
-- person who made it still has an account. Who made it is in `audit_log`,
-- which is where "who" belongs.
--
-- Backfill is unambiguous: every existing `arrived_at` predates the modal
-- control, so every one of them was detected.
-- ---------------------------------------------------------------------------

CREATE TYPE public.arrival_source AS ENUM ('detected', 'dispatcher');--> statement-breakpoint

ALTER TABLE public.stops
  ADD COLUMN arrived_source public.arrival_source;--> statement-breakpoint

UPDATE public.stops
   SET arrived_source = 'detected'
 WHERE arrived_at IS NOT NULL;--> statement-breakpoint

-- Paired, both ways. A source with no arrival is a claim about nothing, and
-- an arrival with no source is the ambiguity this migration exists to end —
-- including on the clear path, where forgetting to null the source would
-- leave the next detection wearing a dispatcher's label.
ALTER TABLE public.stops
  ADD CONSTRAINT stops_arrived_source_paired
    CHECK ((arrived_at IS NULL) = (arrived_source IS NULL));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- §12.58. The reason list had no entry for the commonest manual override
-- there is, so it filed as OTHER — which §9.5 reserves for the rare case that
-- earns a written note, and which is the one value that cannot be counted in
-- review. Two trucks hit it on the first day of real use: one on a ZIP
-- centroid that §12.30 gates arrival off entirely, one whose street match the
-- §12.55 guard now refuses. Neither is an ELD fault, and saying
-- ELD_POSITION_WRONG about a working ELD would put a lie in the audit log.
--
-- ADD VALUE only, and the value is not USED in this migration: Postgres
-- permits adding to an enum inside a transaction block but not referencing
-- the new label in the same one.
--
-- BEFORE, not appended. Nothing orders by this enum today, so sort order is
-- cosmetic — but the TypeScript list in lib/status.ts is the one a dispatcher
-- reads down in the modal, and a database whose order silently disagrees with
-- it is a trap for whoever next writes `order by reason`.
-- ---------------------------------------------------------------------------

ALTER TYPE public.override_reason
  ADD VALUE 'ARRIVAL_NOT_DETECTED' BEFORE 'DRIVER_REPORTED_DELAY';
