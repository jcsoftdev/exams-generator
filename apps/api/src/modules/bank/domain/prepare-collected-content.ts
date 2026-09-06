import { escapeTypstText } from "./escape-typst-text";
import { convertLatexMathRuns } from "./latex-math-to-typst";
import { hashBodyTypst } from "./hash-body-typst";
import { normalizeTypstMathSymbols } from "./normalize-typst-math-symbols";
import { promoteProseMath } from "./promote-prose-math";
import { tightenUnicodeScripts } from "./tighten-unicode-scripts";
import { unicodeScriptsToCaret } from "./unicode-scripts-to-caret";
import { stripSolutionTail } from "./strip-solution-tail";
import { stripStatementPollution } from "./strip-statement-pollution";

export interface RawCollectedContent {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
}

export interface PreparedCollectedContent {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly bodyHash: string;
}

/**
 * The five repairs, in the one order they work in: LaTeX translation first,
 * then the three that turn scraped prose into formulas, and last the one
 * that can only run once those formulas have edges to sit inside.
 */
function repair(raw: string): string {
  return normalizeTypstMathSymbols(
    promoteProseMath(unicodeScriptsToCaret(tightenUnicodeScripts(convertLatexMathRuns(raw)))),
  );
}

/**
 * Maps ONE web-scraped entry's raw prose onto the columns a `questions` row
 * actually stores: `body_typst` / `alternatives` escaped for Typst (see
 * `escape-typst-text.ts` for the two failure modes that forces), and
 * `body_hash` computed from the RAW statement.
 *
 * Hashing raw rather than escaped is the load-bearing decision here. That
 * hash is the collected seeder's only dedup key — `tenant_id` is NULL on
 * every central-bank row and Postgres treats NULL as distinct from NULL, so
 * `questions_tenant_id_body_hash_idx` never catches these — and it is
 * recomputed from the JSON files on EVERY boot. Hashing the escaped form
 * would repin that key to whatever the escaper emits today: the rows
 * already in the bank were hashed before escaping existed, so the next boot
 * would miss all of them and insert the entire bank a second time. The raw
 * statement is the stable identity of a scraped question; how we render it
 * is not. Stripping runs AFTER the hash for the same reason.
 *
 * `convertLatexMathRuns` runs FIRST, ahead of the escaper. Part of the scrape
 * was transcribed into LaTeX rather than Typst (`$\dfrac{\alpha}{\beta}$`,
 * 244 runs), which Typst cannot compile — so those runs used to be escaped and
 * printed with their backslashes showing. Translating them here, and only when
 * every command is one the translator positively knows, turns them into real
 * formulas without ever handing Typst something it would choke on.
 *
 * `tightenUnicodeScripts`, `unicodeScriptsToCaret` and `promoteProseMath`
 * then repair the formulas
 * the scrape left as prose. The collected bank is almost entirely free of
 * math mode — 63855 of its 64257 statements hold no `$` at all — so a caret
 * reached the exam as a literal caret and an OCR-stranded exponent drifted
 * away from its base. They run BEFORE the escaper so that the dollars
 * `promoteProseMath` introduces are seen by `splitTypstMathSpans` as the
 * formulas they are — and that module's own `isMathRun` is the gate every
 * candidate passes before it is wrapped, so the escaper can never disagree
 * and turn a promoted formula back into printed dollars.
 *
 * `normalizeTypstMathSymbols` runs last of the repairs, once the formulas have
 * boundaries. Only then can the en dash a source page types for a minus be
 * told from the dash punctuating the sentence around it — Typst sets `–`
 * as the prose glyph it is, so `(x^4 – 9)` reaches the exam with a dash of
 * prose width where the minus belongs.
 *
 * Alternatives go through `stripSolutionTail` and the statement through
 * `stripStatementPollution`: the scrapes glued the source page's answer key
 * onto the last option (audit 2026-08-20, H2) and, in the statement, a whole
 * foreign exercise block or a word dropped mid-sentence (H8). The two use
 * different rules because they fail differently — see
 * `strip-statement-pollution.ts`.
 */
export function prepareCollectedContent(raw: RawCollectedContent): PreparedCollectedContent {
  return {
    bodyTypst: escapeTypstText(repair(stripStatementPollution(raw.bodyTypst))),
    alternatives: raw.alternatives.map((alternative) =>
      escapeTypstText(repair(stripSolutionTail(alternative))),
    ),
    bodyHash: hashBodyTypst(raw.bodyTypst),
  };
}
