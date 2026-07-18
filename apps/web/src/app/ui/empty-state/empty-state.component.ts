import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

/**
 * Design-system empty-state primitive (DECISION FE-4, DS-R4). The CTA is a
 * pure projection slot — it renders NOTHING when the caller projects no
 * `[cta]` content (no empty button shell), and supports one or two CTAs
 * (e.g. exam-builder's "Subir preguntas" + "Generar con IA" (sparkles icon)).
 *
 * `icon` is a lucide-angular icon name (kebab-case, e.g. "search"). No
 * emojis in UI (docs/superpowers/specs/2026-07-18-ui-redesign-screens-design.md).
 * This primitive only declares the `<lucide-icon>` selector — it does NOT
 * register any icon set. The CALLER component must register whichever
 * icon(s) it passes via `LucideAngularModule.pick(...)` in its own
 * `imports`; Angular DI resolves `<lucide-icon>` by walking up the
 * component-injector hierarchy, so the caller's registration is visible here.
 */
@Component({
  selector: 'ui-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div class="flex flex-col items-center gap-3 py-10 text-center">
      @if (icon()) {
        <div data-testid="empty-state-icon">
          <lucide-icon [name]="icon()!"></lucide-icon>
        </div>
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
