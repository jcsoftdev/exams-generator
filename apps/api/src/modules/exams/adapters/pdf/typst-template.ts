import {
  ExamPdfDocumentInput,
  AnswerKeyDocumentInput,
} from "../../domain/ports/pdf-compiler.port";

/**
 * Pure Typst source generators — no I/O, no child_process. Testable without
 * the typst binary installed. Each question/answer-key entry is preceded by
 * a `// q:{id}` comment marker; `typst-error-mapper.ts` uses that marker to
 * trace a failing compile-time line number back to the offending question.
 */

export function renderExamTypst(input: ExamPdfDocumentInput): string {
  const logoBlock = input.tenantLogoAbsolutePath
    ? `#image("${input.tenantLogoAbsolutePath}", width: 3cm)\n\n`
    : "";

  const questionBlocks = input.questions
    .map(
      (question) =>
        `// q:${question.id}\n#image("${question.imageAbsolutePath}", width: 100%)`,
    )
    .join("\n\n");

  return `#set page(columns: 2, margin: 1.5cm)
#set text(size: 10pt)

${logoBlock}#align(center)[= ${input.title} --- ${input.versionLabel}]

${questionBlocks}
`;
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
