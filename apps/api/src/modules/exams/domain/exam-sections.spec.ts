import { groupIntoSections, QuestionPlacement } from "./exam-sections";
import { SelectedQuestion } from "./version-shuffler";

const question = (id: string): SelectedQuestion => ({ questionId: id, correctAnswer: "A" });

const placement = (
  id: string,
  sortOrder: number,
  blockLabel: string,
  sectionCode: string | null = null,
  sectionLabel: string | null = null,
): QuestionPlacement => ({
  question: question(id),
  sortOrder,
  blockLabel,
  sectionCode,
  sectionLabel,
});

describe("groupIntoSections", () => {
  it("agrupa por bloque respetando el orden de sortOrder", () => {
    const sections = groupIntoSections([
      placement("q3", 1, "ÁLGEBRA"),
      placement("q1", 0, "ARITMÉTICA"),
      placement("q2", 0, "ARITMÉTICA"),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].code).toBeNull();
    expect(sections[0].label).toBeNull();
    expect(sections[0].blocks.map((b) => b.label)).toEqual(["ARITMÉTICA", "ÁLGEBRA"]);
    expect(sections[0].blocks[0].questions.map((q) => q.questionId)).toEqual(["q1", "q2"]);
    expect(sections[0].blocks[1].questions.map((q) => q.questionId)).toEqual(["q3"]);
  });

  it("un bloque abarca varios cursos: filas distintas con el mismo blockLabel caen en el mismo bloque", () => {
    const sections = groupIntoSections([
      placement("q1", 0, "MATEMÁTICA", "E2", "SEGUNDA PRUEBA"),
      placement("q2", 1, "MATEMÁTICA", "E2", "SEGUNDA PRUEBA"),
      placement("q3", 2, "MATEMÁTICA", "E2", "SEGUNDA PRUEBA"),
    ]);

    expect(sections[0].blocks).toHaveLength(1);
    expect(sections[0].blocks[0].questions.map((q) => q.questionId)).toEqual(["q1", "q2", "q3"]);
  });

  it("separa secciones y las devuelve en orden canónico de sortOrder", () => {
    const sections = groupIntoSections([
      placement("q5", 10, "FÍSICA", "E3", "TERCERA PRUEBA"),
      placement("q1", 0, "RAZ. MATEMÁTICO", "E1", "PRIMERA PRUEBA"),
      placement("q3", 5, "MATEMÁTICA", "E2", "SEGUNDA PRUEBA"),
    ]);

    expect(sections.map((s) => s.code)).toEqual(["E1", "E2", "E3"]);
    expect(sections.map((s) => s.label)).toEqual([
      "PRIMERA PRUEBA",
      "SEGUNDA PRUEBA",
      "TERCERA PRUEBA",
    ]);
  });

  it("filas del mismo bloque que quedaron separadas por sortOrder se fusionan en un solo bloque", () => {
    const sections = groupIntoSections([
      placement("q1", 0, "ARITMÉTICA"),
      placement("q2", 1, "ÁLGEBRA"),
      placement("q3", 2, "ARITMÉTICA"),
    ]);

    expect(sections[0].blocks.map((b) => b.label)).toEqual(["ARITMÉTICA", "ÁLGEBRA"]);
    expect(sections[0].blocks[0].questions.map((q) => q.questionId)).toEqual(["q1", "q3"]);
  });

  it("devuelve lista vacía sin placements", () => {
    expect(groupIntoSections([])).toEqual([]);
  });
});
