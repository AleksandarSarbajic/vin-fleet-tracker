'use client';

import Image from 'next/image';
import { useActionState } from 'react';
import { signIn, type LoginState } from './actions';
import { BRAND } from '@/lib/brand';

const initial: LoginState = { error: null };

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <main className="grid min-h-dvh place-items-center bg-surface-sunken p-6">
      <form
        action={action}
        className="w-[420px] max-w-full border border-line-hair bg-surface-base p-8"
      >
        {/* §9.12 / 3f: the knockout lockup at 54px tall, 22px above the title. */}
        <Image
          src={BRAND.markKnockout.src}
          width={BRAND.markKnockout.width}
          height={BRAND.markKnockout.height}
          alt={BRAND.alt}
          unoptimized
          priority
          className="mb-[22px] h-[54px] w-auto"
        />
        <h1 className="font-cond text-display uppercase">Fleet Tracker</h1>
        <p className="mb-6 mt-1.5 text-body text-text-secondary">
          Dispatch console. Authorised users only.
        </p>

        <label className="mb-3.5 block">
          <span className="mb-1.5 block text-small font-medium text-text-secondary">
            Work email
          </span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="h-11 w-full border border-line-hair bg-surface-sunken px-3 text-[13.5px]"
          />
        </label>

        <label className="mb-2 block">
          <span className="mb-1.5 block text-small font-medium text-text-secondary">
            Password
          </span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="h-11 w-full border border-line-hair bg-surface-sunken px-3 text-[13.5px]"
          />
        </label>

        {state.error ? (
          <p role="alert" className="mb-3 text-small font-medium text-status-late-fg">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-4 h-[46px] w-full bg-accent font-cond text-[13px] uppercase tracking-[.1em] text-text-inverse disabled:opacity-45"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
