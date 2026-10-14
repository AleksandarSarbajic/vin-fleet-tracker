-- A layout fingerprint with each AI read's outcome (docs/llm-reader-design.md
-- §4; Alex, 2026-10-15), so the layouts that recur can be counted and the ones
-- worth a template seen. The browser hashes the LABELS in the text it sent
-- (the text before a colon or a "#" in a cell): 8 hex characters of each
-- hash, at most 64, sorted. HASHES ONLY: no value, label text, name, address
-- or load number is stored. The checks below refuse anything else, and a
-- schema test holds it (src/server/ratecon-reader/outcomes-schema.test.ts).
--
-- ADDITIVE ONLY. One column on "ratecon_ai_outcomes", NOT NULL with a default
-- of the empty array, so every existing row stays valid (an outcome recorded
-- before this, or by a page that sent none, has an empty layout) and no
-- deployed code that does not name the column is affected. Same life as the
-- row it is on: deleted with its read after 90 days (0028 cascades). RLS and
-- the deny-all policy are the table's, from 0028; a column adds none.
--
-- The checks: at most 64 entries; none NULL; one dimension; every entry
-- exactly 8 lower-case hex characters (joined with commas, the whole array
-- must be a run of them, so a comma, a space, a newline or a label inside an
-- entry is refused).
--
-- Rollback (nothing else refers to it):
--   ALTER TABLE "ratecon_ai_outcomes" DROP CONSTRAINT "ratecon_ai_outcomes_layout_hashes";
--   ALTER TABLE "ratecon_ai_outcomes" DROP COLUMN "layout";
ALTER TABLE "ratecon_ai_outcomes" ADD COLUMN "layout" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ratecon_ai_outcomes" ADD CONSTRAINT "ratecon_ai_outcomes_layout_hashes" CHECK (
	cardinality("layout") <= 64
	AND cardinality(array_remove("layout", NULL)) = cardinality("layout")
	AND (array_ndims("layout") IS NULL OR array_ndims("layout") = 1)
	AND array_to_string("layout", ',') ~ '^([0-9a-f]{8}(,[0-9a-f]{8})*)?$'
);
