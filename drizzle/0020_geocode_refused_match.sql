-- §12.76. A street-only refusal now continues down the geocode chain, and the
-- fallback hit it produces is cached. This column keeps what Census matched
-- and the guard refused, so a cache hit still warns "only matched loosely".
-- Nullable and additive: code that predates it neither reads nor writes it.
ALTER TABLE "geocode_cache" ADD COLUMN "refused_match" text;--> statement-breakpoint
-- A refusal is only recorded on a hit. A miss already says why it missed.
ALTER TABLE "geocode_cache" ADD CONSTRAINT "geocode_cache_refusal_on_hit" CHECK (refused_match is null or lat is not null);
