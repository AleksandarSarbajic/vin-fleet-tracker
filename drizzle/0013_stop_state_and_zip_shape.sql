-- ---------------------------------------------------------------------------
-- State is two letters; ZIP is five digits (§12.44).
--
-- The normalisation lives in `StopEdit`, which the modal validates with and
-- the route re-parses. That covers every path the current code takes — and
-- the seed script and the geocoder both write these columns WITHOUT going
-- through it. A rule enforced where today's code happens to go, and absent
-- where tomorrow's will, is the shape of every bug this session.
--
-- The column is the one layer a future write path cannot skip. A 500 on a bad
-- write beats a quietly wrong row: a stored '60601-1234' silently degrades
-- the geocode the whole ETA chain hangs off, and a stored 'il' breaks the
-- state-name search (§12.7) and the timezone derivation with it.
--
-- NON-DESTRUCTIVE and no backfill: all 56 stops already conform, verified
-- before writing this.
-- ---------------------------------------------------------------------------

ALTER TABLE public.stops
  ADD CONSTRAINT stops_state_two_letters
    CHECK (state IS NULL OR state ~ '^[A-Z]{2}$');--> statement-breakpoint

ALTER TABLE public.stops
  ADD CONSTRAINT stops_zip_five_digits
    CHECK (zip IS NULL OR zip ~ '^[0-9]{5}$');
