import { MATH_IDENTIFIERS, PROSE_ONLY, isMathRun, splitTypstMathSpans } from "./split-typst-math-spans";

/**
 * Characters that carry meaning inside a formula and none outside one. `.`
 * and `,` are here so a decimal survives the scan; both are trimmed again
 * when they end up on an edge, where they are sentence punctuation instead.
 */
const MATH_SYMBOLS = new Set([
  "+",
  "-",
  "*",
  "/",
  "=",
  "<",
  ">",
  "(",
  ")",
  ",",
  ".",
  "|",
  "·",
  "±",
  "×",
  "÷",
  "≤",
  "≥",
  "≠",
  "≈",
  "≡",
  "!",
  // The three dashes a scrape puts where a minus belongs. An en dash is the
  // one Peruvian source pages actually type, and OCR of a printed minus
  // lands on U+2212 as often as on the hyphen.
  "–",
  "—",
  "−",
  // Peruvian material separates a polynomial's arguments with a semicolon:
  // `P(x; y)`, `F(a; b; c)`. Left out, it ends the run one character into
  // the very formula the run was opened for.
  ";",
  // Set membership, which `normalizeTypstMathSymbols` later spells `in`.
  "∈",
  "∉",
]);

/**
 * A run needs a base on the left of its caret and an exponent on its right.
 * Without both, the caret is a stray character and Typst answers a bare `^`
 * with a compile error rather than a superscript.
 */
const HAS_BASE = /[\p{L}\d)]\s*\^/u;
const HAS_EXPONENT = /\^\s*\(?\s*[\p{L}\d–—−-]/u;

/**
 * The relations that only ever appear in a statement of equality — with a
 * term on each side, because a dangling `=` is punctuation the scrape left
 * behind rather than an equation.
 */
const RELATION_FORM = /[\p{L}\d)|]\s*(?:!=|<=|>=|[=<>≤≥≠≈≡∈∉])\s*[-+–—−]?\s*[\p{L}\d(|ℤℝℕℚℂ]/u;

/** `P(x)`, `f(x + 1)`, `sen(2t)` — a name applied to an argument. */
const FUNCTION_FORM = /[\p{L}]\s*\(\s*[\p{L}\d][^)]*\)/u;

