import 'server-only';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { clientEnv } from '@/env/client';

/**
 * Request-scoped client carrying the signed-in user's session. Uses the
 * PUBLISHABLE key on purpose: it acts as that user, not as the service.
 * For service-level access use `createAdminClient`.
 */
export async function createClient() {
  const store = await cookies();
  return createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
          try {
            for (const { name, value, options } of toSet) {
              store.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session, so this is safe to ignore —
            // and it is the one catch in the codebase that is deliberate.
          }
        },
      },
    },
  );
}
