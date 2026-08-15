import { findPrivateUseGlyph } from "./find-private-use-glyph";

const SYMBOL_ANGLE = String.fromCodePoint(0xf0d0);
const SYMBOL_PI = String.fromCodePoint(0xf070);

describe("findPrivateUseGlyph", () => {
  it("reports nothing for ordinary prose", () => {
    expect(findPrivateUseGlyph("Calcule el área del triángulo ABC")).toBeUndefined();
  });

  it("reports nothing for real Unicode math, which renders fine", () => {
    expect(findPrivateUseGlyph("m∠CBD = 30° y A ∩ B ≤ π")).toBeUndefined();
  });

  it("reports a legacy Symbol-font codepoint", () => {
    expect(findPrivateUseGlyph(`m${SYMBOL_ANGLE}CBD = 30°`)).toBe("U+F0D0");
  });

  it("reports the first offender when a statement carries several", () => {
    expect(findPrivateUseGlyph(`${SYMBOL_PI} y ${SYMBOL_ANGLE}`)).toBe("U+F070");
  });

  it("scans past the Basic Multilingual Plane without splitting surrogate pairs", () => {
    expect(findPrivateUseGlyph("𝜋 es pi")).toBeUndefined();
  });

  it("returns nothing for an empty string", () => {
    expect(findPrivateUseGlyph("")).toBeUndefined();
  });
});
