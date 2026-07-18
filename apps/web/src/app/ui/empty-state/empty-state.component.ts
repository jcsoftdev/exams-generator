import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Design-system empty-state primitive (DECISION FE-4, DS-R4). The CTA is a
 * pure projection slot — it renders NOTHING when the caller projects no
 * `[cta]` content (no empty button shell), and supports one or two CTAs
 * (e.g. exam-builder's "Subir preguntas" + "✨ Generar con IA").
 */
@Component({
  selector: 'ui-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center gap-3 py-10 text-center">
      @if (icon()) {
        <div data-testid="empty-state-icon">{{ icon() }}</div>
      }
      <p class="text-sm text-n600">{{ message() }}</p>
      <div data-testid="empty-state-cta" class="flex gap-2">
        <ng-content select="[cta]"></ng-content>
      </div>
    </div>
  `,
})
export class EmptyStateComponent {
  readonly message = input.required<string>();
  readonly icon = input<string>();
}
