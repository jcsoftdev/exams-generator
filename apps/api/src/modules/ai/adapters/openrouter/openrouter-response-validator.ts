import {
  ExtractedQuestion,
  GeneratedAlternatives,
  GeneratedQuestion,
} from "../../domain/ports/question-generator.port";

const ANSWER_LETTERS = ["a", "b", "c", "d", "e"] as const;
const VALID_ANSWER_LETTERS = new Set<string>(ANSWER_LETTERS);

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
 * A verdict the model appended to a proposition it was asked to TRANSCRIBE,
 * not solve: `-> V`, `→ F`, a trailing `(V)`, a tick or a cross. Anchored to
 * the end of a line, because that is where an annotation lands — a legitimate
 * `->` mid-sentence (a mapping, an implication inside the question's own
 * wording) never is.
 */
const ANSWER_ANNOTATION = /(?:->|→|=>)\s*[VF]\s*\$?\s*$|[✓✗]\s*\$?\s*$|\(\s*[VF]\s*\)\s*\$?\s*$/gmu;

/** How many annotated lines it takes before this is the model solving, not coincidence. */
const ANSWER_ANNOTATION_THRESHOLD = 2;

/**
 * Counts lines that end in a true/false verdict.
 *
 * This is the same shape as `findLatexCommandInMath` above: a known-bad
 * pattern inside `bodyTypst` becomes a validation error, which the adapter
 * feeds back into a retry (`previousError`) instead of shipping. Prompting
 * alone did not hold — the rule leads the extract prompt and a weak model
 * still annotated every proposition — and the failure is invisible until the
 * exam prints, handing the candidate the answer key.
 *
 * Requires TWO such lines, not one: a single `-> V` could plausibly belong to
 * the question's own text, while a column of them is the model showing its
 * work.
 */
