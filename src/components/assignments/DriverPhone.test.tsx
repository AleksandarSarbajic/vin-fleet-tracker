// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_MEDIA } from '@/lib/editing';
import { DriverPhone } from './DriverPhone';

/**
 * §12.106. The phone control on the assignment board. Made-up 555 numbers;
 * assertions on a whole number compare by equality, so a failure prints none.
 */

let root: Root;
let container: HTMLDivElement;
const realMatchMedia = window.matchMedia;
const fetchMock = vi.fn();

const screenIs = (wide: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: query === EDIT_MEDIA ? wide : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  screenIs(true);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ changed: true }), { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.matchMedia = realMatchMedia;
});

function render(props: { phone: string | null; mayEdit?: boolean; onSaved?: () => void }) {
  act(() => {
    root.render(
      <DriverPhone
        driverId="d-1"
        driverName="Ana Petrovic"
        phone={props.phone}
        mayEdit={props.mayEdit ?? true}
        lockedReason="Your role is viewer. Phone numbers need dispatcher."
        onSaved={props.onSaved ?? (() => {})}
      />,
    );
  });
}

const button = (name: RegExp) =>
  [...container.querySelectorAll('button')].find((b) =>
    name.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
  );
const input = () => container.querySelector<HTMLInputElement>('input[type="tel"]');
function type(value: string) {
  const el = input()!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the driver phone control', () => {
  it('reads a stored number with dashes', () => {
    render({ phone: '7085550123' });
    const shown = container.querySelector('[data-driver-phone-value]')!.textContent;
    expect(shown === '708-555-0123').toBe(true);
    expect(button(/Change the phone/)).toBeDefined();
  });

  it('says "No phone" and offers Add when there is none', () => {
    render({ phone: null });
    expect(container.textContent).toContain('No phone');
    expect(button(/Add the phone/)).toBeDefined();
  });

  it('a viewer sees the control disabled with the reason, never hidden', () => {
    render({ phone: null, mayEdit: false });
    const add = button(/Add the phone/)!;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe('Your role is viewer. Phone numbers need dispatcher.');
  });

  it('below 768px the number is read-only: no edit control at all', () => {
    screenIs(false);
    render({ phone: '7085550123' });
    expect(container.querySelector('[data-driver-phone-value]')).not.toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('refuses an undialable number before any request, with the reason', () => {
    render({ phone: null });
    act(() => button(/Add the phone/)!.click());
    type('555-0123');
    act(() => button(/^Save$/)!.click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/all 10 digits/);
  });

  it('sends a good number once, and reports the save', async () => {
    const onSaved = vi.fn();
    render({ phone: null, onSaved });
    act(() => button(/Add the phone/)!.click());
    type('(708) 555 0123');
    await act(async () => button(/^Save$/)!.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as {
      action: string;
      driverId: string;
    };
    expect(body).toMatchObject({ action: 'phone', driverId: 'd-1' });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('a blank value is sent as a clear', async () => {
    render({ phone: '7085550123' });
    act(() => button(/Change the phone/)!.click());
    type('');
    await act(async () => button(/^Save$/)!.click());
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as {
      phone: string;
    };
    expect(body.phone).toBe('');
  });
});
