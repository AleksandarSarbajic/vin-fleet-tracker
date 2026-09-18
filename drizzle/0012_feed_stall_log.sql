-- ---------------------------------------------------------------------------
-- One row per stall, so the question can be asked tomorrow (§12.42).
--
-- 0011 added counters to feed_health, which answer "has it ever been broken".
-- They cannot answer "was it broken yesterday": a cumulative total and an
-- all-time maximum have no day in them. The diagnosis in §12.39 — eleven
-- stalls, 5.8 to 51.1 minutes, 329 in total — was only possible by
-- reconstructing gaps out of the positions table after the fact, inside a
-- retention window that deletes the evidence after a few days.
--
-- A stall is rare (eleven on the worst day observed) and a row is 40 bytes,
-- so recording each one costs nothing and makes the distribution readable
-- from psql without the worker's stdout.
--
-- NON-DESTRUCTIVE: one new table, one new column with a default.
-- ---------------------------------------------------------------------------

CREATE TABLE public.feed_stalls (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	-- The last poll that succeeded, and the one that recovered.
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"seconds" integer NOT NULL,
	"missed_cycles" integer NOT NULL,
	CONSTRAINT "feed_stalls_ordered" CHECK (ended_at >= started_at),
	CONSTRAINT "feed_stalls_positive" CHECK (seconds > 0)
);--> statement-breakpoint

CREATE INDEX "feed_stalls_ended_idx" ON public.feed_stalls USING btree ("ended_at" DESC);--> statement-breakpoint

-- When this log started, so an empty day can be told from an unrecorded one.
--
-- Without it the first startup report reads "yesterday: 0 stalls" for a day
-- that in fact had eleven, and a zero that means "no data" is worse than no
-- line at all — it is the same shape as every other bug this session, a fact
-- present in one layer and absent from the one that gets read.
ALTER TABLE public.feed_health
  ADD COLUMN stall_log_since timestamptz NOT NULL DEFAULT now();--> statement-breakpoint

-- RLS, deny-by-default, same as every other table (see 0001).
ALTER TABLE public.feed_stalls ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY feed_stalls_deny_all ON public.feed_stalls FOR ALL USING (false) WITH CHECK (false);--> statement-breakpoint
REVOKE ALL ON public.feed_stalls FROM anon, authenticated;
