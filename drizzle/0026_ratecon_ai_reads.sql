-- The language-model reader's counts (docs/llm-reader-design.md §4).
--
-- One row a read, reserved BEFORE the vendor is called and given its outcome
-- after. It is what the daily caps count (Alex, 2026-10-13: 25 a user, 100 in
-- all, per dispatch-zone day). COUNTS ONLY: no column holds text — no file
-- name, no load number, no value, no quote, no model id. A schema test holds
-- that (src/server/ratecon-reader/reads.test.ts).
--
-- ADDITIVE ONLY. Two new types and one new table; nothing existing changes,
-- and no deployed code names any of it.
--
-- `user_id` has no foreign key, as eta_marks' truck_id has none: provenance
-- for a count, which must never stop a user from being removed.
--
-- Rows older than 90 days are deleted by each reservation (reads.ts), so
-- there is no job to forget.
--
-- Rollback: DROP TABLE "ratecon_ai_reads"; DROP TYPE "ratecon_ai_outcome";
-- DROP TYPE "ratecon_ai_vendor". Nothing else refers to them.
CREATE TYPE "public"."ratecon_ai_outcome" AS ENUM('pending', 'ok', 'timeout', 'unavailable', 'refused', 'invalid_output', 'cancelled', 'error');--> statement-breakpoint
-- Only the fake until Alex chooses a vendor; a real one is added with its adapter.
CREATE TYPE "public"."ratecon_ai_vendor" AS ENUM('fake');--> statement-breakpoint
CREATE TABLE "ratecon_ai_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" "ratecon_ai_outcome" DEFAULT 'pending' NOT NULL,
	"vendor" "ratecon_ai_vendor" NOT NULL,
	"lines_sent" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	CONSTRAINT "ratecon_ai_reads_counts" CHECK ("lines_sent" >= 0 AND ("input_tokens" IS NULL OR "input_tokens" >= 0) AND ("output_tokens" IS NULL OR "output_tokens" >= 0))
);--> statement-breakpoint
CREATE INDEX "ratecon_ai_reads_created_idx" ON "ratecon_ai_reads" USING btree ("created_at");--> statement-breakpoint

-- Deny-by-default, as every table (0001).
ALTER TABLE "public"."ratecon_ai_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "public"."ratecon_ai_reads" FROM anon, authenticated;--> statement-breakpoint
CREATE POLICY "ratecon_ai_reads_deny_all" ON "public"."ratecon_ai_reads" FOR ALL USING (false) WITH CHECK (false);
