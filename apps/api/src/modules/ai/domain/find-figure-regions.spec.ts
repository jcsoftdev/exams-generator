import { CROP_INK_PADDING_PX } from "./crop.constants";
import { findFigureRegions } from "./find-figure-regions";
import { ImageRaster } from "./snap-box-to-ink";
import { TextWord } from "./ports/text-region-detector.port";

const WHITE = 255;
const BLACK = 0;
const SIZE = 200;

/**
 * A 200x200 raster with rectangles painted into it, in pixel terms. SIZE is
 * large enough that the real thresholds (MIN_FIGURE_WIDTH = 0.03,
 * MIN_FIGURE_HEIGHT = 0.02) work out to whole pixels — 6px wide, 4px tall —
 * so the fixtures below can straddle them exactly instead of merely scaling a
 * smaller raster where the proportions never cross the floor.
 *
 * `paper` and `ink` default to a pure-white Typst render, which is what most
 * of these fixtures are; `greyRaster` below builds the photographed case.
 */
function raster(
  rects: readonly { left: number; top: number; width: number; height: number }[],
  { paper = WHITE, ink = BLACK }: { paper?: number; ink?: number } = {},
): ImageRaster {
  const gray = new Uint8Array(SIZE * SIZE).fill(paper);
  for (const rect of rects) {
    for (let y = rect.top; y < rect.top + rect.height; y++) {
      for (let x = rect.left; x < rect.left + rect.width; x++) {
        gray[y * SIZE + x] = ink;
      }
    }
  }
  return { gray, width: SIZE, height: SIZE };
}

/**
 * A phone photo of an exam sheet in warm indoor light: the paper is grey, it
 * is UNEVENLY lit (one corner brighter than the other), and most of it sits
 * below the absolute 160 an earlier revision of this file used as its ink
 * cutoff. Nothing here is near 255.
 */
function greyRaster(
  rects: readonly { left: number; top: number; width: number; height: number }[],
  { darkestPaper = 130, brightestPaper = 175, ink = 35 } = {},
): ImageRaster {
  const gray = new Uint8Array(SIZE * SIZE);
  const span = brightestPaper - darkestPaper;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      gray[y * SIZE + x] = darkestPaper + Math.round((span * (x + y)) / (2 * (SIZE - 1)));
    }
  }
  for (const rect of rects) {
    for (let y = rect.top; y < rect.top + rect.height; y++) {
      for (let x = rect.left; x < rect.left + rect.width; x++) {
        gray[y * SIZE + x] = ink;
      }
    }
  }
  return { gray, width: SIZE, height: SIZE };
}

function word(left: number, top: number, width: number, height: number): TextWord {
  return {
    text: "x",
    box: { x: left / SIZE, y: top / SIZE, w: width / SIZE, h: height / SIZE },
    confidence: 90,
  };
}

/**
 * One word in the very top-left corner, far from every figure in these
 * fixtures and small enough that its 3px erase padding reaches no further
 * than row/column 4.
 *
 * Present because an EMPTY word list is now a hard bail (`findFigureRegions`
 * returns nothing when the OCR reported no text at all), so a fixture that
 * wants to exercise the subtraction algorithm has to look like a page the OCR
 * actually read — which every real page is.
 */
const STRAY_WORD = word(0, 0, 2, 2);

/** Normalized box of a pixel rect after `CROP_INK_PADDING_PX` is added on all four sides. */
function padded(rect: { left: number; top: number; width: number; height: number }) {
  const left = Math.max(rect.left - CROP_INK_PADDING_PX, 0);
  const top = Math.max(rect.top - CROP_INK_PADDING_PX, 0);
  const right = Math.min(rect.left + rect.width + CROP_INK_PADDING_PX, SIZE);
  const bottom = Math.min(rect.top + rect.height + CROP_INK_PADDING_PX, SIZE);
  return { x: left / SIZE, y: top / SIZE, w: (right - left) / SIZE, h: (bottom - top) / SIZE };
}

