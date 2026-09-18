-- The Supabase platform objects our migrations reference, and nothing else.
--
-- `drizzle/0001_rls_deny_by_default.sql` revokes from `anon` and
-- `authenticated`, and hangs a trigger on `auth.users`. Those are created by
-- the Supabase platform, not by our migrations, so a vanilla cluster has to
-- be given them before migration 0001 will apply.
--
-- This file is the ONLY place the local cluster diverges from production, and
-- it deliberately does the minimum: enough for the migrations to run
-- unmodified. Our migrations are recorded by file hash and an applied one is
-- immutable, so editing them to suit a local cluster is not an option — and
-- would not be wanted even if it were, since then they would no longer be the
-- statements that ran against production.
--
-- What this does NOT reproduce: Supabase's GoTrue schema in full, its grants,
-- or the mapping from an sb_secret_ key onto `service_role`. Tests connect as
-- the owner and bypass RLS, exactly as they do against production, so none of
-- that is exercised either way. See §12.32.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;

-- Only the three columns handle_new_user() reads.
CREATE TABLE IF NOT EXISTS auth.users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text,
  raw_user_meta_data  jsonb
);
