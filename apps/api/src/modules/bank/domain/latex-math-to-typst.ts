/**
 * LaTeX commands that take one braced argument, and the Typst call that
 * replaces them. `dfrac` becomes a parenthesised division rather than a
 * `frac(..)` call because Typst's `/` already typesets a display fraction and
 * the parentheses keep precedence intact once the argument is an expression.
 */
const ONE_ARGUMENT: Record<string, (argument: string) => string> = {
  sqrt: (argument) => `sqrt(${argument})`,
  mathbb: (argument) => (argument === "R" ? "RR" : argument === "N" ? "NN" : argument === "Z" ? "ZZ" : argument === "Q" ? "QQ" : argument === "C" ? "CC" : ""),
};

const TWO_ARGUMENTS: Record<string, (first: string, second: string) => string> = {
  dfrac: (first, second) => `(${first})/(${second})`,
  frac: (first, second) => `(${first})/(${second})`,
  tfrac: (first, second) => `(${first})/(${second})`,
};

/**
 * Bare commands, mapped to whatever Typst spells the same idea.
 *
 * `sen` is the one that needs an operator wrapper: Peruvian material writes
 * the sine as "sen", Typst has no such builtin, and leaving it bare would
 * typeset three italic variables `s e n`. The functions Typst DOES know
 * (`cos`, `tan`, ...) are already upright, so they pass through by name.
 */
const TOKENS: Record<string, string> = {
  alpha: "alpha", beta: "beta", gamma: "gamma", delta: "delta", epsilon: "epsilon",
  theta: "theta", lambda: "lambda", mu: "mu", pi: "pi", rho: "rho", sigma: "sigma",
  tau: "tau", phi: "phi", varphi: "phi.alt", psi: "psi", omega: "omega",
  Delta: "Delta", Omega: "Omega", Sigma: "Sigma", Phi: "Phi", Theta: "Theta",
  sen: 'op("sen")', sin: "sin", cos: "cos", tan: "tan", sec: "sec", csc: "csc", cot: "cot",
  arcsen: 'op("arcsen")', arcsin: "arcsin", arccos: "arccos", arctan: "arctan",
  log: "log", ln: "ln", lim: "lim", sum: "sum", prod: "product", int: "integral",
  in: "in", notin: "in.not", subset: "subset", cup: "union", cap: "sect",
  emptyset: "nothing", infty: "infinity", forall: "forall", exists: "exists",
  cdot: "dot", times: "times", div: "div", pm: "plus.minus", mp: "minus.plus",
  neq: "!=", leq: "<=", geq: ">=", approx: "approx", equiv: "equiv",
  rightarrow: "->", Rightarrow: "=>", leftarrow: "<-", to: "->",
  quad: "quad", qquad: "wide",
};

/** Commands that only told LaTeX how big to draw a delimiter. Typst grows them itself. */
const DROPPED = new Set(["left", "right", "displaystyle", "textstyle", "limits", "!"]);

/** Escapes that stand for a literal character or a space. */
const LITERALS: Record<string, string> = {
  "{": "{", "}": "}", "%": "%", $: "$", " ": " ",
  // Padded, because these are spacing commands that sit flush against their
  // neighbours in LaTeX (`\alpha,\, \beta`) and would otherwise weld onto
  // them. `collapseSpaces` tidies whatever doubling that causes.
  ",": " thin ", ";": " thick ",
};

/**
 * Rewrites a LaTeX math run as Typst math, or returns `undefined` when it
 * contains anything this does not positively know.
 *
 * Part of the scraped bank was transcribed into LaTeX rather than Typst
 * (`$N = \beta^2 + \dfrac{1}{\beta^2}$`, 244 runs across 63 questions). Typst
 * cannot compile that — `MITEX_RULES` says as much — so until now those runs
 * were escaped and printed with their backslashes showing.
 *
 * Converting beats the `mitex` package here: `infra/Dockerfile.api` installs
 * the Typst binary but vendors no `@preview` packages, so a `#import
 * "@preview/mitex"` would reach for the network at render time and take the
 * whole exam down whenever it could not.
 *
 * Returning `undefined` on an unknown command is the load-bearing part. The
 * caller then leaves the run escaped — today's behaviour, a visible backslash
 * — instead of emitting a half-translation that fails the compile and takes
 * every other question on the page with it.
 */
