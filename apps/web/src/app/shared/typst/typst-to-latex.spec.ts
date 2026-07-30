import { describe, expect, it } from 'vitest';
import { parseTypst, truncateTypst, typstMathToLatex, typstToPlainText } from './typst-to-latex';

/**
 * Every expectation here was calibrated against the REAL `typst 0.15.1`
 * binary (the version pinned in `infra/Dockerfile.api`) by compiling the
 * same source to a PNG and reading the glyphs off it — not against a guess
 * at Typst's grammar. The tricky ones, in order of how easy they are to get
 * wrong:
 *
 * - `/` binds ONE atom on each side, not the whole surrounding product:
 *   `4 dot (x+1)/(x-1)` is `4 · frac(x+1, x-1)`, NOT `frac(4 · (x+1), x-1)`.
 * - A BARE paren group loses its parens when it becomes a fraction operand
 *   or a script, but a group that already carries an attachment keeps them:
 *   `(25/16)` -> `\frac{25}{16}`, `(Re(w))^2` -> `\left(\Re(w)\right)^{2}`.
 * - Attachments swallow a parenthesized script whole: `x^(n+1)` -> `x^{n+1}`.
 */
describe('typstMathToLatex', () => {
  it('maps bare symbols the pre-uni corpus actually uses', () => {
    expect(typstMathToLatex('36 pi')).toBe('36 \\pi');
    expect(typstMathToLatex('70 degree')).toBe('70 ^\\circ');
    expect(typstMathToLatex('x in RR')).toBe('x \\in \\mathbb{R}');
    expect(typstMathToLatex('+infinity')).toBe('+\\infty');
    expect(typstMathToLatex('p arrow.l.r q')).toBe('p \\leftrightarrow q');
    expect(typstMathToLatex('p star q equiv (not p) and q')).toBe(
      'p \\star q \\equiv \\left(\\lnot p\\right) \\land q',
    );
    expect(typstMathToLatex('p diamond.stroked q')).toBe('p \\diamond q');
    expect(typstMathToLatex('dots.h')).toBe('\\dots');
  });

  it('maps relations that have no single-character LaTeX spelling', () => {
    expect(typstMathToLatex('x <= 3')).toBe('x \\le 3');
    expect(typstMathToLatex('x >= 2')).toBe('x \\ge 2');
    expect(typstMathToLatex('x != y')).toBe('x \\ne y');
    expect(typstMathToLatex('p -> q')).toBe('p \\to q');
  });

  it('renders attachments, dropping the parens Typst uses purely to group', () => {
    expect(typstMathToLatex('x^2')).toBe('x^{2}');
    expect(typstMathToLatex('A^T')).toBe('A^{T}');
    expect(typstMathToLatex('x^(n+1)')).toBe('x^{n + 1}');
    expect(typstMathToLatex('x_1 < x_2')).toBe('x_{1} < x_{2}');
    expect(typstMathToLatex('sum_(k=0)^(100)')).toBe('\\sum_{k = 0}^{100}');
  });

  it('binds `/` to a single atom on each side, like Typst does', () => {
    expect(typstMathToLatex('1/2')).toBe('\\frac{1}{2}');
    expect(typstMathToLatex('a_1/r')).toBe('\\frac{a_{1}}{r}');
    expect(typstMathToLatex('a b/c d')).toBe('a \\frac{b}{c} d');
    expect(typstMathToLatex('4 dot (x+1)/(x-1) - 4')).toBe('4 \\cdot \\frac{x + 1}{x - 1} - 4');
  });

  it('keeps parens on a fraction operand that already carries an attachment', () => {
    expect(typstMathToLatex('(Re(w))^2/(25/16)')).toBe(
      '\\frac{\\left(\\Re\\left(w\\right)\\right)^{2}}{\\frac{25}{16}}',
    );
  });

  it('expands the Typst math functions that take real arguments', () => {
    expect(typstMathToLatex('frac(a, b)')).toBe('\\frac{a}{b}');
    expect(typstMathToLatex('sqrt(x)')).toBe('\\sqrt{x}');
    expect(typstMathToLatex('root(3, 5)')).toBe('\\sqrt[3]{5}');
    expect(typstMathToLatex('abs(x - 2)')).toBe('\\left|x - 2\\right|');
    expect(typstMathToLatex('mat(P, 1; 0, P)')).toBe('\\begin{pmatrix}P & 1 \\\\ 0 & P\\end{pmatrix}');
    expect(typstMathToLatex('cases(x + 2y = 4, x - y = -8)')).toBe(
      '\\begin{cases}x + 2 y = 4 \\\\ x - y = -8\\end{cases}',
    );
  });

  it('reads a juxtaposed call as ONE atom, so a fraction takes the whole call', () => {
    // `1/det(A)` is frac(1, det(A)) in Typst — not frac(1, det) followed by (A).
    expect(typstMathToLatex('det(B) = 1 / det(A)')).toBe(
      '\\det\\left(B\\right) = \\frac{1}{\\det\\left(A\\right)}',
    );
    expect(typstMathToLatex('sin(x)/2')).toBe('\\frac{\\sin\\left(x\\right)}{2}');
    expect(typstMathToLatex('f(x)/2')).toBe('\\frac{f\\left(x\\right)}{2}');
  });

  it('tells an accent from a symbol by whether the paren touches the name', () => {
    // Typst reads adjacency, and only adjacency, as the call: `arrow(v)` is a
    // vector accent, `arrow (q)` is the → symbol next to a group. Same for
    // `dot`, which is both ⋅ and the dot accent.
    expect(typstMathToLatex('arrow(v)_A = 2hat(i)')).toBe('\\vec{v}_{A} = 2 \\hat{i}');
    expect(typstMathToLatex('p arrow (q and r)')).toBe('p \\to \\left(q \\land r\\right)');
    expect(typstMathToLatex('3 dot (x+1)')).toBe('3 \\cdot \\left(x + 1\\right)');
    expect(typstMathToLatex('dot(x)')).toBe('\\dot{x}');
    expect(typstMathToLatex('sqrt(13)(hat(i)+hat(j))')).toBe(
      '\\sqrt{13}\\left(\\hat{i} + \\hat{j}\\right)',
    );
  });

  it('treats named operators as operators, leaving their argument parens alone', () => {
    expect(typstMathToLatex('log_3 (x)')).toBe('\\log_{3} \\left(x\\right)');
    expect(typstMathToLatex('sin(x) + arcsin(y)')).toBe('\\sin\\left(x\\right) + \\arcsin\\left(y\\right)');
  });

  it('renders quoted runs as upright text, not as variables', () => {
    expect(typstMathToLatex('"MCD"(a, b) = 36')).toBe('\\text{MCD}\\left(a , b\\right) = 36');
  });

  it('keeps set and interval delimiters literal, as Typst does', () => {
    expect(typstMathToLatex('a, b in {1,2}')).toBe('a , b \\in \\{ 1 , 2 \\}');
    expect(typstMathToLatex(']0, a[ union ]b, +infinity[')).toBe('] 0 , a [ \\cup ] b , +\\infty [');
    expect(typstMathToLatex('{x | x in ZZ}')).toBe('\\{ x \\mid x \\in \\mathbb{Z} \\}');
  });

  it('falls back to an upright operator name for identifiers it does not know', () => {
    expect(typstMathToLatex('foo(x)')).toBe('\\operatorname{foo}\\left(x\\right)');
  });

  it('never emits a LaTeX control sequence for a stray backslash in the source', () => {
    // Unwrapped LaTeX is invalid Typst (the API validator rejects it), but a
    // legacy row could still hold it — it must not become live LaTeX markup.
    expect(typstMathToLatex('\\frac{1}{2}')).not.toContain('\\frac{1}{2}');
  });
});

