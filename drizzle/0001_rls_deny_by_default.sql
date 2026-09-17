-- ---------------------------------------------------------------------------
-- RLS: enabled on every table, deny-by-default.
--
-- All application reads and writes go through our own route handlers using a
-- secret key, so these policies are a BACKSTOP, not the access model. The
-- goal is narrow and absolute: if the publishable key ever leaks, it reads
-- nothing. Do not "open up" a table here to make a client-side query work —
-- add a route handler instead.
--
-- Supabase maps sb_secret_… to service_role, and the `postgres` role we
-- connect as via Drizzle both carry BYPASSRLS, so server-side access is
-- unaffected by anything below.
-- ---------------------------------------------------------------------------

-- 1. Enable RLS everywhere. With zero permissive policies this denies all
--    access to any non-BYPASSRLS role.
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trucks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stops        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overrides    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_health  ENABLE ROW LEVEL SECURITY;

-- 2. Belt and braces: take the grants away too, so a future permissive
--    policy cannot by itself open a table to the browser.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- And for tables added later by a migration run as `postgres`.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- 3. Explicit deny policies. Redundant next to "RLS on, no policies", but
--    they make the intent legible in the Supabase dashboard, where an empty
--    policy list reads as "nobody configured this yet".
CREATE POLICY profiles_deny_all    ON public.profiles    FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY trucks_deny_all      ON public.trucks      FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY drivers_deny_all     ON public.drivers     FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY assignments_deny_all ON public.assignments FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY positions_deny_all   ON public.positions   FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY loads_deny_all       ON public.loads       FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY stops_deny_all       ON public.stops       FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY overrides_deny_all   ON public.overrides   FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY audit_log_deny_all   ON public.audit_log   FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY feed_health_deny_all ON public.feed_health FOR ALL USING (false) WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 4. Every auth.users row gets a profile. Without this a freshly invited
--    dispatcher signs in successfully and then has no role, which fails in a
--    much more confusing place than signup.
--
--    Default role is 'viewer' — the least privilege. Promotion is a
--    deliberate act by an admin, never a side effect of signing up.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
      split_part(NEW.email, '@', 1)
    ),
    'viewer'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Backfill any users that already exist.
INSERT INTO public.profiles (id, full_name, role)
SELECT u.id,
       COALESCE(NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                split_part(u.email, '@', 1)),
       'viewer'
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- 6. Seed the feed_health singleton so the offline rule has a row to read
--    before the worker has ever run.
INSERT INTO public.feed_health (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
