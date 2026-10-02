// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from './test-render';
import { useResumeRefetch } from './useResumeRefetch';

/**
 * §12.96. Back from the background: the board refetches at once, and says
 * it is updating until the answer lands — never longer, never shorter.
 */

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visibility,
});

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** A refetch the test settles by hand. */
function heldRefetch() {
  const pending: Array<() => void> = [];
  const refetch = vi.fn(
    (_options: { cancelRefetch: boolean }) =>
      new Promise<void>((resolve) => pending.push(resolve)),
  );
  return { refetch, land: (i = 0) => pending[i]!() };
}

const mounted: Array<{ unmount: () => void }> = [];
function mount(refetch: (options: { cancelRefetch: boolean }) => Promise<unknown>) {
  const hook = renderHook(() => useResumeRefetch(refetch));
  mounted.push(hook);
  return hook;
}

afterEach(() => {
  mounted.splice(0).forEach((hook) => hook.unmount());
  visibility = 'visible';
});

describe('useResumeRefetch', () => {
  it('is quiet until the page comes back', () => {
    const { refetch } = heldRefetch();
    const hook = mount(refetch);
    expect(hook.current()).toBe(false);
    act(() => setVisibility('hidden'));
    expect(hook.current()).toBe(false);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('refetches the moment it is visible, joining any fetch in flight, and holds until it lands', async () => {
    const { refetch, land } = heldRefetch();
    const hook = mount(refetch);
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith({ cancelRefetch: false });
    expect(hook.current()).toBe(true);

    await act(async () => land());
    expect(hook.current()).toBe(false);
  });

  it('clears on a failed refetch too: the error banner speaks for that', async () => {
    const refetch = vi.fn(() => Promise.reject(new Error('offline')));
    const hook = mount(refetch);
    act(() => setVisibility('visible'));
    expect(hook.current()).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.current()).toBe(false);
  });

  it('answers to a page restored from the back-forward cache', () => {
    const { refetch } = heldRefetch();
    const hook = mount(refetch);
    act(() => {
      const event = new Event('pageshow') as PageTransitionEvent;
      Object.defineProperty(event, 'persisted', { value: true });
      window.dispatchEvent(event);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(hook.current()).toBe(true);
  });

  it('two quick returns: one marker, cleared by the newer answer only', async () => {
    const { refetch, land } = heldRefetch();
    const hook = mount(refetch);
    act(() => setVisibility('visible'));
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(refetch).toHaveBeenCalledTimes(2);

    await act(async () => land(0));
    expect(hook.current()).toBe(true);
    await act(async () => land(1));
    expect(hook.current()).toBe(false);
  });
});
