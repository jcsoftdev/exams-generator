import {
  ExamPdfDocumentInput,
  ExamPdfQuestion,
  ExamPdfSection,
  AnswerKeyDocumentInput,
} from "../../domain/ports/pdf-compiler.port";

/**
 * Pure Typst source generators — no I/O, no child_process. Testable without
 * the typst binary installed. Each question/answer-key entry is preceded by
 * a `// q:{id}` comment marker; `typst-error-mapper.ts` uses that marker to
 * trace a failing compile-time line number back to the offending question.
 */

const ALTERNATIVE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/**
 * Ceilings the printed page enforces on borrowed raster art, measured against
 * the two-column layout below.
 *
 * A complement scan has no intrinsic size the document can trust: the same
 * `width: 100%` that suits a wide diagram turns a tall one — a clock face, a
 * portrait poster — into a full-column block that pushes its own alternatives
 * onto the next page.
 *
 * The cap has to be a MAXIMUM, not a fixed size. Passing `height` to `image`
 * reserves exactly that much room whatever the picture measures, so a short
 * figure prints inside a tall band of white — visibly worse than the problem
 * being fixed. Measuring first and only shrinking the ones that overflow is
 * what makes it a ceiling.
 *
 * Alternative art is sized by HEIGHT rather than width for the opposite
 * reason: those are small glyphs of wildly different aspect (a tall pair of
 * stacked circles next to a squat rectangle), and a shared width makes the
 * tall ones enormous. A shared height makes five of them read as one row of
 * comparable options, which is what the question is asking the student to do.
 */
const COMPLEMENT_IMAGE_MAX_HEIGHT = "6cm";
const ALTERNATIVE_IMAGE_HEIGHT = "1.1cm";

export function renderExamTypst(input: ExamPdfDocumentInput): string {
  const logoBlock = input.tenantLogoAbsolutePath
    ? `#image("${input.tenantLogoAbsolutePath}", width: 3cm)\n\n`
    : "";

  const sectionBlocks = input.sections
    .map((section, sectionIndex) => renderSection(section, sectionIndex))
    .join("\n\n");

  // `#set page(columns: 2)` would put the WHOLE document inside two columns,
  // and inside that a heading can never span the full page width. With a
  // per-section `#columns(2)[...]` instead, the section title sits outside,
  // at full width, like the real booklet does (design doc §6.2).
  return `#set page(margin: 1.5cm)
#set text(size: 10pt)
// Fractions and roots are taller than the line they sit on, so the default
// leading lets stacked alternatives like $2/11$ / $3/11$ overlap.
#set par(leading: 0.8em)

${logoBlock}#align(center)[= ${input.title} --- ${input.versionLabel}]

${sectionBlocks}
`;
}

/**
 * Renders one booklet section: an optional full-width title, a page break
 * before every section but the first, and its blocks inside a two-column
 * flow. The question counter is local to the function — it restarts for
 * every section, which is exactly what the printed booklet does.
 */
function renderSection(section: ExamPdfSection, sectionIndex: number): string {
  const pageBreak = sectionIndex > 0 ? "#pagebreak()\n\n" : "";
  const heading = section.label ? `#align(center)[== ${section.label}]\n\n` : "";

  let number = 0;
  const body = section.blocks
    .map((block) => {
      const blockHeading = block.label ? `*${block.label}*\n\n` : "";
      const questions = block.questions
        .map((question) => renderQuestionBlock(question, ++number))
        .join("\n\n");
      return `${blockHeading}${questions}`;
    })
    .join("\n\n");

  return `${pageBreak}${heading}#columns(2)[
${body}
]`;
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
/**
 * A complement image at column width, shrunk only if it would otherwise stand
 * taller than `COMPLEMENT_IMAGE_MAX_HEIGHT`.
 *
 * `layout` rather than `context` because the decision needs the COLUMN's
 * width, and `measure` alone does not have it: measuring `image(.., width:
 * 100%)` outside a container resolves the percentage against nothing, so the
 * comparison silently never fires and every tall scan prints full size. The
 * aspect ratio comes from measuring the image at its natural size, which is
 * the one thing `measure` reports reliably.
 */
function renderCappedImage(absolutePath: string): string {
  return [
    "#layout(size => {",
    `  let natural = measure(image("${absolutePath}"))`,
    "  let scaled = size.width * (natural.height / natural.width)",
    `  if scaled > ${COMPLEMENT_IMAGE_MAX_HEIGHT} {`,
    `    image("${absolutePath}", height: ${COMPLEMENT_IMAGE_MAX_HEIGHT})`,
    `  } else { image("${absolutePath}", width: 100%) }`,
    "})",
  ].join("\n");
}

function renderStructuredQuestionBlock(
  question: Extract<ExamPdfQuestion, { type: "structured" }>,
  number: number,
): string {
  const figureBlock = question.figureCode ? `\n\n${question.figureCode}` : "";
  const imageBlock = question.imageAbsolutePath
    ? `\n\n${renderCappedImage(question.imageAbsolutePath)}`
    : "";
  const alternativesBlock = question.alternatives
    .map((alternative, index) => {
      const letter = ALTERNATIVE_LETTERS[index] ?? index + 1;
      const alternativeImagePath = question.alternativeImagePaths?.[index];
      // An alternative with its own image carries no text (`alternative` is
      // `""` for this variant) — render the image instead of an empty line.
      return alternativeImagePath
        // `#box` keeps the drawing on the SAME line as its letter. A bare
        // `#image` is taller than the line it sits on, so it wraps and the
        // option prints as "A)" with an orphaned picture underneath it.
        ? `${letter}) #box(image("${alternativeImagePath}", height: ${ALTERNATIVE_IMAGE_HEIGHT}))`
        : `${letter}) ${alternative}`;
    })
    .join(" \\ \n");

  return `// q:${question.id}
*${number}.* ${question.bodyTypst}${figureBlock}${imageBlock}

${alternativesBlock}`;
}

export function renderAnswerKeyTypst(input: AnswerKeyDocumentInput): string {
  // The printed cell is the question's POSITION in this form, matching the
  // `*N.*` numbering `renderStructuredQuestionBlock` prints on the exam — a
  // teacher grades against "14 -> C", and cannot do anything with a uuid.
  // The id stays in the `// q:` marker, which is what `typst-error-mapper.ts`
  // reads and is invisible in the rendered PDF.
  const rows = input.entries
    .map((entry, index) => `// q:${entry.questionId}\n  [${index + 1}], [${entry.correctOption}],`)
    .join("\n");

  return `#align(center)[= ${input.title} --- ${input.versionLabel} --- Clave de respuestas]

#table(
  columns: 2,
  [Pregunta], [Respuesta],
${rows}
)
`;
}
