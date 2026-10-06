-- §12.112. The ETA prediction log: what the board said, at fixed distances,
-- kept so it can be held against what happened (`npm run eta:score`).
--
-- ADDITIVE ONLY. One new table and two new nullable columns; nothing existing
-- is altered or rewritten, so the worker and app deployed before this keep
-- working after it is applied — neither names anything here. Applied to
-- production before the worker that writes it is deployed.
--
-- One row when the worker first sees a stop as a truck's next stop
-- (`mark_miles` null), then one per straight-line distance crossed for the
-- first time: 400, 200, 100, 50, 25, 10. At most seven rows per stop and
-- destination, not one per poll.
--
-- Rollback: DROP TABLE "eta_marks"; ALTER TABLE "stop_routes" DROP COLUMN
-- "base_duration_s"; ALTER TABLE "route_samples" DROP COLUMN
-- "base_duration_s". Nothing else refers to any of them.
CREATE TABLE "eta_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	-- Deleting a stop deletes its predictions: without the stop there is no
	-- arrival to score them against, and a demo clear must leave nothing.
	"stop_id" uuid NOT NULL,
	-- Provenance only, no foreign key — the truck the prediction was made for.
	"truck_id" uuid NOT NULL,
	"truck_number" integer,
	-- Null on the first-seen row; otherwise the distance just crossed.
	"mark_miles" integer,
	-- The destination point predicted to, snapshotted. A stop edited to a new
	-- destination is a new trip (§12.111: 3 of 12 arrived stops had been), so
	-- the point is part of the key and the settle step refuses to give an old
	-- point the new point's arrival.
	"dest_lat" double precision NOT NULL,
	"dest_lng" double precision NOT NULL,
	-- The point as the key compares it: integer microdegrees, "lat:lng",
	-- written by `destinationKey` (lib/eta-marks.ts) and by nothing else, so
	-- two float spellings of one point are one key and a moved point is not.
	"dest_key" text NOT NULL,
	"dest_precision" "geocode_precision",
	"dest_accuracy_miles" double precision,
	"deadline_utc" timestamp with time zone,
	-- The fix the board anchored to (§12.24).
	"fix_recorded_at" timestamp with time zone NOT NULL,
	"fix_lat" double precision NOT NULL,
	"fix_lng" double precision NOT NULL,
	"fix_speed_mph" double precision,
	"straight_miles" double precision NOT NULL,
	-- What the board showed.
	"basis" text NOT NULL,
	"projected_miles" double precision NOT NULL,
	"speed_mph" double precision NOT NULL,
	"eta_utc" timestamp with time zone NOT NULL,
	-- The cached route it was built from, so every basis can be replayed.
	"route_routed_miles" double precision,
	"route_duration_s" double precision,
	"route_base_duration_s" double precision,
	"route_straight_miles" double precision,
	"route_lane_ratio" double precision,
	"route_computed_at" timestamp with time zone,
	-- The configuration in force, so a later change to either is visible.
	"avg_speed_mph" double precision NOT NULL,
	"road_factor" double precision NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Filled by the settle step, hourly, before positions are pruned.
	"settled_at" timestamp with time zone,
	"settle_outcome" text,
	"arrived_at" timestamp with time zone,
	"arrived_source" "arrival_source",
	-- Minutes stopped (10+ min episodes) between the fix and the arrival.
	-- Null when the positions did not cover the stretch.
	"stopped_minutes" double precision,
	CONSTRAINT "eta_marks_mark_known" CHECK (mark_miles IS NULL OR mark_miles IN (400, 200, 100, 50, 25, 10)),
	CONSTRAINT "eta_marks_basis_known" CHECK (basis IN ('routed', 'lane-estimate', 'straight-line')),
	CONSTRAINT "eta_marks_settle_outcome_known" CHECK (
		settle_outcome IS NULL OR settle_outcome IN ('arrived', 'destination-changed', 'closed-without-arrival')
	),
	CONSTRAINT "eta_marks_settled_whole" CHECK ((settled_at IS NULL) = (settle_outcome IS NULL)),
	CONSTRAINT "eta_marks_arrival_only_when_arrived" CHECK (
		arrived_at IS NULL OR settle_outcome = 'arrived'
	),
	CONSTRAINT "eta_marks_stopped_nonnegative" CHECK (stopped_minutes IS NULL OR stopped_minutes >= 0),
	CONSTRAINT "eta_marks_dest_key_shape" CHECK (dest_key ~ '^-?[0-9]+:-?[0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "eta_marks" ADD CONSTRAINT "eta_marks_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Recorded once, the first time: a truck that drives away and back does not
-- log a distance again.
CREATE UNIQUE INDEX "eta_marks_mark_key" ON "eta_marks" USING btree ("stop_id", "dest_key", "mark_miles") WHERE "mark_miles" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "eta_marks_first_seen_key" ON "eta_marks" USING btree ("stop_id", "dest_key") WHERE "mark_miles" IS NULL;--> statement-breakpoint
CREATE INDEX "eta_marks_unsettled_idx" ON "eta_marks" USING btree ("stop_id") WHERE "settled_at" IS NULL;--> statement-breakpoint

-- HERE's no-traffic duration, from the response we already receive (§12.112).
-- Stored, not used: it is what lets traffic be separated from the rest.
ALTER TABLE "stop_routes" ADD COLUMN "base_duration_s" double precision;--> statement-breakpoint
ALTER TABLE "route_samples" ADD COLUMN "base_duration_s" double precision;--> statement-breakpoint

-- Deny-by-default, as every table (0001).
ALTER TABLE "public"."eta_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "public"."eta_marks" FROM anon, authenticated;--> statement-breakpoint
CREATE POLICY "eta_marks_deny_all" ON "public"."eta_marks" FOR ALL USING (false) WITH CHECK (false);
