/*
 * §12.73. The §12.61 shadow run is over: the ratio-stability gate is not
 * built. This removes what the run needed and closes what it left.
 *
 * Hand-written, like 0017 and 0018. drizzle-kit's snapshots stop at 0010, so
 * `db:generate` diffs against a stale picture and proposes re-creating tables
 * that already exist; that output must never be applied.
 */

/*
 * r(i-2) was carried on the cache row for the shadow observation and read by
 * nothing in the routing path (0018). With no reader and no writer it would
 * only go stale.
 */
ALTER TABLE "stop_routes" DROP COLUMN "prev_lane_ratio";--> statement-breakpoint

/*
 * The foreign key goes BEFORE the trigger arrives, and this ordering is the
 * bug the suite caught. `ON DELETE SET NULL` makes every stop deletion run
 * `UPDATE route_shadow SET stop_id = NULL WHERE stop_id = $1`, and a trigger
 * that refuses updates would then refuse every load or stop deletion in the
 * product. `stop_id` was provenance, never a join key (§12.54); a closed
 * table has no reason to be told about stops at all.
 */
ALTER TABLE "route_shadow" DROP CONSTRAINT "route_shadow_stop_id_stops_id_fk";--> statement-breakpoint

/*
 * route_shadow is KEPT — its rows are the verdict's raw evidence and
 * `npm run shadow:analyse` re-reads them — but it takes nothing new. The
 * worker no longer writes here; this makes "no more rows" the database's
 * rule rather than merely the absence of a writer, so a stale deploy, a
 * script, or a hand-typed INSERT fails loudly instead of quietly reopening
 * a closed experiment.
 *
 * `search_path` is pinned so the function cannot be redirected by a caller's
 * path, and nobody but the owner may execute it.
 */
CREATE FUNCTION public.route_shadow_closed() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'route_shadow is closed: the section 12.61 shadow run concluded on 2026-09-25 (see section 12.73)';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.route_shadow_closed() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
/*
 * FOR EACH ROW, not FOR EACH STATEMENT: a statement trigger fires even when
 * the statement touches nothing, which is exactly how the foreign key above
 * would have turned it on every deletion. A row trigger fires only for a row
 * that is really being written.
 */
CREATE TRIGGER route_shadow_closed
  BEFORE INSERT OR UPDATE ON public.route_shadow
  FOR EACH ROW EXECUTE FUNCTION public.route_shadow_closed();
