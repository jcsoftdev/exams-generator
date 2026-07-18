import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Design-system progress primitive (DECISION FE-4, DS-R5). Renders a
 * proportional fill bar plus a "N de M" label. Guards against
 * division-by-zero when `total=0` (0% fill, no NaN).
 */
@Component({
  selector: 'ui-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-3">
      <div class="h-2 flex-1 overflow-hidden rounded-field bg-n200">
        <div
          data-testid="progress-fill"
          class="h-full bg-primary-500"
          [style.width.%]="fillPct()"
        ></div>
      </div>
      <span class="text-sm text-n600">{{ current() }} de {{ total() }}</span>
    </div>
  `,
})
export class ProgressComponent {
  readonly current = input.required<number>();
  readonly total = input.required<number>();

  protected readonly fillPct = computed(() => {
    const total = this.total();
    return total > 0 ? (this.current() / total) * 100 : 0;
  });
}
