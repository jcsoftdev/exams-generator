import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * Design-system input primitive (DECISION FE-4). Renders label/control/
 * error slot; two-way binds via `model<string>()`. Presentational only.
 */
@Component({
  selector: 'ui-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label()) {
      <label class="mb-1 block text-sm font-medium text-n700">{{ label() }}</label>
    }
    <input
      [attr.name]="name() || null"
      [attr.type]="type()"
      [attr.placeholder]="placeholder() || null"
      [disabled]="disabled()"
      [value]="value()"
      (input)="onInput($event)"
      class="w-full rounded-field border border-n300 bg-white px-3 py-2 text-sm text-n900 disabled:cursor-not-allowed disabled:bg-n100"
    />
    @if (error()) {
      <p data-testid="input-error" class="mt-1 text-sm text-hard-text">{{ error() }}</p>
    }
  `,
})
export class InputComponent {
  readonly value = model<string>('');
  readonly label = input<string>();
  readonly placeholder = input<string>();
  readonly type = input<'text' | 'email' | 'password' | 'number'>('text');
  readonly error = input<string>();
  readonly disabled = input(false);
  readonly name = input<string>();

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