export function latexMathToTypst(run: string): string | undefined {
  let out = "";
  let index = 0;

  while (index < run.length) {
    const character = run[index]!;

    if (character !== "\\") {
      out += character === "^" || character === "_" ? readScript(run, index, character, (skip) => (index += skip)) : character;
      index++;
      continue;
    }

    const match = /^\\([A-Za-z]+|.)/.exec(run.slice(index));
    if (!match) {
      return undefined;
    }
    const command = match[1]!;
    index += match[0].length;

    if (DROPPED.has(command)) {
      continue;
    }
    if (LITERALS[command] !== undefined) {
      out += LITERALS[command];
      continue;
    }

    if (TWO_ARGUMENTS[command]) {
      const first = readArgument(run, index);
      if (!first) return undefined;
      const second = readArgument(run, first.end);
      if (!second) return undefined;
      const inner = [first.value, second.value].map(latexMathToTypst);
      if (inner.some((value) => value === undefined)) return undefined;
      out += TWO_ARGUMENTS[command]!(inner[0]!, inner[1]!);
      index = second.end;
      continue;
    }

    if (ONE_ARGUMENT[command]) {
      const only = readArgument(run, index);
      if (!only) return undefined;
      const inner = latexMathToTypst(only.value);
      if (inner === undefined) return undefined;
      const replacement = ONE_ARGUMENT[command]!(inner);
      if (replacement === "") return undefined;
      out += replacement;
      index = only.end;
      continue;
    }

    const token = TOKENS[command];
    if (token === undefined) {
      return undefined;
    }
    // LaTeX lets a command sit flush against its neighbours (`\tan\theta`,
    // `2\sen(\pi)\cos(\pi)`); Typst would read the result as one long
    // identifier. A gap goes BEFORE the token when something wordlike ends
    // right there, and AFTER it only when a letter follows — never before a
    // `(`, which makes it a call rather than a product.
    const needsGapBefore = /[A-Za-z0-9)]$/.test(out) && /^[A-Za-z]/.test(token);
    const needsGapAfter = /^[A-Za-z]/.test(run.slice(index));
    out += `${needsGapBefore ? " " : ""}${token}${needsGapAfter ? " " : ""}`;
  }

  return collapseSpaces(out);
}

/** `^{n+1}` -> `^(n+1)`; a bare `^2` is already Typst. */
function readScript(run: string, index: number, marker: string, advance: (skip: number) => void): string {
  const argument = run[index + 1] === "{" ? readArgument(run, index + 1) : undefined;
  if (!argument) {
    return marker;
  }
  const inner = latexMathToTypst(argument.value);
  advance(argument.end - index - 1);

  return inner === undefined ? marker : `${marker}(${inner})`;
}

/** Reads one `{...}` group, honouring nesting; `undefined` when it never closes. */
function readArgument(run: string, from: number): { value: string; end: number } | undefined {
  if (run[from] !== "{") {
    return undefined;
  }
  let depth = 0;
  for (let index = from; index < run.length; index++) {
    if (run[index] === "{" && run[index - 1] !== "\\") depth++;
    if (run[index] === "}" && run[index - 1] !== "\\") {
      depth--;
      if (depth === 0) {
        return { value: run.slice(from + 1, index), end: index + 1 };
      }
    }
  }

  return undefined;
}

function collapseSpaces(text: string): string {
  return text.replace(/ {2,}/g, " ").replace(/ +$/, "");
}

/**
 * Rewrites every `$...$` run that is LaTeX into Typst, leaving everything
 * else — already-Typst formulas, prose, currency signs — byte for byte as it
 * was.
 *
 * Runs to a fixed point per run, never across the whole string: a run that
 * `latexMathToTypst` will not translate is put back verbatim so the escaper
 * downstream still protects it. That is why this runs at INGEST, ahead of
 * `escapeTypstText` — see `prepare-collected-content.ts`.
 */
export function convertLatexMathRuns(raw: string): string {
  let out = "";
  let index = 0;

  while (index < raw.length) {
    if (raw[index] !== "$") {
      out += raw[index];
      index++;
      continue;
    }

    const closing = raw.indexOf("$", index + 1);
    const run = closing === -1 ? undefined : raw.slice(index + 1, closing);
    // No backslash means nothing to translate: either it is already Typst, or
    // it is a pair of currency signs that must stay exactly as scraped.
    if (run === undefined || !run.includes("\\") || run.includes("\n")) {
      out += "$";
      index++;
      continue;
    }

    const converted = latexMathToTypst(run);
    out += converted === undefined ? "$" : `$${converted}$`;
    index = converted === undefined ? index + 1 : closing + 1;
  }

  return out;
}
