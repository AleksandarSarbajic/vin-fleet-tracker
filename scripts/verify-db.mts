/**
 * Post-migration sanity check. `npm run db:verify`.
 *
 * Asserts the things a migration can silently half-apply: RLS on every
 * table, a deny policy on every table, and zero grants to anon/authenticated.
 * Exits non-zero on any failure so it can gate a deploy.
 */
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
loadEnv({ path: '.env.local' });

const sql = postgres(process.env.DIRECT_URL!, { max: 1 });

const tables = await sql`
  SELECT c.relname AS table, c.relrowsecurity AS rls,
         (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`;

console.log('table            rls     policies');
for (const t of tables) {
  console.log(`${String(t.table).padEnd(16)} ${String(t.rls).padEnd(7)} ${t.policies}`);
}

const [checks] = await sql`SELECT count(*) FROM pg_constraint c
  JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='c'`;
const [uniques] = await sql`SELECT count(*) FROM pg_indexes
  WHERE schemaname='public' AND indexdef ILIKE '%UNIQUE%'`;
const [trg] =
  await sql`SELECT count(*) FROM pg_trigger WHERE tgname='on_auth_user_created'`;
const [fh] = await sql`SELECT count(*) FROM public.feed_health`;
const [grants] = await sql`SELECT count(*) FROM information_schema.role_table_grants
  WHERE table_schema='public' AND grantee IN ('anon','authenticated')`;

console.log('\ncheck constraints :', checks!.count);
console.log('unique indexes    :', uniques!.count);
console.log('signup trigger    :', trg!.count);
console.log('feed_health rows  :', fh!.count, '(singleton)');
console.log('anon/auth grants  :', grants!.count, '(want 0)');

const problems: string[] = [];
for (const t of tables) {
  if (!t.rls) problems.push(`${t.table}: RLS is OFF`);
  if (Number(t.policies) === 0) problems.push(`${t.table}: no policy`);
}
if (Number(grants!.count) > 0) problems.push('anon/authenticated hold table grants');
if (Number(trg!.count) === 0) problems.push('signup trigger missing');
if (Number(fh!.count) !== 1) problems.push('feed_health is not a singleton');

await sql.end();

if (problems.length > 0) {
  console.error('\nFAILED:');
  for (const p of problems) console.error('  -', p);
  process.exit(1);
}
console.log('\nOK — schema, RLS and grants are as specified.');
