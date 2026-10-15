-- §12.126. The board's status for a stop, logged when it changes: what the
-- board showed, and when, between the distance marks of the ETA log (§12.112).
--
-- ADDITIVE ONLY. One new table; nothing existing is altered or rewritten, so
-- the worker and app deployed before this keep working after it is applied —
-- neither names anything here. Applied to production before the worker that
-- writes it is deployed.
--
-- One row when the worker first sees a stop as a truck's next stop
-- (`prev_status` null), then one per poll in which the board's status or the
-- engine's own (`computed`) differs from the newest row of the sequence.
-- Nothing on a poll where neither changed. At most 100 rows a sequence, plus
-- the first row in each status or computed status not yet logged for it.
--
-- Rollback: DROP TABLE "eta_status_changes". Nothing else refers to it.
CREATE TABLE "eta_status_changes" (
	-- An identity, not a uuid: rows written in one transaction share
	-- `logged_at` (now() is the transaction's instant), and the newest row of a
	-- sequence is read by `logged_at`, then `id`.
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	-- Deleting a stop deletes its log: without the stop there is nothing to
	-- hold the statuses against, and a demo clear must leave nothing.
	"stop_id" uuid NOT NULL,
	-- Provenance only, no foreign key — the truck the board showed the stop for.
	"truck_id" uuid NOT NULL,
	"truck_number" integer,
	-- The stop's point as `destinationKey` (lib/eta-marks.ts) writes it, the
	-- same key as eta_marks: a stop edited to a new destination starts a new
	-- sequence. Null when the stop has no coordinates; the board then shows a
	-- status by the clock, and null is compared as a value.
	"dest_key" text,
	-- What the row shows, override applied.
	"status" text NOT NULL,
	-- The engine's own answer, override or not (§9.5).
	"computed" text NOT NULL,
	"override_live" boolean NOT NULL,
	-- The newest row before this one in the sequence; null on its first row.
	"prev_status" text,
	"prev_computed" text,
	-- The fix the board anchored to (§12.24). Null when the truck has none.
	"fix_recorded_at" timestamp with time zone,
	"fix_lat" double precision,
	"fix_lng" double precision,
	-- The ETA the board shows; null when it shows none.
	"eta_utc" timestamp with time zone,
	"miles_remaining" double precision,
	-- The engine's deadline: the end of the window, else its start (§12.1).
	"deadline_utc" timestamp with time zone,
	"precision" "geocode_precision",
	-- The basis of the ETA shown; null when no ETA is shown.
	"distance_basis" text,
	"appt_type" "appointment_type",
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- The STATUSES list in lib/status.ts, in its order. A test holds the two
	-- together.
	CONSTRAINT "eta_status_changes_status_known" CHECK (
		status IN ('LATE', 'STALE_GPS', 'UNASSIGNED', 'AT_RISK', 'NO_APPT', 'ARRIVED', 'ON_TIME', 'TOMORROW')
	),
	CONSTRAINT "eta_status_changes_computed_known" CHECK (
		computed IN ('LATE', 'STALE_GPS', 'UNASSIGNED', 'AT_RISK', 'NO_APPT', 'ARRIVED', 'ON_TIME', 'TOMORROW')
	),
	CONSTRAINT "eta_status_changes_prev_status_known" CHECK (
		prev_status IS NULL OR prev_status IN ('LATE', 'STALE_GPS', 'UNASSIGNED', 'AT_RISK', 'NO_APPT', 'ARRIVED', 'ON_TIME', 'TOMORROW')
	),
	CONSTRAINT "eta_status_changes_prev_computed_known" CHECK (
		prev_computed IS NULL OR prev_computed IN ('LATE', 'STALE_GPS', 'UNASSIGNED', 'AT_RISK', 'NO_APPT', 'ARRIVED', 'ON_TIME', 'TOMORROW')
	),
	-- A previous row is one row: both of its statuses, or neither.
	CONSTRAINT "eta_status_changes_prev_whole" CHECK ((prev_status IS NULL) = (prev_computed IS NULL)),
	CONSTRAINT "eta_status_changes_basis_known" CHECK (
		distance_basis IS NULL OR distance_basis IN ('routed', 'lane-estimate', 'straight-line')
	),
	CONSTRAINT "eta_status_changes_dest_key_shape" CHECK (dest_key IS NULL OR dest_key ~ '^-?[0-9]+:-?[0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "eta_status_changes" ADD CONSTRAINT "eta_status_changes_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The sequence's newest row, and its length for the cap: one lookup a poll.
CREATE INDEX "eta_status_changes_sequence_idx" ON "eta_status_changes" USING btree ("stop_id", "truck_id", "dest_key", "logged_at");--> statement-breakpoint

-- Deny-by-default, as every table (0001). The identity's sequence is the first
-- in this schema; 0001's default privileges already withhold it, and it is
-- revoked here as well rather than left to them.
ALTER TABLE "public"."eta_status_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "public"."eta_status_changes" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON SEQUENCE "public"."eta_status_changes_id_seq" FROM anon, authenticated;--> statement-breakpoint
CREATE POLICY "eta_status_changes_deny_all" ON "public"."eta_status_changes" FOR ALL USING (false) WITH CHECK (false);
