import { ChangeDetectionStrategy, Component, ElementRef, effect, input, model, viewChild } from '@angular/core';

/**
 * Design-system modal primitive (DECISION FE-4). Backdrop-click and Esc
 * both close it (writing `open` back to false via the `model`). A basic
 * focus trap moves focus into the panel when it opens.
 */
@Component({
  selector: 'ui-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div
        data-testid="modal-backdrop"
        class="fixed inset-0 z-40 bg-primary-900/40"
        (click)="close()"
      ></div>
      <div
        #panel
        data-testid="modal-panel"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        class="fixed inset-0 z-50 m-auto h-fit w-fit max-w-lg rounded-card bg-white p-6 shadow-lg"
        (keydown.escape)="close()"
      >
        @if (title()) {
          <h2 class="mb-3 text-lg font-semibold text-n900">{{ title() }}</h2>
        }
        <ng-content></ng-content>
        <div data-testid="modal-actions" class="mt-4 flex justify-end gap-2">
          <ng-content select="[actions]"></ng-content>
        </div>
      </div>
    }
  `,
})
export class ModalComponent {
  readonly open = model(false);
  readonly title = input<string>();

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    effect(() => {
      if (this.open()) {
        queueMicrotask(() => this.panel()?.nativeElement.focus());
      }
    });
  }

  protected close(): void {
    this.open.set(false);
  }
}
