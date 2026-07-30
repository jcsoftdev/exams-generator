/**
 * Typst -> LaTeX transpiler for the question preview.
 *
 * Question statements (`bodyTypst`) and alternatives are stored as raw Typst
 * markup, because that is what the API compiles into the exam PDF. The web
 * app has no Typst engine, so to show a teacher the same thing the PDF will
 * show, we transpile the `$…$` runs to LaTeX and hand them to KaTeX.
 *
 * The mapping was calibrated against the real `typst 0.15.1` binary — the
 * version pinned in `infra/Dockerfile.api` — by compiling each construct and
 * reading the rendered glyphs. Three Typst rules are easy to get wrong and
 * are the reason this is a parser and not a pile of regexes:
 *
 *  1. `/` is a fraction that binds exactly ONE atom on each side, so
 *     `4 dot (x+1)/(x-1)` means `4 · frac(x+1, x-1)`.
 *  2. A BARE parenthesised group loses its parens when it is consumed as a
 *     fraction operand or as a script (`(25/16)` -> `\frac{25}{16}`,
 *     `x^(n+1)` -> `x^{n+1}`), but a group that already carries an
 *     attachment keeps them (`(Re(w))^2`).
 *  3. Multi-letter runs are symbol/function names, not juxtaposed variables:
 *     `pi` is π, not p·i.
 *
 * Anything this transpiler does not recognise degrades to an upright
 * `\operatorname{…}` rather than to live LaTeX markup, so a malformed row can
 * never smuggle control sequences into the rendered output.
 */

/** A run of the source: literal prose, or math already transpiled to LaTeX. */
export type TypstSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'math'; readonly latex: string; readonly display: boolean };

/**
 * Operand symbols — they can be a fraction numerator or an attachment base.
 * `degree` is `^\circ` because that is how Typst renders `70 degree` (70°).
 */
const SYMBOL_ATOMS: Readonly<Record<string, string>> = {
  degree: '^\\circ',
  infinity: '\\infty',
  emptyset: '\\emptyset',
  diameter: '\\varnothing',
  angle: '\\angle',
  ell: '\\ell',
  RR: '\\mathbb{R}',
  ZZ: '\\mathbb{Z}',
  NN: '\\mathbb{N}',
  QQ: '\\mathbb{Q}',
  CC: '\\mathbb{C}',
  Re: '\\Re',
  Im: '\\Im',
  'dots.h': '\\dots',
  'dots.c': '\\cdots',
  'dots.v': '\\vdots',
  'dots.down': '\\ddots',
  alpha: '\\alpha',
  beta: '\\beta',
  gamma: '\\gamma',
  delta: '\\delta',
  epsilon: '\\varepsilon',
  zeta: '\\zeta',
  eta: '\\eta',
  theta: '\\theta',
  iota: '\\iota',
  kappa: '\\kappa',
  lambda: '\\lambda',
  mu: '\\mu',
  nu: '\\nu',
  xi: '\\xi',
  pi: '\\pi',
  rho: '\\rho',
  sigma: '\\sigma',
  tau: '\\tau',
  upsilon: '\\upsilon',
  phi: '\\varphi',
  chi: '\\chi',
  psi: '\\psi',
  omega: '\\omega',
  Gamma: '\\Gamma',
  Delta: '\\Delta',
  Theta: '\\Theta',
  Lambda: '\\Lambda',
  Xi: '\\Xi',
  Pi: '\\Pi',
  Sigma: '\\Sigma',
  Phi: '\\Phi',
  Psi: '\\Psi',
  Omega: '\\Omega',
};

/**
 * Binary/relational symbols. Kept OUT of the atom set so that `/` never
 * mistakes one for a numerator and so that a `+`/`-` right after one is read
 * as a sign rather than as another binary operator (`= -8`, not `= - 8`).
 */
