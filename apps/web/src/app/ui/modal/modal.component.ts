import { ChangeDetectionStrategy, Component, ElementRef, effect, input, model, viewChild } from '@angular/core';

/**
 * Design-system modal primitive (DECISION FE-4). Backdrop-click and Esc
 * both close it (writing `open` back to false via the `model`).
 *
 * Implements a real focus trap: Tab/Shift+Tab are contained inside the
 * panel while it's open, focus moves into the panel on open and is
 * restored to whatever element triggered it once it closes (by Esc,
 * backdrop click, or an external action button flipping `open` to
 * false), and the panel is labelled via `aria-labelledby` when a
 * `title` is supplied.
 *
 * Background content is NOT made `inert`/`aria-hidden`. This component
 * isn't rendered through a portal — it projects `<ng-content>` and its
 * template lives inline inside the caller's own DOM, so it has no
 * reliable way to identify "the rest of the page" (siblings could sit
 * anywhere up the caller's ancestor chain). `fixed inset-0` plus the
 * backdrop already blocks pointer interaction with it; Tab is
 * contained explicitly instead, which doesn't require touching DOM
 * outside this component's own template.
 */
@Component({
  selector: 'ui-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <button
        type="button"
        data-testid="modal-backdrop"
        aria-label="Cerrar"
        class="fixed inset-0 z-40 block w-full border-0 bg-primary-900/40 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-300"
        (click)="close()"
      ></button>
      <div
        #panel
        data-testid="modal-panel"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        [attr.aria-labelledby]="title() ? titleId : null"
        class="fixed inset-0 z-50 m-auto h-fit w-fit max-w-lg rounded-card bg-surface p-6 shadow-lg"
        (keydown.escape)="close()"
        (keydown.tab)="onTab($event, false)"
        (keydown.shift.tab)="onTab($event, true)"
      >
        @if (title()) {
          <h2 [id]="titleId" class="mb-3 text-lg font-semibold text-n900">{{ title() }}</h2>
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
  private static instanceCounter = 0;

  private static readonly FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  readonly open = model(false);
  readonly title = input<string>();

  protected readonly instanceId = `ui-modal-${ModalComponent.instanceCounter++}`;
  protected readonly titleId = `${this.instanceId}-title`;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Element focused right before the modal opened; restored on close. Not a signal — it's a side effect of open(), not itself state to react to. */
  private triggerElement: HTMLElement | null = null;
  private wasOpen = false;

  constructor() {
    effect(() => {
      const isOpen = this.open();
      if (isOpen && !this.wasOpen) {
        this.triggerElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        queueMicrotask(() => this.panel()?.nativeElement.focus());
      } else if (!isOpen && this.wasOpen) {
        this.triggerElement?.focus();
        this.triggerElement = null;
      }
      this.wasOpen = isOpen;
    });
  }

  protected close(): void {
    this.open.set(false);
  }

  /** Keeps Tab/Shift+Tab cycling through the panel's own focusable elements instead of leaking into the page behind it. */
  protected onTab(event: Event, backward: boolean): void {
    const panelEl = this.panel()?.nativeElement;
    if (!panelEl) {
      return;
    }

    const focusable = Array.from(panelEl.querySelectorAll<HTMLElement>(ModalComponent.FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      // Nothing inside to tab to — keep focus pinned on the panel itself (tabindex="-1").
      event.preventDefault();
      panelEl.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (backward && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!backward && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
