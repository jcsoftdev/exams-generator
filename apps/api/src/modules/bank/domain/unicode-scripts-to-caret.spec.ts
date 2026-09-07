import { unicodeScriptsToCaret } from "./unicode-scripts-to-caret";

describe("unicodeScriptsToCaret", () => {
  it("leaves prose without a script character untouched", () => {
    expect(unicodeScriptsToCaret("Halla el residuo de la division.")).toBe(
      "Halla el residuo de la division.",
    );
  });

  it("rewrites a single-digit exponent as a caret", () => {
    expect(unicodeScriptsToCaret("H(x) = 3x² + 5x + 7")).toBe("H(x) = 3x^2 + 5x + 7");
  });

  it("parenthesises a multi-character exponent so Typst reads it whole", () => {
    expect(unicodeScriptsToCaret("el termino x¹⁵ del binomio")).toBe("el termino x^(15) del binomio");
  });

  it("keeps the sign of a negative exponent inside the group", () => {
    expect(unicodeScriptsToCaret("evalue f⁻¹(1)")).toBe("evalue f^(-1)(1)");
  });

  it("rewrites the letter exponents the block spells out", () => {
    expect(unicodeScriptsToCaret("un polinomio de grado xⁿ")).toBe("un polinomio de grado x^n");
  });

  it("rewrites a subscript as an underscore", () => {
    expect(unicodeScriptsToCaret("una molecula de H₂O")).toBe("una molecula de H_2O");
  });

  it("parenthesises a multi-digit subscript the same way", () => {
    expect(unicodeScriptsToCaret("el termino a₁₂ de la sucesion")).toBe("el termino a_(12) de la sucesion");
  });

  it("rewrites every script in a polynomial", () => {
    expect(unicodeScriptsToCaret("D(x) = 6x⁵+ 13x⁴+ 4x³+ 9x²+ 13x − 2")).toBe(
      "D(x) = 6x^5+ 13x^4+ 4x^3+ 9x^2+ 13x − 2",
    );
  });

  it("leaves a script with no base before it alone, since a bare caret will not compile", () => {
    expect(unicodeScriptsToCaret("² es el exponente")).toBe("² es el exponente");
    expect(unicodeScriptsToCaret("mide 5 ² unidades")).toBe("mide 5 ² unidades");
  });

  it("accepts a closing bracket as a base", () => {
    expect(unicodeScriptsToCaret("(a + b)²")).toBe("(a + b)^2");
  });

  it("leaves a physical unit as a glyph, since a unit is not a formula", () => {
    expect(unicodeScriptsToCaret("acelera a razon de 2m/s² constante")).toBe(
      "acelera a razon de 2m/s² constante",
    );
    expect(unicodeScriptsToCaret("El area es 16 cm² exactos")).toBe("El area es 16 cm² exactos");
    expect(unicodeScriptsToCaret("mide 4 u² de area")).toBe("mide 4 u² de area");
  });

  it("still rewrites a variable whose coefficient sits against it", () => {
    expect(unicodeScriptsToCaret("el termino 16m² del polinomio")).toBe("el termino 16m^2 del polinomio");
  });

  it("declines a segment carrying LaTeX backslashes", () => {
    expect(unicodeScriptsToCaret("$\\alpha² + 1$")).toBe("$\\alpha² + 1$");
  });

  it("leaves the ordinal marker of a Spanish abbreviation alone", () => {
    expect(unicodeScriptsToCaret("el 1ᵉʳ termino")).toBe("el 1ᵉʳ termino");
  });
});
