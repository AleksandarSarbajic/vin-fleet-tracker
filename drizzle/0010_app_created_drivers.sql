-- Drivers a dispatcher creates, for new hires who exist on the board before
-- anyone adds them to the ELD (§12.35).
--
-- Written by hand. `samsara_driver_id` going nullable means the unique index
-- must become PARTIAL, and drizzle-kit renders that as a drop-and-recreate
-- whose ordering it will not guarantee against a live worker upserting
-- through it every 30 seconds.

-- ---------------------------------------------------------------------------
-- 1. The Samsara id becomes optional, and unique only when it is there.
--
--    A full unique index treats NULLs as distinct in Postgres, so it would
--    technically allow many app-created drivers. The index is made partial
--    anyway: it states the rule the column now follows, and it keeps the
--    index off rows that can never match it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.drivers ALTER COLUMN samsara_driver_id DROP NOT NULL;

DROP INDEX IF EXISTS public.drivers_samsara_driver_id_key;
CREATE UNIQUE INDEX drivers_samsara_driver_id_key
  ON public.drivers (samsara_driver_id)
  WHERE samsara_driver_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Where the row came from — EXPLICIT, never inferred.
--
--    `samsara_driver_id IS NULL` is the tempting inference and it is wrong at
--    the exact moment it matters: a merge fills that id in, and the row it was
--    merged into then looks Samsara-born to anything reading the inference.
--    The roster sync must still refuse to overwrite it, so the provenance has
--    to survive the merge that removes the only evidence of it.
-- ---------------------------------------------------------------------------
CREATE TYPE driver_source AS ENUM ('samsara', 'app');

ALTER TABLE public.drivers
  ADD COLUMN source driver_source NOT NULL DEFAULT 'samsara';

-- Every existing row came from the roster sync, so the default backfills
-- correctly. New app rows pass 'app' explicitly.

ALTER TABLE public.drivers
  ADD COLUMN created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. Retirement, which is OURS.
--
--    `active` is Samsara's, overwritten on every poll, so an app-created
--    driver cannot borrow it — and after a merge the sync would resurrect a
--    driver an admin had retired. `retired_at` is never touched by the sync
--    and survives the merge, so retired locally means retired whatever the
--    ELD says.
-- ---------------------------------------------------------------------------
ALTER TABLE public.drivers ADD COLUMN retired_at timestamptz;

-- ---------------------------------------------------------------------------
-- 4. Merge candidates: a Samsara driver whose name matches an app-created one.
--
--    Detected by the sync, acted on by a human (§12.35). The dismissal is
--    stored so a rejected match does not re-offer itself every 30 seconds for
--    the rest of the driver's career.
-- ---------------------------------------------------------------------------
CREATE TABLE public.driver_merge_candidates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_driver_id   uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  samsara_driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  dismissed_at    timestamptz,
  dismissed_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT driver_merge_candidates_distinct CHECK (app_driver_id <> samsara_driver_id)
);

-- One live candidate per pair. Re-detecting must not stack duplicates.
CREATE UNIQUE INDEX driver_merge_candidates_pair_key
  ON public.driver_merge_candidates (app_driver_id, samsara_driver_id);

-- The board reads only what is still open.
CREATE INDEX driver_merge_candidates_open_idx
  ON public.driver_merge_candidates (detected_at)
  WHERE dismissed_at IS NULL;

ALTER TABLE public.driver_merge_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_merge_candidates_deny_all
  ON public.driver_merge_candidates FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.driver_merge_candidates FROM anon, authenticated;
