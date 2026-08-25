import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NormalizedBoxDto } from '@exams-generator/shared';

export type CropTarget =
  | { readonly kind: 'figure' }
  | { readonly kind: 'alternative'; readonly alternativeIndex: number };

export interface CropSlot {
  readonly target: CropTarget;
  readonly label: string;
  readonly dataUrl: string;
  readonly box: NormalizedBoxDto;
  /** True while the API is re-cutting this slot — its controls are locked. */
  readonly busy: boolean;
}

/**
 * Lets the teacher fix a crop the vision model got wrong: the photo with a
 * draggable rectangle over it, the current cut beside it, and a way to throw
 * the whole slot away when the model saw a figure that is not there.
 *
 * Presentational only — it never calls the API. `bank-new` owns the HTTP and
 * feeds a new `slots` value back down, so this component holds no state that
 * could drift from what the server actually cut.
 */
@Component({
  selector: 'app-crop-review',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './crop-review.component.html',
})
export class CropReviewComponent {
  readonly photoUrl = input.required<string>();
  readonly slots = input.required<readonly CropSlot[]>();

  readonly recrop = output<{ target: CropTarget; box: NormalizedBoxDto }>();
  readonly discard = output<CropTarget>();

  /** The eight resize handles drawn on every slot's rectangle, in template render order. */
  protected readonly resizeHandles = RESIZE_HANDLES;

  /** Local drag state — never persisted, never fed back to the caller directly. */
  protected dragTarget: CropTarget | null = null;
  protected dragBox: NormalizedBoxDto | null = null;
  protected dragMode: 'move' | 'resize' | null = null;
  protected dragHandle: ResizeHandle | null = null;
  protected dragStartX = 0;
  protected dragStartY = 0;
  protected dragStartBox: NormalizedBoxDto | null = null;

  /** Called by the drag handler once the teacher lets go of the rectangle. */
  applyBox(target: CropTarget, box: NormalizedBoxDto): void {
    const slot = this.slots().find((candidate) => sameTarget(candidate.target, target));
    if (!slot || slot.busy) {
      return;
    }
    this.recrop.emit({ target, box });
  }

  protected removeSlot(target: CropTarget): void {
    this.discard.emit(target);
  }

  protected trackByLabel(_index: number, slot: CropSlot): string {
    return slot.label;
  }

  /** The rectangle to draw for `slot` — the in-progress drag box while dragging it, otherwise its saved box. */
  protected boxFor(slot: CropSlot): NormalizedBoxDto {
    if (this.dragBox && this.dragTarget && sameTarget(this.dragTarget, slot.target)) {
      return this.dragBox;
    }
    return slot.box;
  }

  protected startMove(event: PointerEvent, container: HTMLElement, slot: CropSlot): void {
    if (slot.busy) {
      return;
    }
    event.preventDefault();
    this.beginDrag(event, container, slot, 'move', null);
  }

  protected startResize(event: PointerEvent, container: HTMLElement, slot: CropSlot, handle: ResizeHandle): void {
    if (slot.busy) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.beginDrag(event, container, slot, 'resize', handle);
  }

  private beginDrag(
    event: PointerEvent,
    container: HTMLElement,
    slot: CropSlot,
    mode: 'move' | 'resize',
    handle: ResizeHandle | null,
  ): void {
    const rect = container.getBoundingClientRect();
    this.dragTarget = slot.target;
    this.dragStartBox = slot.box;
    this.dragBox = slot.box;
    this.dragMode = mode;
    this.dragHandle = handle;
    this.dragStartX = (event.clientX - rect.left) / rect.width;
    this.dragStartY = (event.clientY - rect.top) / rect.height;
    // Keep receiving move/up events even if the pointer leaves the container mid-drag.
    container.setPointerCapture?.(event.pointerId);
  }

  /** Percentage offsets for one resize handle, centered on the rectangle's corner/edge. */
  protected handlePosition(handle: ResizeHandle): { left: string; top: string } {
    const left = handle.includes('w') ? '0%' : handle.includes('e') ? '100%' : '50%';
    const top = handle.includes('n') ? '0%' : handle.includes('s') ? '100%' : '50%';
    return { left, top };
  }

  protected onPointerMove(event: PointerEvent, container: HTMLElement): void {
    if (!this.dragTarget || !this.dragStartBox || !this.dragMode) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const dx = x - this.dragStartX;
    const dy = y - this.dragStartY;

    this.dragBox =
      this.dragMode === 'move'
        ? clampMove(this.dragStartBox, dx, dy)
        : clampResize(this.dragStartBox, this.dragHandle!, dx, dy);
  }

  protected onPointerUp(): void {
    if (this.dragTarget && this.dragBox) {
      this.applyBox(this.dragTarget, this.dragBox);
    }
    this.dragTarget = null;
    this.dragBox = null;
    this.dragMode = null;
    this.dragHandle = null;
    this.dragStartBox = null;
  }
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const RESIZE_HANDLES: readonly ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Translates the box by (dx, dy), clamped so it never crosses the photo's
 * 0..1 edges. Exported so its boundary behavior — the guard against the API's
 * `isValidNormalizedBox` (which DISCARDS, not clamps, an out-of-canvas box)
 * — can be unit-tested directly rather than only through simulated drags.
 */
export function clampMove(box: NormalizedBoxDto, dx: number, dy: number): NormalizedBoxDto {
  const x = clamp(box.x + dx, 0, 1 - box.w);
  const y = clamp(box.y + dy, 0, 1 - box.h);
  return { x, y, w: box.w, h: box.h };
}

/**
 * Resizes the box from the dragged handle, clamped to 0..1 and to a minimum
 * size — the API rejects `w <= 0` / `h <= 0` outright, so a resize that would
 * collapse or invert an edge is stopped at `MIN` instead of ever reaching 0.
 * Exported for the same reason as `clampMove`.
 */
export function clampResize(box: NormalizedBoxDto, handle: ResizeHandle, dx: number, dy: number): NormalizedBoxDto {
  const MIN = 0.02;
  let { x, y, w, h } = box;
  const right = box.x + box.w;
  const bottom = box.y + box.h;

  if (handle.includes('w')) {
    x = clamp(box.x + dx, 0, right - MIN);
    w = right - x;
  }
  if (handle.includes('e')) {
    const newRight = clamp(right + dx, x + MIN, 1);
    w = newRight - x;
  }
  if (handle.includes('n')) {
    y = clamp(box.y + dy, 0, bottom - MIN);
    h = bottom - y;
  }
  if (handle.includes('s')) {
    const newBottom = clamp(bottom + dy, y + MIN, 1);
    h = newBottom - y;
  }

  return { x, y, w, h };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Exported because `bank-new` matches slots by target too — see Task 10. */
export function sameTarget(a: CropTarget, b: CropTarget): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  return a.kind === 'figure' || a.alternativeIndex === (b as { alternativeIndex: number }).alternativeIndex;
}
