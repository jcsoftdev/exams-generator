import { NormalizedBox, PixelRect, toNormalizedBox, toPixelRect } from "./normalized-box";

/** One luminance byte per pixel, row-major. */
export interface ImageRaster {
  readonly gray: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * How far past the model's own box the snap is allowed to grow, as a
 * fraction of that box's size on each axis. Without a cap, a box the model
 * mistakenly placed over a paragraph would find ink in every direction and
 * expand until it swallowed the whole page.
 */
const MAX_EXPANSION_RATIO = 0.5;

/**
 * How much darker than the search area's own brightest pixels a pixel must
 * be to count as ink. Relative, not absolute: a photo of grey paper has no
 * pixel near 255, and an absolute threshold would read the entire sheet as
 * ink.
 */
const INK_CONTRAST = 0.35;

/**
 * Minimum span (brightest - darkest) to distinguish ink from blank paper or uniform grey.
 */
const MIN_CONTRAST_SPAN = 32;

function searchArea(box: NormalizedBox, raster: ImageRaster): PixelRect {
  const expanded: NormalizedBox = {
    x: Math.max(box.x - box.w * MAX_EXPANSION_RATIO, 0),
    y: Math.max(box.y - box.h * MAX_EXPANSION_RATIO, 0),
    w: Math.min(box.w * (1 + MAX_EXPANSION_RATIO * 2), 1),
    h: Math.min(box.h * (1 + MAX_EXPANSION_RATIO * 2), 1),
  };
  const clamped: NormalizedBox = {
    ...expanded,
    w: Math.min(expanded.w, 1 - expanded.x),
    h: Math.min(expanded.h, 1 - expanded.y),
  };
  return toPixelRect(clamped, raster.width, raster.height);
}

/**
 * Reads the brightest and darkest luminance inside the area, and returns the
 * cutoff below which a pixel counts as ink — or `null` when the area has no
 * meaningful contrast at all (blank paper, uniform grey), which is the
 * caller's signal to leave the box alone.
 */
function inkThreshold(raster: ImageRaster, area: PixelRect): number | null {
  let darkest = 255;
  let brightest = 0;
  for (let y = area.top; y < area.top + area.height; y++) {
    for (let x = area.left; x < area.left + area.width; x++) {
      const value = raster.gray[y * raster.width + x]!;
      if (value < darkest) darkest = value;
      if (value > brightest) brightest = value;
    }
  }
  const span = brightest - darkest;
  if (span < MIN_CONTRAST_SPAN) {
    return null;
  }
  return darkest + span * INK_CONTRAST;
}

/**
 * Tightens (or loosens) a bounding box reported by the vision model until it
 * hugs the actual ink, then pads it.
 *
 * Vision models report loose coordinates: they clip half a stroke, or leave
 * three centimetres of white margin. This is the same algorithm the offline
 * harvest pipeline already uses (`tools/harvest/figure_bounds.py`), ported to
 * TypeScript so the live extraction path produces crops as even as the ones
 * we hand-cut for the seeded lots.
 *
 * Returns the ORIGINAL box untouched when the search area carries no ink —
 * an empty crop is the human's problem to fix by hand, not something this
 * function should guess at.
 */
export function snapBoxToInk(raster: ImageRaster, box: NormalizedBox, paddingPx: number): NormalizedBox {
  const area = searchArea(box, raster);
  const threshold = inkThreshold(raster, area);
  if (threshold === null) {
    return box;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = area.top; y < area.top + area.height; y++) {
    for (let x = area.left; x < area.left + area.width; x++) {
      if (raster.gray[y * raster.width + x]! <= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX === Number.POSITIVE_INFINITY) {
    return box;
  }

  const left = Math.max(minX - paddingPx, 0);
  const top = Math.max(minY - paddingPx, 0);
  const right = Math.min(maxX + paddingPx + 1, raster.width);
  const bottom = Math.min(maxY + paddingPx + 1, raster.height);

  return toNormalizedBox(
    { left, top, width: right - left, height: bottom - top },
    raster.width,
    raster.height,
  );
}
