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

/**
 * jsdom does not implement `window.matchMedia`. `ThemeService`
 * (`core/theme/theme.service.ts`) calls it once on construction to resolve
 * the system color-scheme preference when no theme has been stored yet —
 * without a stub, ANY spec that constructs `ThemeService` transitively
 * (e.g. `App`'s root component, which injects it for its startup side
 * effect — see `app.ts`) throws `TypeError: window.matchMedia is not a
 * function`. Defaults to `matches: false` (system prefers light);
 * `theme.service.spec.ts` overrides this per-test via
 * `vi.stubGlobal('matchMedia', ...)` to exercise the dark-preference branch,
 * then restores this default afterwards with `vi.unstubAllGlobals()`.
 */
if (typeof globalThis.matchMedia === 'undefined') {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
