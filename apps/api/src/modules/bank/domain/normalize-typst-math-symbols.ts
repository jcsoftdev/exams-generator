import { TYPST_MATH_NAMES, splitTypstMathSpans } from "./split-typst-math-spans";

/**
 * What each scraped glyph is called in Typst.
 *
 * Some of these Typst would render on its own — it knows `≤` and `×`. They
 * are here anyway so that ONE spelling reaches the compiler, because the
 * bank is mixed at the character level: the same relation arrives as `<=`
 * from a LaTeX translation, as `≤` from a copy-paste, and as `≦` from OCR.
 * Normalising at ingest is what keeps `escapeTypstText` and the template
 * from having to know about all three.
 *
 * Every word on the right is in `MATH_IDENTIFIERS`. That is load-bearing:
 * `isMathRun` reads the run again after this, and a name it did not
 * recognise would demote the whole formula back to escaped prose.
 */
const SYMBOLS: readonly (readonly [RegExp, string])[] = [
  // The three dashes a source page types where a minus belongs.
  [/[–—−]/gu, "-"],
  // Numeric sets, which Typst spells by doubling the letter.
  [/ℤ/gu, "ZZ"],
  [/ℝ/gu, "RR"],
  [/ℕ/gu, "NN"],
  [/ℚ/gu, "QQ"],
  [/ℂ/gu, "CC"],
  [/∅/gu, "nothing"],
  // Relations.
  [/[≤≦]/gu, "<="],
  [/[≥≧]/gu, ">="],
  [/≠/gu, "!="],
  [/≈/gu, " approx "],
  [/≡/gu, " equiv "],
  [/∈/gu, " in "],
  [/∉/gu, " in.not "],
  [/⊂/gu, " subset "],
  [/⊆/gu, " subset.eq "],
  [/∪/gu, " union "],
  [/∩/gu, " inter "],
  // Operators.
  [/×/gu, " times "],
  [/÷/gu, " div "],
  [/±/gu, " plus.minus "],
  // Typst folds a middle dot into the identifier beside it, so `x·y` is one
  // unknown name rather than a product.
  [/·/gu, " dot "],
  [/∞/gu, " infinity "],
];

/**
 * Spellings the corpus uses for a name Typst defines under another one.
 * `sen` is the Peruvian spelling of the sine and appears throughout the
 * bank; Typst has never heard of it, and answers `$sen^2 x$` with "unknown
 * variable: sen" — a hard error that fails the entire exam, not one
 * question. The rest are LaTeX habits the harvest carried over.
 */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ["sen", "sin"],
  ["arcsen", "arcsin"],
  ["cdot", "dot"],
  ["sect", "inter"],
  ["nin", "in.not"],
  ["subseteq", "subset.eq"],
  ["supseteq", "supset.eq"],
  ["int", "integral"],
  ["oint", "integral.cont"],
  ["prod", "product"],
  ["diff", "dif"],
  // Typst defines no inverse secant, cosecant or cotangent. `op("...")`
  // sets the name upright and spaces it as the operator it is, which is
  // what the source page printed and what `sec^(-1)` would not be.
  ["arcsec", 'op("arcsec")'],
  ["arccsc", 'op("arccsc")'],
  ["arccot", 'op("arccot")'],
]);

/**
 * What Typst reads as ONE identifier: a letter followed by more letters or
 * digits, and the dotted names built from those. The digits matter —
 * `sin2x` is a single unknown name to the compiler, not the sine of `2x` —
 * and they are why this cannot simply match runs of letters.
 */
const IDENTIFIER = /\p{L}[\p{L}\d]*(?:\.\p{L}[\p{L}\d]*)*/gu;

/**
 * Everything between double quotes, which in Typst math is a literal string
 * the author wrote — `$"Re"(z)$` labels the real part — and never an
 * identifier to be taken apart.
 */
const QUOTED = /"[^"]*"/g;

