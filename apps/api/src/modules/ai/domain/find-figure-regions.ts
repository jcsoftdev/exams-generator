import { NormalizedBox, toNormalizedBox, toPixelRect } from "./normalized-box";
import { TextWord } from "./ports/text-region-detector.port";
import { ImageRaster, snapBoxToInk } from "./snap-box-to-ink";

/** Tesseract's word box clips accents and descenders; erase a little wider than it reports. */
const TEXT_ERASE_PADDING_PX = 3;

/**
 * A surviving component has to clear BOTH floors, not an area threshold: a
 * long hairline — an underline, the edge of the sheet, a table rule — has area
 * to spare and is not a figure.
 */
const MIN_FIGURE_WIDTH = 0.03;
const MIN_FIGURE_HEIGHT = 0.02;

/** Same relative-contrast idea as `snapBoxToInk`: grey paper is not ink. */
const INK_THRESHOLD = 160;

/**
 * The figures in a photographed question, found by subtraction: erase every
 * word the OCR located, and whatever ink survives in a big enough blob is a
 * drawing (design doc §5).
 *
 * Pure: no OCR call, no image library. The raster comes from
 * `ImageCropperPort.raster` and the words from `TextRegionDetectorPort`.
 */
export function findFigureRegions(raster: ImageRaster, words: readonly TextWord[]): readonly NormalizedBox[] {
  const ink = eraseText(raster, words);
  const components = connectedComponents(ink, raster.width, raster.height);

  return components
    .map((rect) => toNormalizedBox(rect, raster.width, raster.height))
    .filter((box) => box.w >= MIN_FIGURE_WIDTH && box.h >= MIN_FIGURE_HEIGHT)
    .map((box) => snapBoxToInk({ ...raster, gray: ink }, box, 0));
}

/** A copy of the raster with every word's box (plus padding) painted white. */
function eraseText(raster: ImageRaster, words: readonly TextWord[]): Uint8Array {
  const ink = new Uint8Array(raster.gray);

  for (const word of words) {
    const clamped: NormalizedBox = {
      x: Math.max(word.box.x, 0),
      y: Math.max(word.box.y, 0),
      w: Math.min(word.box.w, 1 - Math.max(word.box.x, 0)),
      h: Math.min(word.box.h, 1 - Math.max(word.box.y, 0)),
    };
    if (clamped.w <= 0 || clamped.h <= 0) {
      continue;
    }

    const rect = toPixelRect(clamped, raster.width, raster.height);
    const left = Math.max(rect.left - TEXT_ERASE_PADDING_PX, 0);
    const top = Math.max(rect.top - TEXT_ERASE_PADDING_PX, 0);
    const right = Math.min(rect.left + rect.width + TEXT_ERASE_PADDING_PX, raster.width);
    const bottom = Math.min(rect.top + rect.height + TEXT_ERASE_PADDING_PX, raster.height);

    for (let y = top; y < bottom; y++) {
      ink.fill(255, y * raster.width + left, y * raster.width + right);
    }
  }

  return ink;
}

/** Bounding box of every 4-connected blob of ink, found with an iterative flood fill. */
function connectedComponents(
  ink: Uint8Array,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number }[] {
  const seen = new Uint8Array(ink.length);
  const rects: { left: number; top: number; width: number; height: number }[] = [];

  for (let start = 0; start < ink.length; start++) {
    if (seen[start] || ink[start]! > INK_THRESHOLD) {
      continue;
    }

    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    // An explicit stack, not recursion: a full-page figure would blow the call
    // stack on a large photo.
    const stack = [start];
    seen[start] = 1;

    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const next of neighbours) {
        if (next >= 0 && !seen[next] && ink[next]! <= INK_THRESHOLD) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }

    rects.push({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
  }

  return rects;
}
