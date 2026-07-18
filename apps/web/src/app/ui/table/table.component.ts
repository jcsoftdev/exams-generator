import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Column } from '../ui.types';

/**
 * Design-system table primitive (DECISION FE-4). Supports two modes:
 * simple `columns`+`rows` (generic), or bespoke `[head]`/`[body]`
 * projection slots for freeform content (e.g. exam-builder's content
 * table). Simple mode is used only when `columns`/`rows` are provided.
 */
@Component({
  selector: 'ui-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <table class="w-full border-collapse text-left text-sm">
      @if (columns().length > 0) {
        <thead>
          <tr>
            @for (column of columns(); track column.key) {
              <th class="border-b border-n200 px-3 py-2 font-semibold text-n700">
                {{ column.label }}
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track $index) {
            <tr class="border-b border-n100">
              @for (column of columns(); track column.key) {
                <td class="px-3 py-2">{{ cell(row, column) }}</td>
              }
            </tr>
          }
        </tbody>
      } @else {
        <thead>
          <tr><ng-content select="[head]"></ng-content></tr>
        </thead>
        <tbody>
          <ng-content select="[body]"></ng-content>
        </tbody>
      }
    </table>
  `,
})
export class TableComponent<T = unknown> {
  readonly columns = input<readonly Column<T>[]>([]);
  readonly rows = input<readonly T[]>([]);

  protected cell(row: T, column: Column<T>): string {
    if (column.render) {
      return column.render(row);
    }
    const value = (row as Record<string, unknown>)[column.key];
    return value === null || value === undefined ? '' : String(value);
  }
}
