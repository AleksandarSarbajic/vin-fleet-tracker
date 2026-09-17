import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Next loads .env.local automatically; drizzle-kit and tsx do not.
loadEnv({ path: '.env.local' });

// Migrations run over DIRECT_URL — the SESSION pooler (5432), never the
// transaction pooler and never db.<ref>.supabase.co (IPv6-only).
const url = process.env.DIRECT_URL;
if (!url) throw new Error('DIRECT_URL is not set — cannot run migrations.');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
