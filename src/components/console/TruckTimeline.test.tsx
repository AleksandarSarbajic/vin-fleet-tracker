// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TruckTimeline } from './TruckTimeline';

/**
 * The Esc that closes the timeline ends there. It listens on window in the capture
 * phase, beside the board's own Esc for checked rows, and stopping propagation does
 * not stop a listener on the same target. On the real board that listener happens to
 * be spared: closing the timeline re-renders `Console`, which removes it mid-press.
 * That is a reason nobody chose, so this does not lean on it.
 */

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Esc on the timeline', () => {
  it('closes it, and nothing registered after it hears that press', () => {
    const client = new QueryClient();
    client.setQueryData(['timeline', 'truck-1'], []);
    const onClose = vi.fn();
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <TruckTimeline truckId="truck-1" truckLabel="101" dispatchTz="America/Chicago" onClose={onClose} />
        </QueryClientProvider>,
      );
    });
    const heard = vi.fn();
    window.addEventListener('keydown', heard, true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    window.removeEventListener('keydown', heard, true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(heard).not.toHaveBeenCalled();
  });
});
