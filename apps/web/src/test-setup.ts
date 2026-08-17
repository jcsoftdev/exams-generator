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

/**
 * Node 22+ ships its own experimental `localStorage`/`sessionStorage`
 * globals (the Web Storage API), non-functional unless the process is
 * started with `--localstorage-file`. Because that global already exists
 * on `globalThis` before Vitest's jsdom environment initializes, Vitest's
 * global-key allowlist — which predates Node's native Web Storage API —
 * skips re-defining `localStorage`/`sessionStorage` as accessors onto
 * jsdom's real implementation (it only overrides keys already present on
 * `global` when they're in its hardcoded key list). The result: every spec
 * that touches `localStorage` sees Node's inert stub instead of jsdom's
 * working one and throws `TypeError: Cannot read properties of undefined`.
 * Vitest exposes the underlying JSDOM instance as `globalThis.jsdom` for
 * exactly this kind of override — rewire both Storage globals to it.
 * `window === globalThis` in this environment, so this also fixes
 * `window.localStorage`/`window.sessionStorage`.
 */
const jsdomInstance = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
if (jsdomInstance) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: jsdomInstance.window.localStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: jsdomInstance.window.sessionStorage,
    configurable: true,
    writable: true,
  });
}
