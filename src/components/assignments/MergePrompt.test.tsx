// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MergePrompt } from './MergePrompt';
import type { OpenMergeCandidate } from '@/server/drivers';

/**
 * §12.43. A check that cannot run has to say so.
 *
 * The prompt swallowed a failed load in a bare `catch {}` and rendered null —
 * which is the same thing it renders when there is genuinely nothing to merge.
 * That is §12.35's stated failure mode exactly: the worker records a candidate
 * every poll and acts on none of them, so an unshown candidate is worse than
 * an undetected one. The data claims the question was asked and nobody was
 * asked anything.
 *
 * Silence is the one thing this component must never mean by accident.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;
/**
 * Spied, not silenced. §12.43 says the failure is surfaced TWICE — on the
 * board for the dispatcher and in the console for whoever debugs it — and
 * only the first half was asserted. This asserts the second and stops four
 * deliberate errors printing on every run, which is the noise that teaches
 * people to skim output.
 */
let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  logged.mockRestore();
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const CANDIDATE: OpenMergeCandidate = {
  id: 'c-1',
  appDriverId: 'd-app',
  samsaraDriverId: 'd-sam',
  samsaraDriverName: 'Ada Lovelace',
  appDriverName: 'Ada Lovelace',
  appDriverCreatedAt: '2026-09-01T12:00:00.000Z',
};

const render = async (role: 'admin' | 'dispatcher' = 'admin') => {
  await act(async () => {
    root!.render(createElement(MergePrompt, { role }));
  });
  return container!;
};

const byText = (needle: string): HTMLElement | null =>
  Array.from(container!.querySelectorAll('button, p, a')).find((el) =>
    (el.textContent ?? '').includes(needle),
  ) as HTMLElement | null;

/** Loads that never resolve, reject, or answer with the wrong status. */
const respond = (impl: () => Promise<unknown>) => {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
};

const ok = (candidates: OpenMergeCandidate[]) => () =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ candidates }),
  });

describe('a merge check that could not run does not render as "nothing to merge"', () => {
  it('says so when the request rejects', async () => {
    respond(() => Promise.reject(new Error('offline')));
    const el = await render();

    // The bug: this was '' — indistinguishable from a clean roster.
    expect(el.innerHTML).not.toBe('');
    expect(el.textContent).toContain('Could not check for duplicate drivers');
    // And the other half of the handler: the CAUSE reaches the console. A
    // message says what, never why.
    expect(logged).toHaveBeenCalledWith('merge candidate check failed', expect.any(Error));
  });

  it('says so when the request is refused', async () => {
    respond(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) }));
    const el = await render();

    expect(el.textContent).toContain('Could not check for duplicate drivers');
  });

  it('says so when the body is not the shape we asked for', async () => {
    // A route handler returning `{}` is not the same as returning no
    // candidates, and `body.candidates` would have been undefined — which
    // `.length` then throws on, into the same silent catch.
    respond(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    const el = await render();

    expect(el.textContent).toContain('Could not check for duplicate drivers');
  });

  it('renders nothing when the check RAN and found nothing', async () => {
    respond(ok([]));
    const el = await render();

    // The whole point of the distinction: this silence is earned.
    expect(el.innerHTML).toBe('');
    // Nothing logged either: a successful check is not an incident.
    expect(logged).not.toHaveBeenCalled();
  });

  it('renders the prompt when the check found something', async () => {
    respond(ok([CANDIDATE]));
    const el = await render();

    expect(el.textContent).toContain('Ada Lovelace');
    expect(el.textContent).not.toContain('Could not check');
  });

  it('retries, and clears the notice once the check succeeds', async () => {
    let attempt = 0;
    respond(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ candidates: [CANDIDATE] }) });
    });

    const el = await render();
    expect(el.textContent).toContain('Could not check for duplicate drivers');

    const retry = byText('Retry');
    expect(retry).not.toBeNull();
    await act(async () => {
      retry!.click();
    });

    expect(el.textContent).toContain('Ada Lovelace');
    expect(el.textContent).not.toContain('Could not check');
  });

  it('does not flash the notice before the first load settles', async () => {
    // A pending request is not a failed one.
    respond(() => new Promise(() => {}));
    const el = await render();
    expect(el.innerHTML).toBe('');
  });
});
