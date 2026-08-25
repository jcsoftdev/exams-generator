import { Difficulty } from "../enums/difficulty.enum";

/**
 * Lifecycle of a durable AI-generation batch job, as the client sees it —
 * `generation_jobs.status` in the database.
 *
 * The database column is driven by `GENERATION_JOB_STATUSES` in the API's
 * schema (`db/schema/enums.ts`), which cannot be imported here —
 * `packages/shared` must not depend on the API. The two lists are kept
 * honest by a test on the API side that compares them, same pattern as
 * `EXAM_VERSION_JOB_STATUSES`.
 *
 * NOTE: the API's `generation_job_status` Postgres enum is, byte for byte,
 * the SAME enum `exam_version_jobs.status` also uses (`generationJobStatusEnum`
 * in `db/schema/enums.ts` is shared by both tables) — so this list and
 * `EXAM_VERSION_JOB_STATUSES` are pinned against the identical DB source and
 * will always carry the same 5 values. Kept as two independently-named
 * exports rather than one shared alias because they mirror two distinct HTTP
 * contracts (`/ai/questions/jobs/*` vs `/exams/:id/versions/jobs/*`); folding
 * them into one is a reasonable follow-up but out of scope for this slice
 * (audit 2026-08-21, M4b).
 */
export const GENERATION_JOB_STATUSES = ["pending", "running", "completed", "failed", "cancelled"] as const;

export type GenerationJobStatus = (typeof GENERATION_JOB_STATUSES)[number];

/**
 * One failed item inside a `GenerationJob.failedItems` array. Structurally
 * identical to `GenerateQuestionsFailedItem` (a single buffered-batch item
 * failure) by coincidence, not by design — they mirror two independent API
 * types (`GenerationJobFailedItem` in `generation-jobs.repository.ts` vs
 * `GenerateQuestionsFailedItem` in `generate-questions.service.ts`) that
 * happen to describe the same "index + reason" shape, so both names are kept
 * to avoid implying a coupling that isn't there.
 */
export interface GenerationJobFailedItem {
  readonly index: number;
  readonly error: string;
}

/**
 * Wire shape of `/ai/questions/jobs/*` — what `POST /ai/questions/jobs`
 * (202), `GET /ai/questions/jobs/:id`, `GET /ai/questions/jobs/:id/stream`
 * and `POST /ai/questions/jobs/:id/cancel` all return.
 *
 * Declared here rather than twice — it was `GenerationJob` in the web's
 * `ai.models.ts` and `GenerationJobRecord` in the API's
 * `generation-jobs.repository.ts`, with nothing tying a field renamed on one
 * side to a compile failure on the other (audit 2026-08-21, M4b). Comparing
 * the two found no drift beyond what's listed below — every field the web
 * declared really is sent, with the type the web already assumed.
 *
 * Same pattern as `ExamVersionJob`: the API's record stays WIDER on purpose —
 * `createdBy`/`createdByRole` are storage/audit concerns (who queued the job)
 * that no web screen reads or displays; they are pinned as extra fields on
 * `GenerationJobRecord` instead of added here.
 */
