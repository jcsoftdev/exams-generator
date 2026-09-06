import { normalizeTypstMathSymbols } from "./normalize-typst-math-symbols";

describe("normalizeTypstMathSymbols", () => {
  it("leaves prose without a math span untouched", () => {
    expect(normalizeTypstMathSymbols("Un intervalo de 3 – 5 años.")).toBe("Un intervalo de 3 – 5 años.");
  });

  it("rewrites every dash inside a formula as a minus", () => {
    expect(normalizeTypstMathSymbols("Al dividir $(x^4 – 3x^2 − 9)$ entre $(x — 1)$")).toBe(
      "Al dividir $(x^4 - 3x^2 - 9)$ entre $(x - 1)$",
    );
  });

  it("leaves the dashes of the surrounding prose alone", () => {
    expect(normalizeTypstMathSymbols("El costo – dice el autor – es $x – 1$ soles.")).toBe(
      "El costo – dice el autor – es $x - 1$ soles.",
    );
  });

  it("leaves a run that is not a formula exactly as it stands", () => {
    expect(normalizeTypstMathSymbols("cuesta $ 4000 – 5000 pesos")).toBe("cuesta $ 4000 – 5000 pesos");
  });

  it("spells a numeric set the way Typst names it", () => {
    expect(normalizeTypstMathSymbols("con $x ∈ ℤ$ positivo")).toBe("con $x in ZZ$ positivo");
  });

  it("spells the relations Typst writes in ASCII", () => {
    expect(normalizeTypstMathSymbols("si $a ≠ 0$ y $b ≤ 3$")).toBe("si $a != 0$ y $b <= 3$");
  });

  it("names the operators Typst knows by word", () => {
    expect(normalizeTypstMathSymbols("resulta $3 × 4 ÷ 2$")).toBe("resulta $3 times 4 div 2$");
  });

  it("collapses the whitespace a substitution doubles up", () => {
    expect(normalizeTypstMathSymbols("$a ± b$")).toBe("$a plus.minus b$");
  });

  it("spells the Peruvian trigonometric names the way Typst defines them", () => {
    expect(normalizeTypstMathSymbols("Resolver $sen^2 x + cos^2 x = 1$")).toBe(
      "Resolver $sin^2 x + cos^2 x = 1$",
    );
    expect(normalizeTypstMathSymbols("$arcsen(1)$")).toBe("$arcsin(1)$");
  });

  it("splits a product of variables Typst would read as one unknown name", () => {
    expect(normalizeTypstMathSymbols("Halla $P = 2my^2 + ab$")).toBe("Halla $P = 2m y^2 + a b$");
  });

  it("keeps a numeric set and a dotted Typst name whole", () => {
    expect(normalizeTypstMathSymbols("$x ∉ ℤ$")).toBe("$x in.not ZZ$");
    expect(normalizeTypstMathSymbols("$A ∩ B$")).toBe("$A inter B$");
  });

  it("splits an identifier the scrape fused out of a name and a digit", () => {
    expect(normalizeTypstMathSymbols("$H2O$ y $log2 + g2x$")).toBe("$H 2 O$ y $log 2 + g 2 x$");
  });

  it("never edits inside a Typst string, which is text the author chose", () => {
    expect(normalizeTypstMathSymbols('$"Re"(z_2) + ab$')).toBe('$"Re"(z_2) + a b$');
  });

  it("resolves a name the scrape ran into the next one across a period", () => {
    expect(normalizeTypstMathSymbols("$6sen2x.cos2x$")).toBe("$6sin 2 x.cos 2 x$");
  });

  it("keeps the function names Typst already knows", () => {
    expect(normalizeTypstMathSymbols("$log(x) + tan(y)$")).toBe("$log(x) + tan(y)$");
  });
});