const SYMBOL_OPS: Readonly<Record<string, string>> = {
  in: '\\in',
  'in.not': '\\notin',
  subset: '\\subset',
  'subset.eq': '\\subseteq',
  supset: '\\supset',
  union: '\\cup',
  sect: '\\cap',
  inter: '\\cap',
  and: '\\land',
  or: '\\lor',
  not: '\\lnot',
  equiv: '\\equiv',
  approx: '\\approx',
  prop: '\\propto',
  times: '\\times',
  div: '\\div',
  dot: '\\cdot',
  star: '\\star',
  'diamond.stroked': '\\diamond',
  'plus.minus': '\\pm',
  'minus.plus': '\\mp',
  arrow: '\\to',
  'arrow.r': '\\to',
  'arrow.l': '\\leftarrow',
  'arrow.l.r': '\\leftrightarrow',
  'arrow.double': '\\Rightarrow',
  'arrow.double.r': '\\Rightarrow',
  'arrow.double.l': '\\Leftarrow',
  'arrow.double.l.r': '\\Leftrightarrow',
  'arrow.b': '\\downarrow',
  'arrow.t': '\\uparrow',
  lt: '<',
  gt: '>',
  'lt.eq': '\\le',
  'gt.eq': '\\ge',
  'eq.not': '\\ne',
};

/** Named operators: upright, and they do NOT swallow their argument parens. */
const NAMED_OPERATORS: Readonly<Record<string, string>> = {
  sin: '\\sin',
  cos: '\\cos',
  tan: '\\tan',
  cot: '\\cot',
  sec: '\\sec',
  csc: '\\csc',
  arcsin: '\\arcsin',
  arccos: '\\arccos',
  arctan: '\\arctan',
  sinh: '\\sinh',
  cosh: '\\cosh',
  tanh: '\\tanh',
  ln: '\\ln',
  log: '\\log',
  exp: '\\exp',
  lim: '\\lim',
  min: '\\min',
  max: '\\max',
  det: '\\det',
  gcd: '\\gcd',
  mod: '\\bmod',
  sum: '\\sum',
  product: '\\prod',
  integral: '\\int',
};

/**
 * Accents. These share a name with a plain symbol (`arrow` is → but
 * `arrow(v)` is v⃗; `dot` is ⋅ but `dot(x)` is ẋ) and Typst tells them apart
 * by ADJACENCY: the paren must touch the name. `p arrow (q and r)` is
 * "p → (q ∧ r)", while `p arrow(q and r)` puts an arrow over `q ∧ r`.
 * Verified against the 0.15.1 binary; the tokenizer records that adjacency
 * as `glued` so this distinction survives.
 */
const ACCENT_FUNCTIONS: Readonly<Record<string, string>> = {
  hat: '\\hat',
  arrow: '\\vec',
  bar: '\\bar',
  macron: '\\bar',
  tilde: '\\tilde',
  dot: '\\dot',
  'dot.double': '\\ddot',
  breve: '\\breve',
  check: '\\check',
  acute: '\\acute',
  grave: '\\grave',
};

/** Functions whose parenthesised arguments ARE consumed and restructured. */
const ARGUMENT_FUNCTIONS = new Set([
  'frac',
  'sqrt',
  'root',
  'abs',
  'norm',
  'binom',
  'floor',
  'ceil',
  'mat',
  'cases',
  'vec',
]);

/** Multi-character operators, longest first so `<=>` beats `<=` beats `<`. */
const MULTI_CHAR_OPERATORS: readonly (readonly [string, string])[] = [
  ['<=>', '\\Leftrightarrow'],
  ['<->', '\\leftrightarrow'],
  ['|->', '\\mapsto'],
  ['<=', '\\le'],
  ['>=', '\\ge'],
  ['!=', '\\ne'],
  ['->', '\\to'],
  ['=>', '\\Rightarrow'],
  ['<-', '\\leftarrow'],
  [':=', ':='],
  ['...', '\\dots'],
];

/** Single characters that are safe to emit into LaTeX math verbatim. */
const VERBATIM_CHARS = new Set(['+', '-', '*', '=', '<', '>', ',', ';', ':', '!', '?', '.', "'", '[', ']', '(', ')']);

