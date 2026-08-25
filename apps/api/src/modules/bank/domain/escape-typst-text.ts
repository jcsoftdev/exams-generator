import { splitTypstMathSpans } from "./split-typst-math-spans";

/**
 * Characters Typst reads as markup anywhere in a line. `\` is deliberately
 * absent — it has to be escaped FIRST, on its own, or it would also escape
 * the backslashes this function itself introduces.
 */
const INLINE_MARKUP = /[#$*_`@<>~[\]]/g;

/**
 * Characters Typst only reads as markup at the START of a line: `=` heading,
 * `-` list item, `+` enum item, `/` term-list item. Mid-line they are
 * ordinary text — "5 - 3 = 2" and a verse break "yerta, / chorreando" both
 * have to stay readable — so these are escaped positionally, never globally.
 */
const LINE_START_SYMBOL = /^(\s*)([=\-+/])/;

/**
 * `1.` at the start of a line opens a numbered enum. Scraped statements
 * routinely begin with one ("1. Determinar el conjunto…"), which silently
 * turns the statement into a list item; a decimal mid-sentence ("3.14") is
 * untouched.
 */
const LINE_START_ENUM = /^(\s*)(\d+)\./;

/**
 * Turns PLAIN TEXT into Typst markup that renders it verbatim.
 *
 * `typst-template.ts` embeds `bodyTypst`/`alternatives` into the document
 * verbatim, on the documented assumption that they already ARE trusted
 * Typst markup — true for AI-generated questions, which are prompted and
 * validated as such. It is NOT true for the web-scraped bank under
 * `db/data/collected/`, whose statements are raw prose that happens to
 * contain markup characters. Two distinct failure modes came out of that:
 *
 *   - loud: `Expresar 532_(6)` -> "error: unclosed delimiter", which fails
 *     the whole generation job;
 *   - silent, and worse: `34_(n) + 15_(n)` pairs into emphasis and PRINTS
 *     as "3 4 (n) + 1 5 (n)" — a wrong exam, with no error anywhere.
 *
 * So collected content is escaped at INGEST (see `seed-collected-questions.ts`
 * and `scripts/normalize-collected-content.ts`), never at render time: escaping
 * in the template would equally destroy the legitimate `$...$` math and CeTZ
 * figures that AI-authored questions rely on.
 *
 * The collected corpus turned out not to be uniformly raw prose, though. Part
 * of it was transcribed into real Typst math by the harvest pipeline, so this
 * escapes PER SEGMENT (`split-typst-math-spans.ts`): prose is escaped as
 * before, and a run the splitter recognises as a formula is re-emitted with
 * its dollars intact. Escaping those too is what printed `$cot(1/2 cdot
 * arcsec(61/60))$` literally in the 2026-08-23 exam.
 */
export function escapeTypstText(raw: string): string {
  return splitTypstMathSpans(raw)
    .map((segment) =>
      segment.kind === "math" ? `$${segment.value}$` : escapeTextSegment(segment.value, segment.atLineStart),
    )
    .join("");
}

/**
 * Escapes one prose run. `atLineStart` says whether the run's FIRST line is
 * a real line start — a run sitting after a formula on the same line is not,
 * and its leading `-` is an ordinary minus rather than a list marker. Every
 * later line inside the run always is.
 */
function escapeTextSegment(raw: string, atLineStart: boolean): string {
  const inlineEscaped = raw.replace(/\\/g, "\\\\").replace(INLINE_MARKUP, (character) => `\\${character}`);

  return inlineEscaped
    .split("\n")
    .map((line, index) =>
      index === 0 && !atLineStart
        ? line
        : line
            .replace(LINE_START_SYMBOL, (_match, indent: string, marker: string) => `${indent}\\${marker}`)
            .replace(LINE_START_ENUM, (_match, indent: string, digits: string) => `${indent}${digits}\\.`),
    )
    .join("\n");
}
