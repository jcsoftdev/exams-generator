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
  /**
   * Per-alternative image paths, index-aligned with `alternatives` for THIS
   * version (i.e. already permuted the same way `alternatives` was — see
   * `version-shuffler.ts`). When `alternativeImagePaths[i]` is present, the
   * template renders alternative `i` as that image instead of its (empty)
   * text — see `renderStructuredQuestionBlock` in `typst-template.ts`.
   */
  readonly alternativeImagePaths?: readonly (string | undefined)[];
}

export type ExamPdfQuestion = ExamPdfImageQuestion | ExamPdfStructuredQuestion;

/**
 * A printed block of the booklet. An empty `label` means "no heading" (the
 * single-question preview, and versions generated before the official layout
 * feature).
 *
 * A block spans several courses by definition — the UNI prints "MATEMÁTICA"
 * as a single 40-question block (design doc §2.2).
 */
export interface ExamPdfBlock {
  readonly label: string;
  readonly questions: readonly ExamPdfQuestion[];
}

/**
 * A section of the booklet — the "prueba" (E1/E2/E3) at UNI, the curricular
 * area at UNCP. A missing/null `label` means no heading and no page break.
 * The printed numbering restarts at every section.
 */
export interface ExamPdfSection {
  readonly code?: string | null;
  readonly label?: string | null;
  readonly blocks: readonly ExamPdfBlock[];
}

export interface ExamPdfDocumentInput {
  readonly title: string;
  readonly versionLabel: string;
  readonly tenantLogoAbsolutePath?: string;
  readonly sections: readonly ExamPdfSection[];
}

export interface AnswerKeyEntry {
  readonly questionId: string;
  readonly correctOption: string;
}

/**
 * A stretch of the answer key that corresponds to one booklet section. Its
 * numbering is LOCAL: if the booklet says "14", the key has to say "14" too,
 * not that question's global position in the exam (design doc §6.3).
 */
export interface AnswerKeySection {
  readonly label?: string | null;
  readonly entries: readonly AnswerKeyEntry[];
}

export interface AnswerKeyDocumentInput {
  readonly title: string;
  readonly versionLabel: string;
  readonly sections: readonly AnswerKeySection[];
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
