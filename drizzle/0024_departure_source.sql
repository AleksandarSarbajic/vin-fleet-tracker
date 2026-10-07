-- §12.118. Which kind of claim stops.departed_at is — `detected` by the sweep
-- from GPS fixes, or `dispatcher` because a person typed it — the same
-- distinction arrived_source draws for the arrival (§12.57), and for the same
-- reason: a departure is evidence about where a truck was, and "the worker
-- saw it leave" and "somebody said so" are different evidence.
--
-- The migrator applies this file, and its journal row, inside ONE
-- transaction (drizzle-orm pg dialect `migrate`), so the guard below failing
-- leaves the database exactly as it was: no enum, no column, no trigger.
CREATE TYPE "public"."departure_source" AS ENUM('detected', 'dispatcher');--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "departed_source" "departure_source";--> statement-breakpoint

-- The backfill names every existing departure the worker's. Checked, not
-- assumed: each must have the worker's audit row for exactly that instant,
-- or the migration stops and nothing is labelled. On 2026-10-07 that was 13
-- departures, 13 matching rows, all source `worker`.
DO $$
DECLARE unmatched int;
BEGIN
  SELECT count(*) INTO unmatched
    FROM stops s
   WHERE s.departed_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM audit_log a
        WHERE a.entity = 'stop'
          AND a.entity_id = s.id
          AND a.after->>'source' IN ('worker', 'departure-after-manual-arrival')
          AND (a.after->>'departedAt')::timestamptz = s.departed_at);
  IF unmatched > 0 THEN
    RAISE EXCEPTION '% departure(s) have no worker audit row for that instant; none labelled', unmatched;
  END IF;
END $$;--> statement-breakpoint
UPDATE "stops" SET "departed_source" = 'detected' WHERE "departed_at" IS NOT NULL;--> statement-breakpoint

-- A departure with no source is the ambiguity the column ends; a source with
-- no departure is a contradiction.
ALTER TABLE "stops" ADD CONSTRAINT "stops_departed_source_paired" CHECK ((departed_at IS NULL) = (departed_source IS NULL));--> statement-breakpoint

-- THE BRIDGE, for writers that predate the column. Removed by 0025.
--
-- A column default would not do: the worker records a departure with an
-- UPDATE, and a default applies only on INSERT. Without this, the running
-- worker's next departure would be refused by the check above, and the old
-- app's arrival clear (departed_at -> null, source untouched) with it.
--
-- While it exists, a departure written with no source is labelled `detected`.
-- That is an inference, true only because the one writer that leaves the
-- source empty is the worker deployed before this; which is why it is
-- temporary, and why 0025 drops it once the worker writes the source itself.
-- Clearing the time clears the source: that is the pair, not an inference.
CREATE FUNCTION public.stops_departure_source_bridge() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $$
BEGIN
  IF NEW.departed_at IS NULL THEN
    NEW.departed_source := NULL;
  ELSIF NEW.departed_source IS NULL THEN
    NEW.departed_source := 'detected';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.stops_departure_source_bridge() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER stops_departure_source_bridge
  BEFORE INSERT OR UPDATE OF departed_at, departed_source ON "stops"
  FOR EACH ROW EXECUTE FUNCTION public.stops_departure_source_bridge();
