-- A missed cycle has to outlive its own recovery (§12.39).
--
-- The worker stalled eleven times in one day, 5.8 to 51.1 minutes, 329
-- minutes in total. Every one self-recovered: Samsara returned the backlog,
-- `newest_position_at` jumped forward, the staleness banner cleared, and
-- `recordSuccess` wiped `last_error`. A dispatcher looking afterwards saw a
-- healthy board and no evidence that half an hour of the fleet was missing.
--
-- `last_error` answers "is it broken NOW". These answer "has it been", which
-- is the question nobody could ask.

ALTER TABLE public.feed_health
  -- When the current run of missed cycles began. NULL when polling is healthy.
  ADD COLUMN stall_started_at timestamptz,
  -- The worst gap ever seen between two successful polls, and when it ended.
  ADD COLUMN longest_stall_seconds integer,
  ADD COLUMN longest_stall_at timestamptz,
  -- Cumulative, so a pattern of short stalls is as visible as one long one.
  ADD COLUMN missed_cycles integer NOT NULL DEFAULT 0;
