import { CROP_INK_PADDING_PX } from "./crop.constants";
import { NormalizedBox, PixelRect, toNormalizedBox, toPixelRect } from "./normalized-box";
import { TextWord } from "./ports/text-region-detector.port";
import { ImageRaster, inkThreshold } from "./snap-box-to-ink";

/** Tesseract's word box clips accents and descenders; erase a little wider than it reports. */
const TEXT_ERASE_PADDING_PX = 3;

/**
 * A surviving component has to clear BOTH floors, not an area threshold: a
 * long hairline — an underline, the edge of the sheet, a table rule — has area
 * to spare and is not a figure.
 */
const MIN_FIGURE_WIDTH = 0.03;
const MIN_FIGURE_HEIGHT = 0.02;

/**
 * The figures in a photographed question, found by subtraction: erase every
 * word the OCR located, and whatever ink survives in a big enough blob is a
 * drawing (design doc §5).
 *
 * ORDERING CONTRACT: the returned figures are always top-to-bottom. The
 * connected-component search scans the raster row-major, so a component is
 * discovered at its own topmost (then leftmost) pixel, and padding never
 * reorders them. `attributeFigureToAlternative` DEPENDS on this — it takes the
 * first figure in input order as the statement's complement and the first
 * figure per marker band as that alternative's drawing. Any `sort`/`filter`
 * added here has to preserve it.
 *
 * Two things make this return nothing rather than a guess:
 *   - an EMPTY word list. The algorithm is "erase the text, keep what is
 *     left"; with nothing erased it has no signal, and every blob of ink over
 *     the size floor — every handwritten word, every line of prose tesseract
 *     could not read — would come back as a "figure". OCR silence is not the
 *     same event as OCR success on a page without text.
 *   - a raster with too little contrast to separate ink from paper. See
 *     `inkThreshold`: a page we cannot threshold is a page we must not guess
 *     about.
 *
 * Pure: no OCR call, no image library. The raster comes from
 * `ImageCropperPort.raster` and the words from `TextRegionDetectorPort`.
 */
export function findFigureRegions(raster: ImageRaster, words: readonly TextWord[]): readonly NormalizedBox[] {
  if (words.length === 0) {
    return [];
  }

  // Derived from the ORIGINAL raster, not from the erased copy: `eraseText`
  // paints pure white over the words, which on a photograph would inflate the
  // brightest end of the span and drag the cutoff up towards the paper.
  const threshold = inkThreshold(raster, {
    left: 0,
    top: 0,
    width: raster.width,
    height: raster.height,
  });
  if (threshold === null) {
    return [];
  }

  const ink = eraseText(raster, words);
  const components = connectedComponents(ink, raster.width, raster.height, threshold);

  return (
    components
      // The floors are applied to the component's OWN box, before padding: a
      // speck must not be promoted into a figure by its own breathing room.
      .filter(
        (rect) =>
          rect.width / raster.width >= MIN_FIGURE_WIDTH && rect.height / raster.height >= MIN_FIGURE_HEIGHT,
      )
      .map((rect) =>
        toNormalizedBox(padToCanvas(rect, raster.width, raster.height), raster.width, raster.height),
      )
  );
}

/**
 * Breathing room around the ink so a stroke never touches the crop edge,
 * clamped to the canvas so the resulting normalized box stays inside 0..1.
 *
 * Deliberately an explicit step rather than a `snapBoxToInk` call: that
 * function exists to correct a vision model's loose aim, so it searches an
 * area grown by half the box on each axis. Handed a connected component's
 * EXACT box it can only expand — into the speck the size filter just dropped,
 * into a table rule, or into the neighbouring alternative's drawing.
 */
function padToCanvas(rect: PixelRect, width: number, height: number): PixelRect {
  const left = Math.max(rect.left - CROP_INK_PADDING_PX, 0);
  const top = Math.max(rect.top - CROP_INK_PADDING_PX, 0);
  const right = Math.min(rect.left + rect.width + CROP_INK_PADDING_PX, width);
  const bottom = Math.min(rect.top + rect.height + CROP_INK_PADDING_PX, height);
  return { left, top, width: right - left, height: bottom - top };
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

/**
 * Bounding box of every 4-connected blob of ink, found with an iterative flood
 * fill. `threshold` is the per-raster cutoff from `inkThreshold`, never an
 * absolute constant — see `findFigureRegions`.
 *
 * Scans row-major, which is what makes the returned rects top-to-bottom.
 */
function connectedComponents(ink: Uint8Array, width: number, height: number, threshold: number): PixelRect[] {
  const seen = new Uint8Array(ink.length);
  const rects: PixelRect[] = [];

  for (let start = 0; start < ink.length; start++) {
    if (seen[start] || ink[start]! > threshold) {
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
        if (next >= 0 && !seen[next] && ink[next]! <= threshold) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }

    rects.push({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
  }

  return rects;
}
