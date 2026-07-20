import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
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
  imports: [RouterLink, RouterLinkActive, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="flex h-full flex-col gap-6 bg-n100 p-5 text-n900">
      <div class="flex items-center gap-2 px-2" data-testid="sidebar-logo">
        <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-500 text-xs font-bold text-white">
          E
        </span>
        <span class="text-xs font-bold tracking-wide text-n900">Exams Generator</span>
      </div>
      @for (group of groups(); track group.title) {
        <div>
          <p class="mb-3 px-3 text-xs font-semibold uppercase tracking-wide text-n500">
            {{ group.title }}
          </p>
          <ul class="flex flex-col">
            @for (item of group.items; track item.route) {
              <li>
                <a
                  data-testid="nav-item"
                  [routerLink]="item.route"
                  routerLinkActive="bg-tint-activo text-tint-texto"
                  [routerLinkActiveOptions]="{ exact: false }"
                  (click)="navigate.emit(item.route)"
                  class="flex h-[42px] items-center gap-2 rounded-field px-3 text-sm text-n700 hover:bg-n200"
                >
                  @if (item.icon) {
                    <lucide-angular [name]="item.icon" class="h-5 w-5 shrink-0"></lucide-angular>
                  }
                  <span class="flex-1">{{ item.label }}</span>
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
