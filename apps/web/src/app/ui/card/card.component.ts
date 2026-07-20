import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Design-system card primitive (DECISION FE-4). Shell with optional
 * `[header]`/`[footer]` projection slots plus the default body slot.
 */
@Component({
  selector: 'ui-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="card" [class]="classes()">
      <div data-testid="card-header"><ng-content select="[header]"></ng-content></div>
      <ng-content></ng-content>
      <div data-testid="card-footer"><ng-content select="[footer]"></ng-content></div>
    </div>
  `,
})
export class CardComponent {
  readonly tone = input<'default' | 'muted'>('default');

  protected classes(): string {
    const base = 'rounded-card border border-n200 p-4';
    return this.tone() === 'muted' ? `${base} bg-n50` : `${base} bg-surface`;
  }
}
