/**
 * PdfCompilerPort — generates the printable exam PDF and its separate
 * answer-key PDF for one exam version. `type='image'` questions are single
 * baked images (enunciado + alternativas already flattened into one image)
 * embedded as-is. `type='structured'` questions (design doc §5.4) carry
 * Typst-markup `bodyTypst`, a JSON `alternatives` array, an optional CeTZ
 * `figureCode` (vector drawing), and an optional `imageAbsolutePath` (a
 * complement raster image — a chart/diagram/passage scan that can't be
 * authored in Typst) — the template renders enunciado + numbered
 * alternatives + figure/image with the SAME two-column, numbered visual
 * style as image questions.
 */
export interface ExamPdfImageQuestion {
  readonly id: string;
  readonly type?: "image";
  readonly imageAbsolutePath: string;
}

export interface ExamPdfStructuredQuestion {
  readonly id: string;
  readonly type: "structured";
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly figureCode?: string;
  readonly imageAbsolutePath?: string;
}

export type ExamPdfQuestion = ExamPdfImageQuestion | ExamPdfStructuredQuestion;

export interface ExamPdfDocumentInput {
  readonly title: string;
  readonly versionLabel: string;
  readonly tenantLogoAbsolutePath?: string;
  readonly questions: readonly ExamPdfQuestion[];
}

export interface AnswerKeyEntry {
  readonly questionId: string;
  readonly correctOption: string;
}

export interface AnswerKeyDocumentInput {
  readonly title: string;
  readonly versionLabel: string;
  readonly entries: readonly AnswerKeyEntry[];
}

export interface PdfCompilerPort {
  /** Compiles the 2-column exam booklet (with tenant logo) into PDF bytes. */
  compileExam(input: ExamPdfDocumentInput): Promise<Buffer>;

  /** Compiles the answer key as its own, separate PDF document. */
  compileAnswerKey(input: AnswerKeyDocumentInput): Promise<Buffer>;
}

/**
 * Raised when `typst compile` exits non-zero. `questionId` is populated
 * whenever the failing source line can be traced back to a `// q:{id}`
 * marker emitted alongside that question's image block (see
 * `typst-error-mapper.ts`) — this lets the caller surface a row-specific
 * error (e.g. "question X has a broken image") instead of failing exam
 * generation opaquely. `questionId` is `undefined` when the failure can't
 * be attributed to a specific question (e.g. a syntax error in the
 * template shell itself).
 */
export class TypstCompilationError extends Error {
  constructor(
    message: string,
    readonly questionId: string | undefined,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "TypstCompilationError";
  }
}
