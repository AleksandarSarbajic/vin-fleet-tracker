import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { signOut } from './login/actions';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <main className="min-h-dvh p-10">
      <h1 className="font-cond text-display uppercase">Fleet Tracker</h1>
      <p className="mt-2 text-small text-text-secondary">
        Phase 1 — scaffold, env, schema, RLS and auth. The console arrives in phase 3.
      </p>

      <dl className="mt-8 grid max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
        <dt className="text-text-muted">Signed in</dt>
        <dd>{user.email}</dd>
        <dt className="text-text-muted">Name</dt>
        <dd>{user.fullName}</dd>
        <dt className="text-text-muted">Role</dt>
        <dd className="uppercase">{user.role}</dd>
      </dl>

      <form action={signOut} className="mt-8">
        <button
          type="submit"
          className="h-10 border border-line-hair px-4 font-cond text-[12.5px] uppercase tracking-[.08em]"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
