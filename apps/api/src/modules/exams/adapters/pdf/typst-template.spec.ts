import { renderExamTypst, renderAnswerKeyTypst } from "./typst-template";
import { ExamPdfDocumentInput, AnswerKeyDocumentInput } from "../../domain/ports/pdf-compiler.port";

/** Wraps a flat question list in the minimal shape: one unlabeled section, one unlabeled block. */
const oneBlock = (questions: ExamPdfDocumentInput["sections"][number]["blocks"][number]["questions"]) => [
  { code: null, label: null, blocks: [{ label: "", questions }] },
];

describe("renderExamTypst", () => {
  it("wraps each section's content in a two-column layout", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: oneBlock([{ id: "q1", imageAbsolutePath: "/fixtures/q1.png" }]),
    };

    const source = renderExamTypst(input);

    expect(source).toContain("#columns(2)[");
  });

  it("embeds the tenant logo when provided", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      tenantLogoAbsolutePath: "/fixtures/logo.png",
      sections: oneBlock([{ id: "q1", imageAbsolutePath: "/fixtures/q1.png" }]),
    };

    const source = renderExamTypst(input);

    expect(source).toContain('image("/fixtures/logo.png"');
  });

  it("omits any logo image() call when no tenant logo is provided", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: oneBlock([{ id: "q1", imageAbsolutePath: "/fixtures/q1.png" }]),
    };

    const source = renderExamTypst(input);

    expect(source).not.toContain("logo");
  });

  it("embeds every question's image, each preceded by a `// q:{id}` marker", () => {
    const questions = [
      { id: "q1", imageAbsolutePath: "/fixtures/q1.png" },
      { id: "q2", imageAbsolutePath: "/fixtures/q2.png" },
    ];
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: oneBlock(questions),
    };

    const source = renderExamTypst(input);
    const lines = source.split("\n");

    for (const question of questions) {
      if (question.type === "structured") {
        continue;
      }

      const markerIndex = lines.findIndex((line) => line.includes(`// q:${question.id}`));
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
      sections: oneBlock([{ id: "q1", imageAbsolutePath: "/fixtures/q1.png" }]),
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
      sections: oneBlock([
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Resuelve: $x + 1 = 2$",
          alternatives: ["1", "2", "3"],
        },
      ]),
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
      sections: oneBlock([
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Resuelve: $x + 1 = 2$",
          alternatives: ["1", "2", "3"],
        },
      ]),
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
      sections: oneBlock([
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Observa la figura",
          alternatives: ["a", "b"],
          figureCode: "#box[triangle placeholder]",
        },
      ]),
    };

    const source = renderExamTypst(input);

    expect(source).toContain("#box[triangle placeholder]");
  });

  it("omits any figure block when figureCode is not provided", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: oneBlock([
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Sin figura",
          alternatives: ["a", "b"],
        },
      ]),
    };

    const source = renderExamTypst(input);

    expect(source).not.toContain("undefined");
  });

  it("embeds a structured question's complement image via #image() when imageAbsolutePath is provided", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: oneBlock([
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Según el gráfico adjunto, calcule...",
          alternatives: ["a", "b"],
          imageAbsolutePath: "/fixtures/complement-chart.png",
        },
      ]),
    };

    const source = renderExamTypst(input);

    expect(source).toContain('image("/fixtures/complement-chart.png"');
  });

  it("renders an alternative with an image path as #image(...) instead of its (empty) text", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: oneBlock([
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "¿Cuál gráfico corresponde?",
          alternatives: ["", "", ""],
          alternativeImagePaths: ["/fixtures/alt-a.png", "/fixtures/alt-b.png", "/fixtures/alt-c.png"],
        },
      ]),
    };

    const source = renderExamTypst(input);

    expect(source).toContain('A) #box(image("/fixtures/alt-a.png", height: 1.1cm))');
    expect(source).toContain('B) #box(image("/fixtures/alt-b.png", height: 1.1cm))');
    expect(source).toContain('C) #box(image("/fixtures/alt-c.png", height: 1.1cm))');
  });

  it("mixed: renders text alternatives normally and only the ones with an image path as #image(...)", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: oneBlock([
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Observa las opciones",
          alternatives: ["texto plano", "", "otro texto"],
          alternativeImagePaths: [undefined, "/fixtures/alt-b.png", undefined],
        },
      ]),
    };

    const source = renderExamTypst(input);

    expect(source).toContain("A) texto plano");
    expect(source).toContain('B) #box(image("/fixtures/alt-b.png", height: 1.1cm))');
    expect(source).toContain("C) otro texto");
  });

  it("omits #image(...) for alternatives when alternativeImagePaths is not provided at all", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: oneBlock([
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Sin imágenes de alternativas",
          alternatives: ["a", "b"],
        },
      ]),
    };

    const source = renderExamTypst(input);

    expect(source).toContain("A) a");
    expect(source).toContain("B) b");
    expect(source).not.toContain("#image(");
  });

  it("renders both figureCode and imageAbsolutePath when a structured question has both", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: oneBlock([
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Observa la figura y el gráfico",
          alternatives: ["a", "b"],
          figureCode: "#box[triangle placeholder]",
          imageAbsolutePath: "/fixtures/complement-chart.png",
        },
      ]),
    };

    const source = renderExamTypst(input);

    expect(source).toContain("#box[triangle placeholder]");
    expect(source).toContain('image("/fixtures/complement-chart.png"');
  });

  it("omits any complement image() call when imageAbsolutePath is not provided", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: oneBlock([
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Sin imagen complementaria",
          alternatives: ["a", "b"],
        },
      ]),
    };

    const source = renderExamTypst(input);

    expect(source).not.toContain("#image(");
  });

  it("renders image and structured questions side by side in the same document, each with its own marker", () => {
    const input: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: oneBlock([
        { id: "q1", imageAbsolutePath: "/fixtures/q1.png" },
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Resuelve: $x + 1 = 2$",
          alternatives: ["1", "2"],
        },
      ]),
    };

    const source = renderExamTypst(input);

    expect(source).toContain("// q:q1");
    expect(source).toContain("// q:sq1");
    expect(source).toContain('image("/fixtures/q1.png"');
    expect(source).toContain("Resuelve: $x + 1 = 2$");
  });
});

