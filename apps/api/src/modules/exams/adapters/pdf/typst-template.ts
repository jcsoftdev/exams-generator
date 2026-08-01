import {
  ExamPdfDocumentInput,
  ExamPdfQuestion,
  AnswerKeyDocumentInput,
} from "../../domain/ports/pdf-compiler.port";

/**
 * Pure Typst source generators — no I/O, no child_process. Testable without
 * the typst binary installed. Each question/answer-key entry is preceded by
 * a `// q:{id}` comment marker; `typst-error-mapper.ts` uses that marker to
 * trace a failing compile-time line number back to the offending question.
 */

const ALTERNATIVE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export function renderExamTypst(input: ExamPdfDocumentInput): string {
  const logoBlock = input.tenantLogoAbsolutePath
    ? `#image("${input.tenantLogoAbsolutePath}", width: 3cm)\n\n`
    : "";

  const questionBlocks = input.questions
    .map((question, index) => renderQuestionBlock(question, index + 1))
    .join("\n\n");

  return `#set page(columns: 2, margin: 1.5cm)
#set text(size: 10pt)

${logoBlock}#align(center)[= ${input.title} --- ${input.versionLabel}]

${questionBlocks}
`;
}

function renderQuestionBlock(question: ExamPdfQuestion, number: number): string {
  if (question.type === "structured") {
    return renderStructuredQuestionBlock(question, number);
  }
  return `// q:${question.id}\n#image("${question.imageAbsolutePath}", width: 100%)`;
}

/**
 * Structured questions carry no baked-in numbering/lettering (unlike image
 * questions, whose enunciado + alternatives are already flattened into the
 * uploaded image) — so, to match the SAME two-column, numbered visual style
 * as image questions, this block explicitly numbers the statement (`N.`)
 * and letters each alternative (`A)`, `B)`, ...). `bodyTypst` and
 * `figureCode` are trusted Typst/CeTZ markup, embedded verbatim (same trust
 * model as the image path string above). `imageAbsolutePath`, when present,
 * is a complement raster image (chart/diagram/passage scan that can't be
 * authored in Typst) — it renders alongside (not instead of) `figureCode`,
 * since one is vector drawing and the other is a real photo/scan.
 */
function renderStructuredQuestionBlock(
  question: Extract<ExamPdfQuestion, { type: "structured" }>,
  number: number,
): string {
  const figureBlock = question.figureCode ? `\n\n${question.figureCode}` : "";
  const imageBlock = question.imageAbsolutePath
    ? `\n\n#image("${question.imageAbsolutePath}", width: 100%)`
    : "";
  const alternativesBlock = question.alternatives
    .map((alternative, index) => {
      const letter = ALTERNATIVE_LETTERS[index] ?? index + 1;
      const alternativeImagePath = question.alternativeImagePaths?.[index];
      // An alternative with its own image carries no text (`alternative` is
      // `""` for this variant) — render the image instead of an empty line.
      return alternativeImagePath
        ? `${letter}) #image("${alternativeImagePath}", width: 35%)`
        : `${letter}) ${alternative}`;
    })
    .join(" \\ \n");

  return `// q:${question.id}
*${number}.* ${question.bodyTypst}${figureBlock}${imageBlock}

${alternativesBlock}`;
}

export function renderAnswerKeyTypst(input: AnswerKeyDocumentInput): string {
  const rows = input.entries
    .map(
      (entry) =>
        `// q:${entry.questionId}\n  [${entry.questionId}], [${entry.correctOption}],`,
    )
    .join("\n");

  return `#align(center)[= ${input.title} --- ${input.versionLabel} --- Clave de respuestas]

#table(
  columns: 2,
  [Pregunta], [Respuesta],
${rows}
)
`;
}
