import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { clientEnv } from '@/env/client';
import { serverEnv } from '@/env/server';

/**
 * Service-level client. Bypasses RLS, so it must never be reachable from a
 * request path that has not already checked the caller's role server-side.
 *
 * `service` picks which secret key to use — the two exist so either can be
 * rotated without taking the other down.
 */
export function createAdminClient(service: 'web' | 'worker' = 'web') {
  const key =
    service === 'worker'
      ? serverEnv.WORKER_SUPABASE_SECRET_KEY
      : serverEnv.SUPABASE_SECRET_KEY;

  return createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
