/**
 * Identifiers Typst math mode gives a meaning to. Anything else spelled out
 * in letters inside a `$...$` run is Spanish prose, and the run is therefore
 * a pair of currency signs rather than a formula.
 *
 * A WHITELIST, not a blacklist of Spanish words, because the two fail in
 * opposite directions. An unknown Spanish word slipping past a blacklist
 * un-escapes prose and breaks the compile; an unknown math identifier
 * missing from this whitelist merely escapes a formula that would have
 * rendered — the behaviour the bank already had before this module existed.
 * Only the second failure is survivable, so the default has to be "prose".
 */
const MATH_IDENTIFIERS = new Set([
  // trigonometry, including the `sen`/`tg`/`ctg` spellings Peruvian material uses
  "sin",
  "sen",
  "cos",
  "tan",
  "tg",
  "ctg",
  "sec",
  "csc",
  "cot",
  "sinh",
  "cosh",
  "tanh",
  "arcsin",
  "arcsen",
  "arccos",
  "arctan",
  "arcsec",
  "arccsc",
  "arccot",
  // analysis
  "log",
  "ln",
  "lg",
  "exp",
  "lim",
  "limsup",
  "liminf",
  "sup",
  "inf",
  "sum",
  "prod",
  "int",
  "integral",
  "oint",
  "diff",
  "dif",
  "partial",
  // constructors
  "sqrt",
  "root",
  "frac",
  "binom",
  "vec",
  "mat",
  "cases",
  "abs",
  "norm",
  "floor",
  "ceil",
  "overline",
  "underline",
  "hat",
  "bar",
  "tilde",
  "arrow",
  "arrows",
  "harpoon",
  "text",
  "upright",
  "italic",
  "bold",
  "display",
  "inline",
  "mod",
  "det",
  "dim",
  "ker",
  "deg",
  "gcd",
  "lcm",
  "max",
  "min",
  // operators and relations
  "cdot",
  "dot",
  "dots",
  "times",
  "div",
  "plus",
  "minus",
  "circle",
  "star",
  "approx",
  "equiv",
  "prop",
  "perp",
  "parallel",
  "angle",
  "degree",
  "triangle",
  "square",
  // sets and logic
  "in",
  "nin",
  "subset",
  "supset",
  "subseteq",
  "supseteq",
  "union",
  "sect",
  "inter",
  "emptyset",
  "nothing",
  "forall",
  "exists",
  "and",
  "or",
  "not",
  "if",
  "otherwise",
  "infinity",
  "oo",
  // greek
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "omicron",
  "pi",
  "rho",
  "sigma",
  "tau",
  "upsilon",
  "phi",
  "chi",
  "psi",
  "omega",
  "Alpha",
  "Beta",
  "Gamma",
  "Delta",
  "Epsilon",
  "Theta",
  "Lambda",
  "Xi",
  "Pi",
  "Sigma",
  "Upsilon",
  "Phi",
  "Psi",
  "Omega",
  // spacing
  "space",
  "quad",
  "thick",
  "thin",
  "med",
  "wide",
]);

/**
 * Runs of three or more letters are the ones that have to be recognised.
 * One- and two-letter runs are left free: they are variable names (`x`,
 * `AB`, `dy`) and blackboard sets (`RR`, `NN`), never Spanish words worth
 * ruling on.
 */
const LETTER_RUN = /\p{L}{3,}/gu;

/**
 * Characters that only appear in Spanish prose. `¿`/`¡` are unambiguous, and
 * an accent inside a formula means the run swallowed a word.
 */
const PROSE_ONLY = /[¿¡?áéíóúüñÁÉÍÓÚÜÑ]/u;

/**
 * Longest `$...$` run this will consider. Authored formulas in the bank top
 * out around 80 characters; a longer run is a currency sign that happened to
 * find a partner several sentences away.
 */
const MAX_MATH_LENGTH = 200;

export type TypstSegmentKind = "text" | "math";

export interface TypstSegment {
  readonly kind: TypstSegmentKind;
  /** For `math`, the run WITHOUT its delimiting dollars. */
  readonly value: string;
  /** Whether `value` starts at the first character of a line. */
  readonly atLineStart: boolean;
}

/** Whether the characters between two dollars are a formula rather than prose. */
function isMathRun(run: string): boolean {
  if (run.length === 0 || run.length > MAX_MATH_LENGTH) {
    return false;
  }
  if (run.includes("\n") || PROSE_ONLY.test(run)) {
    return false;
  }
  // A backslash means LaTeX, not Typst. Part of the scrape came through as
  // `$\frac{\alpha}{\beta}$`, and every command in that example is ALSO a
  // Typst identifier — so the whitelist alone would wave it through and hand
  // Typst markup it cannot compile, failing the whole exam rather than one
  // question. Typst's own `\{` loses its escape here and prints literally;
  // that is the cheaper of the two failures.
  if (run.includes("\\")) {
    return false;
  }

  for (const [word] of run.matchAll(LETTER_RUN)) {
    if (!MATH_IDENTIFIERS.has(word)) {
      return false;
    }
  }

  return true;
}

/**
 * Splits a collected statement into the Typst math runs it authored and the
 * prose around them.
 *
 * The bank's collected corpus is MIXED at the character level, which is why
 * this cannot be a per-file flag. `db/data/collected/` holds statements the
 * harvest pipeline transcribed into real Typst math (`$cot(1/2 cdot
 * arcsec(61/60))$`) alongside scraped word problems priced in dollars ("un
 * auto que vale $ 4840 ... un capital $ 4000"), and eight files carry both.
 * Escaping everything — what `escapeTypstText` did until this module — printed
 * the formulas literally, dollars and all, in the generated exam; escaping
 * nothing would let two currency signs pair up and swallow a sentence into
 * math mode.
 *
 * Dollars are paired greedily from the left, and a pair that fails
 * `isMathRun` is discarded: its opening dollar reverts to text and the scan
 * resumes one character later, so the second dollar stays free to open a
 * real formula further along.
 */
export function splitTypstMathSpans(raw: string): TypstSegment[] {
  const segments: TypstSegment[] = [];
  let pendingText = "";
  let pendingTextStart = 0;
  let index = 0;

  const atLineStart = (position: number): boolean => position === 0 || raw[position - 1] === "\n";

  const flushText = (): void => {
    if (pendingText.length > 0) {
      segments.push({ kind: "text", value: pendingText, atLineStart: atLineStart(pendingTextStart) });
      pendingText = "";
    }
  };

  while (index < raw.length) {
    if (raw[index] !== "$") {
      if (pendingText.length === 0) {
        pendingTextStart = index;
      }
      pendingText += raw[index];
      index++;
      continue;
    }

    const closing = raw.indexOf("$", index + 1);
    const run = closing === -1 ? undefined : raw.slice(index + 1, closing);

    if (run === undefined || !isMathRun(run)) {
      if (pendingText.length === 0) {
        pendingTextStart = index;
      }
      pendingText += "$";
      index++;
      continue;
    }

    const mathStart = index;
    flushText();
    segments.push({ kind: "math", value: run, atLineStart: atLineStart(mathStart) });
    index = closing + 1;
  }

  flushText();

  return segments.length > 0 ? segments : [{ kind: "text", value: "", atLineStart: true }];
}
