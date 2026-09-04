import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';

export interface BreadcrumbCrumb {
  readonly id: string;
  readonly label: string;
}

/**
 * The bank's trail of crumbs.
 *
 * The LAST crumb is deliberately not a button: it names the page the teacher
 * is already on, so making it activatable would announce a route change to a
 * screen reader for a navigation that never happens. It carries
 * `aria-current="page"` instead, which is what tells assistive tech where in
 * the trail we are.
 */
@Component({
  selector: 'ui-breadcrumb',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [LucideAngularModule.pick({ ChevronRight }).providers ?? []],
  template: `
    <nav aria-label="Ruta" class="flex flex-wrap items-center gap-2 text-sm text-n600">
      @for (crumb of items(); track crumb.id; let last = $last) {
        @if (last) {
          <span data-testid="breadcrumb-crumb" aria-current="page" class="font-semibold text-n900">
            {{ crumb.label }}
          </span>
        } @else {
          <button
            type="button"
            data-testid="breadcrumb-crumb"
            class="rounded-field font-medium text-tint-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            (click)="navigate.emit(crumb.id)"
          >
            {{ crumb.label }}
          </button>
          <lucide-angular
            name="chevron-right"
            aria-hidden="true"
            class="h-3.5 w-3.5 shrink-0 text-n300"
          ></lucide-angular>
        }
      }
    </nav>
  `,
})
export class BreadcrumbComponent {
  readonly items = input<readonly BreadcrumbCrumb[]>([]);

  /** The id of the crumb the teacher asked to go back to. */
  readonly navigate = output<string>();
}
