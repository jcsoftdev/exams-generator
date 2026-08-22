# Light/Dark Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a real light/dark theme toggle where light mode (new Figma indigo ramp) becomes the app's default and dark mode (the app's original navy ramp, plus newly-designed dark neutrals/semantic tags) is available via a topbar button, an explicit user choice, or the OS preference.

**Architecture:** Tailwind v4's `@theme` block in `apps/web/src/styles.css` continues to generate the same utility class names (`bg-primary-900`, `text-n600`, etc.) it always has — only the underlying CSS custom-property _values_ change per mode, via a `@media (prefers-color-scheme: dark)` block (system preference, no explicit choice) and two `:root[data-theme="light"|"dark"]` attribute-selector overrides (explicit choice, always wins). A new `ThemeService` (`providedIn: 'root'`, signal-based) owns reading/writing that `data-theme` attribute and `localStorage`; it is injected once in the root `App` component (so the attribute is applied before any route — including `/login` — renders) and again in `ShellComponent` to wire the new topbar toggle button.

**Tech Stack:** Angular v22 (standalone components, signals), Tailwind v4 CSS-first `@theme`, `lucide-angular` (`Sun`/`Moon` icons), Vitest under `@angular/build:unit-test`.

## Global Constraints

- Class names never change between modes — only the CSS custom-property values behind them do (design doc §2).
- Explicit user choice (`data-theme` attribute, from a stored preference or a toggle click) always wins over the OS `prefers-color-scheme` media query (design doc §2).
- `paper-bg` / `paper-border` (print-preview "paper") and `radius-field` / `radius-card` / `font-sans` never theme-switch — they are declared once in `@theme` and never repeated in any override block (design doc §3, "Unchanged in both modes").
- No flash-of-unstyled-content engineering — a brief flash on first load before `ThemeService` applies a stored explicit preference is an accepted tradeoff, not a defect to fix (design doc §2).
- No changes to any component template beyond the new toggle button — every other screen inherits the new token values automatically because it already references these token names via Tailwind utility classes (design doc §4). This explicitly includes the login hero panel (`login.component.html`), which already uses `primary-900`/`primary-800` etc. and therefore follows the global toggle automatically with zero code changes.
- One global toggle for the whole app — no dedicated theme-settings page, no per-tenant/per-component overrides (design doc §6).
- No automated visual/pixel regression testing — verification is a full test-suite run (for regressions) plus a live-browser check of both modes for console errors, matching the dashboard-layout-migration precedent (design doc §5).
- Always run the full test suite (`cd apps/web && pnpm exec ng test`) to verify — file-scoped runs are known to fail on `initTestEnvironment` in this exact setup. Never invoke a narrower test command.

## File Structure

