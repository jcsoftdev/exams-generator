import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonSize, ButtonVariant } from '../ui.types';

/**
 * Design-system button primitive (DECISION FE-4). Presentational only —
 * no HttpClient/service injection. `clicked` is suppressed whenever
 * `disabled` or `loading` is true (DS-R2). Label/icon are supplied via
 * projected content, no default copy (DS-R7).
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
      [attr.aria-disabled]="disabled() || loading() ? 'true' : null"
      (click)="onClick()"
    >
      <ng-content></ng-content>
    </button>
  `,
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly htmlType = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
  readonly loading = input(false);

  readonly clicked = output<void>();

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
    ghost: 'bg-transparent text-primary-500 border border-primary-500 hover:bg-primary-50',
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
