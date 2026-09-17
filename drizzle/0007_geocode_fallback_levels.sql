-- ---------------------------------------------------------------------------
-- Three LIVE precision levels, and no dead ones (§12.30).
--
-- `city` is retired rather than left in place. It was written by nothing and
-- could be written by nothing: the Census locations/address service rejects
-- city-only input with HTTP 400 instead of returning a centroid, so the level
-- was unreachable by construction. Zero rows ever carried it (checked before
-- writing this: stops 43 `street` + 2 null; geocode_cache 10 `street` + 9
-- null). It is RENAMED into `zip` rather than dropped and re-added, so the
-- type keeps its identity and no row is rewritten.
--
-- `block` is new, and it exists because of a measurement rather than a guess.
-- When Census has the street but not the house number, probing a few numbers
-- on the same street and taking the one NEAREST the typed number lands, on
-- the three addresses where a true coordinate was available to check against:
--
--     4747 W Buckeye Rd, Phoenix        probe 0.54 mi  ·  ZIP centroid 2.45 mi
--     4400 Fulton Industrial Blvd SW    probe 0.78 mi  ·  ZIP centroid 2.95 mi
--     1804 N Washington St, Grand Forks probe 0.16 mi  ·  ZIP centroid 5.51 mi
--
-- Three to thirty times better than the ZIP centroid, so it deserves to be
-- above it. But up to 0.78 mi of error is larger than the worker's 0.25 mi
-- arrival radius (§12.27), so it must NOT be treated as `street` either. A
-- level of its own is the honest answer; folding it into `street` would let
-- arrival detection run on a coordinate that can sit half a mile from the dock.
--
--     street  exact house number matched in range   arrival YES · AT_RISK YES
--     block   right street, nearest probed block    arrival NO  · AT_RISK YES
--     zip     ZCTA centroid, vintage 2023           arrival NO  · AT_RISK NO
--
-- NON-DESTRUCTIVE. No row changes value.
-- ---------------------------------------------------------------------------

ALTER TYPE "public"."geocode_precision" RENAME VALUE 'city' TO 'zip';--> statement-breakpoint

-- Ordered between the two, so the enum sorts from most precise to least and
-- `precision <= 'block'` means what it reads like.
ALTER TYPE "public"."geocode_precision" ADD VALUE 'block' BEFORE 'zip';
