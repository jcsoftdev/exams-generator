import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Design-system table primitive (DECISION FE-4). Bespoke `[head]`/`[body]`
 * projection slots for freeform content (e.g. exam-builder's content
 * table).
 */
@Component({
  selector: 'ui-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <table class="w-full border-collapse text-left text-sm">
      <thead>
        <tr>
          <ng-content select="[head]"></ng-content>
        </tr>
      </thead>
      <tbody>
        <ng-content select="[body]"></ng-content>
      </tbody>
    </table>
  `,
})
export class TableComponent {}
