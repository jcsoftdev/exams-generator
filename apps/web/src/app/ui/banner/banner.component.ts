import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { BannerVariant } from '../ui.types';

/**
 * Design-system banner/alert primitive (DECISION FE-4). Solid fills only
 * (§3.3 — no gradients). Optional dismiss button. Icons are lucide-angular
 * only (no emojis in UI — see docs/superpowers/specs/2026-07-18-ui-redesign-screens-design.md).
 */
@Component({
  selector: 'ui-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `ModuleWithProviders` (from `.pick()`) is not valid inside a standalone
  // component's `imports` (NG2012) — the bare module goes in `imports` (so
  // the `<lucide-angular>` selector resolves) and its providers go in `providers`.
  imports: [LucideAngularModule],
  providers: [LucideAngularModule.pick({ X }).providers ?? []],
  template: `
    <div data-testid="banner" [class]="classes()">
      <p class="flex-1 text-sm">{{ message() }}</p>
      @if (dismissible()) {
        <button
          type="button"
          data-testid="banner-close"
          class="ml-3 text-sm font-medium"
          (click)="dismissed.emit()"
          aria-label="Cerrar"
        >
          <lucide-angular name="x" class="h-4 w-4"></lucide-angular>
        </button>
      }
    </div>
  `,
})
export class BannerComponent {
  readonly variant = input.required<BannerVariant>();
  readonly message = input.required<string>();
  readonly dismissible = input(false);

  readonly dismissed = output<void>();

  private static readonly BASE = 'flex items-center rounded-field px-4 py-3';
  private static readonly VARIANT_CLASSES: Record<BannerVariant, string> = {
    info: 'bg-tint-activo text-tint-texto',
    success: 'bg-easy-bg text-easy-text',
    warning: 'bg-medium-bg text-medium-text',
    error: 'bg-hard-bg text-hard-text',
  };

  protected classes(): string {
    return `${BannerComponent.BASE} ${BannerComponent.VARIANT_CLASSES[this.variant()]}`;
  }
}
