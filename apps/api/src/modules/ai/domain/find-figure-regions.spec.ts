import { findFigureRegions } from "./find-figure-regions";
import { ImageRaster } from "./snap-box-to-ink";
import { TextWord } from "./ports/text-region-detector.port";

const WHITE = 255;
const BLACK = 0;
const SIZE = 200;

/**
 * A 200x200 white raster with black rectangles painted into it, in pixel
 * terms. SIZE is large enough that the real thresholds (MIN_FIGURE_WIDTH =
 * 0.03, MIN_FIGURE_HEIGHT = 0.02) work out to whole pixels — 6px wide, 4px
 * tall — so the fixtures below can straddle them exactly instead of merely
 * scaling a smaller raster where the proportions never cross the floor.
 */
function raster(rects: readonly { left: number; top: number; width: number; height: number }[]): ImageRaster {
  const gray = new Uint8Array(SIZE * SIZE).fill(WHITE);
  for (const rect of rects) {
    for (let y = rect.top; y < rect.top + rect.height; y++) {
      for (let x = rect.left; x < rect.left + rect.width; x++) {
        gray[y * SIZE + x] = BLACK;
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

describe("findFigureRegions", () => {
  it("finds the single block of ink when there is no text at all", () => {
    // Figure occupies rows/cols 40..119 (80x80px) -> 0.4 x 0.4 normalized.
    const regions = findFigureRegions(raster([{ left: 40, top: 40, width: 80, height: 80 }]), []);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.x).toBeCloseTo(0.2, 5);
    expect(regions[0]!.y).toBeCloseTo(0.2, 5);
    expect(regions[0]!.w).toBeCloseTo(0.4, 5);
    expect(regions[0]!.h).toBeCloseTo(0.4, 5);
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
    expect(regions[0]!.x).toBeCloseTo(0.2, 5);
    expect(regions[0]!.y).toBeCloseTo(0.215, 5);
    expect(regions[0]!.w).toBeCloseTo(0.4, 5);
    expect(regions[0]!.h).toBeCloseTo(0.385, 5);
  });

  it("returns nothing when every bit of ink was text", () => {
    const ink = raster([{ left: 10, top: 10, width: 180, height: 30 }]);

    expect(findFigureRegions(ink, [word(10, 10, 180, 30)])).toEqual([]);
  });

  it("discards a speck below the size floor", () => {
    // 4x4px -> 0.02 x 0.02 normalized: width (0.02) is below the 0.03 floor.
    const regions = findFigureRegions(raster([{ left: 98, top: 98, width: 4, height: 4 }]), []);

    expect(regions).toEqual([]);
  });

  it("MUST: discards a wide hairline — a rule or a page edge has area but no height", () => {
    // 180x3px -> 0.9 x 0.015 normalized: huge area, but height (0.015) is
    // below the 0.02 floor.
    const regions = findFigureRegions(raster([{ left: 10, top: 100, width: 180, height: 3 }]), []);

    expect(regions).toEqual([]);
  });

  it("separates two figures that do not touch", () => {
    const regions = findFigureRegions(
      raster([
        { left: 10, top: 10, width: 60, height: 60 },
        { left: 120, top: 120, width: 60, height: 60 },
      ]),
      [],
    );

    expect(regions).toHaveLength(2);
    expect(regions[0]!.x).toBeCloseTo(0.05, 5);
    expect(regions[0]!.y).toBeCloseTo(0.05, 5);
    expect(regions[0]!.w).toBeCloseTo(0.3, 5);
    expect(regions[0]!.h).toBeCloseTo(0.3, 5);
    expect(regions[1]!.x).toBeCloseTo(0.6, 5);
    expect(regions[1]!.y).toBeCloseTo(0.6, 5);
    expect(regions[1]!.w).toBeCloseTo(0.3, 5);
    expect(regions[1]!.h).toBeCloseTo(0.3, 5);
  });

  it("ignores a word box that lies outside the canvas instead of throwing", () => {
    const wild: TextWord = { text: "x", box: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, confidence: 90 };

    expect(() =>
      findFigureRegions(raster([{ left: 40, top: 40, width: 80, height: 80 }]), [wild]),
    ).not.toThrow();
  });
});
