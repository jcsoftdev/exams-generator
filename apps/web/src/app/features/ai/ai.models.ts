import { Difficulty } from '@exams-generator/shared';

/**
 * LOCAL grade-level catalog for apps/web's ai feature.
 *
 * Duplicated from `features/bank/bank.models.ts` (same fixed backend
 * catalog, see that file's comment for the full rationale). Kept as a
 * local copy — same convention the bank feature already follows for
 * auth.models.ts — rather than cross-importing another feature folder or
 * editing `packages/shared` (integrator-owned, see
 * docs/superpowers/PARALLEL-TODO.md Reglas de coordinación). Promote to
 * `@exams-generator/shared` once a third feature needs it.
 */
export const GRADE_LEVELS = [
  'primaria_1',
  'primaria_2',
  'primaria_3',
  'primaria_4',
  'primaria_5',
  'primaria_6',
  'secundaria_1',
  'secundaria_2',
  'secundaria_3',
  'secundaria_4',
  'secundaria_5',
  'pre',
] as const;

export type GradeLevel = (typeof GRADE_LEVELS)[number];

export const GRADE_LEVEL_LABELS: Record<GradeLevel, string> = {
  primaria_1: '1° primaria',
  primaria_2: '2° primaria',
  primaria_3: '3° primaria',
  primaria_4: '4° primaria',
  primaria_5: '5° primaria',
  primaria_6: '6° primaria',
  secundaria_1: '1° secundaria',
  secundaria_2: '2° secundaria',
  secundaria_3: '3° secundaria',
  secundaria_4: '4° secundaria',
  secundaria_5: '5° secundaria',
  pre: 'Pre-admisión',
};

/**
 * `POST /ai/questions/generate` request body (design doc §5.2). Course and
 * topic are raw IDs — GAP: there is no course/topic catalog endpoint yet,
 * see ai-generate.component for the note surfaced to the user.
 */
export interface GenerateQuestionsPayload {
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly count: number;
  readonly withFigure: boolean;
}

/** Mirrors `GenerateQuestionsCreatedItem` (apps/api ai module). */
export interface GenerateQuestionsCreatedItem {
  readonly id: string;
}

/** Mirrors `GenerateQuestionsFailedItem` (apps/api ai module). */
export interface GenerateQuestionsFailedItem {
  readonly index: number;
  readonly error: string;
}

/**
 * Mirrors `GenerateQuestionsResult` (apps/api ai module) — a batch is
 * PARTIAL: some questions can fail (e.g. invalid Typst markup from the
 * model) while others are created as drafts.
 */
export interface GenerateQuestionsResult {
  readonly created: readonly GenerateQuestionsCreatedItem[];
  readonly failed: readonly GenerateQuestionsFailedItem[];
}

/**
 * Mirrors `GenerateProgressEvent`/`GenerateQuestionStreamEvent` (apps/api
 * ai module). `restart` fires whenever the backend discards a partial
 * generation and starts a fresh one (an internal AI-response retry, or a
 * Typst-compile retry) — consumers MUST clear any UI state built from
 * `delta` events when they see it, or two unrelated generations will look
 * like one continuous stream.
 */
export type GenerateQuestionStreamEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'restart' }
  | { readonly type: 'done'; readonly result: GenerateQuestionsResult };

/**
 * A `status='draft'` structured question awaiting human review (design doc
 * §5.2, §7 — the AI never publishes directly to the bank). Mirrors the
 * relevant fields of `QuestionListItem` (apps/api bank module) narrowed to
 * what the structured editor needs.
 */
export interface DraftQuestion {
  readonly id: string;
  readonly tenantId: string | null;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly correctAnswer: string;
  readonly bodyTypst: string | null;
  readonly alternatives: readonly string[] | null;
  readonly figureCode: string | null;
}

/**
 * `PATCH /bank/questions/:id` request body. The backend recompiles the
 * Typst preview server-side and responds 400 (never persists) if the
 * markup is invalid after applying the patch — see
 * `extract-error-message.ts` for how the review queue surfaces that.
 */
export interface EditDraftPayload {
  readonly bodyTypst?: string;
  readonly alternatives?: readonly string[];
  readonly correctAnswer?: string;
  readonly figureCode?: string;
}

/**
 * Task 7: response shape shared by `POST /ai/questions/:id/revise` and
 * `POST /ai/questions/extract` — mirrors `GeneratedQuestion`
 * (apps/api/src/modules/ai/ports/question-generator.port.ts). The backend
 * already converts the model's letter answer ("a"-"e") to a 0-based INDEX
 * string ("0"-"4") via `correctAnswerLetterToIndex` before responding, so
 * `correctAnswer` here is an index, not a letter — do not re-convert on
 * the client.
 */
export interface AiRevisedQuestion {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly figureCode?: string | null;
}

export type GenerationJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface GenerationJobFailedItem {
  readonly index: number;
  readonly error: string;
}

/** Mirrors `GenerationJobRecord` (apps/api ai module) — a durable AI-generation batch job. */
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

/** `POST /ai/questions/jobs` request body. */
export interface CreateGenerationJobPayload {
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly count: number;
  readonly withFigure: boolean;
  /** Set when this job resubmits a failed/partial batch — see `GenerationJobDetailComponent.retry()`. */
  readonly retriedFromJobId?: string;
}

/**
 * `GenerationJob` plus display fields only `listGenerationJobs()`'s
 * leaf-per-chain rows carry: how many attempts exist in its retry chain, and
 * the course/topic names so each history row can show a title instead of
 * raw ids.
 */
export interface GenerationJobListItem extends GenerationJob {
  readonly attemptCount: number;
  readonly courseName: string;
  readonly topicName: string;
}

export interface GenerationJobListResult {
  readonly items: readonly GenerationJobListItem[];
  readonly total: number;
}

/** `GET /ai/questions/jobs/:id/chain` response — every attempt in a job's retry chain, oldest first. */
export interface GenerationJobChainResult {
  readonly items: readonly GenerationJob[];
}
