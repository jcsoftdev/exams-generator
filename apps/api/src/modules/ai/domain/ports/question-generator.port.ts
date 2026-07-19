import { Difficulty } from "@exams-generator/shared";
import { GradeLevel } from "../../../exams/domain/value-objects/grade-level";

/**
 * QuestionGeneratorPort — the domain/application layer never talks to an AI
 * provider (OpenRouter, Gemini, Claude, ...) directly. Every adapter (real
 * HTTP client, in-memory fake for unit tests, ...) implements this same
 * contract so callers can swap the model/provider without touching business
 * logic (mirrors `StoragePort` / `PdfCompilerPort`).
 *
 * Per design doc §5.2: AI-generated questions are ALWAYS `structured`
 * (Typst markup body, JSON alternatives, optional CeTZ figure code) and
 * ALWAYS enter the bank as `draft` — this port only generates content, it
 * never decides persistence/approval state.
 */
export interface GenerateQuestionInput {
  readonly course: string;
  readonly topic: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: GradeLevel;
  /** Whether the model should also produce a CeTZ figure code block. */
  readonly withFigure: boolean;
}

/** Exactly 5 alternatives, per design doc §5.2. */
export type GeneratedAlternatives = readonly [
  string,
  string,
  string,
  string,
  string,
];

export interface GeneratedQuestion {
  /** Typst markup — supports inline/block math. */
  readonly bodyTypst: string;
  readonly alternatives: GeneratedAlternatives;
  /** Letter of the correct alternative: "a" | "b" | "c" | "d" | "e". */
  readonly correctAnswer: string;
  /** CeTZ figure source, present only when `withFigure` was requested. */
  readonly figureCode?: string;
}

/** Input for `QuestionGeneratorPort.reviseQuestion()` — AI-assisted edit of an existing question. */
export interface ReviseQuestionInput {
  readonly current: {
    readonly bodyTypst: string;
    readonly alternatives: readonly string[];
    readonly correctAnswer: string;
  };
  /** Free-text instruction from the human editor, e.g. "hazla más difícil". */
  readonly instruction: string;
  readonly difficulty: Difficulty;
}

/** Input for `QuestionGeneratorPort.extractFromImage()` — OCR/vision extraction of a question from a photo. */
export interface ExtractQuestionInput {
  readonly image: Buffer;
  readonly mimeType: string;
}

export interface QuestionGeneratorPort {
  /**
   * Produces one AI-generated question. Implementations MUST validate their
   * own output against the expected shape before resolving — this port
   * NEVER returns unvalidated content (design doc §7: "Nunca se guarda sin
   * validar contra schema").
   *
   * @throws AiRateLimitError when the provider is rate-limited (e.g. 429 on
   *   OpenRouter's free tier).
   * @throws AiInvalidResponseError when the provider's output can't be
   *   parsed/validated into a `GeneratedQuestion`, even after any internal
   *   retry the adapter performs.
   */
  generate(input: GenerateQuestionInput): Promise<GeneratedQuestion>;

  /**
   * Applies a human-authored edit instruction to an existing question and
   * returns a new, fully-validated `GeneratedQuestion` (same shape/validation
   * guarantees as `generate()`).
   *
   * @throws AiRateLimitError when the provider is rate-limited.
   * @throws AiInvalidResponseError when the provider's output can't be
   *   parsed/validated into a `GeneratedQuestion`.
   */
  reviseQuestion(input: ReviseQuestionInput): Promise<GeneratedQuestion>;

  /**
   * Extracts a question (body, alternatives, correct answer) from a photo of
   * a printed/handwritten question, returning a fully-validated
   * `GeneratedQuestion` (same shape/validation guarantees as `generate()`).
   *
   * @throws AiRateLimitError when the provider is rate-limited.
   * @throws AiInvalidResponseError when the provider's output can't be
   *   parsed/validated into a `GeneratedQuestion`.
   */
  extractFromImage(input: ExtractQuestionInput): Promise<GeneratedQuestion>;
}

export class AiGenerationError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AiGenerationError";
  }
}

/** Raised when the provider responds 429 (free-tier quota exhausted). */
export class AiRateLimitError extends AiGenerationError {
  constructor(message = "AI provider rate limit reached (429)") {
    super(message);
    this.name = "AiRateLimitError";
  }
}

/**
 * Raised when the provider's response can't be turned into a valid
 * `GeneratedQuestion`, after the adapter's single retry has also failed.
 * `rawResponse` is kept for debugging/logging — never persisted.
 */
export class AiInvalidResponseError extends AiGenerationError {
  constructor(
    message: string,
    readonly rawResponse: string,
  ) {
    super(message);
    this.name = "AiInvalidResponseError";
  }
}