/** An arithmetic operator binding two terms: `3x+2`, `(a+b+c)÷17`. */
const OPERATOR_FORM = /[\p{L}\d)|]\s*[+*·×÷±–—−-]\s*[-+–—−]?\s*[\p{L}\d(|]/u;

/**
 * The characters that can START a formula. Prose holding none of them holds
 * no formula either, and skipping it keeps this off the tokenizer for the
 * ~90% of the bank that is pure Spanish.
 */
const ANY_ANCHOR = /[\^=<>≤≥≠≈≡+*·×÷±!(–—−∈∉-]/u;

/** Symbols that anchor a run on their own, without needing a caret. */
const RELATION_ANCHORS = new Set(["=", "<", ">", "≤", "≥", "≠", "≈", "≡", "!", "∈", "∉"]);
/**
 * A slash is deliberately NOT here. It divides in `(a+b)/2` and it separates
 * a unit in `2m/s`, and the corpus holds far more of the second — so as an
 * anchor it earns a handful of fractions and loses every unit on the page.
 * It stays in `MATH_SYMBOLS`, so a run anchored on something else still
 * takes it in: `(a^3 + b^3) / (a^2 + b^2)` is promoted whole.
 */
const OPERATOR_ANCHORS = new Set(["+", "-", "*", "·", "×", "÷", "±", "–", "—", "−"]);

/**
 * The Spanish conjunctions that are also plausible variable names. Left at an
 * edge of a run they are almost always the conjunction — `= 36 y la recta`
 * joins two clauses — so they are trimmed there, and only there. Any other
 * lone letter at an edge stays: `7 cos^2 x` really does end in a variable.
 */
const EDGE_CONJUNCTIONS = new Set(["y", "o", "e", "u"]);

/** Symbols that legitimately OPEN an expression, so a left edge keeps them. */
const OPENING_SYMBOLS = new Set(["(", "-", "–", "—", "−", "|"]);

/** Symbols that legitimately CLOSE one, so a right edge keeps them. */
const CLOSING_SYMBOLS = new Set([")", "|"]);

/**
 * Two-letter Spanish function words. `isMathRun` lets any one- or two-letter
 * run through, which is right when an author already put the dollars around a
 * formula — but this module is DISCOVERING where the formula ends, and there
 * `si` bridges two independent clauses: `(a^2 + b^2) si a + b = 3` is one
 * expression, a conjunction, and another expression. None of these is ever a
 * variable name; products of variables (`ab`, `xy`, `mn`) are not in the set
 * and keep passing.
 */
const SPANISH_FUNCTION_WORDS = new Set([
  "si",
  "de",
  "en",
  "el",
  "la",
  "lo",
  "un",
  "es",
  "al",
  "se",
  "su",
  "no",
  "ni",
  "me",
  "te",
  "le",
  "yo",
  "tu",
  "da",
  "ya",
]);

type TokenKind = "word" | "number" | "space" | "symbol" | "caret" | "stop";

interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Rewrites the formulas a scrape left as bare prose into real Typst math:
 * `Factorizar: ax^2 - 5ax + 6a.` becomes `Factorizar: $ax^2 - 5ax + 6a$.`
 *
 * Until this ran, a caret reached the exam as a literal caret. Typst only
 * reads `^` as a superscript inside math mode, and the collected bank has
 * essentially no math mode in it — 63855 of its 64257 statements carry no
 * `$` at all. So `4x^2` printed as "4x^2" on the page and showed the same
 * way in the teacher's preview, which is the report this module answers.
 *
 * Where a formula ENDS is the whole problem, because Spanish prose and
 * algebra share an alphabet. The boundary rule is deliberately the one
 * `split-typst-math-spans.ts` already calibrated for the opposite question:
 * a letter run of three or more is prose unless it is a known math
 * identifier, and one- or two-letter runs are variables. That is what makes
 * `hallar a^2 + b^2` stop where it does, and it means the bank has ONE
 * definition of "this is a formula" rather than two that can disagree.
 *
 * Every candidate is put to `isMathRun` before it is wrapped. That is not
 * belt-and-braces: `escapeTypstText` runs after this and consults the same
 * judge, so a run this module wrapped but that judge rejects would have its
 * dollars escaped and PRINT as dollars. Sharing the gate makes that
 * disagreement impossible.
 */
export function promoteProseMath(raw: string): string {
  return splitTypstMathSpans(raw)
    .map((segment) => (segment.kind === "math" ? `$${segment.value}$` : promoteInProse(segment.value)))
    .join("");
}

/**
 * A segment holding a dollar or a backslash is left exactly as it is. Both
 * mean the harvest already tried to mark up this statement and failed — an
 * unpaired currency sign, or LaTeX that `convertLatexMathRuns` could not
 * translate. Promoting a run inside one nests dollars into a string that
 * already has some, which is a compile error rather than a formula.
 */
function promoteInProse(prose: string): string {
  if (prose.includes("$") || prose.includes("\\") || !ANY_ANCHOR.test(prose)) {
    return prose;
  }

  const tokens = tokenize(prose);
  const pieces: string[] = [];
  let consumed = 0;
  let index = 0;
  let floor = 0;

  while (index < tokens.length) {
    if (!isAnchor(tokens, index)) {
      index++;
      continue;
    }

    const span = expand(tokens, index, floor);
    if (!span) {
      index++;
      continue;
    }

    const run = prose.slice(tokens[span.left]!.start, tokens[span.right]!.end);
    if (!isPromotable(run)) {
      index++;
      continue;
    }

    pieces.push(prose.slice(consumed, tokens[span.left]!.start), `$${run}$`);
    consumed = tokens[span.right]!.end;
    floor = span.right + 1;
    index = span.right + 1;
  }

  pieces.push(prose.slice(consumed));
  return pieces.join("");
}

/** Grows the widest eligible run around `caret`, then trims its edges back. */
function expand(
  tokens: readonly Token[],
  anchor: number,
  floor: number,
): { left: number; right: number } | null {
  let left = anchor;
  let right = anchor;

  while (left - 1 >= floor && isEligible(tokens, left - 1)) {
    left--;
  }
  while (right + 1 < tokens.length && isEligible(tokens, right + 1)) {
    right++;
  }

  // Pull the edges back off anything that is punctuation rather than part of
  // the expression: whitespace, a sentence comma or period, a binary operator
  // with nothing to bind (`2my^2 +`), and a conjunction the scan reached
  // across whitespace (`= 36 y la recta`). A bracket is kept on the edge it
  // belongs to — `(` and `-` and `|` open an expression, `)` and `|` close
  // one — so trimming never breaks the pair `isBalanced` then checks.
  const trimmable = (index: number, atLeftEdge: boolean): boolean => {
    const token = tokens[index]!;
    if (token.kind === "space") {
      return true;
    }
    if (token.kind === "symbol") {
      return !(atLeftEdge ? OPENING_SYMBOLS : CLOSING_SYMBOLS).has(token.value);
    }
    return (
      token.kind === "word" &&
      EDGE_CONJUNCTIONS.has(token.value.toLowerCase()) &&
      tokens[index + (atLeftEdge ? 1 : -1)]?.kind === "space"
    );
  };

  while (left <= right && left !== anchor && trimmable(left, true)) {
    left++;
  }
  while (right >= left && right !== anchor && trimmable(right, false)) {
    right--;
  }

  return left <= right && isBalanced(tokens, left, right) ? { left, right } : null;
}

/**
 * Only a run whose parentheses close can be wrapped. An unbalanced one is
 * exactly the "unclosed delimiter" that fails a whole generation job, and
 * `isMathRun` does not count brackets.
 */
function isBalanced(tokens: readonly Token[], left: number, right: number): boolean {
  let depth = 0;
  for (let index = left; index <= right; index++) {
    const token = tokens[index]!;
    if (token.value === "(") {
      depth++;
    } else if (token.value === ")") {
      depth--;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

/**
 * A run is worth wrapping when it holds one of the four shapes a formula
 * takes in this corpus, and `isMathRun` agrees it is not prose.
 *
 * The arithmetic shape is the loosest of the four, so it carries two extra
 * conditions: the run must hold a letter AND a digit. Without them, `3-4` in
 * "3-4 años" and `12/05` in a date would both read as expressions, and a
 * wrongly wrapped date is a worse page than an unwrapped subtraction.
 */
function isPromotable(run: string): boolean {
  if (!isMathRun(run) || !everyScriptIsBound(run)) {
    return false;
  }
  if (HAS_BASE.test(run) && HAS_EXPONENT.test(run)) {
    return true;
  }
  if (RELATION_FORM.test(run) || FUNCTION_FORM.test(run)) {
    return true;
  }
  return OPERATOR_FORM.test(run) && /\p{L}/u.test(run) && /\d/.test(run);
}

/**
 * Whether EVERY `^` and `_` in the run has something to raise and something
 * to raise it by.
 *
 * Checked per script, not per run, and that distinction is the whole point.
 * A run anchored on an equation can perfectly well satisfy `HAS_BASE`
 * somewhere and still open with a stranded caret — `^6x = 0,25`, where a
 * degree sign cut the base away — and wrapping that in dollars does not
 * merely print it wrong. Typst answers a bare hat with "unexpected hat" and
 * fails the document, so one such statement takes every other question on
 * the exam down with it. Left unwrapped the caret reaches `escapeTypstText`
 * instead, which prints it as the character it is.
 */
function everyScriptIsBound(run: string): boolean {
  for (let index = 0; index < run.length; index++) {
    if (run[index] !== "^" && run[index] !== "_") {
      continue;
    }
    const before = run.slice(0, index).trimEnd();
    const after = run.slice(index + 1).trimStart();
    if (!/[\p{L}\d)\]|]$/u.test(before) || !/^\(?[\p{L}\d+–—−-]/u.test(after)) {
      return false;
    }
  }
  return true;
}

/**
 * Where a scan starts. A caret and a relation speak for themselves; an
 * arithmetic operator and a function application are weaker signals, which
 * is why `isPromotable` re-examines the run they produce.
 *
 * A function application is anchored on the NAME, not on its bracket, so
 * that the run opens at `P` rather than mid-expression — and only when that
 * name is a token `isEligible` would accept anyway, which is what keeps
 * "en (x - 2)" and "reparte (x + 2) chocolates" out.
 */
function isAnchor(tokens: readonly Token[], index: number): boolean {
  const token = tokens[index]!;
  if (token.kind === "caret") {
    return true;
  }
  if (token.kind === "symbol") {
    return RELATION_ANCHORS.has(token.value) || OPERATOR_ANCHORS.has(token.value);
  }
  return token.kind === "word" && isEligible(tokens, index) && tokens[index + 1]?.value === "(";
}

/**
 * Whether `y`/`o`/`e`/`u` at this position joins two clauses rather than
 * naming a variable. The tell is what flanks it: a conjunction sits between
 * two COMPLETE terms — `= 5 y ab = 3` — while a variable sits next to an
 * operator, as in `x + y = 5`. Reading it wrong in either direction splices
 * two equations into one or cuts a real expression in half, so the run is
 * stopped here rather than merely trimmed at the edge.
 */
function isJoiningConjunction(tokens: readonly Token[], index: number): boolean {
  if (!EDGE_CONJUNCTIONS.has(tokens[index]!.value.toLowerCase())) {
    return false;
  }

  const neighbour = (step: number): Token | undefined => {
    let cursor = index + step;
    while (tokens[cursor]?.kind === "space") {
      cursor += step;
    }
    return tokens[cursor];
  };

  const isTerm = (token: Token | undefined): boolean =>
    token !== undefined && (token.kind === "number" || token.kind === "word" || token.value === ")");

  return isTerm(neighbour(-1)) && isTerm(neighbour(1));
}

/**
 * Whether the word at this position is an abbreviation rather than a
 * variable. A period followed by a space is the tell — `pp. 109-227` is a
 * page range in a citation, and without this rule the scan takes `pp` for a
 * variable and the hyphen for a minus, and prints a bibliography in italics
 * as though it were algebra.
 */
function isAbbreviation(tokens: readonly Token[], index: number): boolean {
  return tokens[index + 1]?.value === "." && tokens[index + 2]?.kind === "space";
}

function isEligible(tokens: readonly Token[], index: number): boolean {
  const token = tokens[index]!;
  switch (token.kind) {
    case "number":
    case "space":
    case "symbol":
    case "caret":
      return true;
    case "word":
      return (
        !PROSE_ONLY.test(token.value) &&
        !SPANISH_FUNCTION_WORDS.has(token.value.toLowerCase()) &&
        (token.value.length <= 2 || MATH_IDENTIFIERS.has(token.value)) &&
        !isAbbreviation(tokens, index) &&
        !isJoiningConjunction(tokens, index)
      );
    case "stop":
      return false;
  }
}

function tokenize(prose: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < prose.length) {
    const start = index;
    const character = prose[index]!;

    if (character === "^") {
      index++;
      tokens.push({ kind: "caret", value: character, start, end: index });
      continue;
    }

    if (character === " " || character === "\t") {
      while (index < prose.length && (prose[index] === " " || prose[index] === "\t")) {
        index++;
      }
      tokens.push({ kind: "space", value: prose.slice(start, index), start, end: index });
      continue;
    }

    if (/\d/.test(character)) {
      while (index < prose.length && /\d/.test(prose[index]!)) {
        index++;
      }
      tokens.push({ kind: "number", value: prose.slice(start, index), start, end: index });
      continue;
    }

    if (/\p{L}/u.test(character)) {
      while (index < prose.length && /\p{L}/u.test(prose[index]!)) {
        index++;
      }
      tokens.push({ kind: "word", value: prose.slice(start, index), start, end: index });
      continue;
    }

    index++;
    tokens.push({
      kind: MATH_SYMBOLS.has(character) ? "symbol" : "stop",
      value: character,
      start,
      end: index,
    });
  }

  return tokens;
}
