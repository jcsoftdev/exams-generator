import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { BannerVariant } from '../ui.types';

/**
 * Design-system banner/alert primitive (DECISION FE-4). Solid fills only
 * (§3.3 — no gradients). Optional dismiss button.
 */
@Component({
  selector: 'ui-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
          ✕
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
