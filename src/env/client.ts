import { ClientEnv, report } from './schema';

/**
 * Browser-safe configuration. Everything here IS inlined into the client
 * bundle — only ever put publishable values in this file.
 *
 * Next replaces `process.env.NEXT_PUBLIC_*` at build time by literal text
 * substitution, so each must be written out in full. Destructuring
 * process.env or indexing it dynamically silently yields undefined.
 */
const result = ClientEnv.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});

if (!result.success) throw new Error(report('client', result.error));

export const clientEnv = result.data;
