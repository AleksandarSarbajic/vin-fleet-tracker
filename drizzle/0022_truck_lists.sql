-- §12.90. Shared truck lists: named sets of trucks every dispatcher can see
-- and use ("Bob's trucks").
--
-- ADDITIVE ONLY. Two new tables, their triggers, their RLS — nothing existing
-- is altered, so the app deployed before this keeps working after it is
-- applied: it never names these tables. Applied to production before the
-- code that reads them is pushed.
--
-- Trucks are stored by id (a foreign key), never by the typed number: the
-- number is shown, the id is what is kept. A truck deleted from `trucks`
-- leaves every list with it (ON DELETE CASCADE); a DEACTIVATED truck stays in
-- its lists and the console's Inactive chip rule decides whether it shows.
CREATE TABLE "truck_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	-- Bumped by every change. An edit or delete names the version it started
	-- from and is refused if another save landed in between (§12.90).
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Stored already normalised — trimmed, runs of whitespace collapsed — and
	-- 1..40 characters, the same rule as personal views' names.
	CONSTRAINT "truck_lists_name_shape" CHECK (
		name = regexp_replace(btrim(name), '\s+', ' ', 'g')
		and char_length(name) between 1 and 40
	),
	CONSTRAINT "truck_lists_version_positive" CHECK (version >= 1)
);
--> statement-breakpoint
ALTER TABLE "truck_lists" ADD CONSTRAINT "truck_lists_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_lists" ADD CONSTRAINT "truck_lists_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- "Bob's trucks" and "bob's  trucks" are one name: whitespace is collapsed
-- by the shape check above, case here.
CREATE UNIQUE INDEX "truck_lists_name_unique" ON "truck_lists" USING btree (lower("name"));--> statement-breakpoint

CREATE TABLE "truck_list_members" (
	"list_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- A truck is in a list once.
	CONSTRAINT "truck_list_members_list_id_truck_id_pk" PRIMARY KEY("list_id","truck_id")
);
--> statement-breakpoint
ALTER TABLE "truck_list_members" ADD CONSTRAINT "truck_list_members_list_id_truck_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."truck_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_list_members" ADD CONSTRAINT "truck_list_members_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_list_members" ADD CONSTRAINT "truck_list_members_added_by_profiles_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "truck_list_members_truck_idx" ON "truck_list_members" USING btree ("truck_id");--> statement-breakpoint

-- The caps, in the database so no write path can skip them. A CHECK cannot
-- count rows, so these are triggers, and each takes a lock first: without it
-- two inserts racing at 49 lists would both see 49 and both succeed.
CREATE FUNCTION "public"."truck_lists_cap"() RETURNS trigger
	LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
	PERFORM pg_advisory_xact_lock(hashtext('truck_lists_cap'));
	IF (SELECT count(*) FROM truck_lists) >= 50 THEN
		RAISE EXCEPTION 'truck_lists_cap: there can be at most 50 lists'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "truck_lists_cap" BEFORE INSERT ON "truck_lists"
	FOR EACH ROW EXECUTE FUNCTION "public"."truck_lists_cap"();--> statement-breakpoint

CREATE FUNCTION "public"."truck_list_members_cap"() RETURNS trigger
	LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
	-- The list's own row, locked, so two adds to one list count in turn.
	PERFORM 1 FROM truck_lists WHERE id = NEW.list_id FOR UPDATE;
	IF (SELECT count(*) FROM truck_list_members WHERE list_id = NEW.list_id) >= 200 THEN
		RAISE EXCEPTION 'truck_list_members_cap: a list can hold at most 200 trucks'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "truck_list_members_cap" BEFORE INSERT ON "truck_list_members"
	FOR EACH ROW EXECUTE FUNCTION "public"."truck_list_members_cap"();--> statement-breakpoint

REVOKE ALL ON FUNCTION "public"."truck_lists_cap"() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."truck_list_members_cap"() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Deny-by-default, as every table (0001): the server reaches these through
-- the connection that bypasses RLS; a browser holding the publishable key
-- reaches nothing.
ALTER TABLE "public"."truck_lists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."truck_list_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "public"."truck_lists" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON "public"."truck_list_members" FROM anon, authenticated;--> statement-breakpoint
CREATE POLICY "truck_lists_deny_all" ON "public"."truck_lists" FOR ALL USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "truck_list_members_deny_all" ON "public"."truck_list_members" FOR ALL USING (false) WITH CHECK (false);
