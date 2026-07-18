import { renderExamTypst, renderAnswerKeyTypst } from "./typst-template";
import {
  ExamPdfDocumentInput,
  AnswerKeyDocumentInput,
} from "../../domain/ports/pdf-compiler.port";

describe("renderExamTypst", () => {
  it("sets a 2-column page layout", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      questions: [{ id: "q1", imageAbsolutePath: "/fixtures/q1.png" }],
    };

    const source = renderExamTypst(input);

    expect(source).toContain("columns: 2");
  });

  it("embeds the tenant logo when provided", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      tenantLogoAbsolutePath: "/fixtures/logo.png",
      questions: [{ id: "q1", imageAbsolutePath: "/fixtures/q1.png" }],
    };

    const source = renderExamTypst(input);

    expect(source).toContain('image("/fixtures/logo.png"');
  });

  it("omits any logo image() call when no tenant logo is provided", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      questions: [{ id: "q1", imageAbsolutePath: "/fixtures/q1.png" }],
    };

    const source = renderExamTypst(input);

    expect(source).not.toContain("logo");
  });

  it("embeds every question's image, each preceded by a `// q:{id}` marker", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      questions: [
        { id: "q1", imageAbsolutePath: "/fixtures/q1.png" },
        { id: "q2", imageAbsolutePath: "/fixtures/q2.png" },
      ],
    };

    const source = renderExamTypst(input);
    const lines = source.split("\n");

    for (const question of input.questions) {
      if (question.type === "structured") {
        continue;
      }

      const markerIndex = lines.findIndex((line) =>
        line.includes(`// q:${question.id}`),
      );
      expect(markerIndex).toBeGreaterThanOrEqual(0);

      const imageLine = lines
        .slice(markerIndex, markerIndex + 3)
        .find((line) => line.includes(question.imageAbsolutePath));
      expect(imageLine).toBeDefined();
    }
  });

  it("includes the exam title and version label in the source", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version B",
      questions: [{ id: "q1", imageAbsolutePath: "/fixtures/q1.png" }],
    };

    const source = renderExamTypst(input);

    expect(source).toContain("Simulacro San Marcos");
    expect(source).toContain("Version B");
  });
});

describe("renderExamTypst — structured questions", () => {
  it("embeds a structured question's body, marked with the same `// q:{id}` marker as image questions", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      questions: [
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Resuelve: $x + 1 = 2$",
          alternatives: ["1", "2", "3"],
        },
      ],
    };

    const source = renderExamTypst(input);
    const lines = source.split("\n");

    const markerIndex = lines.findIndex((line) => line.includes("// q:sq1"));
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(source).toContain("Resuelve: $x + 1 = 2$");
  });

  it("renders every alternative, numbered/lettered", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      questions: [
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Resuelve: $x + 1 = 2$",
          alternatives: ["1", "2", "3"],
        },
      ],
    };

    const source = renderExamTypst(input);

    expect(source).toContain("A) 1");
    expect(source).toContain("B) 2");
    expect(source).toContain("C) 3");
  });

  it("embeds figureCode verbatim when provided", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      questions: [
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Observa la figura",
          alternatives: ["a", "b"],
          figureCode: '#box[triangle placeholder]',
        },
      ],
    };

    const source = renderExamTypst(input);

    expect(source).toContain("#box[triangle placeholder]");
  });

  it("omits any figure block when figureCode is not provided", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      questions: [
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Sin figura",
          alternatives: ["a", "b"],
        },
      ],
    };

    const source = renderExamTypst(input);

    expect(source).not.toContain("undefined");
  });

  it("renders image and structured questions side by side in the same document, each with its own marker", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      questions: [
        { id: "q1", imageAbsolutePath: "/fixtures/q1.png" },
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Resuelve: $x + 1 = 2$",
          alternatives: ["1", "2"],
        },
      ],
    };

    const source = renderExamTypst(input);

    expect(source).toContain("// q:q1");
    expect(source).toContain("// q:sq1");
    expect(source).toContain('image("/fixtures/q1.png"');
    expect(source).toContain("Resuelve: $x + 1 = 2$");
  });
});

describe("renderAnswerKeyTypst", () => {
  it("marks every entry with a `// q:{id}` marker for error-mapping", () => {
    const input: AnswerKeyDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      entries: [
        { questionId: "q1", correctOption: "B" },
        { questionId: "q2", correctOption: "D" },
      ],
    };

    const source = renderAnswerKeyTypst(input);

    for (const entry of input.entries) {
      expect(source).toContain(`// q:${entry.questionId}`);
    }
  });

  it("includes each question's correct option in the source", () => {
    const input: AnswerKeyDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      entries: [{ questionId: "q1", correctOption: "B" }],
    };

    const source = renderAnswerKeyTypst(input);

    expect(source).toContain("[q1]");
    expect(source).toContain("[B]");
  });

  it("is a separate document from the exam (does not embed question images)", () => {
    const input: AnswerKeyDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      entries: [{ questionId: "q1", correctOption: "B" }],
    };

    const source = renderAnswerKeyTypst(input);

    expect(source).not.toContain("#image(");
  });
});