describe("renderExamTypst — official layout", () => {
  const structured = (id: string, body: string) =>
    ({ id, type: "structured", bodyTypst: body, alternatives: ["uno", "dos"] }) as const;

  const twoSectionInput = (): ExamPdfDocumentInput => ({
    title: "ETA UNI",
    versionLabel: "Forma A",
    sections: [
      {
        code: "E1",
        label: "PRIMERA PRUEBA",
        blocks: [
          { label: "RAZ. MATEMÁTICO", questions: [structured("a", "ra"), structured("b", "rb")] },
          { label: "RAZ. VERBAL", questions: [structured("c", "rc")] },
        ],
      },
      {
        code: "E2",
        label: "SEGUNDA PRUEBA",
        blocks: [{ label: "MATEMÁTICA", questions: [structured("d", "rd")] }],
      },
    ],
  });

  it("emits each section's title", () => {
    const source = renderExamTypst(twoSectionInput());

    expect(source).toContain("PRIMERA PRUEBA");
    expect(source).toContain("SEGUNDA PRUEBA");
  });

  it("emits each block's heading", () => {
    const source = renderExamTypst(twoSectionInput());

    expect(source).toContain("RAZ. MATEMÁTICO");
    expect(source).toContain("RAZ. VERBAL");
    expect(source).toContain("MATEMÁTICA");
  });

  it("puts the section title OUTSIDE the columns, so it spans the full page width", () => {
    const source = renderExamTypst(twoSectionInput());

    const headingIndex = source.indexOf("PRIMERA PRUEBA");
    const columnsIndex = source.indexOf("#columns(2)");

    expect(headingIndex).toBeGreaterThan(-1);
    expect(columnsIndex).toBeGreaterThan(headingIndex);
    expect(source).not.toContain("columns: 2");
  });

  it("inserts a page break between sections, but not before the first one", () => {
    const source = renderExamTypst(twoSectionInput());

    expect(source.split("#pagebreak()")).toHaveLength(2);
    expect(source.indexOf("#pagebreak()")).toBeGreaterThan(source.indexOf("PRIMERA PRUEBA"));
  });

  it("MUST: numbering restarts at every section", () => {
    const source = renderExamTypst(twoSectionInput());

    // E1 numbers 1,2,3 and E2 starts over at 1.
    expect(source).toContain("*1.* ra");
    expect(source).toContain("*2.* rb");
    expect(source).toContain("*3.* rc");
    expect(source).toContain("*1.* rd");
  });

  it("a single unlabeled section with a single unlabeled block emits no headings or page break", () => {
    const source = renderExamTypst({
      title: "Vista previa",
      versionLabel: "preview",
      sections: [{ code: null, label: null, blocks: [{ label: "", questions: [structured("x", "rx")] }] }],
    });

    expect(source).not.toContain("#pagebreak()");
    expect(source).toContain("*1.* rx");
  });
});

