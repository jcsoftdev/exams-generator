import {
  GeneratedAlternatives,
  GeneratedQuestion,
} from "../../domain/ports/question-generator.port";

const VALID_ANSWER_LETTERS = new Set(["a", "b", "c", "d", "e"]);

const MATH_SEGMENT = /\$([^$]*)\$/g;
const LATEX_COMMAND = /\\[a-zA-Z]+/;

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
 */
function findLatexCommandInMath(bodyTypst: string): string | undefined {
  for (const match of bodyTypst.matchAll(MATH_SEGMENT)) {
    const command = match[1].match(LATEX_COMMAND);
    if (command) {
      return command[0];
    }
  }
  return undefined;
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
