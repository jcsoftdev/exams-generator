/**
 * Shared type unions for the `ui/` design system (DECISION FE-3/FE-4).
 * Single source of truth imported by both primitives and their specs, and
 * by feature containers that compose them.
 */

export type ButtonVariant = 'primary' | 'ghost' | 'danger';

/**
 * `md` is the default page/dialog action size. `sm` exists for buttons that
 * sit INSIDE a dense row (a question row's "Cambiar", a job row's action):
 * at `md` they dominate the row they belong to. Size is deliberately not a
 * free-form class — it is the only axis feature code may shrink a button on.
 */
export type ButtonSize = 'md' | 'sm';

export type TagVariant = 'easy' | 'medium' | 'hard' | 'ai' | 'warning-stock';

export type BannerVariant = 'info' | 'success' | 'warning' | 'error';

/** One navigation item inside a sidebar `NavGroup` (design doc §4). */
export interface NavItem {
  readonly label: string;
  readonly route: string;
  readonly icon?: string;
  /** Optional pending-count pill rendered at the end of the label (e.g. "Cola de revisión · 7"). */
  readonly badge?: string | number;
}

/** One of the sidebar's three groups: Principal / Inteligencia / Colegio. */
export interface NavGroup {
  readonly title: string;
  readonly items: readonly NavItem[];
}
