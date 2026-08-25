import { isValidNormalizedBox, toPixelRect, toNormalizedBox } from "./normalized-box";

describe("isValidNormalizedBox", () => {
  it("accepts a box fully inside the 0..1 canvas", () => {
    expect(isValidNormalizedBox({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 })).toBe(true);
  });

  it("accepts a box that exactly fills the canvas", () => {
    expect(isValidNormalizedBox({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
  });

  it("rejects a box with a negative origin", () => {
    expect(isValidNormalizedBox({ x: -0.01, y: 0.2, w: 0.5, h: 0.4 })).toBe(false);
  });

  it("rejects a box with zero or negative extent", () => {
    expect(isValidNormalizedBox({ x: 0.1, y: 0.2, w: 0, h: 0.4 })).toBe(false);
    expect(isValidNormalizedBox({ x: 0.1, y: 0.2, w: 0.5, h: -0.1 })).toBe(false);
  });

  it("rejects a box that spills past the right or bottom edge", () => {
    expect(isValidNormalizedBox({ x: 0.8, y: 0.2, w: 0.3, h: 0.4 })).toBe(false);
    expect(isValidNormalizedBox({ x: 0.1, y: 0.9, w: 0.2, h: 0.2 })).toBe(false);
  });

  it("rejects non-finite numbers and non-objects", () => {
    expect(isValidNormalizedBox({ x: Number.NaN, y: 0.2, w: 0.5, h: 0.4 })).toBe(false);
    expect(isValidNormalizedBox({ x: 0.1, y: 0.2, w: Number.POSITIVE_INFINITY, h: 0.4 })).toBe(false);
    expect(isValidNormalizedBox(null)).toBe(false);
    expect(isValidNormalizedBox([0.1, 0.2, 0.5, 0.4])).toBe(false);
    expect(isValidNormalizedBox("0.1,0.2,0.5,0.4")).toBe(false);
  });

  it("rejects a box missing a component", () => {
    expect(isValidNormalizedBox({ x: 0.1, y: 0.2, w: 0.5 })).toBe(false);
  });
});

describe("toPixelRect", () => {
  it("scales and rounds the box to whole pixels", () => {
    // Deliberately non-coinciding left/top and width/height: a box that
    // accidentally produced left === top (or width === height) would let a
    // left/top or width/height transposition bug pass silently — Minor
    // Finding 9.
    expect(toPixelRect({ x: 0.1, y: 0.3, w: 0.2, h: 0.05 }, 800, 400)).toEqual({
      left: 80,
      top: 120,
      width: 160,
      height: 20,
    });
  });

  it("never returns a zero-sized rect for a very thin box", () => {
    const rect = toPixelRect({ x: 0, y: 0, w: 0.0001, h: 0.0001 }, 100, 100);
    expect(rect.width).toBeGreaterThanOrEqual(1);
    expect(rect.height).toBeGreaterThanOrEqual(1);
  });

  it("never returns a rect that spills past the image bounds", () => {
    const rect = toPixelRect({ x: 0.999, y: 0.999, w: 0.001, h: 0.001 }, 100, 100);
    expect(rect.left + rect.width).toBeLessThanOrEqual(100);
    expect(rect.top + rect.height).toBeLessThanOrEqual(100);
  });
});

describe("toNormalizedBox", () => {
  it("converts pixel rect back to normalized box (inverse of toPixelRect)", () => {
    // Same non-coinciding fixture as toPixelRect's test, for the same reason.
    expect(toNormalizedBox({ left: 80, top: 120, width: 160, height: 20 }, 800, 400)).toEqual({
      x: 0.1,
      y: 0.3,
      w: 0.2,
      h: 0.05,
    });
  });
});
