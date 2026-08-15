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
});