/** Single characters that need a LaTeX spelling of their own. */
const ESCAPED_CHARS: Readonly<Record<string, string>> = {
  '\\': '\\backslash',
  '{': '\\{',
  '}': '\\}',
  '|': '\\mid',
  '%': '\\%',
  '&': '\\&',
  '#': '\\#',
  $: '\\$',
  _: '\\_',
  '^': '\\hat{}',
  '~': '\\sim',
  '"': "''",
};

/**
 * `glued` records that no whitespace preceded this token. Only `(` uses it,
 * to tell a call/accent (`hat(i)`) from juxtaposition (`arrow (q)`) — a
 * distinction Typst makes purely on adjacency.
 */
type Token = {
  readonly t: 'ident' | 'num' | 'str' | 'sym';
  readonly v: string;
  readonly glued: boolean;
};

/**
 * A parsed piece of a math run. `atom` marks operands (only those can be a
 * fraction numerator or an attachment base); `group` marks a BARE `(…)` whose
 * parens Typst drops when it is consumed as a fraction operand or a script.
 */
interface Node {
  readonly tex: string;
  readonly atom: boolean;
  readonly group: boolean;
  /** Contents of a bare group, without the surrounding `\left(`/`\right)`. */
  readonly inner?: string;
}

const IDENT_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*/;
const NUMBER_PATTERN = /^[0-9]+(?:\.[0-9]+)?/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let glued = false;

  while (i < source.length) {
    const rest = source.slice(i);
    const char = source[i];

    if (/\s/.test(char)) {
      glued = false;
      i += 1;
      continue;
    }

    if (char === '"') {
      const end = source.indexOf('"', i + 1);
      if (end === -1) {
        tokens.push({ t: 'str', v: rest.slice(1), glued });
        break;
      }
      tokens.push({ t: 'str', v: source.slice(i + 1, end), glued });
      i = end + 1;
      glued = true;
      continue;
    }

    const numberMatch = NUMBER_PATTERN.exec(rest);
    if (numberMatch) {
      tokens.push({ t: 'num', v: numberMatch[0], glued });
      i += numberMatch[0].length;
      glued = true;
      continue;
    }

    const identMatch = IDENT_PATTERN.exec(rest);
    if (identMatch) {
      tokens.push({ t: 'ident', v: identMatch[0], glued });
      i += identMatch[0].length;
      glued = true;
      continue;
    }

    const multi = MULTI_CHAR_OPERATORS.find(([literal]) => rest.startsWith(literal));
    const literal = multi ? multi[0] : char;
    tokens.push({ t: 'sym', v: literal, glued });
    i += literal.length;
    glued = true;
  }

  return tokens;
}

