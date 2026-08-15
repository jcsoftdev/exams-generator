import { escapeTypstText } from "./escape-typst-text";

describe("escapeTypstText", () => {
  it("leaves plain prose untouched", () => {
    expect(escapeTypstText("¿Cuántos aprobaron por lo menos dos exámenes?")).toBe(
      "¿Cuántos aprobaron por lo menos dos exámenes?",
    );
  });

  it("escapes a lone underscore so base notation survives", () => {
    expect(escapeTypstText("Expresar 532_(6) en base 10.")).toBe("Expresar 532\\_(6) en base 10.");
  });

  it("escapes every underscore in a paired-emphasis trap", () => {
    expect(escapeTypstText("34_(n) + 15_(n) = 53_(n)")).toBe("34\\_(n) + 15\\_(n) = 53\\_(n)");
  });

  it("escapes a fill-in-the-blank run of underscores", () => {
    expect(escapeTypstText("el _______ en el mundo")).toBe("el \\_\\_\\_\\_\\_\\_\\_ en el mundo");
  });

  it("escapes a bare dollar sign so it is not read as math mode", () => {
    expect(escapeTypstText("x $ y = x + y")).toBe("x \\$ y = x + y");
  });

  it("escapes the hash that would start a code expression", () => {
    expect(escapeTypstText("El #3 de la lista")).toBe("El \\#3 de la lista");
  });

  it("escapes asterisks that would toggle strong emphasis", () => {
    expect(escapeTypstText("2 * 3 * 4")).toBe("2 \\* 3 \\* 4");
  });

  it("escapes backticks that would open a raw block", () => {
    expect(escapeTypstText("usa `codigo` aqui")).toBe("usa \\`codigo\\` aqui");
  });

  it("escapes angle brackets that would be read as a label", () => {
    expect(escapeTypstText("a <b> c")).toBe("a \\<b\\> c");
  });

  it("escapes at-signs that would be read as a reference", () => {
    expect(escapeTypstText("correo@dominio.com")).toBe("correo\\@dominio.com");
  });

  it("escapes square brackets that would open a content block", () => {
    expect(escapeTypstText("el intervalo [0, 1]")).toBe("el intervalo \\[0, 1\\]");
  });

  it("escapes the tilde that would become a non-breaking space", () => {
    expect(escapeTypstText("~5 minutos")).toBe("\\~5 minutos");
  });

  it("escapes a backslash without corrupting the escapes added around it", () => {
    expect(escapeTypstText("a \\ b_c")).toBe("a \\\\ b\\_c");
  });

  it("escapes a leading equals so it is not parsed as a heading", () => {
    expect(escapeTypstText("= 5 es la respuesta")).toBe("\\= 5 es la respuesta");
  });

  it("escapes a leading dash so it is not parsed as a list item", () => {
    expect(escapeTypstText("- primer caso")).toBe("\\- primer caso");
  });

  it("escapes a leading plus so it is not parsed as an enum item", () => {
    expect(escapeTypstText("+ primer caso")).toBe("\\+ primer caso");
  });

  it("escapes a leading slash so a verse line is not parsed as a term list", () => {
    expect(escapeTypstText("/ Aquel macho que huyó")).toBe("\\/ Aquel macho que huyó");
  });

  it("escapes a leading enum number so it is not parsed as an enum item", () => {
    expect(escapeTypstText("1. primer caso")).toBe("1\\. primer caso");
  });

  it("leaves a slash alone when it separates verses mid-line", () => {
    expect(escapeTypstText("débil, yerta, / chorreando sangre")).toBe("débil, yerta, / chorreando sangre");
  });

  it("leaves a decimal number alone when it is not at the start of a line", () => {
    expect(escapeTypstText("el valor es 3.14 exacto")).toBe("el valor es 3.14 exacto");
  });

  it("escapes line-start markers on every line, not just the first", () => {
    expect(escapeTypstText("Lea el texto:\n- primer caso\n= total")).toBe(
      "Lea el texto:\n\\- primer caso\n\\= total",
    );
  });

  it("escapes a line-start marker that follows leading whitespace", () => {
    expect(escapeTypstText("  - primer caso")).toBe("  \\- primer caso");
  });

  it("leaves dashes and equals alone when they are not at the start of a line", () => {
    expect(escapeTypstText("de 5 - 3 = 2")).toBe("de 5 - 3 = 2");
  });

  it("returns an empty string unchanged", () => {
    expect(escapeTypstText("")).toBe("");
  });
});
