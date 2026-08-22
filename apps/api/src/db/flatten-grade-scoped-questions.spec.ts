import { flattenGradeScopedQuestions } from "./flatten-grade-scoped-questions";

const QUESTION = {
  bodyTypst: "¿Cuánto es 2 + 2?",
  alternatives: ["3", "4", "5"],
  correctAnswer: "1",
  difficulty: "easy",
  sourceUrl: "https://example.test/a",
  sourceName: "Fuente A",
};

describe("flattenGradeScopedQuestions", () => {
  it("lifts courseName and gradeLevel off the file and topicName off the topic", () => {
    const entries = flattenGradeScopedQuestions({
      courseName: "Matemática",
      gradeLevel: "primaria_3",
      topics: [{ name: "Números y operaciones", questions: [QUESTION] }],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      courseName: "Matemática",
      gradeLevel: "primaria_3",
      topicName: "Números y operaciones",
    });
  });

  it("carries every per-question field through untouched", () => {
    const entries = flattenGradeScopedQuestions({
      courseName: "Matemática",
      gradeLevel: "primaria_3",
      topics: [{ name: "Números y operaciones", questions: [QUESTION] }],
    });

    expect(entries[0]).toMatchObject(QUESTION);
  });

  it("flattens every topic in the file, in order", () => {
    const entries = flattenGradeScopedQuestions({
      courseName: "Comunicación",
      gradeLevel: "secundaria_1",
      topics: [
        { name: "Tema A", questions: [QUESTION, QUESTION] },
        { name: "Tema B", questions: [QUESTION] },
      ],
    });

    expect(entries.map((entry) => entry.topicName)).toEqual(["Tema A", "Tema A", "Tema B"]);
  });

  it("skips a topic that carries no questions", () => {
    const entries = flattenGradeScopedQuestions({
      courseName: "Arte",
      gradeLevel: "primaria_1",
      topics: [
        { name: "Vacío", questions: [] },
        { name: "Con contenido", questions: [QUESTION] },
      ],
    });

    expect(entries.map((entry) => entry.topicName)).toEqual(["Con contenido"]);
  });

  it("returns nothing for the flat `entries` shape, which the collected seeder already reads", () => {
    expect(flattenGradeScopedQuestions({ entries: [QUESTION] })).toEqual([]);
  });

  it("returns nothing for a file missing courseName or gradeLevel rather than emitting unusable entries", () => {
    expect(flattenGradeScopedQuestions({ topics: [{ name: "T", questions: [QUESTION] }] })).toEqual([]);
  });

  it("tolerates a topic with no questions key at all", () => {
    expect(
      flattenGradeScopedQuestions({ courseName: "C", gradeLevel: "primaria_1", topics: [{ name: "T" }] }),
    ).toEqual([]);
  });
});
