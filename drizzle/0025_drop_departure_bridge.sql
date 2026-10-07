-- §12.118. The 0024 bridge's last day.
--
-- It labelled a departure written with no source `detected`: an inference,
-- true only while the one writer that left the source empty was the worker
-- deployed before 0024. Applied only after the worker that writes
-- `departed_source` itself (f86e7fb) and the app that writes `dispatcher`
-- (3cd1d59) are both live. From here a departure with no source is refused by
-- `stops_departed_source_paired` — loudly, rather than labelled by a guess.
DROP TRIGGER "stops_departure_source_bridge" ON "stops";--> statement-breakpoint
DROP FUNCTION public.stops_departure_source_bridge();
