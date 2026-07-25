import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * Design-system pagination primitive (DECISION FE-4) — page/prev/next plus
 * a "N–M de TOTAL" summary. Purely presentational: page state and the
 * actual re-fetch live in the consumer (mirrors `ui-select`'s model-in-
 * consumer shape), this component only emits the page to move to.
 */
@Component({
  selector: 'ui-pagination',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (total() > pageSize()) {
      <div class="flex items-center justify-between gap-3 text-sm text-n600">
        <span data-testid="pagination-summary">{{ rangeStart() }}–{{ rangeEnd() }} de {{ total() }}</span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            data-testid="pagination-prev"
            class="rounded-field border border-n300 px-3 py-1 disabled:cursor-not-allowed disabled:opacity-40"
            [disabled]="page() <= 1"
            (click)="pageChange.emit(page() - 1)"
          >
            Anterior
          </button>
          <span data-testid="pagination-current" class="font-medium text-n800">{{ page() }} / {{ totalPages() }}</span>
          <button
            type="button"
            data-testid="pagination-next"
            class="rounded-field border border-n300 px-3 py-1 disabled:cursor-not-allowed disabled:opacity-40"
            [disabled]="page() >= totalPages()"
            (click)="pageChange.emit(page() + 1)"
          >
            Siguiente
          </button>
        </div>
      </div>
    }
  `,
})
export class PaginationComponent {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();

  readonly pageChange = output<number>();

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly rangeStart = computed(() => (this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1));
  protected readonly rangeEnd = computed(() => Math.min(this.page() * this.pageSize(), this.total()));
}
