import { duplicateTitle } from "./duplicate-title";

describe("duplicateTitle", () => {
  it("prefixes the first copy", () => {
    expect(duplicateTitle("Examen 4to secundaria", [])).toBe("Copia de Examen 4to secundaria");
  });

  it("numbers the next copies instead of stacking prefixes", () => {
    // Audit 2026-08-20 L7: this produced "Copia de Copia de Copia de …".
    const existing = ["Examen 4to secundaria", "Copia de Examen 4to secundaria"];

    expect(duplicateTitle("Examen 4to secundaria", existing)).toBe("Copia de Examen 4to secundaria (2)");
    expect(duplicateTitle("Examen 4to secundaria", [...existing, "Copia de Examen 4to secundaria (2)"])).toBe(
      "Copia de Examen 4to secundaria (3)",
    );
  });

  it("treats the copy of a copy as another copy of the same exam", () => {
    const existing = ["Examen", "Copia de Examen"];

    expect(duplicateTitle("Copia de Examen", existing)).toBe("Copia de Examen (2)");
    expect(duplicateTitle("Copia de Examen (2)", [...existing, "Copia de Examen (2)"])).toBe(
      "Copia de Examen (3)",
    );
  });

  it("fills the first free number rather than counting copies", () => {
    // "(2)" was renamed or deleted — reuse it instead of jumping to (4).
    const existing = ["Copia de Examen", "Copia de Examen (3)"];

    expect(duplicateTitle("Examen", existing)).toBe("Copia de Examen (2)");
  });

  it("ignores surrounding whitespace on both sides of the comparison", () => {
    expect(duplicateTitle("  Examen  ", ["Copia de Examen "])).toBe("Copia de Examen (2)");
  });

  it("keeps a number the teacher wrote — it is part of their title, not our counter", () => {
    expect(duplicateTitle("Simulacro (2024)", [])).toBe("Copia de Simulacro (2024)");
    expect(duplicateTitle("Simulacro (2024)", ["Copia de Simulacro (2024)"])).toBe(
      "Copia de Simulacro (2024) (2)",
    );
  });

  it("only strips a small number, and only from a title that already is a copy", () => {
    // Nothing tells our "(2)" from their "(2024)" apart, so the rule errs
    // toward keeping what the teacher typed.
    expect(duplicateTitle("Copia de Simulacro (2024)", ["Copia de Simulacro (2024)"])).toBe(
      "Copia de Simulacro (2024) (2)",
    );
    expect(duplicateTitle("Copia de Examen (12)", ["Copia de Examen"])).toBe("Copia de Examen (2)");
  });
});
