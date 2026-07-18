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
