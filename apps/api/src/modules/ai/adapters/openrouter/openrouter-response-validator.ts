import { GeneratedAlternatives, GeneratedQuestion } from "../../domain/ports/question-generator.port";

const VALID_ANSWER_LETTERS = new Set(["a", "b", "c", "d", "e"]);

const MATH_SEGMENT = /\$([^$]*)\$/g;
const LATEX_COMMAND = /\\[a-zA-Z]+/;
const MITEX_MI_CALL = /#mi\("(?:[^"\\]|\\.)*"\)/g;
const MITEX_BLOCK_CALL = /#mitex\(`[^`]*`\)/g;

/**
 * Models default to LaTeX math commands (`\frac`, `\circ`, `\angle`...)
 * inside `$...$`, which Typst cannot compile — this was the single biggest
 * cause of "Typst compile failed" (see `TYPST_MATH_RULES` in
 * `openrouter-request-builder.ts`). Catching it here, before ever invoking
 * the real `typst` binary, turns a wasted generate+compile round-trip into
 * an immediate validation error that feeds straight into the SAME
 * previousError retry the adapter already runs for a malformed JSON shape.
 * Scoped to `$...$` only — Typst's own escape syntax (`\ ` line break,
 * `\$`, `\\`) is backslash followed by a NON-letter and outside math mode,
 * so it's never flagged.
 *
 * `#mi("...")`/`#mitex(\`...\`)` mitex escape-hatch calls (see
 * `MITEX_RULES` in `openrouter-request-builder.ts`) are stripped out of
 * `bodyTypst` entirely BEFORE the `$...$` scan runs — they are not merely
 * skipped once found. A `$` character can legitimately appear inside a
 * mitex call's argument, and left in place it would desync the
 * left-to-right `$`-pairing for the rest of the string: either shifting a
 * real `$...$` segment out of detection (a genuine LaTeX command slips
 * through unflagged) or pulling the mitex argument itself into a spuriously
 * "detected" math segment (a legitimate backslash command gets falsely
 * flagged). Stripping the mitex spans first guarantees a `$` inside one of
 * them can never participate in pairing at all.
 */
function findLatexCommandInMath(bodyTypst: string): string | undefined {
  const withoutMitexCalls = bodyTypst.replace(MITEX_MI_CALL, "").replace(MITEX_BLOCK_CALL, "");

  for (const match of withoutMitexCalls.matchAll(MATH_SEGMENT)) {
    const command = match[1].match(LATEX_COMMAND);
    if (command) {
      return command[0];
    }
  }
  return undefined;
}

/**
 * The model's self-reported structural metadata about the question it just
 * produced — which distinct concepts/relations the solution combines, and
 * how many reasoning steps it takes. Required by `RESPONSE_JSON_SCHEMA`
 * (see `openrouter-request-builder.ts`) so difficulty can be VERIFIED
 * programmatically (`openrouter-difficulty-gate.ts`) instead of trusting
 * the bare "easy"/"medium"/"hard" label. Deliberately NOT part of the
 * `GeneratedQuestion` port contract: it's adapter-internal evidence used
 * by the content guards, never persisted downstream.
 */
export interface QuestionSelfReport {
  readonly conceptsUsed: readonly string[];
  readonly solutionSteps: number;
}

export interface ValidatedGeneratedQuestion {
  readonly question: GeneratedQuestion;
  readonly selfReport: QuestionSelfReport;
}

/**
 * Validates an already-parsed (but untyped) JSON value against the
 * `GeneratedQuestion` shape. This is the ONLY gate content is allowed
 * through before the port resolves — per design doc §7 the AI response is
 * "nunca se guarda sin validar contra schema". Throws `TypeError` (with a
 * message describing every violated rule) when the payload doesn't match.
 *
 * `figureCode: null` (a common JSON-schema idiom for "optional field") is
 * normalized to `undefined` to match the port's TypeScript contract.
 */
export function validateGeneratedQuestionShape(value: unknown): ValidatedGeneratedQuestion {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("AI response payload must be a JSON object");
  }

  const payload = value as Record<string, unknown>;

  if (typeof payload.bodyTypst !== "string" || payload.bodyTypst.trim().length === 0) {
    errors.push("bodyTypst must be a non-empty string");
  } else {
    const latexCommand = findLatexCommandInMath(payload.bodyTypst);
    if (latexCommand) {
      errors.push(
        `bodyTypst contains the LaTeX command "${latexCommand}" inside math mode ($...$) — Typst cannot compile LaTeX commands, rewrite that math using Typst syntax (no backslash)`,
      );
    }
  }

  const alternatives = payload.alternatives;
  if (
    !Array.isArray(alternatives) ||
    alternatives.length !== 5 ||
    !alternatives.every((alt) => typeof alt === "string" && alt.trim().length > 0)
  ) {
    errors.push("alternatives must be an array of exactly 5 non-empty strings");
  }

  if (typeof payload.correctAnswer !== "string" || !VALID_ANSWER_LETTERS.has(payload.correctAnswer)) {
    errors.push('correctAnswer must be one of "a", "b", "c", "d", "e"');
  }

  const rawFigureCode = payload.figureCode;
  if (rawFigureCode !== undefined && rawFigureCode !== null && typeof rawFigureCode !== "string") {
    errors.push("figureCode must be a string, null, or omitted");
  }

  const conceptsUsed = payload.conceptsUsed;
  if (
    !Array.isArray(conceptsUsed) ||
    conceptsUsed.length === 0 ||
    !conceptsUsed.every((concept) => typeof concept === "string" && concept.trim().length > 0)
  ) {
    errors.push("conceptsUsed must be an array of at least 1 non-empty string");
  }

  const solutionSteps = payload.solutionSteps;
  if (typeof solutionSteps !== "number" || !Number.isInteger(solutionSteps) || solutionSteps < 1) {
    errors.push("solutionSteps must be an integer >= 1");
  }

  if (errors.length > 0) {
    throw new TypeError(`Invalid AI-generated question: ${errors.join("; ")}`);
  }

  // `suggestedCourse`/`suggestedTopic` are extract-only, best-effort, and
  // never validated as errors — a `null`/absent/blank guess just means
  // "not confident enough", not a malformed response (mirrors `figureCode`'s
  // null-normalization above). `generate`/`reviseQuestion` payloads never
  // carry these keys at all, so this is a no-op for those callers.
  const rawSuggestedCourse = payload.suggestedCourse;
  const rawSuggestedTopic = payload.suggestedTopic;

  return {
    question: {
      bodyTypst: payload.bodyTypst as string,
      alternatives: alternatives as unknown as GeneratedAlternatives,
      correctAnswer: payload.correctAnswer as string,
      figureCode: typeof rawFigureCode === "string" && rawFigureCode.length > 0 ? rawFigureCode : undefined,
      suggestedCourseName:
        typeof rawSuggestedCourse === "string" && rawSuggestedCourse.trim().length > 0
          ? rawSuggestedCourse
          : undefined,
      suggestedTopicName:
        typeof rawSuggestedTopic === "string" && rawSuggestedTopic.trim().length > 0
          ? rawSuggestedTopic
          : undefined,
    },
    selfReport: {
      conceptsUsed: conceptsUsed as string[],
      solutionSteps: solutionSteps as number,
    },
  };
}