describe("renderAnswerKeyTypst", () => {
  it("marks every entry with a `// q:{id}` marker for error-mapping", () => {
    const entries = [
      { questionId: "q1", correctOption: "B" },
      { questionId: "q2", correctOption: "D" },
    ];
    const input: AnswerKeyDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: [{ label: null, entries }],
    };

    const source = renderAnswerKeyTypst(input);

    for (const entry of entries) {
      expect(source).toContain(`// q:${entry.questionId}`);
    }
  });

  it("includes each question's correct option in the source", () => {
    const input: AnswerKeyDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: [{ label: null, entries: [{ questionId: "q1", correctOption: "B" }] }],
    };

    const source = renderAnswerKeyTypst(input);

    expect(source).toContain("[B]");
  });

  it("prints the question's position, not its id — the id is unusable for hand grading", () => {
    const input: AnswerKeyDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: [
        {
          label: null,
          entries: [
            { questionId: "324a9515-febf-4f76-9309-c8e680904dd9", correctOption: "C" },
            { questionId: "f9969f3c-e77e-4ee2-872b-7709c64d1060", correctOption: "B" },
          ],
        },
      ],
    };

    const source = renderAnswerKeyTypst(input);

    expect(source).toContain("[1], [C],");
    expect(source).toContain("[2], [B],");
    expect(source).not.toContain("[324a9515-febf-4f76-9309-c8e680904dd9]");
  });

  it("numbers from the entry order so each form gets its own shuffled numbering", () => {
    const input: AnswerKeyDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version B",
      sections: [
        {
          label: null,
          entries: [
            { questionId: "q9", correctOption: "A" },
            { questionId: "q4", correctOption: "E" },
            { questionId: "q7", correctOption: "D" },
          ],
        },
      ],
    };

    const source = renderAnswerKeyTypst(input);

    expect(source).toContain("[1], [A],");
    expect(source).toContain("[2], [E],");
    expect(source).toContain("[3], [D],");
  });

  it("is a separate document from the exam (does not embed question images)", () => {
    const input: AnswerKeyDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      sections: [{ label: null, entries: [{ questionId: "q1", correctOption: "B" }] }],
    };

    const source = renderAnswerKeyTypst(input);

    expect(source).not.toContain("#image(");
  });

  it("caps a complement image's height so a tall figure cannot own the column", () => {
    const typst = renderExamTypst({
      title: "T",
      versionLabel: "Forma A",
      sections: oneBlock([
        {
          id: "q1",
          type: "structured",
          bodyTypst: "¿Qué hora marca el reloj?",
          alternatives: ["a", "b"],
          imageAbsolutePath: "/tmp/clock.png",
        },
      ]),
    });

    expect(typst).toContain('let natural = measure(image("/tmp/clock.png"))');
    expect(typst).toMatch(/if scaled > \d+cm/);
    expect(typst).toContain("#layout(size =>");
  });

  it("sizes an alternative image by height, so five drawings still fit one column", () => {
    const typst = renderExamTypst({
      title: "T",
      versionLabel: "Forma A",
      sections: oneBlock([
        {
          id: "q1",
          type: "structured",
          bodyTypst: "¿Qué figura continúa?",
          alternatives: ["", "", "", "", ""],
          alternativeImagePaths: ["/a.png", "/b.png", "/c.png", "/d.png", "/e.png"],
        },
      ]),
    });

    expect(typst).toContain('A) #box(image("/a.png", height: ');
    expect(typst).not.toContain("width: 35%");
  });

  it("gives the alternatives enough leading that stacked fractions do not collide", () => {
    const typst = renderExamTypst({
      title: "T",
      versionLabel: "Forma A",
      sections: oneBlock([
        { id: "q1", type: "structured", bodyTypst: "Calcula", alternatives: ["$2/11$", "$3/11$"] },
      ]),
    });

    expect(typst).toMatch(/#set par\(leading:/);
  });
});

describe("renderAnswerKeyTypst — local numbering per section", () => {
  const input = (): AnswerKeyDocumentInput => ({
    title: "ETA UNI",
    versionLabel: "Forma A",
    sections: [
      {
        label: "PRIMERA PRUEBA",
        entries: [
          { questionId: "a", correctOption: "C" },
          { questionId: "b", correctOption: "A" },
        ],
      },
      {
        label: "SEGUNDA PRUEBA",
        entries: [{ questionId: "c", correctOption: "E" }],
      },
    ],
  });

  it("MUST: numbering restarts per section, matching the booklet", () => {
    const source = renderAnswerKeyTypst(input());

    expect(source).toContain("[1], [C],");
    expect(source).toContain("[2], [A],");
    // The exam's third question is the 1st of the second test, not the 3rd.
    expect(source).toContain("[1], [E],");
    expect(source).not.toContain("[3], [E],");
  });

  it("labels each section of the key", () => {
    const source = renderAnswerKeyTypst(input());

    expect(source).toContain("PRIMERA PRUEBA");
    expect(source).toContain("SEGUNDA PRUEBA");
  });

  it("keeps the // q:{id} marker for every entry", () => {
    const source = renderAnswerKeyTypst(input());

    expect(source).toContain("// q:a");
    expect(source).toContain("// q:c");
  });

  it("an unlabeled section emits no heading", () => {
    const source = renderAnswerKeyTypst({
      title: "Repaso",
      versionLabel: "Forma A",
      sections: [{ label: null, entries: [{ questionId: "x", correctOption: "B" }] }],
    });

    expect(source).toContain("[1], [B],");
    expect(source).toContain("Clave de respuestas");
  });
});
