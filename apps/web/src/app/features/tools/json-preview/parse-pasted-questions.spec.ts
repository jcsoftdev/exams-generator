import { describe, expect, it } from 'vitest';
import { parseTypst } from '../../../shared/typst/typst-to-latex';
import { parsePastedQuestions } from './parse-pasted-questions';

/**
 * The input this parser has to survive is NOT what the API produces — it is
 * what a plain chat UI (chatgpt.com, deepseek.com) hands back when the
 * extraction prompt is pasted there by hand. That output drifts from
 * `EXTRACT_RESPONSE_JSON_SCHEMA` in two ways we saw immediately, and both are
 * exercised below:
 *
 *  - `solutionSteps` comes back as the LIST of reasoning steps, where the
 *    schema declares an integer COUNT;
 *  - math comes back as raw LaTeX (`$\frac{3}{4}$`), which is exactly what
 *    `TYPST_MATH_RULES` forbids because the Typst binary downstream cannot
 *    compile it.
 *
 * Neither is a reason to reject the paste — this screen previews, it does not
 * persist — so both are normalized and reported as warnings instead.
 */
const CHAT_PASTE = `{
  "questions": [
    {
      "sourceImage": 1,
      "bodyTypst": "Hallar una raíz de la ecuación:\\n$2x^2 - 3x - 3 = 0$",
      "alternatives": [
        "$\\\\frac{2 - \\\\sqrt{32}}{3}$",
        "$\\\\frac{13 + \\\\sqrt{33}}{4}$",
        "$\\\\frac{3 - \\\\sqrt{32}}{2}$",
        "$\\\\frac{3 + \\\\sqrt{33}}{4}$",
        "$\\\\sqrt{3}$"
      ],
      "correctAnswer": "d",
      "figureCode": null,
      "conceptsUsed": ["Ecuación cuadrática", "Fórmula general de segundo grado"],
      "solutionSteps": [
        "Identificar los coeficientes: $a=2$, $b=-3$, $c=-3$.",
        "Aplicar la fórmula cuadrática."
      ],
      "suggestedCourse": "Álgebra",
      "suggestedTopic": "Ecuaciones cuadráticas"
    }
  ]
}`;

function firstQuestion(raw: string) {
  const result = parsePastedQuestions(raw);
  if (!result.ok) {
    throw new Error(`expected a parse, got error: ${result.error}`);
  }
  return result.questions[0]!;
}

describe('parsePastedQuestions — accepted shapes', () => {
  it('reads the { questions: [...] } envelope a chat returns for several images', () => {
    const result = parsePastedQuestions(CHAT_PASTE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions).toHaveLength(1);
    const question = result.questions[0]!;
    expect(question.sourceImage).toBe(1);
    expect(question.alternatives).toHaveLength(5);
    expect(question.conceptsUsed).toEqual([
      'Ecuación cuadrática',
      'Fórmula general de segundo grado',
    ]);
    expect(question.suggestedCourse).toBe('Álgebra');
    expect(question.suggestedTopic).toBe('Ecuaciones cuadráticas');
  });

  it('reads a BARE array of questions, with no envelope', () => {
    const result = parsePastedQuestions(
      '[{"bodyTypst":"Primera"},{"bodyTypst":"Segunda"},{"bodyTypst":"Tercera"}]',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions.map((q) => q.bodyTypst)).toEqual(['Primera', 'Segunda', 'Tercera']);
  });

  it('reads a SINGLE question object, with neither envelope nor array', () => {
    const result = parsePastedQuestions('{"bodyTypst":"¿Cuánto es $1/2 + 1/4$?"}');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.bodyTypst).toBe('¿Cuánto es $1/2 + 1/4$?');
  });

  it('falls back to treating NON-JSON input as one bare Typst statement', () => {
    const result = parsePastedQuestions('El área del círculo de radio $3$ es $9 pi$.');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.bodyTypst).toBe('El área del círculo de radio $3$ es $9 pi$.');
    expect(result.questions[0]!.alternatives).toEqual([]);
    expect(result.questions[0]!.correctAnswerIndex).toBeNull();
  });
});

describe('parsePastedQuestions — rejected input', () => {
  it('rejects an empty paste', () => {
    const result = parsePastedQuestions('   \n  ');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Pega');
  });

  it('rejects JSON whose shape is neither an envelope, an array, nor a question', () => {
    const result = parsePastedQuestions('{"foo":1,"bar":2}');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('bodyTypst');
  });

  it('rejects an envelope whose questions array is empty', () => {
    const result = parsePastedQuestions('{"questions":[]}');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('ninguna pregunta');
  });

  it('reports the JSON syntax error when a paste OPENS like JSON but is broken', () => {
    const result = parsePastedQuestions('{"questions":[{"bodyTypst":"x"},]}');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('JSON');
  });
});

