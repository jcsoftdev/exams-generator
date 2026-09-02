import { ChangeDetectionStrategy, Component, effect, inject, input, output } from '@angular/core';
import { LiveAnnouncerService } from '../live-region/live-announcer.service';
import { ButtonSize, ButtonVariant } from '../ui.types';

/**
 * Design-system button primitive (DECISION FE-4). Presentational only —
 * no HttpClient/service injection [beyond `LiveAnnouncerService`, itself a
 * presentational-safe signal bus with no HTTP of its own — see its doc].
 * `clicked` is suppressed whenever `disabled` or `loading` is true (DS-R2).
 * Label/icon are supplied via projected content, no default copy (DS-R7).
 */
@Component({
  selector: 'ui-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [attr.type]="htmlType()"
      [class]="classes()"
      [disabled]="disabled() || loading()"
      [attr.aria-label]="computedAriaLabel()"
      [attr.aria-disabled]="disabled() || loading() ? 'true' : null"
      [attr.aria-busy]="loading() ? 'true' : null"
      [attr.aria-describedby]="ariaDescribedBy() || null"
      (click)="onClick()"
    >
      <ng-content></ng-content>
      @if (loading()) {
        <!-- D3a (audit M12): loading toggled disabled but never told assistive
             tech WHY the click did nothing and nothing else changed — no
             aria-busy, no changed label. This is the sr-only equivalent of the
             spinner every loading variant already shows sighted users.

             Audit crop-review/button #9: when ariaLabel() IS set, this span
             never reaches the accessible name at all — aria-label wins the
             accname computation outright over content, sr-only or not. That
             case is handled instead by computedAriaLabel() folding
             ", cargando" straight into the attribute. -->
        <span class="sr-only">Cargando…</span>
      }
    </button>
  `,
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly htmlType = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
  readonly loading = input(false);
  /**
   * Overrides the accessible name when the visible text isn't enough on its
   * own — e.g. the builder grid's bridge actions, where "Elegir del banco"
   * repeats verbatim in every short cell and only the position says which cell
   * it belongs to (audit 2026-08-15).
   */
  readonly ariaLabel = input<string>();
  /**
   * D4 (audit M11): "Botón deshabilitado sin vínculo a la razón" — a disabled
   * button with a helper text nearby ("Necesita grado e imagen") has no
   * programmatic link between the two unless something passes that hint's id
   * through as `aria-describedby`. Passthrough only — the id itself is the
   * caller's to own (same pattern as `ui-input`'s `errorId`).
   */
  readonly ariaDescribedBy = input<string>();

  readonly clicked = output<void>();

  private readonly liveAnnouncer = inject(LiveAnnouncerService);

  constructor() {
    // Audit crop-review/button #9: `loading` already forces the native
    // `disabled` attribute and (via `computedAriaLabel`/the sr-only span)
    // the accessible name, but neither one is itself an INTERRUPTING signal
    // — a screen reader only picks up a name/state change on an element it
    // is currently focused on and re-inspects, and a disabled button often
    // isn't. Routing through `LiveAnnouncerService` makes "the button you
    // just pressed is now working on it" audible even then.
    //
    // Fires only on the FALSE -> TRUE transition: `effect()` re-runs when
    // its tracked signal's VALUE changes, so `loading()` staying `true`
    // across renders never re-triggers this — no duplicate announcements
    // for as long as it stays loading.
    effect(() => {
      if (this.loading()) {
        this.liveAnnouncer.announce('Cargando…');
      }
    });
  }

  /**
   * The accessible name once `loading()` is folded in (audit #9). Content-
   * based naming (no `ariaLabel()`) already gets this for free from the
   * sr-only "Cargando…" span rendered alongside the projected content — ARIA
   * accname concatenates them. `aria-label`, when present, instead REPLACES
   * content in the accname computation outright, so that span is invisible
   * to it; composing ", cargando" directly into the attribute is the only
   * way to expose the same state change on that path.
   */
  protected computedAriaLabel(): string | null {
    const label = this.ariaLabel();
    if (!label) {
      return null;
    }
    return this.loading() ? `${label}, cargando` : label;
  }

  private static readonly BASE =
    'inline-flex items-center justify-center gap-2 rounded-field text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60';
  private static readonly SIZE_CLASSES: Record<ButtonSize, string> = {
    md: 'px-4 py-2',
    // Matches the padding the exam-review row buttons already used before
    // they were migrated onto this primitive — shrinking the box only, never
    // the type size (a smaller label would fail the same contrast/legibility
    // bar the rest of the app holds).
    sm: 'px-3 py-1.5',
  };
  private static readonly VARIANT_CLASSES: Record<ButtonVariant, string> = {
    primary: 'bg-primary-500 hover:bg-primary-600 text-white',
    // Audit P1 #3: text-primary-500 was 3.08:1 in dark mode (surface bg) —
    // below AA. `--color-tint-text` is this app's existing token for
    // brand-colored text over surface/tint backgrounds (nav active state,
    // chips — see ui/sidebar, ui/banner) and its LIGHT value is identical to
    // primary-500's (#5a6acf), so light mode is pixel-for-pixel unchanged;
    // its DARK value (#9db4cb) clears AA (7.58:1 on bg-surface). Reusing it
    // here — rather than redefining --color-primary-500 in the dark block —
    // avoids relighting the unrelated bg-primary-500 usages (solid button,
    // progress fill, sidebar active state) that token also drives.
    ghost: 'bg-transparent text-tint-text border border-tint-text hover:bg-primary-50',
    // Reuses the existing hard-text token (already the app's red accent —
    // see ui-tag's "hard" difficulty and the forbidden page's icon) rather
    // than introducing a parallel red ramp.
    danger: 'bg-hard-text hover:opacity-90 text-white',
  };

  protected classes(): string {
    return `${ButtonComponent.BASE} ${ButtonComponent.SIZE_CLASSES[this.size()]} ${
      ButtonComponent.VARIANT_CLASSES[this.variant()]
    }`;
  }

  protected onClick(): void {
    if (this.disabled() || this.loading()) {
      return;
    }
    this.clicked.emit();
  }
}