- **Modify** `apps/web/src/styles.css` — restructure the `@theme` block to declare light-mode values as the default, add the dark system-preference override and the two explicit `[data-theme]` overrides.
- **Create** `apps/web/src/app/core/theme/theme.service.ts` — `providedIn: 'root'` signal service owning theme resolution (`localStorage` → `matchMedia` fallback), DOM attribute application, and `toggle()`.
- **Create** `apps/web/src/app/core/theme/theme.service.spec.ts` — unit tests for the three behaviors above.
- **Modify** `apps/web/src/test-setup.ts` — add a `window.matchMedia` stub (jsdom doesn't implement it), mirroring the existing `ResizeObserver` stub already in this file.
- **Modify** `apps/web/src/app/app.ts` — inject `ThemeService` once so its constructor side effect (applying a stored explicit preference) runs before any route renders, including `/login`.
- **Modify** `apps/web/src/app/features/shell/shell.component.ts` — inject `ThemeService`, expose a `themeMode` computed and a `toggleTheme()` method to the template.
- **Modify** `apps/web/src/app/features/shell/shell.component.html` — add the sun/moon toggle button next to `notifications-button`.
- **Modify** `apps/web/src/app/features/shell/shell.component.spec.ts` — fake `ThemeService`, add `Sun`/`Moon` to its own `LucideAngularModule.pick({...})`, test the new button.
- **Modify** `apps/web/src/app/app.config.ts` — add `Sun`/`Moon` to the app-wide `LucideAngularModule.pick({...})` (needed for the real, bootstrapped app; unit tests use their own picks per file, as `shell.component.spec.ts` already does for `Bell`).

---

### Task 1: `styles.css` token restructure (light default + dark override)

**Files:**

- Modify: `apps/web/src/styles.css` (full file — see current content below)
- Test: none (pure CSS, no unit-testable logic) — verification is the full suite passing (no CSS-only change should break any TS/component test) plus a manual visual check deferred to after Task 3, once the toggle button exists to actually flip `data-theme` in the browser.

**Interfaces:**

- Consumes: nothing from earlier tasks (first task in the sequence).
- Produces: the same Tailwind utility class names the app already uses (`bg-primary-900`, `text-n600`, `bg-easy-bg`, `text-easy-text`, `bg-tint-activo`, `text-tint-texto`, `bg-paper-bg`, `border-paper-border`, `rounded-field`, `rounded-card`, `font-sans`, etc.) whose custom-property values now differ between an unset `:root` (light default), `@media (prefers-color-scheme: dark)` on an unset `:root` (system dark), `:root[data-theme="dark"]`, and `:root[data-theme="light"]`. Task 2's `ThemeService` produces the `data-theme` attribute value that selects between the last two; Task 3's toggle button is the only UI that changes it.

Current file (for reference — this task replaces it entirely):

```css
@import "./styles/fonts.css";
@import "tailwindcss";

@theme {
  /* Marca "Pizarra profunda" — primary ramp */
  --color-primary-900: #072034;
  --color-primary-800: #1c3141;
  --color-primary-700: #2f4657;
  --color-primary-600: #3f596f;
  --color-primary-500: #516f8a;
  --color-primary-400: #7392ae;
  --color-primary-300: #9db4cb;
  --color-primary-200: #c3d3e2;
  --color-primary-100: #e2ebf3;
  --color-primary-50: #f3f6fa;

  /* Nav activo / chips */
  --color-tint-activo: #deedfb;
  --color-tint-texto: #3b5872;

  /* Neutrales (n50..n900) */
  --color-n50: #f7f8f9;
  --color-n100: #eceef1;
  --color-n200: #dde0e4;
  --color-n300: #c3c8ce;
  --color-n400: #a4abb3;
  --color-n500: #868d96;
  --color-n600: #6a717a;
  --color-n700: #4e545c;
  --color-n800: #363b41;
  --color-n900: #20242a;

  /* Semánticos — pares bg/text (tags + estados) */
  --color-easy-bg: #dcfce7;
  --color-easy-text: #166534;
  --color-medium-bg: #fef3c7;
  --color-medium-text: #92620a;
  --color-hard-bg: #fee2e2;
  --color-hard-text: #9f1239;
  --color-ai-bg: #f3e8ff;
  --color-ai-text: #6b21a8;
  --color-warn-bg: #fff8f1;
  --color-warn-text: #9a3412;

  /* "Papel" — vista previa impresa WYSIWYG (Cola de revisión, §4 pantalla 4) */
  --color-paper-bg: #fdfdfc;
  --color-paper-border: #e8e5df;

  /* Radii 8–12px (§3.3) */
  --radius-field: 8px;
  --radius-card: 12px;

  /* Tipografía */
  --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
}

body {
  @apply font-sans bg-n50 text-n900;
}
```

- [ ] **Step 1: Replace the full contents of `apps/web/src/styles.css`**

The `primary-*` dark values below are byte-identical to the current file's `primary-*` ramp above — dark mode reuses the app's original navy palette as-is (design doc §1/§3). Light `primary-*`, all `n*` values, and all semantic tag values come from the design doc's tables (§3).

```css
@import "./styles/fonts.css";
@import "tailwindcss";

@theme {
  /* Marca — primary ramp (LIGHT mode default: new Figma indigo accent) */
  --color-primary-900: #272f52;
  --color-primary-800: #333d6b;
  --color-primary-700: #3f4d85;
  --color-primary-600: #4a5aa8;
  --color-primary-500: #5a6acf;
  --color-primary-400: #7c89d9;
  --color-primary-300: #9ea8e3;
  --color-primary-200: #c1c8ee;
  --color-primary-100: #dfe3f6;
  --color-primary-50: #f0f2fb;

  /* Nav activo / chips (light) */
  --color-tint-activo: #dfe3f6;
  --color-tint-texto: #5a6acf;

  /* Neutrales (n50..n900) — light mode, unchanged from the original ramp */
  --color-n50: #f7f8f9;
  --color-n100: #eceef1;
  --color-n200: #dde0e4;
  --color-n300: #c3c8ce;
  --color-n400: #a4abb3;
  --color-n500: #868d96;
  --color-n600: #6a717a;
  --color-n700: #4e545c;
  --color-n800: #363b41;
  --color-n900: #20242a;

  /* Semánticos — pares bg/text (tags + estados), light mode, unchanged */
  --color-easy-bg: #dcfce7;
  --color-easy-text: #166534;
  --color-medium-bg: #fef3c7;
  --color-medium-text: #92620a;
  --color-hard-bg: #fee2e2;
  --color-hard-text: #9f1239;
  --color-ai-bg: #f3e8ff;
  --color-ai-text: #6b21a8;
  --color-warn-bg: #fff8f1;
  --color-warn-text: #9a3412;

  /* "Papel" — vista previa impresa WYSIWYG. Fixed regardless of theme
     (design doc §3, "Unchanged in both modes") — never repeated below. */
  --color-paper-bg: #fdfdfc;
  --color-paper-border: #e8e5df;

  /* Radii 8–12px (§3.3) — not color tokens, never repeated below. */
  --radius-field: 8px;
  --radius-card: 12px;

  /* Tipografía — not a color token, never repeated below. */
  --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
}

/* System-preference dark: only when the user has made no explicit choice
   (no [data-theme] attribute on <html>). Explicit choice always wins —
   see the :root[data-theme="..."] blocks below. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    --color-primary-900: #072034;
    --color-primary-800: #1c3141;
    --color-primary-700: #2f4657;
    --color-primary-600: #3f596f;
    --color-primary-500: #516f8a;
    --color-primary-400: #7392ae;
    --color-primary-300: #9db4cb;
    --color-primary-200: #c3d3e2;
    --color-primary-100: #e2ebf3;
    --color-primary-50: #f3f6fa;

    --color-tint-activo: #1c3141;
    --color-tint-texto: #9db4cb;

    --color-n900: #f0f1f3;
    --color-n800: #c9cdd2;
    --color-n700: #aab0b7;
    --color-n600: #8b929a;
    --color-n500: #6b727b;
    --color-n400: #4d545d;
    --color-n300: #3a4048;
    --color-n200: #2a2f37;
    --color-n100: #1c2127;
    --color-n50: #14181d;

    --color-easy-bg: #14532d;
    --color-easy-text: #86efac;
    --color-medium-bg: #78350f;
    --color-medium-text: #fde68a;
    --color-hard-bg: #7f1d1d;
    --color-hard-text: #fca5a5;
    --color-ai-bg: #4c1d95;
    --color-ai-text: #d8b4fe;
    --color-warn-bg: #7c2d12;
    --color-warn-text: #fed7aa;
  }
}

/* Explicit user choice: dark. Set by ThemeService (core/theme/theme.service.ts)
   via document.documentElement.setAttribute('data-theme', 'dark'). Wins over
   the media query above regardless of OS preference. */
:root[data-theme="dark"] {
  --color-primary-900: #072034;
  --color-primary-800: #1c3141;
  --color-primary-700: #2f4657;
  --color-primary-600: #3f596f;
  --color-primary-500: #516f8a;
  --color-primary-400: #7392ae;
  --color-primary-300: #9db4cb;
  --color-primary-200: #c3d3e2;
  --color-primary-100: #e2ebf3;
  --color-primary-50: #f3f6fa;

  --color-tint-activo: #1c3141;
  --color-tint-texto: #9db4cb;

  --color-n900: #f0f1f3;
  --color-n800: #c9cdd2;
  --color-n700: #aab0b7;
  --color-n600: #8b929a;
  --color-n500: #6b727b;
  --color-n400: #4d545d;
  --color-n300: #3a4048;
  --color-n200: #2a2f37;
  --color-n100: #1c2127;
  --color-n50: #14181d;

  --color-easy-bg: #14532d;
  --color-easy-text: #86efac;
  --color-medium-bg: #78350f;
  --color-medium-text: #fde68a;
  --color-hard-bg: #7f1d1d;
  --color-hard-text: #fca5a5;
  --color-ai-bg: #4c1d95;
  --color-ai-text: #d8b4fe;
  --color-warn-bg: #7c2d12;
  --color-warn-text: #fed7aa;
}

/* Explicit user choice: light. Restates the @theme defaults so an explicit
   "light" choice is guaranteed to win even if the OS prefers dark — kept
   symmetric with the dark block above rather than relying on cascade order
   against the @theme-emitted declaration. */
:root[data-theme="light"] {
  --color-primary-900: #272f52;
  --color-primary-800: #333d6b;
  --color-primary-700: #3f4d85;
  --color-primary-600: #4a5aa8;
  --color-primary-500: #5a6acf;
  --color-primary-400: #7c89d9;
  --color-primary-300: #9ea8e3;
  --color-primary-200: #c1c8ee;
  --color-primary-100: #dfe3f6;
  --color-primary-50: #f0f2fb;

  --color-tint-activo: #dfe3f6;
  --color-tint-texto: #5a6acf;

  --color-n50: #f7f8f9;
  --color-n100: #eceef1;
  --color-n200: #dde0e4;
  --color-n300: #c3c8ce;
  --color-n400: #a4abb3;
  --color-n500: #868d96;
  --color-n600: #6a717a;
  --color-n700: #4e545c;
  --color-n800: #363b41;
  --color-n900: #20242a;

  --color-easy-bg: #dcfce7;
  --color-easy-text: #166534;
  --color-medium-bg: #fef3c7;
  --color-medium-text: #92620a;
  --color-hard-bg: #fee2e2;
  --color-hard-text: #9f1239;
  --color-ai-bg: #f3e8ff;
  --color-ai-text: #6b21a8;
  --color-warn-bg: #fff8f1;
  --color-warn-text: #9a3412;
}

body {
  @apply font-sans bg-n50 text-n900;
}
```

- [ ] **Step 2: Run the full test suite to confirm no regressions**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS — every existing test still passes. This is a pure CSS token restructure; no `.ts`/`.html` file changed, so no test assertions about DOM structure, classes, or component behavior should be affected. (Do not run a file-scoped test command — it is known to fail on `initTestEnvironment` in this repo's exact setup.)

Note: visual verification (confirming both light and dark actually render correctly in a browser) is deferred to after Task 3, once the toggle button exists to flip `data-theme` — there is no automated visual/pixel regression check in this repo (design doc §5), and there is no way to manually flip `data-theme` before the toggle exists.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "feat(web): restructure theme tokens for light-default + dark override"
```

---

### Task 2: `ThemeService`

**Files:**

- Create: `apps/web/src/app/core/theme/theme.service.ts`
- Create: `apps/web/src/app/core/theme/theme.service.spec.ts`
- Modify: `apps/web/src/test-setup.ts` (add a `matchMedia` stub — jsdom doesn't implement it, and `ThemeService`'s constructor calls it)
- Modify: `apps/web/src/app/app.ts` (inject `ThemeService` for its constructor side effect)

**Interfaces:**

- Consumes: the `data-theme` attribute/CSS override mechanism Task 1 established (this task is the code that sets that attribute; it does not import anything from `styles.css`).
- Produces: `export type ThemeMode = 'light' | 'dark';` and `ThemeService` (`@Injectable({ providedIn: 'root' })`) with `readonly mode: Signal<ThemeMode>` and `toggle(): void`. Task 3 imports `ThemeService` from `../../core/theme/theme.service` and calls `themeService.mode()` / `themeService.toggle()`.

This task follows the codebase's existing `localStorage` convention exactly as seen in `apps/web/src/app/core/auth/auth.service.ts` — call `localStorage.getItem`/`setItem` directly, no wrapper/abstraction, and mirror it in the spec with real `localStorage` (no mocking), the same way `auth.service.spec.ts` does. There is no existing `matchMedia` precedent in this codebase, so this task establishes one: stub it via `vi.stubGlobal` per-test in the spec, with a project-wide default stub in `test-setup.ts` (mirroring the existing `ResizeObserverStub` there) so that any other spec which transitively constructs `ThemeService` (e.g. `app.spec.ts` in Task 2, `shell.component.spec.ts` if it ever forgot to fake `ThemeService`) doesn't crash with `TypeError: window.matchMedia is not a function`.

- [ ] **Step 1: Add a `matchMedia` stub to `test-setup.ts`**

Append to the end of `apps/web/src/test-setup.ts` (leave the existing `ResizeObserverStub` block untouched):

```ts
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
if (typeof globalThis.matchMedia === "undefined") {
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
```

- [ ] **Step 2: Write the failing tests — `apps/web/src/app/core/theme/theme.service.spec.ts`**

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ThemeService } from "./theme.service";

const THEME_STORAGE_KEY = "theme";

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  );
}

describe("ThemeService", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it('resolves a stored "dark" preference on construction and applies it to the DOM', () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    stubMatchMedia(false); // system prefers light — the stored value must still win

    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);

    expect(service.mode()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it('resolves a stored "light" preference on construction and applies it to the DOM', () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    stubMatchMedia(true); // system prefers dark — the stored value must still win

    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);

    expect(service.mode()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("falls back to the system preference via matchMedia when nothing is stored", () => {
    stubMatchMedia(true); // system prefers dark

    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);

    expect(service.mode()).toBe("dark");
    // No explicit choice yet — the CSS media query handles it; the service
    // must NOT set the attribute itself in this branch (design doc §2).
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("falls back to light when the system has no dark preference and nothing is stored", () => {
    stubMatchMedia(false);

    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);

    expect(service.mode()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("toggle() flips the signal, sets the DOM attribute, and persists to localStorage", () => {
    stubMatchMedia(false); // resolves to 'light' initially

    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);
    expect(service.mode()).toBe("light");

    service.toggle();

    expect(service.mode()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("toggle() back to light updates the DOM attribute and localStorage again", () => {
    stubMatchMedia(false);
    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);

    service.toggle(); // light -> dark
    service.toggle(); // dark -> light

    expect(service.mode()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
```

- [ ] **Step 3: Run the full test suite to verify the new tests fail**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — `theme.service.spec.ts` errors with "Cannot find module './theme.service'" (the file doesn't exist yet).

- [ ] **Step 4: Write the minimal implementation — `apps/web/src/app/core/theme/theme.service.ts`**

```ts
import { Injectable, signal } from "@angular/core";

export type ThemeMode = "light" | "dark";

/** Matches the design doc's mechanism example (§2) verbatim. */
const THEME_STORAGE_KEY = "theme";

/**
 * Owns the light/dark theme: resolves the initial mode (stored explicit
 * choice, else system preference via `matchMedia`), applies the `data-theme`
 * attribute to `document.documentElement` when there IS an explicit choice
 * (never for the system-preference fallback — that's left to the CSS media
 * query in `styles.css`), and persists explicit choices to `localStorage`.
 *
 * Injected once in the root `App` component (`app.ts`) purely for this
 * constructor side effect — so a previously-stored explicit choice is
 * applied before any route renders, including `/login` (`ShellComponent`,
 * which also injects this service to wire the topbar toggle button, is NOT
 * rendered for that route). Injected again in `ShellComponent` to back the
 * toggle button.
 */
@Injectable({ providedIn: "root" })
export class ThemeService {
  private readonly initialStoredMode = this.readStoredMode();

  readonly mode = signal<ThemeMode>(this.initialStoredMode ?? this.resolveSystemMode());

  constructor() {
    if (this.initialStoredMode !== null) {
      document.documentElement.setAttribute("data-theme", this.initialStoredMode);
    }
  }

  toggle(): void {
    const next: ThemeMode = this.mode() === "dark" ? "light" : "dark";
    this.mode.set(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }

  private resolveSystemMode(): ThemeMode {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  private readStoredMode(): ThemeMode | null {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  }
}
```

- [ ] **Step 5: Run the full test suite to verify the new tests pass**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS — all 6 `theme.service.spec.ts` tests pass, and every pre-existing test still passes (the `matchMedia` stub added in Step 1 is additive and guarded by `typeof globalThis.matchMedia === 'undefined'`, so it cannot affect any spec that already stubs its own).

- [ ] **Step 6: Wire eager initialization into the root `App` component**

Modify `apps/web/src/app/app.ts` (current full content: a signal-only component with no injected services):

```ts
import { Component, inject, signal } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { ThemeService } from "./core/theme/theme.service";

@Component({
  selector: "app-root",
  imports: [RouterOutlet],
  templateUrl: "./app.html",
  styleUrl: "./app.scss",
})
export class App {
  protected readonly title = signal("Exams Generator");

  /**
   * Injected for its constructor side effect only (see ThemeService's own
   * doc comment): applies any previously-stored explicit theme choice to
   * `document.documentElement` before any route renders. `App` wraps every
   * route via `<router-outlet>` (`app.html`), including `/login`, which
   * `ShellComponent` does not.
   */
  private readonly themeService = inject(ThemeService);
}
```

No change is needed to `apps/web/src/app/app.spec.ts`: its two existing tests provide only `provideRouter([])` and assert nothing about theming, so the real `ThemeService` gets constructed transparently — `localStorage.getItem('theme')` returns `null` in a clean jsdom environment and the `matchMedia` stub from Step 1 resolves the fallback branch to `'light'` without throwing.

- [ ] **Step 7: Run the full test suite once more to confirm `app.spec.ts` still passes unmodified**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS — both `App (root shell)` tests pass with no changes to `app.spec.ts` itself.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/core/theme/theme.service.ts \
        apps/web/src/app/core/theme/theme.service.spec.ts \
        apps/web/src/test-setup.ts \
        apps/web/src/app/app.ts
git commit -m "feat(web): add ThemeService with light/dark persistence and system-preference fallback"
```

---

### Task 3: Topbar theme toggle button

**Files:**

- Modify: `apps/web/src/app/features/shell/shell.component.ts`
- Modify: `apps/web/src/app/features/shell/shell.component.html`
- Modify: `apps/web/src/app/features/shell/shell.component.spec.ts`
- Modify: `apps/web/src/app/app.config.ts`

**Interfaces:**

- Consumes: `ThemeService` (`../../core/theme/theme.service`) — `readonly mode: Signal<ThemeMode>` and `toggle(): void` — from Task 2.
- Produces: a `[data-testid="theme-toggle-button"]` button in the shell topbar's `[actions]` slot. No later task depends on this.

**Icon-button styling convention** (from `notifications-button` in the current `shell.component.html`, reused verbatim for visual consistency): `relative flex h-8 w-8 items-center justify-center rounded-full text-n600 hover:bg-n100`.

- [ ] **Step 1: Write the failing test — modify `apps/web/src/app/features/shell/shell.component.spec.ts`**

Add `Sun`, `Moon` to the existing `lucide-angular` import list (currently `Menu, User, LogOut, X, Sparkles, Lock, Download, Ellipsis, Check, TriangleAlert, Search, School, Users, Trash2, Pencil, Archive, ChevronLeft, ChevronRight, ChevronDown, Plus, Minus, Bell, LayoutDashboard, BookOpen, FileText, Inbox, Settings`):

```ts
import {
  LucideAngularModule,
  Menu,
  User,
  LogOut,
  X,
  Sparkles,
  Lock,
  Download,
  Ellipsis,
  Check,
  TriangleAlert,
  Search,
  School,
  Users,
  Trash2,
  Pencil,
  Archive,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Minus,
  Bell,
  LayoutDashboard,
  BookOpen,
  FileText,
  Inbox,
  Settings,
  Sun,
  Moon,
} from "lucide-angular";
```

Add the `ThemeService` import next to the other service imports:

```ts
import { ThemeService } from "../../core/theme/theme.service";
```

Extend `setup()` to fake `ThemeService` (mirroring the existing `DraftCountService` fake) and register `Sun`/`Moon` in the pick, and return the `toggleTheme` spy:

```ts
function setup(role: Role | null, draftCount: number | null = 7) {
  const logout = vi.fn();
  const navigateByUrl = vi.fn();
  const toggleTheme = vi.fn();
  TestBed.configureTestingModule({
    imports: [ShellComponent],
    providers: [
      provideRouter([]),
      { provide: DraftCountService, useValue: { count: signal(draftCount) } },
      {
        provide: ThemeService,
        useValue: { mode: signal<"light" | "dark">("light"), toggle: toggleTheme },
      },
      importProvidersFrom(
        LucideAngularModule.pick({
          Menu,
          User,
          LogOut,
          X,
          Sparkles,
          Lock,
          Download,
          Ellipsis,
          Check,
          TriangleAlert,
          Search,
          School,
          Users,
          Trash2,
          Pencil,
          Archive,
          ChevronLeft,
          ChevronRight,
          ChevronDown,
          Plus,
          Minus,
          Bell,
          LayoutDashboard,
          BookOpen,
          FileText,
          Inbox,
          Settings,
          Sun,
          Moon,
        }),
      ),
      { provide: AuthService, useValue: { currentRole: signal(role), logout } },
      {
        provide: TenantSettingsService,
        useValue: {
          getSettings: () => of({ id: "t1", name: "San Marcos School", logoAssetId: null }),
        },
      },
      {
        provide: Router,
        useValue: {
          navigateByUrl,
          createUrlTree: () => ({}),
          serializeUrl: () => "",
          routerState: { root: {} },
          events: EMPTY,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ShellComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    logout,
    navigateByUrl,
    toggleTheme,
  };
}
```

Add the new test to the `describe('ShellComponent', ...)` block:

```ts
it("renders a theme toggle button that calls ThemeService.toggle() on click", () => {
  const { compiled, toggleTheme } = setup(Role.Teacher);

  const button = compiled.querySelector<HTMLButtonElement>('[data-testid="theme-toggle-button"]');
  expect(button).toBeTruthy();

  button!.click();
  expect(toggleTheme).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the full test suite to verify the new test fails**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — `[data-testid="theme-toggle-button"]` is not found (the button doesn't exist yet in `shell.component.html`).

- [ ] **Step 3: Implement — modify `apps/web/src/app/features/shell/shell.component.ts`**

Add the `ThemeService` import next to the other service imports:

```ts
import { ThemeService } from "../../core/theme/theme.service";
```

Add the injected service, a `themeMode` computed, and a `toggleTheme()` method — mirroring this file's existing `navGroups` computed and `toggleMobileMenu`/`toggleUserMenu` method conventions:

```ts
  private readonly draftCount = inject(DraftCountService);
  private readonly themeService = inject(ThemeService);
```

```ts
  protected readonly themeMode = computed(() => this.themeService.mode());
```

```ts
  protected toggleTheme(): void {
    this.themeService.toggle();
  }
```

- [ ] **Step 4: Implement — modify `apps/web/src/app/features/shell/shell.component.html`**

Add the toggle button immediately before the existing `notifications-button`, inside the `<div actions class="flex items-center gap-2">` wrapper:

```html
<button
  type="button"
  data-testid="theme-toggle-button"
  class="relative flex h-8 w-8 items-center justify-center rounded-full text-n600 hover:bg-n100"
  [attr.aria-label]="themeMode() === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'"
  (click)="toggleTheme()"
>
  @if (themeMode() === 'dark') {
  <lucide-angular name="sun" class="h-5 w-5"></lucide-angular>
  } @else {
  <lucide-angular name="moon" class="h-5 w-5"></lucide-angular>
  }
</button>
<button
  type="button"
  data-testid="notifications-button"
  class="relative flex h-8 w-8 items-center justify-center rounded-full text-n600 hover:bg-n100"
  aria-label="Notificaciones"
>
  <lucide-angular name="bell" class="h-5 w-5"></lucide-angular>
  <span class="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-hard-text"></span>
</button>
```

- [ ] **Step 5: Register `Sun`/`Moon` for the real bootstrapped app — modify `apps/web/src/app/app.config.ts`**

```ts
import {
  LucideAngularModule,
  Menu,
  X,
  Sparkles,
  Lock,
  Download,
  Ellipsis,
  Check,
  TriangleAlert,
  Search,
  School,
  LogOut,
  User,
  Users,
  Trash2,
  Pencil,
  Archive,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Minus,
  Bell,
  LayoutDashboard,
  BookOpen,
  FileText,
  Inbox,
  Settings,
  Sun,
  Moon,
} from "lucide-angular";
```

```ts
      LucideAngularModule.pick({
        Menu, X, Sparkles, Lock, Download, Ellipsis, Check, TriangleAlert, Search, School,
        LogOut, User, Users, Trash2, Pencil, Archive, ChevronLeft, ChevronRight, ChevronDown, Plus, Minus, Bell,
        LayoutDashboard, BookOpen, FileText, Inbox, Settings,
        Sun, Moon,
      }),
```

(This mirrors how `Bell` was originally registered in this same file for the notifications button — `app.config.ts` is only exercised by the real bootstrapped app, not by `shell.component.spec.ts`, which supplies its own `LucideAngularModule.pick({...})`, already updated in Step 1.)

- [ ] **Step 6: Run the full test suite to verify everything passes**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS — the new `theme toggle button` test passes, and every pre-existing `ShellComponent` test (including `renders a decorative notifications button...`) still passes since only a new sibling button was inserted before it.

- [ ] **Step 7: Manual visual verification (per design doc §5 — no automated visual regression test exists)**

Serve the app (`cd apps/web && pnpm exec ng serve`), open it in a browser, and:

1. Confirm the topbar shows a moon icon in light mode (the default) next to the bell icon.
2. Click it — confirm the whole app (sidebar, topbar, cards, tags) switches to dark colors matching the design doc's dark table, the icon becomes a sun, and no console errors appear.
3. Click it again — confirm it returns to light mode with no console errors.
4. Reload the page — confirm the last explicit choice persists (this is what `ThemeService`'s constructor + `localStorage` round-trip, verified in Task 2's unit tests, looks like end-to-end).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/features/shell/shell.component.ts \
        apps/web/src/app/features/shell/shell.component.html \
        apps/web/src/app/features/shell/shell.component.spec.ts \
        apps/web/src/app/app.config.ts
git commit -m "feat(web): add topbar theme toggle button wired to ThemeService"
```
