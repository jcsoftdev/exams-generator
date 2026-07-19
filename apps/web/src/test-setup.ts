import 'vitest-canvas-mock';

/**
 * jsdom does not implement `ResizeObserver`. Chart.js unconditionally
 * creates one in `bindResponsiveEvents` whenever `options.responsive` is
 * true (see `ui/bar-chart`), so any chart render under jsdom throws
 * `ReferenceError: ResizeObserver is not defined` without this stub.
 * `vitest-canvas-mock` only mocks the 2D canvas context — it does not
 * cover this gap.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
