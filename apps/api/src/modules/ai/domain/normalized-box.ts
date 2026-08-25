/**
 * A rectangle in coordinates normalized to 0..1, relative to the image's own
 * width and height. Normalized rather than pixels because the vision model
 * never sees the original bytes: OpenRouter rescales the image before the
 * model reads it, so a pixel box the model reports means nothing against the
 * file we hold. A normalized box survives any resize on either side.
 */
export interface NormalizedBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A rectangle in whole pixels, ready to hand to an image library. */
export interface PixelRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * True only for a box that is fully inside the canvas and has real extent.
 * Model output goes through here before anything else touches it — a box
 * that fails this check is DISCARDED, never clamped: a model that reports
 * `w: 1.4` did not mean "the whole width", it hallucinated, and cropping a
 * clamped version of a hallucination just produces a confident-looking wrong
 * picture.
 */
export function isValidNormalizedBox(value: unknown): value is NormalizedBox {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const components = [candidate.x, candidate.y, candidate.w, candidate.h];
  if (!components.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return false;
  }
  const { x, y, w, h } = candidate as unknown as NormalizedBox;
  if (w <= 0 || h <= 0 || x < 0 || y < 0) {
    return false;
  }
  return x + w <= 1 && y + h <= 1;
}

/**
 * Projects a normalized box onto a concrete pixel grid. Guarantees a rect of
 * at least 1x1 that never spills past the image, so callers can hand the
 * result straight to an extract/crop call without re-checking bounds.
 */
export function toPixelRect(box: NormalizedBox, width: number, height: number): PixelRect {
  const left = Math.min(Math.max(Math.round(box.x * width), 0), Math.max(width - 1, 0));
  const top = Math.min(Math.max(Math.round(box.y * height), 0), Math.max(height - 1, 0));
  const rectWidth = Math.min(Math.max(Math.round(box.w * width), 1), width - left);
  const rectHeight = Math.min(Math.max(Math.round(box.h * height), 1), height - top);
  return { left, top, width: rectWidth, height: rectHeight };
}

/** Inverse of `toPixelRect` — turns a pixel rect back into a normalized box. */
export function toNormalizedBox(rect: PixelRect, width: number, height: number): NormalizedBox {
  return {
    x: rect.left / width,
    y: rect.top / height,
    w: rect.width / width,
    h: rect.height / height,
  };
}
