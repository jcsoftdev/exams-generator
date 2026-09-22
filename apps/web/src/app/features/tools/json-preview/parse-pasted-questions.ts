/**
 * Turns whatever a teacher pastes into the JSON preview screen into questions
 * this app can render.
 *
 * The paste does NOT come from our own API — it comes from running the
 * extraction prompt by hand in a chat UI (chatgpt.com, deepseek.com), where
 * there is no `response_format` to enforce `EXTRACT_RESPONSE_JSON_SCHEMA` and
 * no retry loop to reject a malformed answer. So this parser is deliberately
 * permissive about everything that does not change MEANING, and loud (via
 * `warnings`, never a rejection) about the two drifts a chat reliably
 * produces:
 *
 *  - `solutionSteps` as the list of reasoning steps rather than the integer
 *    count the schema declares;
 *  - math as raw LaTeX (`$\frac{3}{4}$`) rather than Typst syntax, which the
 *    `typst` binary downstream cannot compile at all (`TYPST_MATH_RULES` in
 *    `openrouter-request-builder.ts` exists to forbid exactly that).
 *
 * Rejecting either would be wrong here: this screen previews a paste, it
 * never persists one, and a teacher pasting from a chat needs to SEE the
 * question before deciding whether it is worth retyping in Typst.
 */

/** A letter key, as both the prompt and `GeneratedQuestion.correctAnswer` spell it. */
const ANSWER_LETTERS = ['a', 'b', 'c', 'd', 'e'] as const;

/** What an exam form needs; anything less is previewable but not printable. */
const REQUIRED_ALTERNATIVES = 5;

export interface PastedQuestion {
  /** 1-based index of the attached image this came from, when the paste says. */
  readonly sourceImage: number | null;
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  /**
   * 0-based index into `alternatives` — the same convention the rest of the
   * app stores (`ai-extract` converts the model's LETTER to an index), NOT
   * the letter the paste carries. `null` when the paste has no usable key.
   */
  readonly correctAnswerIndex: number | null;
  readonly figureCode: string | null;
  readonly conceptsUsed: readonly string[];
  /** The reasoning steps, when the paste lists them; empty when it only counted them. */
  readonly solutionSteps: readonly string[];
  /** How many steps the paste claims — the list's length, or the bare integer. */
  readonly declaredStepCount: number | null;
  readonly suggestedCourse: string | null;
  readonly suggestedTopic: string | null;
  /** Human-readable, Spanish, shown next to the question — never a hard failure. */
  readonly warnings: readonly string[];
}

export type ParsedPaste =
  | { readonly ok: true; readonly questions: readonly PastedQuestion[] }
  | { readonly ok: false; readonly error: string };

export function parsePastedQuestions(raw: string): ParsedPaste {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Pega el JSON de la(s) pregunta(s), o el enunciado en Typst.' };
  }

  // Only text that OPENS like JSON is held to JSON rules. Anything else is a
  // bare Typst statement — the "de última ya solo el typst" path — and a
  // syntax error would be a confusing way to say "this is not JSON".
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { ok: true, questions: [bareStatement(trimmed)] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return { ok: false, error: `JSON inválido: ${(error as Error).message}` };
  }

  const records = collectRecords(parsed);
  if (!records.ok) {
    return records;
  }

  return { ok: true, questions: records.records.map(readQuestion) };
}

type CollectedRecords =
  | { readonly ok: true; readonly records: readonly Record<string, unknown>[] }
  | { readonly ok: false; readonly error: string };

/**
 * Accepts all three envelopes seen in practice: `{ questions: [...] }` (what
 * the multi-image chat prompt asks for), a bare array (what a chat returns
 * when it drops the envelope), and a lone object (one question, one image).
 */
function collectRecords(parsed: unknown): CollectedRecords {
  if (Array.isArray(parsed)) {
    return parsed.length
      ? { ok: true, records: parsed.filter(isRecord) }
      : { ok: false, error: 'El array no trae ninguna pregunta.' };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: 'El JSON debe ser un objeto o un array de preguntas.' };
  }

  const envelope = parsed['questions'];
  if (Array.isArray(envelope)) {
    return envelope.length
      ? { ok: true, records: envelope.filter(isRecord) }
      : { ok: false, error: '"questions" no trae ninguna pregunta.' };
  }

  if (typeof parsed['bodyTypst'] === 'string') {
    return { ok: true, records: [parsed] };
  }

  return {
    ok: false,
    error:
      'No reconozco la forma: esperaba { "questions": [...] }, un array, o un objeto con "bodyTypst".',
  };
}

function bareStatement(bodyTypst: string): PastedQuestion {
  const latex = latexWarning(bodyTypst);
  return {
    sourceImage: null,
    bodyTypst: normalizeLatexRuns(bodyTypst),
    alternatives: [],
    correctAnswerIndex: null,
    figureCode: null,
    conceptsUsed: [],
    solutionSteps: [],
    declaredStepCount: null,
    suggestedCourse: null,
    suggestedTopic: null,
    warnings: latex ? [latex] : [],
  };
}