function escapeTextRun(value: string): string {
  return value.replace(/[\\{}$&#_^%~]/g, (char) => `\\${char}`);
}

/** Renders a node as a fraction operand or a script: bare groups lose their parens. */
function unwrap(node: Node): string {
  return node.group && node.inner !== undefined ? node.inner : node.tex;
}

class MathParser {
  private position = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  /** Parses a run of nodes, stopping before any `sym` token in `stops`. */
  parseSequence(stops: ReadonlySet<string>): string {
    const nodes: Node[] = [];

    while (this.position < this.tokens.length) {
      const token = this.tokens[this.position];
      if (token.t === 'sym' && stops.has(token.v)) {
        break;
      }

      if (token.t === 'sym' && token.v === '/') {
        this.position += 1;
        const numerator = nodes.length > 0 && nodes[nodes.length - 1].atom ? nodes.pop()! : null;
        const denominator = this.parseAttached();
        nodes.push({
          tex: `\\frac{${numerator ? unwrap(numerator) : ''}}{${denominator ? unwrap(denominator) : ''}}`,
          atom: true,
          group: false,
        });
        continue;
      }

      // `+`/`-` with no operand before it is a sign, and glues to what follows.
      if (token.t === 'sym' && (token.v === '+' || token.v === '-')) {
        const previous = nodes[nodes.length - 1];
        if (!previous || !previous.atom) {
          this.position += 1;
          const operand = this.parseAttached();
          nodes.push({ tex: `${token.v}${operand ? operand.tex : ''}`, atom: true, group: false });
          continue;
        }
      }

      const node = this.parseAttached();
      if (!node) {
        break;
      }
      nodes.push(node);
    }

    return nodes.map((node) => node.tex).join(' ');
  }

  /** A primary with every `^`/`_` attachment applied. */
  private parseAttached(): Node | null {
    let base = this.parsePrimary();
    if (!base) {
      return null;
    }

    for (;;) {
      const token = this.tokens[this.position];
      if (!token || token.t !== 'sym' || (token.v !== '^' && token.v !== '_')) {
        return base;
      }
      this.position += 1;
      const script = this.parsePrimary();
      base = {
        tex: `${base.tex}${token.v}{${script ? unwrap(script) : ''}}`,
        atom: true,
        group: false,
      };
    }
  }

  private parsePrimary(): Node | null {
    const token = this.tokens[this.position];
    if (!token) {
      return null;
    }
    this.position += 1;

    switch (token.t) {
      case 'num':
        return { tex: token.v, atom: true, group: false };

      case 'str':
        return this.absorbCall({ tex: `\\text{${escapeTextRun(token.v)}}`, atom: true, group: false });

      case 'ident':
        return this.absorbCall(this.parseIdentifier(token.v));

      case 'sym':
        if (token.v === '(') {
          const inner = this.parseSequence(new Set([')']));
          this.expect(')');
          return { tex: `\\left(${inner}\\right)`, atom: true, group: true, inner };
        }
        return this.parseSymbol(token.v);
    }
  }

  /**
   * Glues a juxtaposed `(…)` onto the preceding name, because Typst reads
   * `det(A)` as ONE atom: `1/det(A)` is `frac(1, det(A))`, not
   * `frac(1, det)·(A)`. Verified against the 0.15.1 binary.
   */
  private absorbCall(base: Node): Node {
    const next = this.tokens[this.position];
    if (!next || next.t !== 'sym' || next.v !== '(' || !next.glued || !base.atom || base.group) {
      return base;
    }
    this.position += 1;
    const inner = this.parseSequence(new Set([')']));
    this.expect(')');
    return { tex: `${base.tex}\\left(${inner}\\right)`, atom: true, group: false };
  }

  private parseIdentifier(name: string): Node {
    const next = this.tokens[this.position];
    // Only a paren TOUCHING the name is a call — see `ACCENT_FUNCTIONS`.
    const callsWithParens = next && next.t === 'sym' && next.v === '(' && next.glued;

    if (callsWithParens) {
      if (ARGUMENT_FUNCTIONS.has(name)) {
        this.position += 1;
        return { tex: buildFunction(name, this.parseArgumentRows()), atom: true, group: false };
      }

      const accent = ACCENT_FUNCTIONS[name];
      if (accent) {
        this.position += 1;
        const inner = this.parseSequence(new Set([')']));
        this.expect(')');
        return { tex: `${accent}{${inner}}`, atom: true, group: false };
      }
    }

    const operand = SYMBOL_ATOMS[name];
    if (operand) {
      return { tex: operand, atom: true, group: false };
    }

    const operator = SYMBOL_OPS[name];
    if (operator) {
      return { tex: operator, atom: false, group: false };
    }

    const named = NAMED_OPERATORS[name];
    if (named) {
      return { tex: named, atom: true, group: false };
    }

    if (name.length === 1) {
      return { tex: name, atom: true, group: false };
    }

    // Unknown multi-letter run: Typst itself would fail to compile this, so
    // show it upright rather than guess — and never as a control sequence.
    return { tex: `\\operatorname{${escapeTextRun(name)}}`, atom: true, group: false };
  }

  private parseSymbol(value: string): Node {
    const multi = MULTI_CHAR_OPERATORS.find(([literal]) => literal === value);
    if (multi) {
      return { tex: multi[1], atom: false, group: false };
    }
    if (VERBATIM_CHARS.has(value)) {
      const isOperand = value === '[' || value === ']';
      return { tex: value, atom: isOperand, group: false };
    }
    const escaped = ESCAPED_CHARS[value];
    if (escaped) {
      const isOperand = value === '{' || value === '}';
      return { tex: escaped, atom: isOperand, group: false };
    }
    return { tex: '', atom: false, group: false };
  }

  /** Argument list of a call, already consumed past `(`: rows split on `;`, cells on `,`. */
  private parseArgumentRows(): string[][] {
    const stops = new Set([',', ';', ')']);
    const rows: string[][] = [[]];

    for (;;) {
      const cell = this.parseSequence(stops);
      rows[rows.length - 1].push(cell);

      const token = this.tokens[this.position];
      if (!token || token.t !== 'sym') {
        return rows;
      }
      this.position += 1;
      if (token.v === ')') {
        return rows;
      }
      if (token.v === ';') {
        rows.push([]);
      }
    }
  }

  private expect(symbol: string): void {
    const token = this.tokens[this.position];
    if (token && token.t === 'sym' && token.v === symbol) {
      this.position += 1;
    }
  }
}

function buildFunction(name: string, rows: string[][]): string {
  const cells = rows.flat();
  const [first = '', second = ''] = cells;

  switch (name) {
    case 'frac':
      return `\\frac{${first}}{${second}}`;
    case 'binom':
      return `\\binom{${first}}{${second}}`;
    case 'sqrt':
      return `\\sqrt{${first}}`;
    case 'root':
      return `\\sqrt[${first}]{${second}}`;
    case 'abs':
      return `\\left|${first}\\right|`;
    case 'norm':
      return `\\left\\|${first}\\right\\|`;
    case 'floor':
      return `\\left\\lfloor ${first}\\right\\rfloor`;
    case 'ceil':
      return `\\left\\lceil ${first}\\right\\rceil`;
    case 'cases':
      return `\\begin{cases}${cells.join(' \\\\ ')}\\end{cases}`;
    case 'vec':
      return `\\begin{pmatrix}${cells.join(' \\\\ ')}\\end{pmatrix}`;
    case 'mat':
      return `\\begin{pmatrix}${rows.map((row) => row.join(' & ')).join(' \\\\ ')}\\end{pmatrix}`;
    default:
      return `\\operatorname{${escapeTextRun(name)}}\\left(${cells.join(' , ')}\\right)`;
  }
}

/** Transpiles one Typst math run — the inside of a `$…$` — to LaTeX. */
export function typstMathToLatex(math: string): string {
  return new MathParser(tokenize(math)).parseSequence(new Set());
}

/** The `#import "@preview/mitex:…": mi, mitex` line mitex usage requires. */
const MITEX_IMPORT_PATTERN = /^[ \t]*#import\s+"[^"]*"\s*:[^\n]*\n?/gm;

/**
 * Flattens Typst markup to one line of plain prose, dropping the `$`
 * delimiters and the `"…"` quoting inside math.
 *
 * For one-line, width-clipped rows (a tree leaf, a queue row) — NOT for a
 * detail panel, which should use `ui-math-text`. Typeset math cannot survive
 * `text-overflow: ellipsis`: KaTeX lays a `\left(`/`\right)` pair out as
 * absolutely-positioned stretchy spans, and clipping the row mid-expression
 * strands their glyphs across it (`(. ( ) ) (`). Truncating the SOURCE does
 * not help either — 70 characters of Typst still typeset wider than the row.
 * So a row that will be clipped gets text, and only a container that can show
 * the whole expression gets math.
 */
export function typstToPlainText(source: string): string {
  return source
    .replace(MITEX_IMPORT_PATTERN, '')
    .replace(/#mi(?:tex)?\(\s*[`"]([\s\S]*?)[`"]\s*\)/g, '$1')
    // One pass, so an escaped `\$` becomes a literal `$` WITHOUT the next
    // rule then stripping it as if it were a delimiter.
    .replace(/\\\$|\$/g, (match) => (match === '\\$' ? '$' : ''))
    .replace(/"([^"]*)"/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Shortens Typst markup to at most `maxLength` characters WITHOUT cutting a
 * `$…$` run in half. A blind `slice` can land inside one, and the orphaned
 * delimiter then shows up as a literal `$` in the preview — exactly the
 * "formato raro" this module exists to remove. Backs the cut up to the start
 * of the run it would have split.
 */
export function truncateTypst(source: string, maxLength: number): string {
  if (source.length <= maxLength) {
    return source;
  }

  const head = source.slice(0, maxLength);
  let cut = maxLength;
  let open = -1;
  let insideMath = false;

  for (let i = 0; i < head.length; i += 1) {
    if (head[i] === '\\') {
      i += 1;
      continue;
    }
    if (head[i] === '$') {
      insideMath = !insideMath;
      open = insideMath ? i : -1;
    }
  }
  if (insideMath && open >= 0) {
    cut = open;
  }

  return `${source.slice(0, cut).trimEnd()}…`;
}

/**
 * Reads the argument of a `#mi(…)`/`#mitex(…)` call at `start` (the index of
 * the opening paren). mitex accepts either a quoted string or a raw block, so
 * both are supported. Returns `null` when the call is malformed, which leaves
 * the source to be shown as prose rather than silently swallowed.
 */
function readMitexArgument(source: string, start: number): { latex: string; end: number } | null {
  const quote = source[start + 1];
  if (quote !== '"' && quote !== '`') {
    return null;
  }
  const close = source.indexOf(quote, start + 2);
  if (close === -1) {
    return null;
  }
  const paren = source.indexOf(')', close + 1);
  if (paren === -1) {
    return null;
  }
  return { latex: source.slice(start + 2, close), end: paren + 1 };
}

/**
 * Splits raw Typst markup into prose and math segments, transpiling the math
 * on the way. Understands three sources of math:
 *
 *  - `$…$` — native Typst math (display mode when padded with spaces, which
 *    is Typst's own inline-vs-block rule);
 *  - `#mi("…")` / `#mitex(`…`)` — the LaTeX escape hatch the AI prompt offers
 *    (`MITEX_RULES` in `openrouter-request-builder.ts`), passed through as-is
 *    since it is already LaTeX;
 *  - and it drops the `#import "@preview/mitex:…"` line that escape hatch
 *    requires, which is compiler plumbing a teacher should never see.
 */
export function parseTypst(source: string): TypstSegment[] {
  const cleaned = source.replace(MITEX_IMPORT_PATTERN, '');
  const segments: TypstSegment[] = [];
  let text = '';
  let i = 0;

  const flushText = (): void => {
    if (text) {
      segments.push({ kind: 'text', value: text });
      text = '';
    }
  };

  while (i < cleaned.length) {
    const char = cleaned[i];

    if (char === '\\' && i + 1 < cleaned.length) {
      text += cleaned[i + 1];
      i += 2;
      continue;
    }

    if (char === '#') {
      const isBlock = cleaned.startsWith('#mitex(', i);
      const isInline = !isBlock && cleaned.startsWith('#mi(', i);
      if (isBlock || isInline) {
        const parenIndex = i + (isBlock ? '#mitex'.length : '#mi'.length);
        const argument = readMitexArgument(cleaned, parenIndex);
        if (argument) {
          flushText();
          segments.push({ kind: 'math', latex: argument.latex, display: isBlock });
          i = argument.end;
          continue;
        }
      }
    }

    if (char === '$') {
      const close = cleaned.indexOf('$', i + 1);
      if (close !== -1) {
        const body = cleaned.slice(i + 1, close);
        flushText();
        segments.push({
          kind: 'math',
          latex: typstMathToLatex(body),
          display: /^\s/.test(body) && /\s$/.test(body),
        });
        i = close + 1;
        continue;
      }
    }

    text += char;
    i += 1;
  }

  flushText();
  return segments;
}
