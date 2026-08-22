import { stripSolutionTail } from "./strip-solution-tail";

describe("stripSolutionTail", () => {
  it("cuts the answer key a scrape glued onto the last alternative", () => {
    expect(
      stripSolutionTail('El héroe discreto . Rpta.: "E" Ver respuesta correcta >> Leer explicación breve'),
    ).toBe("El héroe discreto");
    expect(stripSolutionTail("Fátima Rpta. d")).toBe("Fátima");
    // The period belongs to the alternative; only a space-detached one is dropped.
    expect(stripSolutionTail("La diéresis Precisión semántica. Rpta. D")).toBe(
      "La diéresis Precisión semántica.",
    );
  });

  it("cuts the source footer the harvest glued on", () => {
    // The instance the audit reproduced, under Geometría → Triángulos.
    expect(stripSolutionTail("15 2da. Prueba Examen de Admisión 2020-1")).toBe("15");
    expect(stripSolutionTail("5 3ra. Prueba del Examen de Admisión 2020-1")).toBe("5");
  });

  it("cuts a pasted resolución block without eating a real resolution number", () => {
    expect(
      stripSolutionTail("Anaxímenes Resolución 1 De acuerdo al texto, la afirmación correcta sería"),
    ).toBe("Anaxímenes");
    // Four digits is a document, not a numbered solution step.
    expect(stripSolutionTail("Aplicación de la Resolución 1080")).toBe("Aplicación de la Resolución 1080");
    expect(stripSolutionTail("La Resolución 217 – A de la Asamblea General")).toBe(
      "La Resolución 217 – A de la Asamblea General",
    );
  });

  it("cuts a pasted solucionario block", () => {
    expect(
      stripSolutionTail(
        "Napoleón habría regresado envuelto en una aureola sacra. SOLUCIONARIO RESOLUCIÓN 1 : Se trata de un juego verbal",
      ),
    ).toBe("Napoleón habría regresado envuelto en una aureola sacra.");
  });

  it("cuts the English 'Key :' and the site's own chrome", () => {
    expect(
      stripSolutionTail("In Greek mythology there are ineffable improper scenes. Key: The text deals mainly"),
    ).toBe("In Greek mythology there are ineffable improper scenes.");
    expect(
      stripSolutionTail('Corea del Norte. Rpta.: "C" Ver respuesta correcta >> Lee la explicación breve'),
    ).toBe("Corea del Norte.");
    expect(
      stripSolutionTail("You will feel immediately all the benefits. CLAVES-RESPUESTAS : 1) C 2) D 3) B"),
    ).toBe("You will feel immediately all the benefits.");
  });

  it("cuts a bare 'Respuesta C' and whatever bled in behind it", () => {
    expect(stripSolutionTail("50 → no cumple Respuesta C 31. Si el esquema es falso: (p4q) ∧ r")).toBe(
      "50 → no cumple",
    );
    // A single capital is the key; a word that merely starts with one is prose.
    expect(stripSolutionTail("La respuesta Correcta depende del contexto")).toBe(
      "La respuesta Correcta depende del contexto",
    );
    expect(stripSolutionTail("Su respuesta Ana la dio ayer")).toBe("Su respuesta Ana la dio ayer");
  });

  it("leaves a clean alternative untouched", () => {
    for (const clean of [
      "74",
      "Manuel Prado y Ugarteche",
      "$x^2 + 1$",
      "Nadie sabe cómo aprobó el examen de admisión 2026-I.",
      "El examen de admisión es una prueba que mide competencias.",
      "La Resolución 217 – A de la Asamblea General",
    ]) {
      expect(stripSolutionTail(clean)).toBe(clean);
    }
  });

  it("keeps the original when the cut would leave nothing", () => {
    // Better a visible tail than an empty option on a printed exam.
    expect(stripSolutionTail("Rpta. C")).toBe("Rpta. C");
    expect(stripSolutionTail("  SOLUCIONARIO  ")).toBe("  SOLUCIONARIO  ");
  });

  it("does not fire on a word that merely contains an anchor", () => {
    expect(stripSolutionTail("La clavícula se fractura con facilidad")).toBe(
      "La clavícula se fractura con facilidad",
    );
    expect(stripSolutionTail("El teclado tiene una tecla de clave numérica")).toBe(
      "El teclado tiene una tecla de clave numérica",
    );
  });
});
