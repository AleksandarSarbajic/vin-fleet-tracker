-- ---------------------------------------------------------------------------
-- The ± that goes with the coarse precision levels (§12.30).
--
-- Null for `street`, where the interpolation error is smaller than anything
-- worth printing. Set for `block` (~0.8 mi) and `zip` (the ZCTA's own radius,
-- median 2.14 mi and p90 5.51 mi across the addresses measured).
--
-- SEPARATE FROM 0007 on purpose. These two statements were first appended to
-- 0007 AFTER it had already run, and drizzle — which records a migration by
-- the hash of its file — skipped the whole thing on the next pass. The enum
-- changes were live and the columns silently were not. A migration that has
-- been applied is immutable; anything else goes in a new file.
-- ---------------------------------------------------------------------------

ALTER TABLE "stops" ADD COLUMN "geocode_accuracy_miles" double precision;--> statement-breakpoint
ALTER TABLE "geocode_cache" ADD COLUMN "accuracy_miles" double precision;
