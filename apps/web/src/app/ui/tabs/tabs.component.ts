import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface TabItem<T = string> {
  readonly value: T;
  readonly label: string;
  /** Optional `data-testid` on the tab button — kept per-tab so existing specs (`tab-photo`, `tab-data`, ...) don't need renaming. */
  readonly testId?: string;
}

/**
 * Design-system tabs primitive (DECISION FE-4) — the underlined tab-strip
 * pattern hand-duplicated in `bank-new` and `tenant-settings` (audit P2).
 * Presentational only, `value`/`valueChange` (not a two-way `model`) because
 * both consumers run side effects on tab change (clearing errors, lazy
 * loading) that belong in the consumer, not this primitive.
 */
@Component({
  selector: 'ui-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-4 flex gap-1 border-b border-n200" role="tablist">
      @for (t of tabs(); track t.value) {
        <button
          type="button"
          role="tab"
          [attr.data-testid]="t.testId ?? null"
          [attr.aria-selected]="value() === t.value"
          class="px-4 py-2 text-sm font-medium"
          [class.border-b-2]="value() === t.value"
          [class.border-primary-500]="value() === t.value"
          [class.text-primary-700]="value() === t.value"
          [class.text-n500]="value() !== t.value"
          (click)="valueChange.emit(t.value)"
        >
          {{ t.label }}
        </button>
      }
    </div>
  `,
})
export class TabsComponent<T = string> {
  readonly tabs = input.required<readonly TabItem<T>[]>();
  readonly value = input.required<T>();

  readonly valueChange = output<T>();
}
