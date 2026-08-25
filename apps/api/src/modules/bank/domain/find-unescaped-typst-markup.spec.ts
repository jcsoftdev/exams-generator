import { escapeTypstText } from "./escape-typst-text";
import { findUnescapedTypstMarkup } from "./find-unescaped-typst-markup";

describe("findUnescapedTypstMarkup", () => {
  it("reports nothing for plain prose", () => {
    expect(findUnescapedTypstMarkup("¿Cuántos aprobaron dos exámenes?")).toBeUndefined();
  });

  it("reports a bare underscore", () => {
    expect(findUnescapedTypstMarkup("Expresar 532_(6) en base 10.")).toBe("_");
  });

  it("accepts an underscore that is already escaped", () => {
    expect(findUnescapedTypstMarkup("Expresar 532\\_(6) en base 10.")).toBeUndefined();
  });

  it("reports an underscore hiding behind an escaped backslash", () => {
    expect(findUnescapedTypstMarkup("a \\\\_b")).toBe("_");
  });

  it("reports a line-start marker", () => {
    expect(findUnescapedTypstMarkup("/ Aquel macho que huyó")).toBe("/");
  });

  it("accepts a slash that is not at the start of a line", () => {
    expect(findUnescapedTypstMarkup("yerta, / chorreando sangre")).toBeUndefined();
  });

  it("accepts anything escapeTypstText produced — the two must agree", () => {
    const nasty = "34_(n) = 53_(n)\n/ verso\n- item\n1. otro\nx $ y #z @w <a> ~b [c] `d` *e*";

    expect(findUnescapedTypstMarkup(escapeTypstText(nasty))).toBeUndefined();
  });

  it("accepts an authored math span, whose markup is the formula itself", () => {
    expect(findUnescapedTypstMarkup("Calcula: $cot(1/2 cdot arcsec(61/60))$")).toBeUndefined();
  });

  it("accepts the sub- and superscripts a formula needs", () => {
    expect(findUnescapedTypstMarkup("Sea $f(x) = x^2 + A_B$ la funcion")).toBeUndefined();
  });

  it("still reports bare markup sitting outside a math span", () => {
    expect(findUnescapedTypstMarkup("Sea $x^2$ y 532_(6)")).toBe("_");
  });

  it("still reports a currency dollar that no formula claimed", () => {
    expect(findUnescapedTypstMarkup("un auto de $ 4840 y un capital $ 4000")).toBe("$");
  });

  it("accepts a math-carrying statement round-tripped through escapeTypstText", () => {
    const mixed = "Calcula: $cot(1/2 cdot arcsec(61/60))$ si vale $ 4840 y 532_(6)\n- item";

    expect(findUnescapedTypstMarkup(escapeTypstText(mixed))).toBeUndefined();
  });
});
