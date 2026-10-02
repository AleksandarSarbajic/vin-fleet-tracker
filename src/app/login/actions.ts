'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Credentials = z.object({
  email: z.string().email('Enter a work email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export interface LoginState {
  error: string | null;
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = Credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  // Deliberately not distinguishing "no such user" from "wrong password" —
  // that difference is an account-enumeration oracle.
  if (error) return { error: 'Email or password is incorrect.' };

  redirect('/');
}

/**
 * Ends THIS device's session only (§12.96). Supabase's default is `global`,
 * which ended every session of the account: signing out on a phone signed the
 * dispatcher out of their desktop console too.
 *
 * The cookies are cleared either way. A refusal from the auth server is
 * reported, not swallowed — the session it failed to revoke stays valid
 * there until it expires, and that is worth knowing.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error)
    console.error('sign-out failed', { message: error.message, status: error.status });
  redirect('/login');
}