describe('parsePastedQuestions — raw LaTeX normalization', () => {
  it('wraps a raw-LaTeX math run in the #mi() escape the Typst transpiler understands', () => {
    const question = firstQuestion(CHAT_PASTE);

    expect(question.alternatives[3]).toBe('#mi(`\\frac{3 + \\sqrt{33}}{4}`)');
  });

  it('leaves NATIVE Typst math runs untouched', () => {
    const question = firstQuestion(CHAT_PASTE);

    expect(question.bodyTypst).toBe('Hallar una raíz de la ecuación:\n$2x^2 - 3x - 3 = 0$');
  });

  it('normalizes raw LaTeX inside the solution steps too', () => {
    const question = firstQuestion(
      '{"bodyTypst":"x","solutionSteps":["Aplicar $\\\\frac{1}{2}$ al resultado."]}',
    );

    expect(question.solutionSteps).toEqual(['Aplicar #mi(`\\frac{1}{2}`) al resultado.']);
  });

  it('warns that raw LaTeX would NOT compile downstream, naming the field', () => {
    const question = firstQuestion(CHAT_PASTE);

    expect(question.warnings.join(' ')).toContain('LaTeX');
  });

  it('leaves a run containing a backtick alone, since #mi(`…`) could not carry it', () => {
    const question = firstQuestion('{"bodyTypst":"Compara $\\\\frac{1}{2}` y 3$"}');

    expect(question.bodyTypst).toBe('Compara $\\frac{1}{2}` y 3$');
  });
});

describe('parsePastedQuestions — schema drift', () => {
  it('accepts solutionSteps as the LIST of steps a chat returns', () => {
    const question = firstQuestion(CHAT_PASTE);

    expect(question.solutionSteps).toHaveLength(2);
    expect(question.declaredStepCount).toBe(2);
  });

  it('accepts solutionSteps as the INTEGER count the API schema declares', () => {
    const question = firstQuestion('{"bodyTypst":"x","solutionSteps":4}');

    expect(question.solutionSteps).toEqual([]);
    expect(question.declaredStepCount).toBe(4);
  });

  it('converts the correctAnswer LETTER to the index the rest of the app uses', () => {
    expect(firstQuestion(CHAT_PASTE).correctAnswerIndex).toBe(3);
    expect(
      firstQuestion('{"bodyTypst":"x","alternatives":["a","b"],"correctAnswer":"B"}')
        .correctAnswerIndex,
    ).toBe(1);
  });

  it('accepts a correctAnswer already given as a 0-based index', () => {
    const question = firstQuestion(
      '{"bodyTypst":"x","alternatives":["p","q","r"],"correctAnswer":2}',
    );

    expect(question.correctAnswerIndex).toBe(2);
  });

  it('warns and drops a correctAnswer that points past the alternatives it has', () => {
    const question = firstQuestion(
      '{"bodyTypst":"x","alternatives":["p","q"],"correctAnswer":"e"}',
    );

    expect(question.correctAnswerIndex).toBeNull();
    expect(question.warnings.join(' ')).toContain('clave');
  });

  it('warns when the paste carries no key at all', () => {
    const question = firstQuestion(
      '{"bodyTypst":"x","alternatives":["p","q","r","s","t"],"correctAnswer":null}',
    );

    expect(question.correctAnswerIndex).toBeNull();
    expect(question.warnings.join(' ')).toContain('clave');
  });

  it('warns when a question does not carry the 5 alternatives an exam needs', () => {
    const question = firstQuestion('{"bodyTypst":"x","alternatives":["p","q"]}');

    expect(question.warnings.join(' ')).toContain('5');
  });

  it('does not warn about alternatives on a bare-Typst paste, which has none by design', () => {
    const question = firstQuestion('Un enunciado suelto sin alternativas');

    expect(question.warnings).toEqual([]);
  });

  it('tolerates a question missing every optional field', () => {
    const question = firstQuestion('{"bodyTypst":"Solo el enunciado"}');

    expect(question.sourceImage).toBeNull();
    expect(question.figureCode).toBeNull();
    expect(question.conceptsUsed).toEqual([]);
    expect(question.suggestedCourse).toBeNull();
    expect(question.declaredStepCount).toBeNull();
  });
});

/**
 * The point of rewriting raw LaTeX as `#mi(`…`)` is that `parseTypst` — what
 * `ui-math-text` actually feeds KaTeX — hands the argument through verbatim.
 * Asserted against the real transpiler, because the whole normalization is
 * worthless if the escape hatch does not survive it.
 */
describe('normalized LaTeX through the real Typst transpiler', () => {
  it('reaches KaTeX as the ORIGINAL LaTeX, not as transpiled Typst', () => {
    const question = firstQuestion(CHAT_PASTE);

    const segments = parseTypst(question.alternatives[3]!);

    expect(segments).toEqual([
      { kind: 'math', latex: '\\frac{3 + \\sqrt{33}}{4}', display: false },
    ]);
  });

  it('keeps a native Typst run going through the transpiler, as before', () => {
    const segments = parseTypst(firstQuestion('{"bodyTypst":"$9 pi$"}').bodyTypst);

    expect(segments).toEqual([{ kind: 'math', latex: '9 \\pi', display: false }]);
  });
});
