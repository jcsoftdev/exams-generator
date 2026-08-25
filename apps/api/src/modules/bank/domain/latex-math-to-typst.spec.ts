import { convertLatexMathRuns, latexMathToTypst } from "./latex-math-to-typst";

describe("latexMathToTypst", () => {
  it("leaves a run that has no LaTeX in it alone", () => {
    expect(latexMathToTypst("x^2 + 1")).toBe("x^2 + 1");
  });

  it("turns a display fraction into a Typst one", () => {
    expect(latexMathToTypst("\\dfrac{5}{4}")).toBe("(5)/(4)");
  });

  it("turns nested fractions into nested Typst ones", () => {
    expect(latexMathToTypst("N = \\beta^2 + \\dfrac{1}{\\beta^2}")).toBe("N = beta^2 + (1)/(beta^2)");
  });

  it("keeps a leading minus outside the fraction", () => {
    expect(latexMathToTypst("-\\dfrac{5}{3}")).toBe("-(5)/(3)");
  });

  it("turns a square root into a Typst call", () => {
    expect(latexMathToTypst("-\\sqrt{17}")).toBe("-sqrt(17)");
  });

  it("renames the greek letters Typst spells differently", () => {
    expect(latexMathToTypst("\\alpha + \\beta")).toBe("alpha + beta");
    expect(latexMathToTypst("\\varphi")).toBe("phi.alt");
  });

  it("writes sen as an upright operator, which Typst has no builtin for", () => {
    expect(latexMathToTypst("\\sen(\\pi)")).toBe('op("sen")(pi)');
  });

  it("uses the Typst builtins for the trig functions that have them", () => {
    expect(latexMathToTypst("\\tan\\theta")).toBe("tan theta");
    expect(latexMathToTypst("\\sec\\theta + \\cot\\theta")).toBe("sec theta + cot theta");
  });

  it("drops the sizing commands, which Typst does not need", () => {
    expect(latexMathToTypst("\\left(\\dfrac{\\pi}{2}\\right)")).toBe("((pi)/(2))");
  });

  it("keeps a brace set, dropping only its escapes", () => {
    expect(latexMathToTypst("\\{\\alpha,\\, \\beta\\}")).toBe("{alpha, thin beta}");
  });

  it("turns a blackboard set into its Typst shorthand", () => {
    expect(latexMathToTypst("x \\in \\mathbb{R}")).toBe("x in RR");
  });

  it("converts the relations that are punctuation in Typst", () => {
    expect(latexMathToTypst("a \\neq b \\pm c")).toBe("a != b plus.minus c");
  });

  it("converts a braced exponent into a parenthesised one", () => {
    expect(latexMathToTypst("x^{n+1}_{i}")).toBe("x^(n+1)_(i)");
  });

  it("converts the worst real statement in the bank", () => {
    const raw =
      "E = \\dfrac{-\\tan\\left(-\\dfrac{\\pi}{2}\\right) - 2\\sen(\\pi)\\cos(\\pi)}{\\cos\\left(\\dfrac{3\\pi}{2}\\right) - \\sen\\left(\\dfrac{\\pi}{2}\\right)}";

    expect(latexMathToTypst(raw)).toBe(
      'E = (-tan(-(pi)/(2)) - 2 op("sen")(pi) cos(pi))/(cos((3 pi)/(2)) - op("sen")((pi)/(2)))',
    );
  });

  it("refuses a run using a command it does not know, rather than guessing", () => {
    expect(latexMathToTypst("\\underbrace{x}")).toBeUndefined();
  });

  it("refuses a run whose braces do not balance", () => {
    expect(latexMathToTypst("\\dfrac{1}{2")).toBeUndefined();
  });
});

describe("convertLatexMathRuns", () => {
  it("rewrites a LaTeX run in place and leaves the prose around it", () => {
    expect(convertLatexMathRuns("Calcule $N = \\beta^2 + \\dfrac{1}{\\beta^2}$ si")).toBe(
      "Calcule $N = beta^2 + (1)/(beta^2)$ si",
    );
  });

  it("leaves a run that was already Typst untouched", () => {
    expect(convertLatexMathRuns("Calcula $cot(1/2 cdot arcsec(61/60))$")).toBe(
      "Calcula $cot(1/2 cdot arcsec(61/60))$",
    );
  });

  it("leaves currency dollars alone, since no formula is involved", () => {
    const raw = "un auto de $ 4840 y un capital $ 4000";

    expect(convertLatexMathRuns(raw)).toBe(raw);
  });

  it("leaves a LaTeX run it cannot fully translate exactly as it found it", () => {
    const raw = "Sea $\\underbrace{x}$ el valor";

    expect(convertLatexMathRuns(raw)).toBe(raw);
  });

  it("converts every run in a statement that has several", () => {
    expect(convertLatexMathRuns("$\\alpha$ y $\\dfrac{1}{2}$")).toBe("$alpha$ y $(1)/(2)$");
  });
});
