import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface SelectOption<T> {
  readonly value: T;
  readonly label: string;
}

/**
 * Design-system select primitive (DECISION FE-4). Generic `<T>` native
 * `<select>` with label/error slots and `model` two-way binding.
 */
@Component({
  selector: 'ui-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label()) {
      <label class="mb-1 block text-sm font-medium text-n700">{{ label() }}</label>
    }
    <select
      [disabled]="disabled()"
      (change)="onChange($event)"
      class="w-full rounded-field border border-n300 bg-white px-3 py-2 text-sm text-n900 disabled:cursor-not-allowed disabled:bg-n100"
    >
      @if (placeholder()) {
        <option value="" [selected]="value() === null">{{ placeholder() }}</option>
      }
      @for (option of options(); track option.value) {
        <option [value]="option.value" [selected]="option.value === value()">
          {{ option.label }}
        </option>
      }
    </select>
    @if (error()) {
      <p data-testid="select-error" class="mt-1 text-sm text-hard-text">{{ error() }}</p>
    }
  `,
})
export class SelectComponent<T = string> {
  readonly value = model<T | null>(null);
  readonly options = input<readonly SelectOption<T>[]>([]);
  readonly label = input<string>();
  readonly placeholder = input<string>();
  readonly disabled = input(false);
  readonly error = input<string>();

  protected onChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    const match = this.options().find((option) => String(option.value) === raw);
    this.value.set(match ? match.value : (raw as unknown as T));
  }
}
