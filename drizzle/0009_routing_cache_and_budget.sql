-- ---------------------------------------------------------------------------
-- Routing: the cache, the sample log and the spend guard (§12.31).
--
-- HAND-WRITTEN, deliberately. `drizzle-kit generate` produced this plus a
-- destructive enum round-trip — DROP TYPE geocode_precision and recreate it,
-- casting three columns through text on the way — because its snapshot did
-- not know about the hand-written RENAME in 0007. It also wanted to re-add
-- two columns that 0008 had already added. Running that generated file would
-- have rebuilt a live enum under three tables to achieve nothing. Only the
-- statements below are actually needed.
--
-- NON-DESTRUCTIVE: three new tables, nothing existing is touched.
-- ---------------------------------------------------------------------------

CREATE TABLE "stop_routes" (
	"stop_id" uuid PRIMARY KEY NOT NULL,
	"routed_miles" double precision NOT NULL,
	"routed_duration_s" double precision NOT NULL,
	"from_lat" double precision NOT NULL,
	"from_lng" double precision NOT NULL,
	"straight_at_route_miles" double precision NOT NULL,
	"lane_ratio" double precision NOT NULL,
	"stop_lat" double precision NOT NULL,
	"stop_lng" double precision NOT NULL,
	"snap_from_m" double precision,
	"snap_to_m" double precision,
	"provider" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stop_routes_miles_positive" CHECK (routed_miles > 0 and lane_ratio > 0)
);--> statement-breakpoint

CREATE TABLE "route_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stop_id" uuid,
	"dest_city" text,
	"dest_state" text,
	"dest_zip" text,
	"dest_precision" "geocode_precision",
	"straight_miles" double precision NOT NULL,
	"routed_miles" double precision NOT NULL,
	"lane_ratio" double precision NOT NULL,
	"routed_duration_s" double precision NOT NULL,
	"implied_mph" double precision,
	"snap_from_m" double precision,
	"snap_to_m" double precision,
	"provider" text NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "routing_budget" (
	"month" text PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- `set null` on the sample, `cascade` on the cache: a deleted stop should lose
-- its cached route but NOT its measurement history, which is about the lane
-- rather than about the row. The destination is denormalised onto the sample
-- for the same reason.
ALTER TABLE "route_samples" ADD CONSTRAINT "route_samples_stop_id_stops_id_fk"
  FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "stop_routes" ADD CONSTRAINT "stop_routes_stop_id_stops_id_fk"
  FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade;--> statement-breakpoint

CREATE INDEX "stop_routes_computed_idx" ON "stop_routes" USING btree ("computed_at");--> statement-breakpoint
CREATE INDEX "route_samples_measured_idx" ON "route_samples" USING btree ("measured_at");--> statement-breakpoint
CREATE INDEX "route_samples_dest_idx" ON "route_samples" USING btree ("dest_state","dest_city");--> statement-breakpoint

-- RLS, deny-by-default, same as every other table (see 0001).
ALTER TABLE public.stop_routes     ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.route_samples   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.routing_budget  ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stop_routes_deny_all    ON public.stop_routes    FOR ALL USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY route_samples_deny_all  ON public.route_samples  FOR ALL USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY routing_budget_deny_all ON public.routing_budget FOR ALL USING (false) WITH CHECK (false);--> statement-breakpoint
REVOKE ALL ON public.stop_routes, public.route_samples, public.routing_budget FROM anon, authenticated;
