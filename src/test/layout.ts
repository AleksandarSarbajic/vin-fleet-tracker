/**
 * happy-dom computes no layout: every element is 0×0 and there is no
 * ResizeObserver worth the name. Two things in the console depend on real
 * measurements — the virtualizer, which renders nothing into a 0px scroller,
 * and FleetList's 6/8 column switch, which reads the panel width (§12.17).
 *
 * So a test that mounts the console measures nothing and renders no rows at
 * all, which is indistinguishable from a broken list.
 *
 * This states a size rather than faking behaviour: the components still run
 * their own logic against it. `width` is the LIST panel's width, the number
 * the column switch actually keys off.
 */

interface Size {
  width: number;
  height: number;
}

const observers = new Set<{ disconnect: () => void }>();

export function stubLayout({ width = 1100, height = 600 }: Partial<Size> = {}): () => void {
  const rect = {
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };

  const realRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getRect(): DOMRect {
    return rect as DOMRect;
  };

  /**
   * `offsetWidth`/`offsetHeight` as well as the client pair: @tanstack/virtual
   * measures the scroller with `offsetHeight`, so stubbing only clientHeight
   * leaves the list rendering zero rows — which looks exactly like a broken
   * list rather than an unmeasured one.
   */
  const sized = (
    name: 'clientWidth' | 'clientHeight' | 'offsetWidth' | 'offsetHeight',
    value: number,
  ) => {
    const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get: () => value,
    });
    return () => {
      if (previous) Object.defineProperty(HTMLElement.prototype, name, previous);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    };
  };
  const restores = [
    sized('clientWidth', width),
    sized('clientHeight', height),
    sized('offsetWidth', width),
    sized('offsetHeight', height),
  ];

  const realObserver = globalThis.ResizeObserver;
  class Stub {
    constructor(private readonly callback: ResizeObserverCallback) {
      observers.add(this);
    }
    observe(target: Element): void {
      // Synchronously, because the component decides its column count from
      // the first entry and a deferred callback would leave every test
      // asserting the pre-measurement render.
      this.callback(
        [{ target, contentRect: rect } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {
      observers.delete(this);
    }
  }
  globalThis.ResizeObserver = Stub as unknown as typeof ResizeObserver;

  return () => {
    Element.prototype.getBoundingClientRect = realRect;
    for (const restore of restores) restore();
    globalThis.ResizeObserver = realObserver;
    observers.clear();
  };
}