describe('typstToPlainText', () => {
  it('drops the math delimiters and the in-math quoting', () => {
    expect(typstToPlainText('El área es $36 pi "cm"^2$ exacto')).toBe('El área es 36 pi cm^2 exacto');
    expect(typstToPlainText('$"MCD"(a, b) = 36$')).toBe('MCD(a, b) = 36');
  });

  it('collapses newlines so the result always fits one row', () => {
    expect(typstToPlainText('primera\n\n  segunda')).toBe('primera segunda');
  });

  it('keeps an escaped dollar as a literal dollar', () => {
    expect(typstToPlainText('cuesta \\$5')).toBe('cuesta $5');
  });

  it('unwraps mitex and drops its import line', () => {
    const source = '#import "@preview/mitex:0.2.7": mi\nSi #mi("\\angle BAD = 70") entonces';
    expect(typstToPlainText(source)).toBe('Si \\angle BAD = 70 entonces');
  });
});

describe('truncateTypst', () => {
  it('leaves a statement shorter than the limit untouched', () => {
    expect(truncateTypst('Halle $x$', 40)).toBe('Halle $x$');
  });

  it('backs the cut up so it never splits a $…$ run in half', () => {
    // A cut at 12 would land inside `$36 pi$` and orphan its opening `$`.
    expect(truncateTypst('El área es $36 pi$ cm', 12)).toBe('El área es…');
  });

  it('cuts at the limit when the cut falls outside any math run', () => {
    expect(truncateTypst('El área es $36 pi$ y algo más', 20)).toBe('El área es $36 pi$ y…');
  });
});

