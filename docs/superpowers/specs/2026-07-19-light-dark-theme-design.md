# Light/Dark Theme System — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

## 1. Goal

Introduce a real light/dark theme toggle. Light mode becomes the new default — the Figma-inspired indigo palette from the dashboard-layout-migration work. Dark mode reuses the app's original navy palette (no new design work for that ramp) plus a newly-designed dark-appropriate neutral scale and semantic-tag variants, since the original neutrals only ever pointed one direction (light background, dark text).

## 2. Mechanism

Tailwind v4's `@theme` block in `apps/web/src/styles.css` generates utility classes (`bg-primary-900`, `text-n600`, etc.) from CSS custom properties. The class names never change between modes — only the underlying custom-property *values* do, via CSS scoping:

```css
@theme {
  /* declares the tokens once, so Tailwind generates the utilities */
  --color-primary-900: #272f52; /* light-mode value, see below */
  ...
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    /* system-preference dark, only when the user hasn't chosen explicitly */
    --color-primary-900: #072034;
    ...
  }
}

:root[data-theme="dark"] {
  /* explicit user choice always wins over system preference */
  --color-primary-900: #072034;
  ...
}

:root[data-theme="light"] {
  --color-primary-900: #272f52;
  ...
}
```

A new `ThemeService` (`apps/web/src/app/core/theme/theme.service.ts`, `providedIn: 'root'`, signal-based):
- On construction, reads `localStorage.getItem('theme')` (`'light' | 'dark' | null`).
- If a stored value exists, sets `document.documentElement.setAttribute('data-theme', value)` immediately (before first paint is out of scope for this app — it's an authenticated SPA, not a marketing site, so a brief flash on first load is an acceptable tradeoff, not a defect to engineer around).
- Exposes `mode = signal<'light' | 'dark'>(...)` reflecting the resolved mode (stored value, or system preference via `matchMedia('(prefers-color-scheme: dark)')` if nothing stored).
- `toggle()`: flips the signal, sets the `data-theme` attribute, and persists to `localStorage`.

A new toggle button lives in the topbar, next to the notification bell (`apps/web/src/app/features/shell/shell.component.html`), rendering a sun icon in dark mode / moon icon in light mode (clicking it switches to the other), calling `ThemeService.toggle()`.

## 3. Token values

### `primary-*` ramp

| Token | Light (new, indigo) | Dark (reused navy) |
|---|---|---|
| 900 | `#272f52` | `#072034` |
| 800 | `#333d6b` | `#1c3141` |
| 700 | `#3f4d85` | `#2f4657` |
| 600 | `#4a5aa8` | `#3f596f` |
| 500 | `#5a6acf` (Figma exact accent) | `#516f8a` |
| 400 | `#7c89d9` | `#7392ae` |
| 300 | `#9ea8e3` | `#9db4cb` |
| 200 | `#c1c8ee` | `#c3d3e2` |
| 100 | `#dfe3f6` | `#e2ebf3` |
| 50 | `#f0f2fb` | `#f3f6fa` |

### `n*` neutral ramp

| Token | Light (unchanged) | Dark (new) |
|---|---|---|
| 900 (primary text) | `#20242a` | `#f0f1f3` |
| 800 | `#363b41` | `#c9cdd2` |
| 700 | `#4e545c` | `#aab0b7` |
| 600 | `#6a717a` | `#8b929a` |
| 500 | `#868d96` | `#6b727b` |
| 400 | `#a4abb3` | `#4d545d` |
| 300 | `#c3c8ce` | `#3a4048` |
| 200 (borders) | `#dde0e4` | `#2a2f37` |
| 100 (sidebar bg) | `#eceef1` | `#1c2127` |
| 50 (page bg) | `#f7f8f9` | `#14181d` |

### Nav active-pill (`tint-*`)

| Token | Light | Dark |
|---|---|---|
| `tint-activo` (pill bg) | `#dfe3f6` (= primary-100) | `#1c3141` (= primary-800) |
| `tint-texto` (pill text) | `#5a6acf` (= primary-500) | `#9db4cb` (= primary-300) |

### Semantic difficulty/status tags

| Token pair | Light (unchanged) | Dark (new) |
|---|---|---|
| easy-bg / easy-text | `#dcfce7` / `#166534` | `#14532d` / `#86efac` |
| medium-bg / medium-text | `#fef3c7` / `#92620a` | `#78350f` / `#fde68a` |
| hard-bg / hard-text | `#fee2e2` / `#9f1239` | `#7f1d1d` / `#fca5a5` |
| ai-bg / ai-text | `#f3e8ff` / `#6b21a8` | `#4c1d95` / `#d8b4fe` |
| warn-bg / warn-text | `#fff8f1` / `#9a3412` | `#7c2d12` / `#fed7aa` |

### Unchanged in both modes

- `paper-bg` / `paper-border` — represents literal paper (print preview), stays fixed regardless of theme, matching how print-preview looks in any app.
- `radius-field` / `radius-card` / `font-sans` — not color tokens.

## 4. Scope

- `styles.css`: restructure `@theme` block per above, add the media-query + attribute-selector override blocks.
- New: `core/theme/theme.service.ts` (+ spec).
- New: toggle button in `shell.component.html`, wired to `ThemeService`.
- No changes to component templates beyond the toggle button — every other screen (bank, exams, ai, settings, dashboard, login) inherits the new values automatically since they already reference these token names via Tailwind utility classes.
- Login hero panel (`login.component.html`): no changes — it already uses `primary-900`/`primary-800` etc., so it follows the global toggle automatically, per the earlier decision.

## 5. Testing

- `theme.service.spec.ts`: unit tests for — reads stored preference on init; falls back to system preference via `matchMedia` when nothing stored; `toggle()` flips the signal, sets the DOM attribute, and persists to `localStorage`.
- `shell.component.spec.ts`: new test asserting the toggle button renders and calls `ThemeService.toggle()` on click.
- No visual/pixel regression testing — verified via the same live-browser screenshot approach used for the dashboard-layout-migration work (Playwright, checking both modes render without console errors).

## 6. Out of scope

- Redesigning the login hero panel's structure (it just inherits new token values).
- A dedicated theme-settings page — the topbar toggle is the only control surface.
- Per-tenant or per-component theme overrides — one global toggle for the whole app.
