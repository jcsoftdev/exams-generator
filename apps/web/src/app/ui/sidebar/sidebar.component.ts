import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavGroup } from '../ui.types';

/**
 * Design-system sidebar primitive (DECISION FE-4, DS-R6). Renders the
 * groups passed in as DATA (role-based visibility is computed by the
 * shell container, not here). The active route is driven by
 * `RouterLinkActive` and carries the "tint activo" background token.
 */
@Component({
  selector: 'ui-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="flex h-full flex-col gap-8 bg-primary-900 p-4 text-primary-100">
      @for (group of groups(); track group.title) {
        <div>
          <p class="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-primary-300">
            {{ group.title }}
          </p>
          <ul class="flex flex-col gap-1">
            @for (item of group.items; track item.route) {
              <li>
                <a
                  data-testid="nav-item"
                  [routerLink]="item.route"
                  routerLinkActive="bg-tint-activo text-tint-texto"
                  [routerLinkActiveOptions]="{ exact: false }"
                  (click)="navigate.emit(item.route)"
                  class="flex h-[42px] items-center justify-between gap-2 rounded-field px-3 text-sm text-primary-100 hover:bg-primary-800"
                >
                  <span>{{ item.label }}</span>
                  @if (item.badge !== undefined) {
                    <span
                      data-testid="nav-item-badge"
                      class="rounded-full bg-primary-500 px-2 py-0.5 text-xs font-semibold text-white"
                      >{{ item.badge }}</span
                    >
                  }
                </a>
              </li>
            }
          </ul>
        </div>
      }
    </nav>
  `,
})
export class SidebarComponent {
  readonly groups = input.required<readonly NavGroup[]>();
  readonly navigate = output<string>();
}
