import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

/**
 * Design-system topbar primitive (DECISION FE-4). `menuToggle` drives the
 * shell's mobile drawer; `[actions]` is a projection slot for screen-level
 * buttons (e.g. "Nueva pregunta"). Icons are lucide-angular only (no emojis
 * in UI — see docs/superpowers/specs/2026-07-18-ui-redesign-screens-design.md).
 * No search field here: there is no unified search endpoint to back it, and
 * a text box that swallows input silently is worse than no box at all
 * (audit P0 — "chrome decorativo que parece funcional").
 */
@Component({
  selector: 'ui-topbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <header
      class="flex items-center justify-between gap-4 border-b border-n200 bg-surface px-4 py-3"
    >
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
      <div class="flex flex-1 items-center gap-2 justify-end">
        <ng-content select="[actions]"></ng-content>
      </div>
    </header>
  `,
})
export class TopbarComponent {
  readonly title = input<string>();
  readonly menuToggle = output<void>();
}
