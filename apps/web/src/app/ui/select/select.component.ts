import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

export interface SelectOption<T> {
  readonly value: T;
  readonly label: string;
}

interface SelectListItem<T> {
  readonly value: T | null;
  readonly label: string;
  readonly isPlaceholder: boolean;
}

/**
 * Design-system select primitive (DECISION FE-4). Generic `<T>` custom
 * dropdown following the WAI-ARIA combobox/listbox authoring pattern —
 * a `<button role="combobox">` trigger plus an absolutely-positioned
 * `<ul role="listbox">` panel. Replaces the native `<select>`: its dropdown
 * panel renders with OS-native styling that can't be styled via CSS and
 * clashed with the design system. Public API (model/inputs) is unchanged
 * from the native-select version — every consumer keeps working as-is.
 */
@Component({
  selector: 'ui-select',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label()) {
      <!--
        Justified exemption: the label is wired to the trigger via
        \`aria-labelledby="labelId"\` (see the button below), which is the
        WAI-ARIA combobox authoring pattern this component follows. A \`for\`
        attribute would name the same control a second time and lose to
        \`aria-labelledby\` anyway. The rule only knows about \`for\`/wrapping.
      -->
      <!-- eslint-disable-next-line @angular-eslint/template/label-has-associated-control -->
      <label [id]="labelId" class="mb-1 block text-sm font-medium text-n700">{{ label() }}</label>
    }
    <div class="relative">
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listboxId"
        [attr.aria-activedescendant]="open() ? optionId(highlightedIndex()) : null"
        [attr.aria-labelledby]="ariaLabelledBy()"
        [attr.aria-required]="required() ? 'true' : null"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="error() ? errorId : null"
        [disabled]="disabled()"
        (click)="toggleOpen()"
        (keydown)="onTriggerKeydown($event)"
        class="flex w-full items-center justify-between gap-2 rounded-field border border-n300 bg-surface px-3 py-2 text-left text-sm text-n900 disabled:cursor-not-allowed disabled:bg-n100"
      >
        <span [id]="valueId" [class.text-n400]="!selectedOption()">{{ triggerLabel() }}</span>
        <lucide-angular name="chevron-down" class="h-4 w-4 shrink-0 text-n500"></lucide-angular>
      </button>

      @if (open()) {
        <ul
          [id]="listboxId"
          role="listbox"
          class="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-card border border-n200 bg-surface py-1 shadow-lg"
        >
          @for (item of listItems(); track $index; let i = $index) {
            <!--
              eslint-disable-next-line @angular-eslint/template/click-events-have-key-events,
              @angular-eslint/template/interactive-supports-focus -- WAI-ARIA combobox/listbox
              authoring pattern: options are intentionally NOT independently focusable. DOM
              focus stays on the trigger button; keyboard selection (ArrowUp/Down + Enter)
              is handled there via onTriggerKeydown and communicated to AT through
              aria-activedescendant. Adding tabindex/keydown here would break that pattern.
            -->
            <li
              [id]="optionId(i)"
              role="option"
              data-testid="select-option"
              [attr.aria-selected]="isSelected(item)"
              [class.bg-tint-active]="i === highlightedIndex()"
              class="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm text-n900 hover:bg-tint-active"
              (click)="selectItem(i)"
              (mouseenter)="highlightIndex(i)"
            >
              <span [class.text-n400]="item.isPlaceholder">{{ item.label }}</span>
              @if (isSelected(item)) {
                <lucide-angular
                  name="check"
                  class="h-4 w-4 shrink-0 text-primary-500"
                ></lucide-angular>
              }
            </li>
          }
        </ul>
      }
    </div>
    @if (error()) {
      <p [id]="errorId" data-testid="select-error" class="mt-1 text-sm text-hard-text">
        {{ error() }}
      </p>
    }
  `,
})
export class SelectComponent<T = string> {
  private static instanceCounter = 0;