/** The longest run of letters an identifier opens with. */
const LEADING_NAME = /^\p{L}+/u;

/** Runs of whitespace a word substitution leaves behind. */
const RUN_OF_SPACES = /[ \t]{2,}/g;

/**
 * Rewrites the Unicode a scrape left inside a Typst formula as the notation
 * Typst reads: `$x ∈ ℤ$` becomes `$x in ZZ$`, `$(x^4 – 9)$` becomes
 * `$(x^4 - 9)$`.
 *
 * A dash is the clearest case of why this is a repair rather than a
 * restyling. Typst has no opinion about `–`: in math mode it sets the glyph
 * as it found it, so the expression reaches the exam with a dash of prose
 * width and prose spacing where the minus belongs.
 *
 * It runs on the MATH SPANS ONLY, and that is what keeps it honest. A dash
 * in the prose around a formula is punctuation, and `∈` in a sentence is a
 * symbol the reader is meant to see. `promoteProseMath` has already decided
 * where the formulas are, and `splitTypstMathSpans` is the same judge it
 * used, so the two can never disagree about a boundary.
 */
export function normalizeTypstMathSymbols(raw: string): string {
  return splitTypstMathSpans(raw)
    .map((segment) => (segment.kind === "math" ? `$${normalizeRun(segment.value)}$` : segment.value))
    .join("");
}

function normalizeRun(run: string): string {
  let out = run;
  for (const [pattern, replacement] of SYMBOLS) {
    out = out.replace(pattern, replacement);
  }
  return outsideStrings(out, (part) => part.replace(IDENTIFIER, resolveIdentifier))
    .replace(RUN_OF_SPACES, " ")
    .trim();
}

/** Applies `rewrite` to everything in `run` that is not inside a string. */
function outsideStrings(run: string, rewrite: (part: string) => string): string {
  const pieces: string[] = [];
  let consumed = 0;
  for (const match of run.matchAll(QUOTED)) {
    pieces.push(rewrite(run.slice(consumed, match.index)), match[0]);
    consumed = match.index + match[0].length;
  }
  pieces.push(rewrite(run.slice(consumed)));
  return pieces.join("");
}

/**
 * Makes one multi-letter run something Typst will actually compile.
 *
 * Typst reads any run of two or more letters in math mode as an IDENTIFIER
 * and looks it up. A name it does not know is not set in italics as a
 * reader might expect — it is "unknown variable: ab", an error that fails
 * the whole document. So the product `ab` becomes `a b`, which Typst sets
 * exactly as the corpus means it, and `sen` becomes the `sin` it stands
 * for.
 *
 * A run touching a dot is left alone: it is one half of a name like
 * `in.not` or `subset.eq`, and splitting `eq` into `e q` would invent a
 * variable where a relation belongs.
 */
function resolveIdentifier(word: string): string {
  const resolved = resolveName(word);
  if (resolved !== undefined) {
    return resolved;
  }

  // A dotted name Typst does not know is not one name. `sen2x.cos2x` is two
  // functions the scrape ran together, so each half is resolved on its own
  // and the period is left standing between them.
  if (word.includes(".")) {
    return word.split(".").map(resolveIdentifier).join(".");
  }

  if (word.length === 1) {
    return word;
  }

  // A known function run into its argument: `sin2x`. Keep the name whole
  // and space out what followed it, so the run reads as the application it
  // is rather than as one invented variable.
  const leading = LEADING_NAME.exec(word)?.[0];
  const name = leading === undefined ? undefined : resolveName(leading);
  if (leading !== undefined && name !== undefined) {
    return [name, ...word.slice(leading.length)].join(" ");
  }

  return [...word].join(" ");
}

/** The Typst spelling of `word`, or `undefined` if Typst has no such name. */
function resolveName(word: string): string | undefined {
  return ALIASES.get(word) ?? (TYPST_MATH_NAMES.has(word) ? word : undefined);
}
