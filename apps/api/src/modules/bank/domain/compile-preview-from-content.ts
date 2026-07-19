import { ExamPdfDocumentInput, PdfCompilerPort } from "../../exams/domain/ports/pdf-compiler.port";

/**
 * Shared single-question Typst PREVIEW compile, extracted out of
 * `BankService.previewQuestion` so BOTH the manual preview path AND the AI
 * revise flow (`ai/revise-question.service.ts`) validate structured content
 * through the EXACT same compile input shape — title "Vista previa",
 * versionLabel "preview", a single `type: 'structured'` question. Keeping
 * this in one place means a manual edit and an AI-produced revision are
 * held to identical Typst-compile scrutiny; there is no second, slightly
 * different code path that could silently diverge.
 *
 * `id` is only used by the compiler to attribute a `TypstCompilationError`
 * back to a specific question (see `TypstCompilationError.questionId`) — for
 * an unsaved AI revision (no persisted id yet to attribute to) callers may
 * pass any stable placeholder, e.g. the question being revised.
 */
export async function compilePreviewFromContent(
  pdfCompiler: PdfCompilerPort,
  id: string,
  bodyTypst: string,
  alternatives: readonly string[],
  figureCode: string | undefined,
): Promise<Buffer> {
  const input: ExamPdfDocumentInput = {
    title: "Vista previa",
    versionLabel: "preview",
    questions: [
      {
        id,
        type: "structured",
        bodyTypst,
        alternatives,
        figureCode,
      },
    ],
  };
  return pdfCompiler.compileExam(input);
}
