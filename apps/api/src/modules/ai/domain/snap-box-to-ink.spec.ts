import { ImageRaster, snapBoxToInk } from "./snap-box-to-ink";

const WHITE = 255;
const BLACK = 0;

/**
 * Builds an 8x8 white raster and paints a black rectangle into it, so each
 * test can state its ink position in plain pixel terms.
 */
function rasterWithInk(rect: { left: number; top: number; width: number; height: number }): ImageRaster {
  const width = 8;
  const height = 8;
  const gray = new Uint8Array(width * height).fill(WHITE);
  for (let y = rect.top; y < rect.top + rect.height; y++) {
    for (let x = rect.left; x < rect.left + rect.width; x++) {
      gray[y * width + x] = BLACK;
    }
  }
  return { gray, width, height };
}

describe("snapBoxToInk", () => {
  it("shrinks a loose box down to the ink it contains", () => {
    // Ink occupies pixels x:2..3, y:2..3 of an 8x8 canvas.
    const raster = rasterWithInk({ left: 2, top: 2, width: 2, height: 2 });
    // The model reported the whole canvas.
    const snapped = snapBoxToInk(raster, { x: 0, y: 0, w: 1, h: 1 }, 0);

    expect(snapped).toEqual({ x: 2 / 8, y: 2 / 8, w: 2 / 8, h: 2 / 8 });
  });

  it("grows a box that cut the ink in half, up to the full ink bounds", () => {
    const raster = rasterWithInk({ left: 1, top: 1, width: 6, height: 6 });
    // The model's box covers only the top-left quarter of the ink.
    const snapped = snapBoxToInk(raster, { x: 0, y: 0, w: 0.5, h: 0.5 }, 0);

    expect(snapped).toEqual({ x: 1 / 8, y: 1 / 8, w: 6 / 8, h: 6 / 8 });
  });

  it("applies the padding around the ink bounds", () => {
    const raster = rasterWithInk({ left: 3, top: 3, width: 2, height: 2 });
    const snapped = snapBoxToInk(raster, { x: 0, y: 0, w: 1, h: 1 }, 1);

    expect(snapped).toEqual({ x: 2 / 8, y: 2 / 8, w: 4 / 8, h: 4 / 8 });
  });

  it("clamps the padding at the canvas edge instead of spilling", () => {
    const raster = rasterWithInk({ left: 0, top: 0, width: 2, height: 2 });
    const snapped = snapBoxToInk(raster, { x: 0, y: 0, w: 1, h: 1 }, 3);

    expect(snapped.x).toBe(0);
    expect(snapped.y).toBe(0);
    expect(snapped.x + snapped.w).toBeLessThanOrEqual(1);
    expect(snapped.y + snapped.h).toBeLessThanOrEqual(1);
  });

  it("returns the original box untouched when the search area has no ink", () => {
    const raster: ImageRaster = { gray: new Uint8Array(64).fill(WHITE), width: 8, height: 8 };
    const box = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

    expect(snapBoxToInk(raster, box, 2)).toEqual(box);
  });

  it("does not read a uniformly grey background as ink", () => {
    // A photo of grey paper: every pixel is 160, no darker mark anywhere.
    const raster: ImageRaster = { gray: new Uint8Array(64).fill(160), width: 8, height: 8 };
    const box = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

    expect(snapBoxToInk(raster, box, 0)).toEqual(box);
  });

  it("ignores ink outside the expanded search window instead of chasing it", () => {
    // A black bar spanning the FULL width at rows 2-3, on white paper.
    const raster = rasterWithInk({ left: 0, top: 2, width: 8, height: 2 });
    // The model pointed at a 2x2 patch: pixels x 2..3, y 2..3.
    const snapped = snapBoxToInk(raster, { x: 0.25, y: 0.25, w: 0.25, h: 0.25 }, 0);

    // Unclamped, the bar's ink bounds would be x 0..7 (w = 8/8). The search
    // window caps the horizontal reach at x 1..4, so the snap stops there.
    expect(snapped).toEqual({ x: 1 / 8, y: 2 / 8, w: 4 / 8, h: 2 / 8 });
  });
});
