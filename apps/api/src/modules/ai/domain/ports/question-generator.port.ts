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
export type GeneratedAlternatives = readonly [string, string, string, string, string];

export interface GeneratedQuestion {
  /** Typst markup — supports inline/block math. */
  readonly bodyTypst: string;
  readonly alternatives: GeneratedAlternatives;
  /** Letter of the correct alternative: "a" | "b" | "c" | "d" | "e". */
  readonly correctAnswer: string;
  /** CeTZ figure source, present only when `withFigure` was requested. */
  readonly figureCode?: string;
  /**
   * `extractFromImage` only — best-effort course/topic name guesses so the
   * caller can pre-fill Curso/Tema without asking the human to pick them
   * before running extraction. Absent/undefined whenever the model wasn't
   * confident enough to guess (never a made-up name); `generate`/
   * `reviseQuestion` never populate these (course/topic are already KNOWN
   * inputs on those paths).
   */
  readonly suggestedCourseName?: string;
  readonly suggestedTopicName?: string;
}

/** Input for `QuestionGeneratorPort.reviseQuestion()` — AI-assisted edit of an existing question. */
export interface ReviseQuestionInput {
  readonly current: {
    readonly bodyTypst: string;
    readonly alternatives: readonly string[];
    /** Letter of the correct alternative: "a" | "b" | "c" | "d" | "e" — same convention as `GeneratedQuestion.correctAnswer`. */
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

/**
 * `extractFromImage()`'s own result shape — deliberately NOT `GeneratedQuestion`.
 * `generate()`/`reviseQuestion()` always produce exactly 5 alternatives and a
 * definite letter key (the model is composing content from nothing, so a
 * schema-enforced complete answer is correct there). `extractFromImage()`
 * transcribes a PHOTO instead: the source material may show fewer than 5
 * alternatives, or no visible/inferable correct answer at all — and inventing
 * either to satisfy a stricter shape would hand the teacher a fabricated
 * alternative or a fabricated key with no way to tell it apart from a real
 * one. So this type is intentionally more permissive on exactly the two
 * fields where the photo itself may simply have less to give:
 *   - `alternatives`: 0..5 non-blank strings (never padded/invented).
 *   - `correctAnswer`: a letter "a".."e" when visible/inferable, `null` when
 *     it is not — never a guess.
 */
export interface ExtractedQuestion extends Omit<GeneratedQuestion, "alternatives" | "correctAnswer"> {
  /** Alternatives the photo actually shows, in order — empty when the photo shows none. Never invented/padded. */
  readonly alternatives: readonly string[];
  /** Letter of the correct alternative when visible/inferable in the photo, `null` otherwise. Never a guess. */
  readonly correctAnswer: string | null;
}

/**
 * Emitted during `QuestionGeneratorPort.generate()` when a caller passes an
 * `onProgress` callback — proof-of-life for the AI call while it's still in
 * flight (design doc: live streaming progress). `restart` fires whenever a
 * PARTIAL generation is discarded and a fresh one begins — either this
 * port's own internal retry (bad/unparseable model output) or the caller's
 * own retry (e.g. a Typst compile failure upstream in
 * `GenerateQuestionsService`). Callers MUST treat `restart` as "clear
 * whatever you accumulated from `delta` events so far" — without it, text
 * from two unrelated generations would look like one continuous stream.
 */
export type GenerateProgressEvent =
  { readonly type: "delta"; readonly text: string } | { readonly type: "restart" };

export interface QuestionGeneratorPort {
  /**
   * Produces one AI-generated question. Implementations MUST validate their
   * own output against the expected shape before resolving — this port
   * NEVER returns unvalidated content (design doc §7: "Nunca se guarda sin
   * validar contra schema").
   *
   * `onProgress`, when provided, is invoked with `delta`/`restart` events as
   * the underlying provider streams its response — purely a progress signal,
   * never part of the resolved value. Implementations that can't stream MAY
   * call it once with the full text, or not at all.
   *
   * `previousCompileError`, when provided, is a Typst compiler error from a
   * PRIOR call with this exact same `input` (fed back by the caller after its
   * own downstream compile step failed — this port has no PDF compiler of its
   * own). Implementations SHOULD surface it to the model so the retry is
   * informed rather than a blind re-roll of the same prompt.
   *
   * @throws AiRateLimitError when the provider is rate-limited (e.g. 429 on
   *   OpenRouter's free tier).
   * @throws AiInvalidResponseError when the provider's output can't be
   *   parsed/validated into a `GeneratedQuestion`, even after any internal
   *   retry the adapter performs.
   */
  generate(
    input: GenerateQuestionInput,
    onProgress?: (event: GenerateProgressEvent) => void,
    previousCompileError?: string,
  ): Promise<GeneratedQuestion>;

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
   * `ExtractedQuestion` — unlike `generate()`/`reviseQuestion()`, alternatives
   * may be fewer than 5 (even zero) and `correctAnswer` may be `null` when the
   * photo doesn't show or imply either: this port NEVER invents an
   * alternative or a key the source material didn't actually contain.
   *
   * @throws AiRateLimitError when the provider is rate-limited.
   * @throws AiInvalidResponseError when the provider's output can't be
   *   parsed/validated into an `ExtractedQuestion`.
   */
  extractFromImage(input: ExtractQuestionInput): Promise<ExtractedQuestion>;
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
