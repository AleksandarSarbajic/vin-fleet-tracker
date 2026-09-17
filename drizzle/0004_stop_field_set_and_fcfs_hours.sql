-- ---------------------------------------------------------------------------
-- The stop field set, and FCFS receiving hours.
--
-- A stop is now: street address, city, state, ZIP, stop type, load number,
-- load status, dispatcher note. `facility_name`, `dock_door` and
-- `loads.broker` go entirely — the columns, not just the form fields, because
-- a column nothing writes is a column someone eventually reads.
--
-- DESTRUCTIVE, deliberately. Everything those three columns held is gone.
-- Checked before writing this: every load in the database was a `DEMO-` row
-- from seed:demo, and the demo data was cleared before the migration ran.
--
-- `load_number` becomes nullable (§12.21). The not-blank check stays, now
-- meaning "if present, it has to be something".
--
-- FCFS (§12.22, superseding §12.2's last bullet): an FCFS stop carries
-- RECEIVING HOURS rather than a bare cutoff. It reuses the appointment
-- columns rather than getting its own:
--
--     appointment_type | appointment_start_utc | appointment_end_utc
--     APPT             | the appointment       | start + window, or null
--     FCFS             | earliest hour         | latest hour — the DEADLINE
--
-- Reuse because the next-stop lateral already orders by
-- `appointment_start_utc asc nulls last`, and the earliest receiving hour is
-- exactly the right sort key for an FCFS stop — that query needs no branch.
-- Separate columns would mean a coalesce or a CASE in the fleet query, the
-- reassignment preview, the audit payload and the seed: four places that must
-- agree, to store two instants measured identically by identical code.
--
-- The old constraint forbade a window on FCFS; the new one requires it.
-- ---------------------------------------------------------------------------

-- Refuses rather than inventing or deleting. An existing FCFS stop with a
-- start and no end would violate the new constraint, and the honest fix is a
-- decision by whoever owns that row — not a backfill that makes up receiving
-- hours to get a migration through, and not a DELETE hiding in a schema
-- change.
DO $$
DECLARE offending int;
BEGIN
  SELECT count(*) INTO offending
  FROM stops
  WHERE appointment_type = 'FCFS'
    AND appointment_start_utc IS NOT NULL
    AND appointment_end_utc IS NULL;

  IF offending > 0 THEN
    RAISE EXCEPTION
      'stops_fcfs_has_window: % FCFS stop(s) have a start and no end. '
      'Set each one''s latest receiving hour first (or clear demo rows with '
      '`npm run seed:demo -- --clear`), then re-run this migration.', offending;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "loads" DROP CONSTRAINT "loads_number_not_blank";--> statement-breakpoint
ALTER TABLE "stops" DROP CONSTRAINT "stops_fcfs_has_no_window";--> statement-breakpoint
ALTER TABLE "loads" ALTER COLUMN "load_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "loads" DROP COLUMN "broker";--> statement-breakpoint
ALTER TABLE "stops" DROP COLUMN "facility_name";--> statement-breakpoint
ALTER TABLE "stops" DROP COLUMN "dock_door";--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_number_not_blank" CHECK (load_number is null or length(btrim(load_number)) > 0);--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_fcfs_has_window" CHECK (appointment_type <> 'FCFS'
          or appointment_start_utc is null
          or appointment_end_utc is not null);--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_fcfs_window_positive" CHECK (appointment_type <> 'FCFS'
          or appointment_start_utc is null
          or appointment_end_utc is null
          or appointment_end_utc > appointment_start_utc);