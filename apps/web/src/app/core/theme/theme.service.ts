import { Injectable, Signal, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

/** Matches the design doc's mechanism example (§2) verbatim. */
const THEME_STORAGE_KEY = 'theme';

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
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly initialStoredMode = this.readStoredMode();

  private readonly _mode = signal<ThemeMode>(this.initialStoredMode ?? this.resolveSystemMode());
  readonly mode: Signal<ThemeMode> = this._mode.asReadonly();

  constructor() {
    if (this.initialStoredMode !== null) {
      document.documentElement.setAttribute('data-theme', this.initialStoredMode);
    }
  }

  toggle(): void {
    const next: ThemeMode = this._mode() === 'dark' ? 'light' : 'dark';
    this._mode.set(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }

  private resolveSystemMode(): ThemeMode {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private readStoredMode(): ThemeMode | null {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  }
}
