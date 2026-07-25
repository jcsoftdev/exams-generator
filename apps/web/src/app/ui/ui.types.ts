/**
 * Shared type unions for the `ui/` design system (DECISION FE-3/FE-4).
 * Single source of truth imported by both primitives and their specs, and
 * by feature containers that compose them.
 */

export type ButtonVariant = 'primary' | 'ghost' | 'danger';

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

/** Simple-mode column definition for `ui/table`. */
export interface Column<T = unknown> {
  readonly key: string;
  readonly label: string;
  readonly render?: (row: T) => string;
}