function countAnswerAnnotations(bodyTypst: string): number {
  return [...bodyTypst.matchAll(ANSWER_ANNOTATION)].length;
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

export interface ValidatedExtractedQuestion {
  readonly question: ExtractedQuestion;
  readonly selfReport: QuestionSelfReport;
}

/** Fields validated the SAME way regardless of caller — everything except `alternatives`/`correctAnswer`, where extraction is deliberately more permissive (see `ExtractedQuestion`'s docstring). */
interface CommonValidatedFields {
  readonly bodyTypst: string;
  readonly figureCode?: string;
  readonly conceptsUsed: readonly string[];
  readonly solutionSteps: number;
  readonly suggestedCourseName?: string;
  readonly suggestedTopicName?: string;
}

/**
 * Validates every field `validateGeneratedQuestionShape` and
 * `validateExtractedQuestionShape` check IDENTICALLY — `bodyTypst` (+ its
 * LaTeX/answer-annotation guards), `figureCode`, `conceptsUsed`,
 * `solutionSteps`, and the best-effort `suggestedCourse`/`suggestedTopic`.
 * Pushes onto the SHARED `errors` array the two callers each own, so a
 * single combined `TypeError` still names every violated rule in one message.
 */
function validateCommonFields(payload: Record<string, unknown>, errors: string[]): CommonValidatedFields {
  if (typeof payload.bodyTypst !== "string" || payload.bodyTypst.trim().length === 0) {
    errors.push("bodyTypst must be a non-empty string");
  } else {
    const latexCommand = findLatexCommandInMath(payload.bodyTypst);
    if (latexCommand) {
      errors.push(
        `bodyTypst contains the LaTeX command "${latexCommand}" inside math mode ($...$) — Typst cannot compile LaTeX commands, rewrite that math using Typst syntax (no backslash)`,
      );
    }

    const annotations = countAnswerAnnotations(payload.bodyTypst);
    if (annotations >= ANSWER_ANNOTATION_THRESHOLD) {
      errors.push(
        `bodyTypst has ${annotations} lines ending in a true/false verdict (-> V, -> F, ✓, ✗) — you were asked to TRANSCRIBE the question, not solve it. Those marks would print on the exam and hand the candidate the answer. Remove every one of them and put the answer only in correctAnswer`,
      );
    }
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

  // `suggestedCourse`/`suggestedTopic` are extract-only, best-effort, and
  // never validated as errors — a `null`/absent/blank guess just means
  // "not confident enough", not a malformed response (mirrors `figureCode`'s
  // null-normalization above). `generate`/`reviseQuestion` payloads never
  // carry these keys at all, so this is a no-op for those callers.
  const rawSuggestedCourse = payload.suggestedCourse;
  const rawSuggestedTopic = payload.suggestedTopic;

  return {
    bodyTypst: payload.bodyTypst as string,
    figureCode: typeof rawFigureCode === "string" && rawFigureCode.length > 0 ? rawFigureCode : undefined,
    conceptsUsed: conceptsUsed as string[],
    solutionSteps: solutionSteps as number,
    suggestedCourseName:
      typeof rawSuggestedCourse === "string" && rawSuggestedCourse.trim().length > 0
        ? rawSuggestedCourse
        : undefined,
    suggestedTopicName:
      typeof rawSuggestedTopic === "string" && rawSuggestedTopic.trim().length > 0
        ? rawSuggestedTopic
        : undefined,
  };
}

/**
 * Uppercase is unambiguous and models emit it constantly ("E" for the fifth
 * option). Rejecting it with a 422 burns a paid call over letter case, and
 * this validator already normalizes defensively elsewhere (it strips letter
 * prefixes and unwraps JSON-wrapped alternatives) — being strict about only
 * this one is incoherent.
 */
function normalizeCorrectAnswer(value: unknown): unknown {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

/**
 * Validates an already-parsed (but untyped) JSON value against the
 * `GeneratedQuestion` shape — used by `generate()`/`reviseQuestion()`, which
 * compose a question from nothing and so must always produce exactly 5
 * alternatives and a definite letter key. This is the ONLY gate content is
 * allowed through before the port resolves — per design doc §7 the AI
 * response is "nunca se guarda sin validar contra schema". Throws
 * `TypeError` (with a message describing every violated rule) when the
 * payload doesn't match.
 *
 * `figureCode: null` (a common JSON-schema idiom for "optional field") is
 * normalized to `undefined` to match the port's TypeScript contract.
 *
 * For `extractFromImage()`'s own, deliberately more permissive shape (the
 * photo may show fewer than 5 alternatives, or no identifiable key), see
 * `validateExtractedQuestionShape` below — NOT this function.
 */
export function validateGeneratedQuestionShape(value: unknown): ValidatedGeneratedQuestion {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("AI response payload must be a JSON object");
  }

  const payload = value as Record<string, unknown>;
  const common = validateCommonFields(payload, errors);

  const alternatives = payload.alternatives;
  if (
    !Array.isArray(alternatives) ||
    alternatives.length !== 5 ||
    !alternatives.every((alt) => typeof alt === "string" && alt.trim().length > 0)
  ) {
    errors.push("alternatives must be an array of exactly 5 non-empty strings");
  }

  const correctAnswer = normalizeCorrectAnswer(payload.correctAnswer);
  if (typeof correctAnswer !== "string" || !VALID_ANSWER_LETTERS.has(correctAnswer)) {
    errors.push('correctAnswer must be one of "a", "b", "c", "d", "e"');
  }

  if (errors.length > 0) {
    throw new TypeError(`Invalid AI-generated question: ${errors.join("; ")}`);
  }

  return {
    question: {
      bodyTypst: common.bodyTypst,
      alternatives: alternatives as unknown as GeneratedAlternatives,
      correctAnswer: correctAnswer as string,
      figureCode: common.figureCode,
      suggestedCourseName: common.suggestedCourseName,
      suggestedTopicName: common.suggestedTopicName,
    },
    selfReport: {
      conceptsUsed: common.conceptsUsed,
      solutionSteps: common.solutionSteps,
    },
  };
}

/**
 * Validates an already-parsed (but untyped) JSON value against the
 * `ExtractedQuestion` shape — used ONLY by `extractFromImage()`. Everything
 * except `alternatives`/`correctAnswer` is validated identically to
 * `validateGeneratedQuestionShape` (via `validateCommonFields`); those two
 * fields are deliberately more permissive here, because a photo is a source
 * of TRUTH the model transcribes, not content it composes:
 *   - `alternatives`: 0..5 non-empty strings — an empty photo section means
 *     an empty array, never 5 invented options.
 *   - `correctAnswer`: a letter "a".."e" when visible/inferable, or `null`
 *     when it is not — never a guessed letter.
 *
 * A `correctAnswer` letter that IS present must still be one of "a".."e" —
 * only `null` is accepted as "not visible"; anything else malformed still
 * fails validation the same way `validateGeneratedQuestionShape` does.
 *
 * A letter that IS one of "a".."e" is STILL rejected when its 0-based index
 * has no matching entry in `alternatives` (e.g. `correctAnswer: "c"` with
 * `alternatives: []`, or `"e"` with only 2 alternatives transcribed) — a key
 * pointing at an option the photo never showed is exactly the kind of
 * invented content this validator otherwise refuses to let through, and
 * rejecting it (rather than silently coercing to `null`) is what feeds the
 * error back into the adapter's retry loop instead of shipping a fabricated
 * key. When `alternatives` is empty, this rule alone means every non-null
 * `correctAnswer` is rejected — there is no index an empty array can
 * satisfy.
 */
export function validateExtractedQuestionShape(value: unknown): ValidatedExtractedQuestion {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("AI response payload must be a JSON object");
  }

  const payload = value as Record<string, unknown>;
  const common = validateCommonFields(payload, errors);

  const rawAlternatives = payload.alternatives;
  let alternatives: readonly string[] = [];
  if (
    !Array.isArray(rawAlternatives) ||
    rawAlternatives.length > 5 ||
    !rawAlternatives.every((alt) => typeof alt === "string" && alt.trim().length > 0)
  ) {
    errors.push(
      "alternatives must be an array of at most 5 non-empty strings (empty when the photo shows none)",
    );
  } else {
    alternatives = rawAlternatives as string[];
  }

  const rawCorrectAnswer = payload.correctAnswer;
  let correctAnswer: string | null = null;
  if (rawCorrectAnswer !== null) {
    const normalized = normalizeCorrectAnswer(rawCorrectAnswer);
    if (typeof normalized !== "string" || !VALID_ANSWER_LETTERS.has(normalized)) {
      errors.push(
        'correctAnswer must be one of "a", "b", "c", "d", "e", or null when not visible in the photo',
      );
    } else if (ANSWER_LETTERS.indexOf(normalized as (typeof ANSWER_LETTERS)[number]) >= alternatives.length) {
      errors.push(
        `correctAnswer "${normalized}" has no matching entry in alternatives (only ${alternatives.length} transcribed) — a key the photo can't show must be null, not a guess`,
      );
    } else {
      correctAnswer = normalized;
    }
  }

  if (errors.length > 0) {
    throw new TypeError(`Invalid AI-extracted question: ${errors.join("; ")}`);
  }

  return {
    question: {
      bodyTypst: common.bodyTypst,
      alternatives,
      correctAnswer,
      figureCode: common.figureCode,
      suggestedCourseName: common.suggestedCourseName,
      suggestedTopicName: common.suggestedTopicName,
    },
    selfReport: {
      conceptsUsed: common.conceptsUsed,
      solutionSteps: common.solutionSteps,
    },
  };
}