  readonly value = model<T | null>(null);
  readonly options = input<readonly SelectOption<T>[]>([]);
  readonly label = input<string>();
  readonly placeholder = input<string>();
  readonly disabled = input(false);
  readonly error = input<string>();
  /** D4 (audit M11): "ningún campo marca `required`" — programmatic, not just visual/copy. */
  readonly required = input(false);

  private readonly elementRef: ElementRef<HTMLElement> = inject(ElementRef);

  protected readonly instanceId = `ui-select-${SelectComponent.instanceCounter++}`;
  protected readonly listboxId = `${this.instanceId}-listbox`;
  protected readonly labelId = `${this.instanceId}-label`;
  /** M14: the trigger's own visible text (placeholder or selected option) — referenced by `ariaLabelledBy` so it joins the label in the trigger's accessible name. */
  protected readonly valueId = `${this.instanceId}-value`;
  /** D4: mirrors `ui-input`'s `errorId` — links the trigger to the error text via `aria-describedby`. */
  protected readonly errorId = `${this.instanceId}-error`;

  protected readonly open = signal(false);
  protected readonly highlightedIndex = signal(-1);

  /** Combined list rendered in the panel: the placeholder (if any) as a selectable "no selection" entry, then every option. */
  protected readonly listItems = computed<readonly SelectListItem<T>[]>(() => {
    const items: SelectListItem<T>[] = [];
    const placeholder = this.placeholder();
    if (placeholder) {
      items.push({ value: null, label: placeholder, isPlaceholder: true });
    }
    for (const option of this.options()) {
      items.push({ value: option.value, label: option.label, isPlaceholder: false });
    }
    return items;
  });

  protected readonly selectedOption = computed(() => {
    const current = this.value();
    if (current === null) {
      return null;
    }
    return this.options().find((option) => option.value === current) ?? null;
  });

  protected readonly triggerLabel = computed(
    () => this.selectedOption()?.label ?? this.placeholder() ?? '',
  );

  /**
   * M14: the trigger's accessible name used to come from `label()` ALONE
   * ("Curso"), never the placeholder/selected option ("Elige un curso" /
   * "Matemática") — so two selects sharing a label sounded identical to
   * assistive tech. Referencing BOTH ids makes the computed name concatenate
   * to "Curso Elige un curso" / "Curso Matemática". `null` when there is no
   * external `label()` — same as before, so a label-less select still falls
   * back to the browser's default (the trigger's own text content).
   */
  protected readonly ariaLabelledBy = computed(() =>
    this.label() ? `${this.labelId} ${this.valueId}` : null,
  );

  protected optionId(index: number): string {
    return `${this.instanceId}-option-${index}`;
  }

  protected isSelected(item: SelectListItem<T>): boolean {
    return item.value === this.value();
  }

  protected highlightIndex(index: number): void {
    this.highlightedIndex.set(index);
  }

  protected toggleOpen(): void {
    if (this.disabled()) {
      return;
    }
    if (this.open()) {
      this.closeList();
    } else {
      this.openList();
    }
  }

  protected closeList(): void {
    this.open.set(false);
  }

  protected selectItem(index: number): void {
    const item = this.listItems()[index];
    if (!item) {
      return;
    }
    this.value.set(item.value);
    this.closeList();
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (this.disabled()) {
      return;
    }
    if (!this.open()) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.openList();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.moveHighlight(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveHighlight(-1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.selectItem(this.highlightedIndex());
        break;
      case 'Escape':
        event.preventDefault();
        this.closeList();
        break;
      case 'Tab':
        // Never trap focus — just close and let Tab move on naturally.
        this.closeList();
        break;
      default:
        break;
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.open()) {
      return;
    }
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.closeList();
    }
  }

  private openList(): void {
    const items = this.listItems();
    const current = this.value();
    const index = items.findIndex((item) => item.value === current);
    this.highlightedIndex.set(index >= 0 ? index : 0);
    this.open.set(true);
  }

  private moveHighlight(delta: number): void {
    const items = this.listItems();
    if (items.length === 0) {
      return;
    }
    const next = Math.min(Math.max(this.highlightedIndex() + delta, 0), items.length - 1);
    this.highlightedIndex.set(next);
  }
}
