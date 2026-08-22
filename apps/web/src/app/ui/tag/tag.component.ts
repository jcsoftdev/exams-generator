import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TagVariant } from '../ui.types';

/**
 * Design-system tag/chip primitive (DECISION FE-4, DS-R3). Each of the 5
 * semantic variants maps to a STATIC class pair from the token theme —
 * colors are never computed at runtime.
 */
@Component({
  selector: 'ui-tag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <span data-testid="tag" [class]="classes()"><ng-content></ng-content></span> `,
})
export class TagComponent {
  readonly variant = input.required<TagVariant>();

  private static readonly BASE =
    'inline-flex items-center rounded-field px-2 py-0.5 text-xs font-medium';
  private static readonly VARIANT_CLASSES: Record<TagVariant, string> = {
    easy: 'bg-easy-bg text-easy-text',
    medium: 'bg-medium-bg text-medium-text',
    hard: 'bg-hard-bg text-hard-text',
    ai: 'bg-ai-bg text-ai-text',
    'warning-stock': 'bg-warn-bg text-warn-text',
  };

  protected classes(): string {
    return `${TagComponent.BASE} ${TagComponent.VARIANT_CLASSES[this.variant()]}`;
  }
}
