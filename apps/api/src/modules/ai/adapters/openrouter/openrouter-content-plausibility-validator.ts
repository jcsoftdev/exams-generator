import { GenerateQuestionInput, GeneratedQuestion } from "../../domain/ports/question-generator.port";

const PLAIN_INTEGER = /^-?\d+$/;

/**
 * Detects the "lazy enumeration" placeholder pattern (1,2,3,4,5 or its
 * mirror 5,4,3,2,1) — a model that gave up on the actual content falls back
 * to counting instead of computing real distractors. Any OTHER numeric run
 * (a step != 1, e.g. 2,4,6,8,10) is left alone: that's a plausible real
 * answer set (multiples, a fixed offset, etc.), not a placeholder.
 */
function isConsecutiveIntegerPlaceholder(alternatives: readonly string[]): boolean {
  const trimmed = alternatives.map((alt) => alt.trim());
  if (!trimmed.every((value) => PLAIN_INTEGER.test(value))) {
    return false;
  }

  const numbers = trimmed.map(Number);
  const diffs = numbers.slice(1).map((n, i) => n - numbers[i]);
  return diffs.every((d) => d === 1) || diffs.every((d) => d === -1);
}

/**
 * Second content-quality gate for `generate()` ONLY (the only op with
 * course/topic/withFigure context) — `validateGeneratedQuestionShape` only
 * checks the response matches the JSON SHAPE, it has no way to notice the
 * model ignored the prompt's actual content. In production, a free-tier
 * model (`nvidia/nemotron-3-super-120b-a12b:free`) returned a perfectly
 * schema-valid but completely off-topic question for a "Geometría del
 * espacio (poliedros)" / hard / withFigure:true request: `bodyTypst: "¿Cuál
 * es el resultado de $1 + 1$?"`, `alternatives: ["1","2","3","4","5"]`,
 * `figureCode: null`.
 *
 * A literal "topic keyword must appear in bodyTypst" check was considered
 * and rejected — it's unreliable in both directions: a real question about
 * "poliedros" can legitimately say "prisma"/"pirámide" without ever writing
 * the word "poliedro", so it would false-positive-reject good output (see
 * `openrouter.adapter.spec.ts`'s own `topic: "fracciones"` fixture, whose
 * body never says "fracciones" either). What IS a reliable, near-zero-false-
 * positive signal that the model didn't actually engage with the request:
 *  - `alternatives` forming a bare consecutive count-up/count-down — real
 *    distractors are computed values, never a lazy enumeration.
 *  - `withFigure: true` was requested but `figureCode` came back empty — the
 *    model dropped the requirement instead of even attempting it.
 * Either signal throws so the SAME retry-with-feedback loop `attempt()`
 * already runs for shape failures kicks in, this time with the actual
 * failure surfaced back into the prompt.
 */
export function assessGeneratedQuestionPlausibility(
  question: GeneratedQuestion,
  input: GenerateQuestionInput,
): void {
  const errors: string[] = [];

  if (isConsecutiveIntegerPlaceholder(question.alternatives)) {
    errors.push(
      `alternatives are a bare consecutive sequence (${question.alternatives.join(", ")}) — this looks like a placeholder, not a real answer set for "${input.topic}" (${input.course}). Write alternatives that are actual computed values for this specific question.`,
    );
  }

  if (input.withFigure && !question.figureCode) {
    errors.push(
      "withFigure was requested but figureCode is empty — a CeTZ figure is required for this question.",
    );
  }

  if (errors.length > 0) {
    throw new TypeError(`Generated question failed content-plausibility check: ${errors.join("; ")}`);
  }
}
