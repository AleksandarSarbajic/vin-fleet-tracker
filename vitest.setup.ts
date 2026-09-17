import { config as loadEnv } from 'dotenv';

// Next loads .env.local automatically; Vitest does not. Database-backed tests
// need DATABASE_URL, and skip themselves cleanly when it is absent.
loadEnv({ path: '.env.local' });
