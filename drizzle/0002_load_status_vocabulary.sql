-- ---------------------------------------------------------------------------
-- Replaces the invented load_status vocabulary with the real one.
--
-- TONU ("truck ordered not used") is the broker cancelling after the truck is
-- committed, and we bill for it. Deliberately distinct from CANCELLED —
-- dispatchers need the two apart, and DISPATCHED can go straight to TONU.
--
-- Only DELIVERED, TONU and CANCELLED are terminal. No ordering is enforced
-- between the rest: real loads skip states constantly, so there is
-- deliberately NO check constraint policing transitions here.
-- ---------------------------------------------------------------------------

ALTER TABLE public.loads ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.loads ALTER COLUMN status TYPE text USING status::text;

-- Map the old placeholders. The table is empty today, but a migration that
-- only works on an empty table is a migration that fails on a restored dump.
UPDATE public.loads SET status = 'AVAILABLE'  WHERE status = 'PLANNED';
UPDATE public.loads SET status = 'DISPATCHED' WHERE status = 'ACTIVE';

DROP TYPE public.load_status;

CREATE TYPE public.load_status AS ENUM (
  'AVAILABLE',
  'DISPATCHED',
  'AT_SHIPPER',
  'LOADED',
  'AT_RECEIVER',
  'DELIVERED',
  'TONU',
  'CANCELLED'
);

ALTER TABLE public.loads
  ALTER COLUMN status TYPE public.load_status USING status::public.load_status;
ALTER TABLE public.loads ALTER COLUMN status SET DEFAULT 'AVAILABLE';
