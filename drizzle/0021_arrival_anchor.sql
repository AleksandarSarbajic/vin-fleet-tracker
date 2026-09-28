-- §12.85. A dispatcher's arrival records where the truck was when it was
-- marked, so the worker can tell when the truck leaves. Before this, a
-- hand-marked arrival on a ZIP or block stop never ended: the departure rule
-- measures from the stop's coordinate, which on those stops is only an area.
-- Nullable and additive: code that predates it neither reads nor writes it.
ALTER TABLE "stops" ADD COLUMN "arrival_anchor_lat" double precision;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "arrival_anchor_lng" double precision;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "arrival_anchor_at" timestamp with time zone;--> statement-breakpoint
-- Three columns or none.
ALTER TABLE "stops" ADD CONSTRAINT "stops_arrival_anchor_whole" CHECK ((arrival_anchor_lat is null) = (arrival_anchor_lng is null)
          and (arrival_anchor_lat is null) = (arrival_anchor_at is null));--> statement-breakpoint
-- Only on a dispatcher's arrival — so clearing the arrival must clear it too.
-- `is not distinct from`, not `=`: with no arrival, arrived_source is NULL,
-- `NULL = 'dispatcher'` is NULL, and a CHECK that evaluates to NULL PASSES.
ALTER TABLE "stops" ADD CONSTRAINT "stops_arrival_anchor_dispatcher" CHECK (arrival_anchor_lat is null or arrived_source is not distinct from 'dispatcher');
