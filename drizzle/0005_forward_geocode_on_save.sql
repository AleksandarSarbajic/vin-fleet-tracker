-- ---------------------------------------------------------------------------
-- Forward geocoding on stop save (§12.24 — the gap closes).
--
-- WHY THIS IS NOT THE BANNED GEOCODER
--
-- The brief bans external geocoding. It was aimed at per-position REVERSE
-- geocoding: a call per truck per poll, ~86,000 a day, to recompute a string
-- Samsara already hands us free in gps.reverseGeo.formattedLocation.
--
-- This is the other direction and a different order of magnitude: one FORWARD
-- call per stop edit whose address actually changed, 20-40 a day, cached by
-- normalised address so the same DC costs one call however often it is
-- entered. Different direction, different volume, different purpose.
--
-- WHAT IT UNBLOCKS
--
-- LATE and AT_RISK are defined against PROJECTED ETA. The projection needs
-- stops.lat/lng. Nothing has ever populated them, so every dispatcher-entered
-- stop fell back to the clock and the board could not warn anyone about a
-- problem until it had already happened. Measured before writing this: 44
-- stops, 44 with an address, 28 with coordinates -- and every one of those 28
-- came from the seed. Not one dispatcher-entered stop had any.
--
-- NON-DESTRUCTIVE. Adds columns and one table; touches no existing data.
-- The backfill is a separate, reviewable script (scripts/geocode-backfill.mts),
-- not a migration -- it spends money at a third party, and that does not
-- belong in something `db:migrate` runs unattended.
-- ---------------------------------------------------------------------------

CREATE TYPE "public"."geocode_precision" AS ENUM('rooftop', 'city');--> statement-breakpoint

-- Coordinates are written ONLY by the server-side geocoder, from the four
-- address fields, in the same save. They are never typed and never accepted
-- from a client.
ALTER TABLE "stops" ADD COLUMN "geocode_precision" "geocode_precision";--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "geocode_confidence" text;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "geocoded_address" text;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "geocoded_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE "geocode_cache" (
	"normalized_address" text PRIMARY KEY NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"precision" "geocode_precision",
	"confidence" text,
	"matched_address" text,
	"miss_reason" text,
	"provider" text DEFAULT 'mapbox-v6' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geocode_cache_coords_paired" CHECK ((lat is null) = (lng is null)),
	CONSTRAINT "geocode_cache_hit_has_precision" CHECK (
	    (lat is null and precision is null and miss_reason is not null)
	 or (lat is not null and precision is not null and miss_reason is null)
	)
);--> statement-breakpoint

-- Drives the TTL sweep. Hits expire at 30 days when the account cannot grant
-- `permanent=true`; misses expire sooner. Both are a `where` on this column.
CREATE INDEX "geocode_cache_fetched_idx" ON "geocode_cache" USING btree ("fetched_at");--> statement-breakpoint

-- RLS, same as every other table: deny-by-default. Provider cache or not, the
-- publishable key reads nothing (see 0001).
ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY geocode_cache_deny_all ON public.geocode_cache
  FOR ALL USING (false) WITH CHECK (false);--> statement-breakpoint
REVOKE ALL ON public.geocode_cache FROM anon, authenticated;
