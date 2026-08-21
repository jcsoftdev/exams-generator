import { stripStatementPollution } from "./strip-statement-pollution";

describe("stripStatementPollution", () => {
  it("cuts the previous exercise's option block off a términos-excluidos statement", () => {
    // 67 real rows look exactly like this; the question's own alternatives
    // (arquero, zaguero, …) live in the alternatives column and are fine.
    const scraped = [
      "FÚTBOL",
      "",
      "Texto:",
      "A) palabra",
      "B) frase",
      "C) inferencia",
      "D) oración",
      "E) párrafo",
      "SOLUCIÓN: Se denomina texto al enunciado o conjunto coherente de enunciados. Rpta. C",
    ].join("\n");

    expect(stripStatementPollution(scraped)).toBe("FÚTBOL");
  });

  it("leaves a reading-comprehension statement that legitimately starts with 'Texto:'", () => {
    const body = "Texto:\nLa fotosíntesis es el proceso por el cual las plantas producen su alimento.";

    expect(stripStatementPollution(body)).toBe(body);
  });

  it("removes a Solucionario dropped into the middle of a sentence", () => {
    expect(
      stripStatementPollution(
        "Las víctimas casi nunca mueren, pero en sus Solucionario cerebros queda el rechazo.",
      ),
    ).toBe("Las víctimas casi nunca mueren, pero en sus cerebros queda el rechazo.");

    // Same defect, followed by a comma rather than a word.
    expect(
      stripStatementPollution("Tiene haustorios Solucionario , raíces especializadas para sujetarse."),
    ).toBe("Tiene haustorios , raíces especializadas para sujetarse.");
  });

  it("cuts a marker that trails the statement", () => {
    expect(
      stripStatementPollution("Se deduce que sus propietarios no son conscientes del daño. Solucionario"),
    ).toBe("Se deduce que sus propietarios no son conscientes del daño.");
    expect(stripStatementPollution("¿Cuál es la capital del Perú? Rpta. Lima")).toBe(
      "¿Cuál es la capital del Perú?",
    );
  });

  it("leaves a statement that merely talks about a resolution", () => {
    // Real rows: both survived only because the rules are anchored, not loose.
    for (const body of [
      "La Declaración Universal de los Derechos Humanos fue aceptada en su Resolución 217 – A, del 10 de diciembre de 1948.",
      "El alcalde se rehusó a cumplir el pacto colectivo 2014 y la resolución 477, por lo cual interpuso una garantía.",
      "COHIPÓNIMOS 1. estructura 2. Método de resolución 3. Etimología",
    ]) {
      expect(stripStatementPollution(body)).toBe(body);
    }
  });

  it("keeps the original when cleaning would leave nothing", () => {
    // A statement that was never captured is a row to look at, not to blank.
    expect(stripStatementPollution("RESOLUCIÓN : INDECISIÓN")).toBe("RESOLUCIÓN : INDECISIÓN");
  });

  it("leaves a clean statement byte-identical", () => {
    const body = "En un triángulo rectángulo, la tangente de uno de sus ángulos agudos es 8/15.";

    expect(stripStatementPollution(body)).toBe(body);
  });
});