function expectBox(
  actual: { x: number; y: number; w: number; h: number } | undefined,
  expected: ReturnType<typeof padded>,
) {
  expect(actual!.x).toBeCloseTo(expected.x, 5);
  expect(actual!.y).toBeCloseTo(expected.y, 5);
  expect(actual!.w).toBeCloseTo(expected.w, 5);
  expect(actual!.h).toBeCloseTo(expected.h, 5);
}

describe("findFigureRegions", () => {
  it("finds the single block of ink the OCR left behind", () => {
    const figure = { left: 40, top: 40, width: 80, height: 80 };

    const regions = findFigureRegions(raster([figure]), [STRAY_WORD]);

    expect(regions).toHaveLength(1);
    expectBox(regions[0], padded(figure));
  });

  it("MUST: erases the text and keeps only the figure", () => {
    // Ink band occupies rows 10..39, cols 10..189, covered exactly by a word
    // box. The figure sits directly below it (rows 40..119, cols 40..119),
    // touching with no gap. The word's 3px erase padding reaches 3px past
    // the band's own bottom edge (row 40) into the figure, so rows 40-42 of
    // the figure are wiped too: what survives is rows 43..119 (80x77px).
    const ink = raster([
      { left: 10, top: 10, width: 180, height: 30 },
      { left: 40, top: 40, width: 80, height: 80 },
    ]);

    const regions = findFigureRegions(ink, [word(10, 10, 180, 30)]);

    expect(regions).toHaveLength(1);
    expectBox(regions[0], padded({ left: 40, top: 43, width: 80, height: 77 }));
  });

  it("returns nothing when every bit of ink was text", () => {
    const ink = raster([{ left: 10, top: 10, width: 180, height: 30 }]);

    expect(findFigureRegions(ink, [word(10, 10, 180, 30)])).toEqual([]);
  });

  it("discards a speck below the size floor", () => {
    // 4x4px -> 0.02 x 0.02 normalized: width (0.02) is below the 0.03 floor.
    // The floor is applied to the component's own box, BEFORE padding — a
    // speck must not be promoted into a figure by its own breathing room.
    const regions = findFigureRegions(raster([{ left: 98, top: 98, width: 4, height: 4 }]), [STRAY_WORD]);

    expect(regions).toEqual([]);
  });

  it("MUST: discards a wide hairline — a rule or a page edge has area but no height", () => {
    // 180x3px -> 0.9 x 0.015 normalized: huge area, but height (0.015) is
    // below the 0.02 floor.
    const regions = findFigureRegions(raster([{ left: 10, top: 100, width: 180, height: 3 }]), [STRAY_WORD]);

    expect(regions).toEqual([]);
  });

  it("separates two figures that do not touch", () => {
    const first = { left: 10, top: 10, width: 60, height: 60 };
    const second = { left: 120, top: 120, width: 60, height: 60 };

    const regions = findFigureRegions(raster([first, second]), [STRAY_WORD]);

    expect(regions).toHaveLength(2);
    expectBox(regions[0], padded(first));
    expectBox(regions[1], padded(second));
  });

  it("returns the figures top-to-bottom — `attributeFigureToAlternative` relies on that order", () => {
    // Painted bottom-first on purpose: the order must come from the scan, not
    // from the order the caller happened to build the raster in.
    const regions = findFigureRegions(
      raster([
        { left: 120, top: 140, width: 40, height: 40 },
        { left: 20, top: 20, width: 40, height: 40 },
      ]),
      [STRAY_WORD],
    );

    expect(regions.map((box) => box.y)).toEqual([...regions.map((box) => box.y)].sort((a, b) => a - b));
    expect(regions[0]!.y).toBeLessThan(regions[1]!.y);
  });

  it("ignores a word box that lies outside the canvas instead of throwing", () => {
    const wild: TextWord = { text: "x", box: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, confidence: 90 };

    expect(() =>
      findFigureRegions(raster([{ left: 40, top: 40, width: 80, height: 80 }]), [wild]),
    ).not.toThrow();
  });

  describe("padding (CROP_INK_PADDING_PX)", () => {
    it("MUST: pads the component's exact box by exactly CROP_INK_PADDING_PX on all four sides", () => {
      const figure = { left: 50, top: 60, width: 40, height: 30 };

      const regions = findFigureRegions(raster([figure]), [STRAY_WORD]);

      expect(regions).toHaveLength(1);
      // Spelled out rather than derived, so the constant changing is visible here.
      expect(regions[0]!.x).toBeCloseTo((50 - 8) / SIZE, 5);
      expect(regions[0]!.y).toBeCloseTo((60 - 8) / SIZE, 5);
      expect(regions[0]!.w).toBeCloseTo((40 + 16) / SIZE, 5);
      expect(regions[0]!.h).toBeCloseTo((30 + 16) / SIZE, 5);
    });

    it("MUST: clamps the padding at the canvas edge instead of running past 0..1", () => {
      // Flush against the top-left corner and against the right edge, so the
      // padding has nowhere to go on three sides.
      const figure = { left: 0, top: 0, width: SIZE, height: 40 };

      const regions = findFigureRegions(raster([figure]), [word(190, 190, 4, 4)]);

      expect(regions).toHaveLength(1);
      expect(regions[0]!.x).toBe(0);
      expect(regions[0]!.y).toBe(0);
      expect(regions[0]!.x + regions[0]!.w).toBeLessThanOrEqual(1);
      expect(regions[0]!.y + regions[0]!.h).toBeLessThanOrEqual(1);
      expect(regions[0]!.w).toBeCloseTo(1, 5);
      expect(regions[0]!.h).toBeCloseTo((40 + 8) / SIZE, 5);
    });
  });

  describe("a photograph, not a Typst render", () => {
    it("MUST: finds the figure on a grey, unevenly lit page — and not the whole sheet", () => {
      // Every paper pixel here is between 130 and 175, i.e. mostly BELOW the
      // absolute 160 cutoff this file used to carry. With an absolute
      // threshold the sheet itself is ink, the page is one component, it
      // clears both size floors trivially and the "figure" is the photo.
      const figure = { left: 60, top: 60, width: 60, height: 60 };

      const regions = findFigureRegions(greyRaster([figure]), [STRAY_WORD]);

      expect(regions).toHaveLength(1);
      expectBox(regions[0], padded(figure));
      // Belt and braces: whatever else changes, this must never be the sheet.
      expect(regions[0]!.w).toBeLessThan(0.5);
      expect(regions[0]!.h).toBeLessThan(0.5);
    });

    it("MUST: returns nothing when the page has too little contrast to threshold at all", () => {
      // Uniform grey with a blob only 20 levels darker: below MIN_CONTRAST_SPAN,
      // so ink and paper are indistinguishable. A page we cannot threshold is a
      // page we must not guess about.
      const flat = greyRaster([{ left: 60, top: 60, width: 60, height: 60 }], {
        darkestPaper: 150,
        brightestPaper: 150,
        ink: 130,
      });

      expect(findFigureRegions(flat, [STRAY_WORD])).toEqual([]);
    });
  });

  describe("OCR silence", () => {
    it("MUST: returns nothing when the OCR reported no words at all", () => {
      // Handwriting, a crooked photo, a missing language pack: tesseract
      // returns nothing and no text gets erased, so every blob of ink over the
      // size floor would otherwise be reported as a "figure" — the teacher
      // gets crop slots full of prose. "Erase the text, keep what is left" has
      // no signal when nothing was erased.
      const ink = raster([
        { left: 10, top: 10, width: 180, height: 30 },
        { left: 40, top: 60, width: 80, height: 80 },
      ]);

      expect(findFigureRegions(ink, [])).toEqual([]);
    });
  });
});
