/*
 * §12.61. Shadow observations for the ratio-stability gate.
 *
 * THE GATE IS NOT BUILT. Nothing reads this table and no recompute is
 * skipped because of it. One row is written after each routing call that
 * really happened, recording what a gate WOULD have decided and what that
 * decision would have cost — which is knowable only here, because the real
 * call returns the ground truth a moment later.
 *
 * Why a table rather than a log line: the answer needs several days of data
 * across worker restarts, and a log is the thing that gets lost. ~187 rows a
 * day; this is dropped when the question is answered.
 *
 * eps is NOT stored. The raw ratios are, so a later sweep can try any eps
 * without re-running the fleet — the mistake §12.31 made when it recorded a
 * conclusion instead of its inputs.
 */
/*
 * r(i-2), carried on the cache row itself.
 *
 * The obvious source is `route_samples` -- take the last two rows for the
 * lane. It does not work: `measured_at` defaults to `now()`, which in
 * Postgres is TRANSACTION START time, so two samples written inside one
 * transaction are indistinguishable and the ordering that picks r(i-2) is
 * arbitrary. Production writes one transaction per routing call and would
 * usually be fine, which is the worst kind of fine.
 *
 * The cache row already knows: at call i it holds r(i-1), and carrying the
 * value it is about to overwrite makes it hold r(i-2) as well. Exact, with no
 * ordering question and no extra query per call.
 *
 * NOTHING READS IT for routing. `needsRecompute` does not see it and the ETA
 * does not see it; it feeds §12.61's shadow observation only.
 */
ALTER TABLE "stop_routes" ADD COLUMN "prev_lane_ratio" double precision;--> statement-breakpoint

CREATE TABLE "route_shadow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

	-- Provenance, not a join key (§12.54): the stop may be re-pointed later,
	-- and this row is an observation about a LANE.
	"stop_id" uuid,
	"dest_lat" double precision NOT NULL,
	"dest_lng" double precision NOT NULL,
	"dest_city" text,
	"dest_state" text,

	-- Which recompute the gate would have been deciding about. route_samples
	-- does not record this, which is why step 0 had to approximate
	-- "plausibly truck-moved" from the geometry.
	"reason" text NOT NULL,

	-- Straight-line miles remaining at this moment. The gate's cost is
	-- straight x |ratio_now - ratio_cached|, so it scales with this.
	"straight_miles" double precision NOT NULL,

	-- r(i-2): what the lane measured two routes ago. NULL on a lane with
	-- only one prior sample, which is a real state and counted as one.
	"ratio_prev" double precision,
	-- r(i-1): what the row was SHOWING until this call returned.
	"ratio_cached" double precision NOT NULL,
	-- r(i): the truth this call just established.
	"ratio_now" double precision NOT NULL,

	-- straight_miles x |ratio_now - ratio_cached|: the miles the board would
	-- have carried had the gate skipped this call.
	"error_miles" double precision NOT NULL,

	"provider" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- `set null`, as on route_samples: a deleted stop loses its cached route but
-- not the measurement history, which is about the lane.
ALTER TABLE "route_shadow" ADD CONSTRAINT "route_shadow_stop_id_stops_id_fk"
  FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE set null;--> statement-breakpoint

CREATE INDEX "route_shadow_observed_idx" ON "route_shadow" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "route_shadow_lane_idx" ON "route_shadow" USING btree ("stop_id","dest_lat","dest_lng","observed_at");--> statement-breakpoint

-- RLS, deny-by-default, same as every other table (see 0001).
ALTER TABLE public.route_shadow ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY route_shadow_deny_all ON public.route_shadow FOR ALL USING (false) WITH CHECK (false);--> statement-breakpoint
REVOKE ALL ON public.route_shadow FROM anon, authenticated;
