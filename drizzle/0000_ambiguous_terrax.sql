CREATE TYPE "public"."appointment_type" AS ENUM('APPT', 'FCFS');--> statement-breakpoint
CREATE TYPE "public"."load_status" AS ENUM('PLANNED', 'ACTIVE', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."override_reason" AS ENUM('RECEIVER_CONFIRMED_DETENTION', 'APPT_RESCHEDULED_BY_BROKER', 'ELD_POSITION_WRONG', 'DRIVER_REPORTED_DELAY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."stop_type" AS ENUM('PU', 'DEL');--> statement-breakpoint
CREATE TYPE "public"."truck_status" AS ENUM('LATE', 'STALE_GPS', 'UNASSIGNED', 'AT_RISK', 'NO_APPT', 'ARRIVED', 'ON_TIME', 'TOMORROW');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'dispatcher', 'viewer');--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"truck_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_by" uuid,
	CONSTRAINT "assignments_ends_after_start" CHECK (ended_at is null or ended_at >= started_at)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"samsara_driver_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_health" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"newest_position_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"cursor" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_health_singleton" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "loads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"truck_id" uuid,
	"load_number" text NOT NULL,
	"broker" text,
	"status" "load_status" DEFAULT 'PLANNED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loads_number_not_blank" CHECK (length(btrim(load_number)) > 0)
);
--> statement-breakpoint
CREATE TABLE "overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stop_id" uuid NOT NULL,
	"forced_status" "truck_status" NOT NULL,
	"reason" "override_reason" NOT NULL,
	"reason_note" text,
	"set_by" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "overrides_forced_status_allowed" CHECK (forced_status in ('LATE', 'ARRIVED', 'NO_APPT')),
	CONSTRAINT "overrides_expires_after_set" CHECK (expires_at > set_at),
	CONSTRAINT "overrides_other_needs_note" CHECK (reason <> 'OTHER' or length(btrim(coalesce(reason_note, ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"truck_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"heading" smallint,
	"speed_mph" double precision,
	"recorded_at" timestamp with time zone NOT NULL,
	"formatted_location" text,
	CONSTRAINT "positions_lat_range" CHECK (lat between -90 and 90),
	CONSTRAINT "positions_lng_range" CHECK (lng between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"load_id" uuid NOT NULL,
	"type" "stop_type" NOT NULL,
	"sequence" integer NOT NULL,
	"facility_name" text,
	"address_line" text,
	"city" text,
	"state" text,
	"zip" text,
	"lat" double precision,
	"lng" double precision,
	"dock_door" text,
	"appointment_start_utc" timestamp with time zone,
	"appointment_end_utc" timestamp with time zone,
	"appointment_tz" text,
	"appointment_type" "appointment_type" DEFAULT 'APPT' NOT NULL,
	"arrived_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	"dispatcher_note" text,
	"note_by" uuid,
	"note_at" timestamp with time zone,
	CONSTRAINT "stops_appointment_needs_tz" CHECK (appointment_start_utc is null or appointment_tz is not null),
	CONSTRAINT "stops_fcfs_has_no_window" CHECK (appointment_type <> 'FCFS' or appointment_end_utc is null),
	CONSTRAINT "stops_window_ordered" CHECK (appointment_end_utc is null or appointment_start_utc is null
          or appointment_end_utc >= appointment_start_utc),
	CONSTRAINT "stops_departed_after_arrived" CHECK (departed_at is null or arrived_at is null or departed_at >= arrived_at)
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"samsara_vehicle_id" text NOT NULL,
	"samsara_name" text NOT NULL,
	"truck_number" integer,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_profiles_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_set_by_profiles_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_note_by_profiles_id_fk" FOREIGN KEY ("note_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_one_open_per_truck" ON "assignments" USING btree ("truck_id") WHERE ended_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_one_open_per_driver" ON "assignments" USING btree ("driver_id") WHERE ended_at is null;--> statement-breakpoint
CREATE INDEX "assignments_truck_started_idx" ON "assignments" USING btree ("truck_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_samsara_driver_id_key" ON "drivers" USING btree ("samsara_driver_id");--> statement-breakpoint
CREATE INDEX "loads_truck_idx" ON "loads" USING btree ("truck_id");--> statement-breakpoint
CREATE INDEX "overrides_stop_idx" ON "overrides" USING btree ("stop_id","set_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "overrides_one_live_per_stop" ON "overrides" USING btree ("stop_id") WHERE cleared_at is null;--> statement-breakpoint
CREATE INDEX "positions_truck_recorded_idx" ON "positions" USING btree ("truck_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "positions_truck_recorded_key" ON "positions" USING btree ("truck_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stops_load_sequence_key" ON "stops" USING btree ("load_id","sequence");--> statement-breakpoint
CREATE INDEX "stops_open_idx" ON "stops" USING btree ("load_id","sequence") WHERE departed_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "trucks_samsara_vehicle_id_key" ON "trucks" USING btree ("samsara_vehicle_id");