describe('parseTypst', () => {
  it('splits prose from inline math and transpiles only the math', () => {
    expect(parseTypst('El área de un círculo es $36 pi$ cm.')).toEqual([
      { kind: 'text', value: 'El área de un círculo es ' },
      { kind: 'math', latex: '36 \\pi', display: false },
      { kind: 'text', value: ' cm.' },
    ]);
  });

  it('treats a run padded with spaces as display math, like Typst does', () => {
    expect(parseTypst('$ x^2 $')).toEqual([{ kind: 'math', latex: 'x^{2}', display: true }]);
  });

  it('keeps an escaped dollar as literal prose', () => {
    expect(parseTypst('cuesta \\$5')).toEqual([{ kind: 'text', value: 'cuesta $5' }]);
  });

  it('leaves an unterminated run as prose instead of eating the rest of the statement', () => {
    expect(parseTypst('total: $36 pi')).toEqual([{ kind: 'text', value: 'total: $36 pi' }]);
  });

  it('drops the mitex import line the AI prompt tells the model to emit', () => {
    const source = '#import "@preview/mitex:0.2.7": mi, mitex\nSi el ángulo mide 30 grados.';
    expect(parseTypst(source)).toEqual([{ kind: 'text', value: 'Si el ángulo mide 30 grados.' }]);
  });

  it('renders mitex-wrapped LaTeX as math, passing it through untouched', () => {
    expect(parseTypst('Si #mi("\\angle BAD = 70^\\circ") entonces')).toEqual([
      { kind: 'text', value: 'Si ' },
      { kind: 'math', latex: '\\angle BAD = 70^\\circ', display: false },
      { kind: 'text', value: ' entonces' },
    ]);
  });

  it('renders a #mitex block, backtick-quoted, as display math', () => {
    expect(parseTypst('#mitex(`\\int_0^1 x^2 dx`)')).toEqual([
      { kind: 'math', latex: '\\int_0^1 x^2 dx', display: true },
    ]);
  });

  it('collapses to nothing for an empty statement', () => {
    expect(parseTypst('')).toEqual([]);
    expect(parseTypst('   ')).toEqual([{ kind: 'text', value: '   ' }]);
  });
});
