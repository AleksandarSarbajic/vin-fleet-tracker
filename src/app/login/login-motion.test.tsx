// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordAnimations, reduceMotion, type Played } from '@/test/animations';
import type { LoginState } from './actions';

/**
 * §12.153, the login page's two small motions. The form comes up into its place on a page
 * load, as CSS in the server's HTML, so no script starts it, ends it or can fail to, and a
 * change of page leaves it to the page's own rise. A sign-in's refusal drops in under the
 * password, its words in the alert in the commit they land in. The browser half (no script,
 * a typed key and a password manager's fill mid-motion, real presses) is
 * `e2e/new-motion.spec.ts`, "phase 3bk".
 */

const arrival = vi.hoisted(() => ({ byChange: false }));
vi.mock('@/lib/page-arrival', () => ({ cameByPageChange: () => arrival.byChange, arrive: () => true }));
const answers = vi.hoisted(() => ({ next: [] as LoginState[] }));
vi.mock('./actions', () => ({
  signIn: async (): Promise<LoginState> => answers.next.shift() ?? { error: null },
}));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => createElement('img', { alt }) }));

const { default: LoginPage } = await import('./page');

const DROP_14 = {
  keyframes: [
    { opacity: 0, translate: '0 -14px' },
    { opacity: 1, translate: '0 0' },
  ],
  duration: 270,
  easing: 'cubic-bezier(.22,.61,.36,1)',
};
const shape = (p: Played) => ({ keyframes: p.keyframes, ...p.options });
const WRONG = 'Email or password is incorrect.';
const NO_EMAIL = 'Enter a work email address.';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let recorder: ReturnType<typeof recordAnimations>;
let unreduce: (() => void) | null = null;

beforeEach(() => {
  arrival.byChange = false;
  answers.next = [];
  recorder = recordAnimations();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  recorder.restore();
  unreduce?.();
  unreduce = null;
  vi.restoreAllMocks();
  window.dispatchEvent(new MouseEvent('pointerup'));
});

const render = async () => {
  await act(async () => {
    root!.render(createElement(LoginPage));
  });
};
const formIn = (scope: ParentNode) => scope.querySelector('form')!;
const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);
/** Signs in with whatever the action is told to answer, as a person pressing Sign in does. */
const signIn = async (answer: LoginState) => {
  answers.next.push(answer);
  const form = formIn(container!);
  form.querySelector<HTMLInputElement>('input[name="email"]')!.value = 'rae@example.test';
  form.querySelector<HTMLInputElement>('input[name="password"]')!.value = 'not-a-real-password';
  await act(async () => {
    // happy-dom's requestSubmit does not reach React's listener; the event a press sends does.
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const alert = () => container!.querySelector('[role="alert"]');

describe('loginForm: the form comes up into its place on a page load', () => {
  it('the server’s HTML carries it as CSS, motion-safe only, and nothing in that HTML hides the form', () => {
    const html = document.createElement('div');
    html.innerHTML = renderToString(createElement(LoginPage));
    const form = formIn(html);
    expect(classesOf(form)).toContain('motion-safe:animate-login-in');
    // Under reduced motion `motion-safe:` gives it nothing: no class runs it unguarded.
    expect(classesOf(form)).not.toContain('animate-login-in');
    // Nothing a script must undo: no inline style, no class that hides or fades it.
    expect(form.getAttribute('style')).toBeNull();
    expect(form.getAttribute('hidden')).toBeNull();
    expect(classesOf(form).filter((c) => /(^|:)(opacity-0|invisible|hidden)$/.test(c))).toEqual([]);
    expect(form.closest('[style]')).toBeNull();
  });

  it('hydrated on the page a load lands on: the same class as the server’s, and no Web Animation', async () => {
    await render();
    expect(classesOf(formIn(container!))).toContain('motion-safe:animate-login-in');
    expect(recorder.played).toEqual([]);
  });

  it('reached by a change of page: no arrival of its own, the page’s rise is the motion', async () => {
    arrival.byChange = true;
    await render();
    expect(classesOf(formIn(container!)).filter((c) => c.includes('animate'))).toEqual([]);
    expect(recorder.played).toEqual([]);
  });

  it('a refusal landing keeps the class the form was drawn with, so its arrival never restarts', async () => {
    await render();
    await signIn({ error: WRONG });
    expect(classesOf(formIn(container!))).toContain('motion-safe:animate-login-in');
  });

  it('from hydration on, a press holds the arrival where it is drawn, and lets go on the release', async () => {
    const arriving = {
      playState: 'running',
      currentTime: 120,
      pause: vi.fn(() => {
        arriving.playState = 'paused';
      }),
      play: vi.fn(() => {
        arriving.playState = 'running';
      }),
      addEventListener: vi.fn(),
    };
    vi.spyOn(HTMLFormElement.prototype, 'getAnimations').mockReturnValue([arriving as unknown as Animation]);
    await render();
    window.dispatchEvent(new MouseEvent('pointerdown'));
    expect(arriving.pause).toHaveBeenCalledTimes(1);
    expect(arriving.currentTime).toBe(120);
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(arriving.play).toHaveBeenCalledTimes(1);
  });
});

describe('loginError: a refusal drops in under the password', () => {
  it('its words are in the alert in the commit they land in, while the drop of 14px in 270ms is still running', async () => {
    await render();
    await signIn({ error: WRONG });
    const shown = alert();
    expect(shown?.textContent).toBe(WRONG);
    expect(recorder.played.map((p) => p.el)).toEqual([shown]);
    expect(recorder.played.map(shape)).toEqual([DROP_14]);
    expect(recorder.played[0]!.animation.playState).toBe('running');
    // The alert as it was: its role, and nothing that hides it from a reader.
    expect(shown?.getAttribute('role')).toBe('alert');
    expect(shown?.getAttribute('aria-hidden')).toBeNull();
    expect(shown?.getAttribute('aria-live')).toBeNull();
  });

  it('the same refusal twice in a row: it stays where it is, played once', async () => {
    await render();
    await signIn({ error: WRONG });
    await signIn({ error: WRONG });
    expect(alert()?.textContent).toBe(WRONG);
    expect(recorder.played).toHaveLength(1);
  });

  it('other words: they drop in again', async () => {
    await render();
    await signIn({ error: NO_EMAIL });
    await signIn({ error: WRONG });
    expect(alert()?.textContent).toBe(WRONG);
    expect(recorder.played.map(shape)).toEqual([DROP_14, DROP_14]);
  });

  it('under reduced motion nothing plays, and the words are there at once', async () => {
    unreduce = reduceMotion();
    await render();
    await signIn({ error: WRONG });
    expect(alert()?.textContent).toBe(WRONG);
    expect(recorder.played).toEqual([]);
  });
});
