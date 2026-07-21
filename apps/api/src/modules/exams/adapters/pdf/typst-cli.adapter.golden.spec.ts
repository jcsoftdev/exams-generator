import * as path from "node:path";
import { TypstCliAdapter } from "./typst-cli.adapter";
import { isTypstAvailableSync } from "./test-utils/typst-availability";
import { ExamPdfDocumentInput } from "../../domain/ports/pdf-compiler.port";

/**
 * RELEASE GATE — golden `.typ` compile test. Compiles a fixed exam
 * definition through the REAL `typst` CLI (no fake runner) and asserts the
 * output is a valid, deterministic PDF. This is the test that proves the
 * generated Typst source is actually syntactically valid Typst — the unit
 * tests in `typst-template.spec.ts` only assert string shape, they never
 * invoke the compiler.
 *
 * Guarded with `describe.skip` (not a fake pass) when the `typst` binary
 * isn't installed — see infra/Dockerfile.api for the pinned version this
 * project expects (0.15.1 at time of writing).
 */
const FIXTURES_DIR = path.join(__dirname, "fixtures");

const GOLDEN_INPUT: ExamPdfDocumentInput = {
  title: "Simulacro San Marcos",
  versionLabel: "Version A",
  tenantLogoAbsolutePath: path.join(FIXTURES_DIR, "logo.png"),
  questions: [
    { id: "q1", imageAbsolutePath: path.join(FIXTURES_DIR, "q1.png") },
    { id: "q2", imageAbsolutePath: path.join(FIXTURES_DIR, "q2.png") },
  ],
};

const describeIfTypst = isTypstAvailableSync() ? describe : describe.skip;

describeIfTypst("TypstCliAdapter golden compile (real typst binary)", () => {
  it("compiles a fixed exam definition into a valid PDF, deterministically", async () => {
    const adapter = new TypstCliAdapter();

    const pdfA = await adapter.compileExam(GOLDEN_INPUT);
    const pdfB = await adapter.compileExam(GOLDEN_INPUT);

    expect(pdfA.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdfA.equals(pdfB)).toBe(true);
  });

  it("compiles the answer key as a separate, valid PDF", async () => {
    const adapter = new TypstCliAdapter();

    const pdf = await adapter.compileAnswerKey({
      title: GOLDEN_INPUT.title,
      versionLabel: GOLDEN_INPUT.versionLabel,
      entries: [
        { questionId: "q1", correctOption: "B" },
        { questionId: "q2", correctOption: "D" },
      ],
    });

    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("compiles a mixed image + structured exam (math body, alternatives, figure) into a valid PDF", async () => {
    const adapter = new TypstCliAdapter();

    const mixedInput: ExamPdfDocumentInput = {
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      questions: [
        { id: "q1", imageAbsolutePath: path.join(FIXTURES_DIR, "q1.png") },
        {
          id: "sq1",
          type: "structured",
          bodyTypst: "Resuelve para $x$: $x + 1 = 2$",
          alternatives: ["1", "2", "3", "4"],
          figureCode: "#box(width: 2cm, height: 2cm, stroke: 1pt)[]",
        },
      ],
    };

    const pdf = await adapter.compileExam(mixedInput);

    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  // Unlike its sibling golden tests, this one needs real network access:
  // `typst` fetches the `@preview/mitex:0.2.7` package from the Typst
  // registry on first compile. If this test fails in CI, check registry
  // reachability first — it likely reads as "mitex broken" but is actually
  // "registry unreachable".
  it("compiles a structured question using LaTeX math via mitex into a valid PDF", async () => {
    const adapter = new TypstCliAdapter();

    const pdf = await adapter.compileExam({
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      questions: [
        {
          id: "q-mitex",
          type: "structured",
          bodyTypst:
            '#import "@preview/mitex:0.2.7": mi; Si el ángulo mide 70 grados, halla #mi("\\frac{1}{2} \\cdot 70^\\circ").',
          alternatives: ["35", "70", "140", "17.5", "N.A."],
        },
      ],
    });

    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
