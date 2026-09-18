-- ---------------------------------------------------------------------------
-- Existing `street` rows get the measured dock offset too (§12.54).
--
-- 0014 gave new geocodes `accuracy_miles = 0.15`. Every stop geocoded before
-- it kept null, and null is the value that reads as "exact" — which is the
-- thing being corrected. A rule that applies only to rows written after it
-- is half a rule, and the half it is missing is all 54 existing stops.
--
-- Backfillable because this is a property of the PRECISION LEVEL, not of the
-- address: 0.15 mi is how far a dock may be from any Census street-
-- interpolated point, measured across 13 parking places at 4 facilities. It
-- is the same constant `block` has carried at 0.8 since §12.30.
--
-- `geocode_cache` too, and for a reason §12.30 states outright: "a stale
-- cache keeps working, at the old answer." A cached street hit with a null
-- accuracy writes null back onto the next stop that matches it, so leaving
-- the cache alone would keep producing the old answer until the TTL expired.
-- No CHAIN_VERSION bump: the coordinates, the precision and the match are all
-- unchanged, and only a derived constant is added.
-- ---------------------------------------------------------------------------

update stops
   set geocode_accuracy_miles = 0.15
 where geocode_precision = 'street'
   and geocode_accuracy_miles is null;

update geocode_cache
   set accuracy_miles = 0.15
 where precision = 'street'
   and accuracy_miles is null;