export interface GenerationJob {
  readonly id: string;
  readonly tenantId: string;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly count: number;
  readonly withFigure: boolean;
  readonly status: GenerationJobStatus;
  readonly createdCount: number;
  readonly failedCount: number;
  readonly createdQuestionIds: readonly string[];
  readonly failedItems: readonly GenerationJobFailedItem[];
  readonly cancelRequested: boolean;
  /** Immediate predecessor this job resubmits, or null if it isn't a retry. */
  readonly retriedFromJobId: string | null;
  /** The chain's original job id (never this job's own id), or null if this job IS the original. */
  readonly rootJobId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

/**
 * `GenerationJob` plus display fields only the history LIST needs: how many
 * attempts exist in its retry chain, and the course/topic names so each row
 * can show a title instead of raw ids. Mirrors `GenerationJobListRecord`
 * (which extends the wider `GenerationJobRecord` the same way).
 */
export interface GenerationJobListItem extends GenerationJob {
  readonly attemptCount: number;
  readonly courseName: string;
  readonly topicName: string;
}

/** `GET /ai/questions/jobs` response. */
export interface GenerationJobListResult {
  readonly items: readonly GenerationJobListItem[];
  readonly total: number;
}

/** `GET /ai/questions/jobs/:id/chain` response — every attempt in a job's retry chain, oldest first. */
export interface GenerationJobChainResult {
  readonly items: readonly GenerationJob[];
}

/** One question successfully created by a buffered `POST /ai/questions/generate*` batch item. */
export interface GenerateQuestionsCreatedItem {
  readonly id: string;
}

/** One batch item that failed — the item's 0-based position in the request, and why. */
export interface GenerateQuestionsFailedItem {
  readonly index: number;
  readonly error: string;
}

/**
 * A generation batch is PARTIAL: some questions can fail (e.g. invalid Typst
 * markup from the model) while others are created as drafts. Mirrors
 * `GenerateQuestionsResult` (`generate-questions.service.ts`).
 */
export interface GenerateQuestionsResult {
  readonly created: readonly GenerateQuestionsCreatedItem[];
  readonly failed: readonly GenerateQuestionsFailedItem[];
}

/** Emitted mid-stream by `POST /ai/questions/generate/stream`, before the terminal `done` event. */
export type GenerateProgressEvent =
  { readonly type: "delta"; readonly text: string } | { readonly type: "restart" };

/**
 * Every event `POST /ai/questions/generate/stream` can emit. `restart` fires
 * whenever the backend discards a partial generation and starts a fresh one
 * (an internal AI-response retry, or a Typst-compile retry) — consumers MUST
 * clear any UI state built from `delta` events when they see it, or two
 * unrelated generations will look like one continuous stream.
 */
export type GenerateQuestionStreamEvent =
  GenerateProgressEvent | { readonly type: "done"; readonly result: GenerateQuestionsResult };

/**
 * Response shape shared by `POST /ai/questions/:id/revise` and
 * `POST /ai/questions/extract` — mirrors `GeneratedQuestion` (api
 * `domain/ports/question-generator.port.ts`), the domain PORT type every AI
 * provider adapter implements. That port type stays local to the API (it is
 * a hexagonal port, not a wire contract), and is structurally assignable to
 * this DTO — pinned by a compile-time assertion in `ai-contract.spec.ts`.
 *
 * The backend already converts the model's letter answer ("a"-"e") to a
 * 0-based INDEX string ("0"-"4") via `correctAnswerLetterToIndex` before
 * responding, so `correctAnswer` here is an index, not a letter — do not
 * re-convert on the client.
 *
 * Comparing the two prior declarations found one real defect: the web typed
 * `figureCode` as `string | null | undefined`, but nothing on the API side
 * ever sends `null` — the port always OMITS the field (`undefined`) when no
 * figure was generated/extracted, never sets it to `null`. Narrowed to
 * `string | undefined` here to match what actually crosses the wire.
 *
 * `alternatives` is left as a loose `readonly string[]`, not the port's
 * exactly-5 `GeneratedAlternatives` tuple, even though the API always sends
 * exactly 5 (`openrouter-response-validator.ts` rejects anything else) —
 * the bank feature's own AI-revise/extract test fixtures
 * (`bank-list.component.spec.ts`, `bank-new.component.spec.ts`) construct
 * `AiRevisedQuestion` values with 2-element arrays via `satisfies
 * AiRevisedQuestion`, so tightening this type here would fail their
 * typecheck; bank/** is out of scope for this change.
 */
export interface AiRevisedQuestion {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly figureCode?: string;
  /**
   * `extract` only — best-effort course/topic name guesses, present only
   * when the model was confident enough to name them (never a made-up
   * name). `revise`'s response never carries these.
   */
  readonly suggestedCourseName?: string;
  readonly suggestedTopicName?: string;
}

/** A crop rectangle in coordinates normalized to 0..1 — see the API's `NormalizedBox`. */
export interface NormalizedBoxDto {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * One cropped graphic, carried inline as a `data:` URL rather than as an
 * asset id. Nothing is persisted until the teacher saves the question, so a
 * discarded draft leaves no orphan asset behind to clean up.
 */
export interface AiQuestionCrop {
  readonly dataUrl: string;
  readonly box: NormalizedBoxDto;
}

/** A crop belonging to one alternative slot. `alternativeIndex` is 0-based. */
export interface AiAlternativeCrop extends AiQuestionCrop {
  readonly alternativeIndex: number;
}

/**
 * `POST /ai/questions/extract`'s response. Extends the revise response with
 * the crop fields; both are absent when the photo held no graphic at all,
 * which is the signal the UI uses to render no crop controls.
 *
 * Task 6 adds an `extractionId` here (a Redis cache handle for a follow-up
 * re-crop endpoint) — deliberately not added yet, since this task builds the
 * initial extraction only, not the cache it will sit on top of.
 */
export interface AiExtractedQuestion extends AiRevisedQuestion {
  readonly figureCrop?: AiQuestionCrop;
  /** Sparse — only the alternatives that are drawings appear here. */
  readonly alternativeCrops?: readonly AiAlternativeCrop[];
}
