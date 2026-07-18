import {
  GeneratedAlternatives,
  GeneratedQuestion,
} from "../../domain/ports/question-generator.port";

const VALID_ANSWER_LETTERS = new Set(["a", "b", "c", "d", "e"]);

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
export function validateGeneratedQuestionShape(
  value: unknown,
): GeneratedQuestion {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("AI response payload must be a JSON object");
  }

  const payload = value as Record<string, unknown>;

  if (typeof payload.bodyTypst !== "string" || payload.bodyTypst.trim().length === 0) {
    errors.push("bodyTypst must be a non-empty string");
  }

  const alternatives = payload.alternatives;
  if (
    !Array.isArray(alternatives) ||
    alternatives.length !== 5 ||
    !alternatives.every((alt) => typeof alt === "string" && alt.trim().length > 0)
  ) {
    errors.push("alternatives must be an array of exactly 5 non-empty strings");
  }

  if (
    typeof payload.correctAnswer !== "string" ||
    !VALID_ANSWER_LETTERS.has(payload.correctAnswer)
  ) {
    errors.push('correctAnswer must be one of "a", "b", "c", "d", "e"');
  }

  const rawFigureCode = payload.figureCode;
  if (
    rawFigureCode !== undefined &&
    rawFigureCode !== null &&
    typeof rawFigureCode !== "string"
  ) {
    errors.push("figureCode must be a string, null, or omitted");
  }

  if (errors.length > 0) {
    throw new TypeError(`Invalid AI-generated question: ${errors.join("; ")}`);
  }

  return {
    bodyTypst: payload.bodyTypst as string,
    alternatives: alternatives as unknown as GeneratedAlternatives,
    correctAnswer: payload.correctAnswer as string,
    figureCode:
      typeof rawFigureCode === "string" && rawFigureCode.length > 0
        ? rawFigureCode
        : undefined,
  };
}
