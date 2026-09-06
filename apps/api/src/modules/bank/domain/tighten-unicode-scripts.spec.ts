import { tightenUnicodeScripts } from "./tighten-unicode-scripts";

describe("tightenUnicodeScripts", () => {
  it("leaves prose without a script character untouched", () => {
    expect(tightenUnicodeScripts("Halla el residuo de la division.")).toBe(
      "Halla el residuo de la division.",
    );
  });

  it("leaves an already tight exponent alone", () => {
    expect(tightenUnicodeScripts("El area es 16 cm² exactos.")).toBe("El area es 16 cm² exactos.");
  });

  it("pulls a stranded exponent back onto its base", () => {
    expect(tightenUnicodeScripts("acelera a razon de 2m/s ² constante")).toBe(
      "acelera a razon de 2m/s² constante",
    );
  });

  it("joins a multi-digit exponent split across spaces", () => {
    expect(tightenUnicodeScripts("(3x ³ y + 2z²) ¹ ⁵")).toBe("(3x³ y + 2z²)¹⁵");
  });

  it("keeps the space that follows an exponent, since it separates factors", () => {
    expect(tightenUnicodeScripts("3x ³ y")).toBe("3x³ y");
  });

  it("tightens subscripts the same way, trailing space and all", () => {
    expect(tightenUnicodeScripts("una molecula de H ₂ O")).toBe("una molecula de H₂ O");
  });

  it("never pulls an exponent onto the previous line", () => {
    expect(tightenUnicodeScripts("x A = 4t\n² + 2t")).toBe("x A = 4t\n² + 2t");
  });

  it("leaves a line's own indentation in place", () => {
    expect(tightenUnicodeScripts("  ² es el exponente")).toBe("  ² es el exponente");
  });
});