function readQuestion(record: Record<string, unknown>): PastedQuestion {
  const warnings: string[] = [];

  const bodyTypst = typeof record['bodyTypst'] === 'string' ? record['bodyTypst'] : '';
  const alternatives = readStringArray(record['alternatives']);
  const solutionSteps = readStringArray(record['solutionSteps']);

  const latex = latexWarning([bodyTypst, ...alternatives, ...solutionSteps].join('\n'));
  if (latex) {
    warnings.push(latex);
  }

  if (typeof record['solutionSteps'] === 'number') {
    warnings.push(
      `"solutionSteps" llegó como el número ${record['solutionSteps']} (el schema de la API) en vez de la lista de pasos — no hay pasos que mostrar.`,
    );
  }

  const correctAnswerIndex = readCorrectAnswer(record['correctAnswer'], alternatives.length);
  if (correctAnswerIndex === null) {
    warnings.push('Sin clave: la pregunta llegó sin una alternativa correcta utilizable.');
  }

  if (alternatives.length !== REQUIRED_ALTERNATIVES) {
    warnings.push(
      `Trae ${alternatives.length} alternativa(s); un examen necesita ${REQUIRED_ALTERNATIVES}.`,
    );
  }

  return {
    sourceImage: typeof record['sourceImage'] === 'number' ? record['sourceImage'] : null,
    bodyTypst: normalizeLatexRuns(bodyTypst),
    alternatives: alternatives.map(normalizeLatexRuns),
    correctAnswerIndex,
    figureCode: typeof record['figureCode'] === 'string' ? record['figureCode'] : null,
    conceptsUsed: readStringArray(record['conceptsUsed']),
    solutionSteps: solutionSteps.map(normalizeLatexRuns),
    declaredStepCount: readStepCount(record['solutionSteps']),
    suggestedCourse: readOptionalString(record['suggestedCourse']),
    suggestedTopic: readOptionalString(record['suggestedTopic']),
    warnings,
  };
}

function readStepCount(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.length;
  return null;
}

/**
 * The paste may spell the key as the prompt's LETTER ("d", "D") or as an
 * index a caller already converted. Either way it has to point at an
 * alternative that exists — a key past the end is the fabricated-answer
 * failure the extraction prompt spends two rules preventing, so it is dropped
 * rather than shown as a real answer.
 */
function readCorrectAnswer(value: unknown, alternativeCount: number): number | null {
  const index = toAnswerIndex(value);
  if (index === null) return null;
  return index < alternativeCount ? index : null;
}

function toAnswerIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const letter = value.trim().toLowerCase();
  const index = ANSWER_LETTERS.indexOf(letter as (typeof ANSWER_LETTERS)[number]);
  return index === -1 ? null : index;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** A `$…$` run, non-greedy so adjacent runs stay separate. */
const MATH_RUN_PATTERN = /\$([^$]*)\$/g;

/** A LaTeX command — the thing Typst math mode cannot compile. */
const LATEX_COMMAND_PATTERN = /\\[a-zA-Z]/;

/**
 * Rewrites raw-LaTeX math runs as `#mi(`…`)`.
 *
 * This is not a LaTeX-to-Typst translation and does not pretend to be one:
 * `#mi()` is the escape hatch `MITEX_RULES` already offers the model and
 * `parseTypst` already understands, passing its argument through to KaTeX
 * verbatim. So the preview shows the teacher a correctly typeset formula
 * while the underlying text stays honest about being LaTeX — which is what
 * the accompanying warning is for.
 *
 * Uses the BACKTICK form because a LaTeX run may legitimately contain a
 * double quote (`\text{"x"}`), which would terminate `#mi("…")` early. A run
 * that contains a backtick itself has no safe wrapper, so it is left alone
 * and degrades in the preview rather than being silently truncated.
 */
export function normalizeLatexRuns(source: string): string {
  return source.replace(MATH_RUN_PATTERN, (run, body: string) => {
    if (!LATEX_COMMAND_PATTERN.test(body) || body.includes('`')) {
      return run;
    }
    return `#mi(\`${body}\`)`;
  });
}

function latexWarning(source: string): string | null {
  const hasRawLatex = [...source.matchAll(MATH_RUN_PATTERN)].some(
    ([, body]) => LATEX_COMMAND_PATTERN.test(body ?? '') && !(body ?? '').includes('`'),
  );
  if (!hasRawLatex) return null;
  return 'Matemática en LaTeX crudo (\\frac, \\sqrt…): el preview la renderiza, pero el compilador Typst del examen NO la acepta — habría que reescribirla en sintaxis Typst antes de guardar.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
