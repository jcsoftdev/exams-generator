import { promises as fs } from "node:fs";
import { TypstCliAdapter, CompileRunner } from "./typst-cli.adapter";
import { TypstCompilationError } from "../../domain/ports/pdf-compiler.port";
import { renderExamTypst } from "./typst-template";
import { ExamPdfDocumentInput } from "../../domain/ports/pdf-compiler.port";

const EXAM_INPUT: ExamPdfDocumentInput = {
  title: "Simulacro San Marcos",
  versionLabel: "Version A",
  questions: [
    { id: "q1", imageAbsolutePath: "/fixtures/q1.png" },
    { id: "q2", imageAbsolutePath: "/fixtures/q2-broken.png" },
  ],
};

describe("TypstCliAdapter", () => {
  it("compileExam() returns the PDF bytes written by the runner when it succeeds", async () => {
    const fakeRunner: CompileRunner = async (args) => {
      const outputPath = args[args.length - 1];
      await fs.writeFile(outputPath, Buffer.from("%PDF-fake-bytes"));
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const adapter = new TypstCliAdapter(fakeRunner);

    const pdf = await adapter.compileExam(EXAM_INPUT);

    expect(pdf.toString()).toBe("%PDF-fake-bytes");
  });

  it("compileExam() throws TypstCompilationError identifying the failing question id", async () => {
    // Compute the real line number of q2's image() call from the actual
    // template output, so this test stays correct even if the template
    // shell (headers, page setup, etc.) changes shape.
    const typstSource = renderExamTypst(EXAM_INPUT);
    const lines = typstSource.split("\n");
    const markerIndex = lines.findIndex((line) => line.includes("// q:q2"));
    const failingLineNumber = markerIndex + 2; // 1-based line of the image() call right after the marker

    const fakeRunner: CompileRunner = async () => ({
      stdout: "",
      stderr: [
        "error: file not found (searched at /fixtures/q2-broken.png)",
        `  ┌─ input.typ:${failingLineNumber}:8`,
      ].join("\n"),
      exitCode: 1,
    });
    const adapter = new TypstCliAdapter(fakeRunner);

    await expect(adapter.compileExam(EXAM_INPUT)).rejects.toMatchObject({
      questionId: "q2",
    });
    await expect(adapter.compileExam(EXAM_INPUT)).rejects.toBeInstanceOf(
      TypstCompilationError,
    );
  });

  it("compileAnswerKey() returns the PDF bytes written by the runner when it succeeds", async () => {
    const fakeRunner: CompileRunner = async (args) => {
      const outputPath = args[args.length - 1];
      await fs.writeFile(outputPath, Buffer.from("%PDF-answer-key"));
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const adapter = new TypstCliAdapter(fakeRunner);

    const pdf = await adapter.compileAnswerKey({
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      entries: [{ questionId: "q1", correctOption: "B" }],
    });

    expect(pdf.toString()).toBe("%PDF-answer-key");
  });

  it("compileExam() throws TypstCompilationError with questionId undefined when the failure can't be traced to a question", async () => {
    const fakeRunner: CompileRunner = async () => ({
      stdout: "",
      stderr: "error: unexpected token (no location info)",
      exitCode: 1,
    });
    const adapter = new TypstCliAdapter(fakeRunner);

    await expect(adapter.compileExam(EXAM_INPUT)).rejects.toMatchObject({
      questionId: undefined,
    });
  });
});
