import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

/**
 * Design-system topbar primitive (DECISION FE-4). `menuToggle` drives the
 * shell's mobile drawer; `[actions]` is a projection slot for screen-level
 * buttons (e.g. "Nueva pregunta"). Icons are lucide-angular only (no emojis
 * in UI — see docs/superpowers/specs/2026-07-18-ui-redesign-screens-design.md).
 * The search field (design doc §3, dashboard-layout-migration) is
 * deliberately NOT wired to any `input()`/`output()` yet — it's a visual
 * match for the Figma reference only; no search behavior is in scope here.
 */
@Component({
  selector: 'ui-topbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <header class="flex items-center justify-between gap-4 border-b border-n200 bg-white px-4 py-3">
      <div class="flex items-center gap-3">
        <button
          data-testid="topbar-menu-button"
          type="button"
          class="rounded-field p-2 hover:bg-n100 md:hidden"
          (click)="menuToggle.emit()"
          aria-label="Abrir menú"
        >
          <lucide-angular name="menu" class="h-5 w-5"></lucide-angular>
        </button>
        @if (title()) {
          <h1 class="text-base font-semibold text-n900">{{ title() }}</h1>
        }
      </div>
      <div class="hidden min-w-0 flex-1 justify-center px-6 md:flex">
        <div class="relative w-full max-w-sm">
          <lucide-angular
            name="search"
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-n400"
          ></lucide-angular>
          <input
            data-testid="topbar-search"
            type="search"
            placeholder="Buscar..."
            aria-label="Buscar"
            class="h-8 w-full rounded-field border-none bg-n50 pl-9 pr-3 text-sm text-n900 placeholder:text-n400 focus:outline-none focus:ring-2 focus:ring-primary-300"
          />
        </div>
      </div>
      <div class="flex items-center gap-2">
        <ng-content select="[actions]"></ng-content>
      </div>
    </header>
  `,
})
export class TopbarComponent {
  readonly title = input<string>();
  readonly menuToggle = output<void>();
}
