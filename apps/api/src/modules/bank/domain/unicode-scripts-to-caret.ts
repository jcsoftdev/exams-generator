/**
 * What each script character means once it stops being a glyph and becomes
 * notation. The three Latin-1 strays (`²³¹`) sit in their own code points
 * rather than in the superscript block, which is why they are listed by hand
 * alongside it.
 */
const SUPERSCRIPT: ReadonlyMap<string, string> = new Map([
  ["⁰", "0"],
  ["¹", "1"],
  ["²", "2"],
  ["³", "3"],
  ["⁴", "4"],
  ["⁵", "5"],
  ["⁶", "6"],
  ["⁷", "7"],
  ["⁸", "8"],
  ["⁹", "9"],
  ["⁺", "+"],
  ["⁻", "-"],
  ["⁼", "="],
  ["⁽", "("],
  ["⁾", ")"],
  ["ⁿ", "n"],
  ["ⁱ", "i"],
]);

const SUBSCRIPT: ReadonlyMap<string, string> = new Map([
  ["₀", "0"],
  ["₁", "1"],
  ["₂", "2"],
  ["₃", "3"],
  ["₄", "4"],
  ["₅", "5"],
  ["₆", "6"],
  ["₇", "7"],
  ["₈", "8"],
  ["₉", "9"],
  ["₊", "+"],
  ["₋", "-"],
  ["₌", "="],
  ["₍", "("],
  ["₎", ")"],
  ["ₐ", "a"],
  ["ₑ", "e"],
  ["ₒ", "o"],
  ["ₓ", "x"],
  ["ₕ", "h"],
  ["ₖ", "k"],
  ["ₗ", "l"],
  ["ₘ", "m"],
  ["ₙ", "n"],
  ["ₚ", "p"],
  ["ₛ", "s"],
  ["ₜ", "t"],
]);

/**
 * What can carry a script: a letter, a digit, or a closing bracket. A script
 * preceded by anything else — whitespace, the start of the line, an operator
 * — has no base, and `promoteProseMath` would refuse the bare caret anyway.
 * Rewriting it would trade a drifting glyph for a literal `^2` on the page,
 * which is strictly worse, so those are left as they are.
 */
const BASE = /[\p{L}\d)\]]/u;

/**
 * Unit symbols that take an exponent without being algebra. `16 cm²` and
 * `2m/s²` are measurements, and a measurement belongs in upright text — a
 * caret would put it in math mode, italicise the symbol and, past the
 * slash, stack it into a two-storey fraction in the middle of a sentence.
 *
 * Only lowercase forms are listed. `A`, `V` and `N` are units too, but in
 * this corpus they are far more often a vertex or a matrix, and leaving `A²`
 * as a glyph would cost more than it saves.
 */
const UNIT_SYMBOLS = new Set([
  "m",
  "cm",
  "mm",
  "km",
  "dm",
  "s",
  "h",
  "min",
  "g",
  "kg",
  "mg",
  "l",
  "ml",
  "u",
  "rad",
  "mol",
]);

/**
 * Whether the script at `index` sits on a unit rather than on a variable.
 *
 * The tell is what precedes the symbol. A coefficient written against it —
 * `16m²`, `3x²` — is algebra, because nobody writes a measurement that way;
 * a symbol standing free after a space or a slash — `16 cm²`, `2m/s²` — is a
 * unit. That one rule separates the two without a list of variable names.
 */
function isUnitScript(raw: string, index: number): boolean {
  // A unit is only ever squared or cubed. Anything else in the exponent —
  // a sign, a letter, a second digit — is algebra: `f⁻¹` and `g⁻¹` are
  // inverse functions, and `g` is a gram in neither of them.
  if (!/^[¹²³](?![\u00B2\u00B3\u00B9\u2070-\u207F])/u.test(raw.slice(index))) {
    return false;
  }

  let start = index;
  while (start > 0 && /\p{L}/u.test(raw[start - 1]!)) {
    start--;
  }

  const symbol = raw.slice(start, index);
  // Matched case-sensitively, the way SI writes them: `H₂O` opens on a
  // capital H, which is hydrogen and not the hour.
  if (symbol.length === 0 || !UNIT_SYMBOLS.has(symbol)) {
    return false;
  }

  const before = raw[start - 1];
  return before === undefined || !/[\p{L}\d]/u.test(before);
}

/**
 * Rewrites the Unicode superscripts and subscripts a scrape left behind into
 * the caret and underscore notation Typst actually reads: `H(x) = 3x²`
 * becomes `H(x) = 3x^2`, and `a₁₂` becomes `a_(12)`.
 *
 * This is what lets 1396 collected statements reach `promoteProseMath` at
 * all. That module discovers a formula by finding a caret, and the harvest
 * transcribed most exponents as script GLYPHS instead — so an entire
 * polynomial like `6x⁵+ 13x⁴+ 4x³` carried no caret, was never promoted, and
 * reached both the preview and the PDF as ordinary text: upright variables,
 * prose spacing, no math layout at all.
 *
 * A run of two or more script characters is wrapped in parentheses. Typst
 * binds `^` to the term that follows it, and while consecutive digits do
 * lex as one number, `x^(-1)` and `x^(n+1)` do not — grouping every
 * multi-character run keeps one rule instead of a special case per shape.
 *
 * A segment carrying a backslash is returned untouched, for the same reason
 * `promoteProseMath` declines one: it is LaTeX that `convertLatexMathRuns`
 * could not translate, and editing inside it would only deepen the damage.
 */
export function unicodeScriptsToCaret(raw: string): string {
  if (raw.includes("\\")) {
    return raw;
  }

  let out = "";
  let index = 0;

  while (index < raw.length) {
    const character = raw[index]!;
    const table = SUPERSCRIPT.has(character) ? SUPERSCRIPT : SUBSCRIPT.has(character) ? SUBSCRIPT : undefined;

    if (table === undefined) {
      out += character;
      index++;
      continue;
    }

    // A script with nothing to attach to, or one measuring something rather
    // than raising it to a power, stays a glyph.
    // Only an exponent can measure something; a subscript never does.
    if (!BASE.test(raw[index - 1] ?? "") || (table === SUPERSCRIPT && isUnitScript(raw, index))) {
      out += character;
      index++;
      continue;
    }

    let run = "";
    while (index < raw.length && table.has(raw[index]!)) {
      run += table.get(raw[index]!)!;
      index++;
    }

    const marker = table === SUPERSCRIPT ? "^" : "_";
    out += run.length === 1 ? `${marker}${run}` : `${marker}(${run})`;
  }

  return out;
}
