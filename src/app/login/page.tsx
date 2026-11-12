'use client';

import Image from 'next/image';
import { useActionState, useLayoutEffect, useRef, useState } from 'react';
import { signIn, type LoginState } from './actions';
import { BRAND } from '@/lib/brand';
import { MOTION_MS, MOTION_SHAPE } from '@/design/tokens';
import { dropIn } from '@/lib/appear-motion';
import { follow } from '@/lib/motion';
import { cameByPageChange } from '@/lib/page-arrival';

const initial: LoginState = { error: null };

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial);

  /**
   * §12.153. The form comes up into its place on a page load. The form is the server's first
   * paint, so this is CSS in that HTML (`motion-safe:animate-login-in`): it starts with the
   * first paint and ends by itself. With no script, or a hydration that fails, the form is
   * there and usable as it always was: nothing hides it that a script must undo. Under
   * reduced motion `motion-safe:` gives it nothing at all.
   *
   * Chosen once, as the page mounts: on the page a load lands on. Reached by a change of page
   * (signing out lands here so), the page's own rise is the motion (§12.149), as the window's
   * opening is for the tour (§12.152). The same on the server and in hydration: both say
   * "load".
   */
  const [arrives] = useState(() => !cameByPageChange());
  const form = useRef<HTMLFormElement | null>(null);
  /** From hydration on, a press holds the form where it is drawn, as it holds any motion (§12.149). */
  useLayoutEffect(() => {
    const el = form.current;
    if (!el || typeof el.getAnimations !== 'function') return;
    for (const animation of el.getAnimations()) follow(animation);
  }, []);

  /**
   * §12.153. A refusal drops in under the password. Keyed by its words: the same refusal
   * twice in a row stays where it is, as a field's message does (§12.152), because nothing
   * new arrived and the alert, whose words did not change, is not read out again either.
   * The words are in the alert in the commit they land in; only their look moves.
   */
  const refusal = useRef<HTMLParagraphElement | null>(null);
  const refused = useRef(state.error);
  useLayoutEffect(() => {
    const before = refused.current;
    refused.current = state.error;
    if (state.error && state.error !== before && refusal.current) {
      dropIn(refusal.current, MOTION_MS.loginErrorDrop, MOTION_SHAPE.loginErrorDropPx);
    }
  });

  return (
    /*
     * §12.96. Below 768px the grid's one column is held to the screen. Left to
     * itself the track grows to fit the 420px card, and the card's
     * `max-w-full` then measures against that track and fits nothing: it ran
     * off a 320px phone. Desktop is unchanged.
     */
    <main className="grid min-h-dvh place-items-center bg-surface-sunken p-6 max-md:grid-cols-[minmax(0,1fr)] max-md:p-4">
      <form
        ref={form}
        action={action}
        className={`${arrives ? 'motion-safe:animate-login-in ' : ''}w-[420px] max-w-full border border-line-hair bg-surface-base p-8 max-md:p-6`}
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
          <p ref={refusal} role="alert" className="mb-3 text-small font-medium text-status-late-fg">
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
