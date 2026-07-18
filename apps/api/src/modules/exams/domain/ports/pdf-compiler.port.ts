/**
 * PdfCompilerPort — generates the printable exam PDF and its separate
 * answer-key PDF for one exam version. MVP questions are single baked
 * images (enunciado + alternativas already flattened into one image) — the
 * PDF layout embeds question images, it never renders structured question
 * text.
 */
export interface ExamPdfQuestion {
  readonly id: string;
  readonly imageAbsolutePath: string;
}

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
