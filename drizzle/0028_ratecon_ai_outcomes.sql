-- What the dispatcher did with an AI read (docs/llm-reader-design.md §4;
-- Alex, 2026-10-14): for a read that filled the form, once, at the first save
-- after the fill, per FIELD NAME and per outcome, summed over stops — kept as
-- filled, changed, or cleared; and for a field the read left blank and
-- marked, whether the dispatcher filled it. COUNTS ONLY: no column holds a
-- value, a quote, an address, a load number or a file name. A schema test
-- holds that (src/server/ratecon-reader/outcomes-schema.test.ts).
--
-- ADDITIVE ONLY. One type and two new tables; nothing existing changes, and
-- no deployed code names any of it.
--
-- `ratecon_ai_outcomes` is the once-per-read marker (its primary key is the
-- read), linked to the read's counts row so an outcome and its cost sit
-- together. `ratecon_ai_outcome_fields` holds one row a field name.
--
-- Both follow the read: ON DELETE CASCADE, because the read's counts row is
-- deleted after 90 days by each reservation (reads.ts), and a foreign key
-- without it would make that clean-up fail. So an outcome lives 90 days.
--
-- The checks bound a count by what a read can fill: a load holds at most 10
-- stops (MAX_STOPS_PER_LOAD), and one load number.
--
-- Rollback: DROP TABLE "ratecon_ai_outcome_fields"; DROP TABLE
-- "ratecon_ai_outcomes"; DROP TYPE "ratecon_ai_field". Nothing else refers
-- to them.
CREATE TYPE "public"."ratecon_ai_field" AS ENUM('load_number', 'stop_type', 'street', 'city', 'state', 'zip', 'appointment');--> statement-breakpoint
CREATE TABLE "ratecon_ai_outcomes" (
	"read_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "ratecon_ai_outcome_fields" (
	"read_id" uuid NOT NULL,
	"field" "ratecon_ai_field" NOT NULL,
	"kept" smallint DEFAULT 0 NOT NULL,
	"changed" smallint DEFAULT 0 NOT NULL,
	"cleared" smallint DEFAULT 0 NOT NULL,
	"blank_filled" smallint DEFAULT 0 NOT NULL,
	"blank_left" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "ratecon_ai_outcome_fields_pk" PRIMARY KEY("read_id","field"),
	CONSTRAINT "ratecon_ai_outcome_fields_counts" CHECK ("kept" >= 0 AND "changed" >= 0 AND "cleared" >= 0 AND "blank_filled" >= 0 AND "blank_left" >= 0
		AND "kept" + "changed" + "cleared" + "blank_filled" + "blank_left" <= CASE WHEN "field" = 'load_number' THEN 1 ELSE 10 END)
);--> statement-breakpoint
ALTER TABLE "ratecon_ai_outcomes" ADD CONSTRAINT "ratecon_ai_outcomes_read_id_fk" FOREIGN KEY ("read_id") REFERENCES "public"."ratecon_ai_reads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratecon_ai_outcome_fields" ADD CONSTRAINT "ratecon_ai_outcome_fields_read_id_fk" FOREIGN KEY ("read_id") REFERENCES "public"."ratecon_ai_outcomes"("read_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Deny-by-default, as every table (0001).
ALTER TABLE "public"."ratecon_ai_outcomes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "public"."ratecon_ai_outcomes" FROM anon, authenticated;--> statement-breakpoint
CREATE POLICY "ratecon_ai_outcomes_deny_all" ON "public"."ratecon_ai_outcomes" FOR ALL USING (false) WITH CHECK (false);--> statement-breakpoint
ALTER TABLE "public"."ratecon_ai_outcome_fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "public"."ratecon_ai_outcome_fields" FROM anon, authenticated;--> statement-breakpoint
CREATE POLICY "ratecon_ai_outcome_fields_deny_all" ON "public"."ratecon_ai_outcome_fields" FOR ALL USING (false) WITH CHECK (false);
