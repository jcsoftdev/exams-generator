import { ChangeDetectionStrategy, Component, effect, input, output } from '@angular/core';
import { NormalizedBoxDto } from '@exams-generator/shared';

export type CropTarget =
  { readonly kind: 'figure' } | { readonly kind: 'alternative'; readonly alternativeIndex: number };

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
  /**
   * Set by `onPointerMove` once the pointer actually moves during this drag.
   * A `pointerdown` immediately followed by `pointerup` — a plain click on
   * the container, or a resize handle tapped and released — never sets it,
   * so `onPointerUp` has a way to tell "the teacher adjusted the box" apart
   * from "the teacher just clicked it" and skip the no-op `recrop`.
   */
  protected moved = false;

  /**
   * Local keyboard-edit state — mirrors `dragBox` but for the keyboard path
   * (Task audit H2): arrow presses accumulate here without touching the
   * server until Enter, and Escape discards them by removing the entry so
   * `boxFor` falls back to the slot's own (unedited) box.
   *
   * Keyed per target (audit crop-review #5) rather than a single pair — a
   * teacher who arrow-edits one slot and then moves focus to another must
   * not lose the first slot's in-progress edit; each target keeps its own
   * pending box until ITS OWN Enter or Escape resolves it.
   */
  private readonly pendingKeyEdits = new Map<string, NormalizedBoxDto>();

  constructor() {
    // A `slots` value from the caller is the server's own truth for every
    // box — any pending arrow-key edit still around from a PREVIOUS value
    // (e.g. a recrop that just landed, or the whole list being replaced) is
    // stale the moment that happens (audit crop-review #3).
    effect(() => {
      this.slots();
      this.pendingKeyEdits.clear();
    });
  }

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

  /**
   * The rectangle to draw for `slot` — the in-progress drag box while
   * dragging it, the in-progress keyboard edit while arrow-editing it,
   * otherwise its saved box.
   */
  protected boxFor(slot: CropSlot): NormalizedBoxDto {
    if (this.dragBox && this.dragTarget && sameTarget(this.dragTarget, slot.target)) {
      return this.dragBox;
    }
    const pending = this.pendingKeyEdits.get(targetKey(slot.target));
    if (pending) {
      return pending;
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

  protected startResize(
    event: PointerEvent,
    container: HTMLElement,
    slot: CropSlot,
    handle: ResizeHandle,
  ): void {
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
    this.moved = false;
    // Starting a drag supersedes any in-progress arrow-key edit on THIS
    // target — otherwise, once the drag ends and `dragBox` clears, `boxFor`
    // would fall through to the now-stale key edit instead of the slot's
    // real box (audit crop-review #3).
    this.pendingKeyEdits.delete(targetKey(slot.target));
    // Keep receiving move/up events even if the pointer leaves the container mid-drag.
    container.setPointerCapture?.(event.pointerId);
  }

  /**
   * The resize-handle wrapper's hit area for one axis (Task audit
   * crop-review #1). Starts at the WCAG-minimum 44px, same as before, but
   * shrinks along the axis the handle sits on — width for a handle on the
   * left/right edge, height for one on the top/bottom edge — once the box
   * itself is too small to fit two opposing 44px wrappers AND still leave a
   * real strip in the middle to grab-and-move: below ~68px of box, a fixed
   * 44px wrapper would leave less than `MOVE_STRIP_PX` of the box.
   *
   * Falls back to the full 44px when the container hasn't been measured yet
   * (`rect.width`/`rect.height` is 0 — no layout in jsdom unless a test
   * stubs `getBoundingClientRect`, or before the image has painted) rather
   * than collapsing every handle to the floor on a zero reading.
   */
  protected handleSize(
    container: HTMLElement,
    slot: CropSlot,
    handle: ResizeHandle,
  ): { readonly width: string; readonly height: string } {
    const rect = container.getBoundingClientRect();
    const box = this.boxFor(slot);
    const width =
      rect.width > 0 && (handle.includes('w') || handle.includes('e'))
        ? clampHandleDimension(box.w * rect.width)
        : HANDLE_MAX_PX;
    const height =
      rect.height > 0 && (handle.includes('n') || handle.includes('s'))
        ? clampHandleDimension(box.h * rect.height)
        : HANDLE_MAX_PX;
    return { width: `${width}px`, height: `${height}px` };
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
    this.moved = true;
  }

  protected onPointerUp(): void {
    // A click with no movement between pointerdown and pointerup — the
    // rectangle tapped, or a resize handle grabbed and released in place —
    // must NOT fire recrop: the box never changed, so it would be a wasted
    // HTTP round trip and a `busy` flash for nothing (Task 10).
    if (this.dragTarget && this.dragBox && this.moved) {
      this.applyBox(this.dragTarget, this.dragBox);
    }
    this.dragTarget = null;
    this.dragBox = null;
    this.dragMode = null;
    this.dragHandle = null;
    this.dragStartBox = null;
    this.moved = false;
  }

  /**
   * Keyboard path for moving/resizing the crop box (audit H2) — mirrors the
   * pointer path through the same `clampMove`/`clampResize` functions so it
   * can never produce a box the API would reject that a drag wouldn't.
   * Arrows move by 1% of the container (10% with Ctrl/Meta); Shift+Arrow
   * resizes from the box's own right/bottom edge, so Right/Down grow it and
   * Left/Up shrink it; Enter applies the edit exactly like the "Aplicar
   * recorte" button; Escape discards it back to the slot's own box.
   */
  protected onKeyDown(event: KeyboardEvent, slot: CropSlot): void {
    if (slot.busy) {
      return;
    }
    const current = this.pendingKeyEdits.get(targetKey(slot.target)) ?? slot.box;
    const step = event.ctrlKey || event.metaKey ? 0.1 : 0.01;

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.setKeyBox(
          slot.target,
          event.shiftKey ? clampResize(current, 'e', -step, 0) : clampMove(current, -step, 0),
        );
        return;
      case 'ArrowRight':
        event.preventDefault();
        this.setKeyBox(
          slot.target,
          event.shiftKey ? clampResize(current, 'e', step, 0) : clampMove(current, step, 0),
        );
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.setKeyBox(
          slot.target,
          event.shiftKey ? clampResize(current, 's', 0, -step) : clampMove(current, 0, -step),
        );
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.setKeyBox(
          slot.target,
          event.shiftKey ? clampResize(current, 's', 0, step) : clampMove(current, 0, step),
        );
        return;
      case 'Enter': {
        event.preventDefault();
        // No pending arrow-key edit for THIS target — e.g. Enter pressed
        // right after focusing the box, with no arrows pressed yet — must be
        // a no-op: applying `current` (which just falls back to the slot's
        // own unchanged box) would fire a wasted `recrop` round trip for a
        // box that never moved (audit crop-review #2).
        const pending = this.pendingKeyEdits.get(targetKey(slot.target));
        if (!pending) {
          return;
        }
        this.applyBox(slot.target, pending);
        this.pendingKeyEdits.delete(targetKey(slot.target));
        return;
      }
      case 'Escape':
        event.preventDefault();
        this.pendingKeyEdits.delete(targetKey(slot.target));
        return;
    }
  }

  private setKeyBox(target: CropTarget, box: NormalizedBoxDto): void {
    this.pendingKeyEdits.set(targetKey(target), box);
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
export function clampResize(
  box: NormalizedBoxDto,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): NormalizedBoxDto {
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
  return (
    a.kind === 'figure' ||
    a.alternativeIndex === (b as { alternativeIndex: number }).alternativeIndex
  );
}

/** String key for `CropTarget`, so it can be used in a `Map` (audit crop-review #5). */
function targetKey(target: CropTarget): string {
  return target.kind === 'figure' ? 'figure' : `alternative:${target.alternativeIndex}`;
}

/** WCAG-minimum resize-handle hit area, and the floor/strip constants `handleSize` shrinks between (audit crop-review #1). */
const HANDLE_MAX_PX = 44;
const HANDLE_MIN_PX = 8;
const MOVE_STRIP_PX = 24;

/** `boxDimensionPx` shrunk just enough to leave `MOVE_STRIP_PX` free, never past the [MIN, MAX] hit-area bounds. */
function clampHandleDimension(boxDimensionPx: number): number {
  return clamp(boxDimensionPx - MOVE_STRIP_PX, HANDLE_MIN_PX, HANDLE_MAX_PX);
}
