-- The language-model reader's one real vendor (docs/llm-reader-design.md §6,
-- phase 2b; Alex, 2026-10-13/14: Anthropic).
--
-- ADDITIVE ONLY. Two enum values; no table, column or row changes.
--   - `anthropic` joins `fake` as a vendor a counts row can name.
--   - `vendor_capped` is a new outcome: the vendor refused because the
--     account's own spending limit is reached (HTTP 400, "You have reached your
--     specified …"). Not `capped`, which is OUR daily cap, and not
--     `unavailable`: only an admin can clear it, and the strip says so.
--
-- `ADD VALUE` may run inside the migrator's transaction (Postgres 12+); a new
-- value cannot be USED in the transaction that adds it, and nothing here uses
-- it.
--
-- Rollback: Postgres cannot drop an enum value. Rows naming either value would
-- have to go first, then the type be rebuilt; nothing else depends on them.
ALTER TYPE "public"."ratecon_ai_vendor" ADD VALUE IF NOT EXISTS 'anthropic';--> statement-breakpoint
ALTER TYPE "public"."ratecon_ai_outcome" ADD VALUE IF NOT EXISTS 'vendor_capped';
