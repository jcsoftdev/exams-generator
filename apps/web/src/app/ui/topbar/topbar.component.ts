import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Design-system topbar primitive (DECISION FE-4). `menuToggle` drives the
 * shell's mobile drawer; `[actions]` is a projection slot for screen-level
 * buttons (e.g. "Nueva pregunta").
 */
@Component({
  selector: 'ui-topbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="flex items-center justify-between border-b border-n200 bg-white px-4 py-3">
      <div class="flex items-center gap-3">
        <button
          data-testid="topbar-menu-button"
          type="button"
          class="rounded-field p-2 hover:bg-n100 md:hidden"
          (click)="menuToggle.emit()"
          aria-label="Abrir menú"
        >
          ☰
        </button>
        @if (title()) {
          <h1 class="text-base font-semibold text-n900">{{ title() }}</h1>
        }
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
