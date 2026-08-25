import { splitTypstMathSpans } from "./split-typst-math-spans";

const kinds = (raw: string): string[] => splitTypstMathSpans(raw).map((segment) => segment.kind);

describe("splitTypstMathSpans", () => {
  it("returns one text segment when there is no dollar at all", () => {
    expect(splitTypstMathSpans("Hallar el area del triangulo.")).toEqual([
      { kind: "text", value: "Hallar el area del triangulo.", atLineStart: true },
    ]);
  });

  it("splits an authored math span out of the surrounding prose", () => {
    expect(splitTypstMathSpans("Calcula: $cot(1/2 cdot arcsec(61/60))$")).toEqual([
      { kind: "text", value: "Calcula: ", atLineStart: true },
      { kind: "math", value: "cot(1/2 cdot arcsec(61/60))", atLineStart: false },
    ]);
  });

  it("recognises a math span made only of a fraction", () => {
    expect(splitTypstMathSpans("gana $1/11$ del total")).toEqual([
      { kind: "text", value: "gana ", atLineStart: true },
      { kind: "math", value: "1/11", atLineStart: false },
      { kind: "text", value: " del total", atLineStart: false },
    ]);
  });

  it("recognises several math spans in one statement", () => {
    expect(splitTypstMathSpans("Si $f(x) = x^2$ entonces $f(3)$ vale")).toEqual([
      { kind: "text", value: "Si ", atLineStart: true },
      { kind: "math", value: "f(x) = x^2", atLineStart: false },
      { kind: "text", value: " entonces ", atLineStart: false },
      { kind: "math", value: "f(3)", atLineStart: false },
      { kind: "text", value: " vale", atLineStart: false },
    ]);
  });

  it("accepts every function name Typst math actually uses", () => {
    expect(kinds("$arcsen(x^2 - 1) + arccos(x) + sqrt(2) + emptyset$")).toEqual(["math"]);
  });

  it("keeps a money dollar as text when the run between two of them is prose", () => {
    const raw =
      "Una persona quiere comprar un auto que vale $ 4840. Durante cuanto tiempo debe prestar un capital $ 4000.";

    expect(splitTypstMathSpans(raw)).toEqual([{ kind: "text", value: raw, atLineStart: true }]);
  });

  it("keeps a trailing-currency dollar as text", () => {
    const raw = "El precio del barril bajo a los 39,85$, desde los 55,49$ del mes anterior.";

    expect(splitTypstMathSpans(raw)).toEqual([{ kind: "text", value: raw, atLineStart: true }]);
  });

  it("treats an unpaired dollar as text", () => {
    expect(splitTypstMathSpans("x $ y = x + y")).toEqual([
      { kind: "text", value: "x $ y = x + y", atLineStart: true },
    ]);
  });

  it("rejects a run holding a word that is not a Typst math identifier", () => {
    expect(kinds("gasto $500 mas$ de lo previsto")).toEqual(["text"]);
  });

  it("rejects a run that carries Spanish punctuation", () => {
    expect(kinds("cuesta $5 ¿cuanto?$ sobra")).toEqual(["text"]);
  });

  it("rejects a run that crosses a line break", () => {
    expect(kinds("vale $5\ny cuesta $6")).toEqual(["text"]);
  });

  it("leaves one- and two-letter variables free inside math", () => {
    expect(kinds("el valor de $A_B + ab - x$ es")).toEqual(["text", "math", "text"]);
  });

  it("flags only a segment whose first character opens a line", () => {
    expect(splitTypstMathSpans("$x$ = 5")).toEqual([
      { kind: "math", value: "x", atLineStart: true },
      { kind: "text", value: " = 5", atLineStart: false },
    ]);
  });

  it("does not flag a text segment that merely contains a later line break", () => {
    expect(splitTypstMathSpans("$x$\n= 5")).toEqual([
      { kind: "math", value: "x", atLineStart: true },
      { kind: "text", value: "\n= 5", atLineStart: false },
    ]);
  });

  it("rejects a LaTeX run, which Typst cannot compile", () => {
    expect(kinds("Sea $\\frac{\\alpha}{\\beta}$ el cociente")).toEqual(["text"]);
  });

  it("rejects LaTeX even when every command it names is also a Typst identifier", () => {
    expect(kinds("vale $\\sqrt{5} + \\pi$")).toEqual(["text"]);
  });

});
