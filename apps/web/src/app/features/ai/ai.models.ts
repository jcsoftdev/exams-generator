import { Difficulty } from '@exams-generator/shared';
import type {
  AiRevisedQuestion as AiRevisedQuestionDto,
  GenerateQuestionsCreatedItem,
  GenerateQuestionsFailedItem,
  GenerateQuestionsResult,
  GenerateQuestionStreamEvent,
  GenerationJob as GenerationJobDto,
  GenerationJobChainResult,
  GenerationJobFailedItem,
  GenerationJobListItem,
  GenerationJobListResult,
  GenerationJobStatus,
} from '@exams-generator/shared';

/**
 * Re-exported, not re-declared. This file's own comment said to promote the
 * catalog "once a third feature needs it" — bank, ai and exams all did, so the
 * codes moved to `@exams-generator/shared` (where the API compiles against them
 * too) and the Spanish labels to the taxonomy feature (audit 2026-08-20, M4).
 */
export { GRADE_LEVELS } from '@exams-generator/shared';
export type { GradeLevel } from '@exams-generator/shared';
export { GRADE_LEVEL_LABELS } from '../taxonomy/grade-level-labels';

/**
 * `POST /ai/questions/generate` request body (design doc §5.2). Course and
 * topic are raw IDs — GAP: there is no course/topic catalog endpoint yet,
 * see ai-generate.component for the note surfaced to the user. Left as a
 * local, strict request type — the API's own request body (`ai.controller.ts`,
 * `GenerateQuestionsBody`) is deliberately loose/optional (everything is
 * re-validated server-side before use), so there is no single honest shape
 * to share between the two (audit 2026-08-21, M4b).
 */
export interface GenerateQuestionsPayload {
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly count: number;
  readonly withFigure: boolean;
}

/**
 * The `POST /ai/questions/generate/stream` response shapes, the durable
 * `/ai/questions/jobs/*` job contract, and the `revise`/`extract` result
 * shape all come from `@exams-generator/shared`, which the API compiles
 * against too — re-exported here so this feature keeps its own local
 * imports. They used to be declared a second time on each side, with
 * nothing tying a field renamed on the wire to a compile failure on the
 * client (audit 2026-08-21, M4b). See `ai.dto.ts` for the differences that
 * comparison turned up.
 */
export type {
  GenerateQuestionsCreatedItem,
  GenerateQuestionsFailedItem,
  GenerateQuestionsResult,
  GenerateQuestionStreamEvent,
  GenerationJobChainResult,
  GenerationJobFailedItem,
  GenerationJobListItem,
  GenerationJobListResult,
  GenerationJobStatus,
};

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
 * Paginated envelope for `GET /bank/questions?status=draft&page=&pageSize=`
 * (`AiService.listDraftsPaged`, docs/audit-2026-08-14.md — the review queue
 * used to fetch the flat unpaginated array via `listDrafts()`, the same
 * unbounded shape that caused the `/app/bank` P0). Mirrors `PagedQuestions`
 * in `bank.models.ts`, narrowed to `DraftQuestion`.
 */
export interface DraftListResult {
  readonly items: readonly DraftQuestion[];
  readonly total: number;
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
 * `POST /ai/questions/extract`. Re-exported under its original local name so
 * this feature's other files (and their specs) don't churn — see
 * `ai.dto.ts` for what comparing this against the API's port type turned up:
 * `figureCode` was typed `string | null | undefined` here, but the API never
 * sends `null` (always omitted, i.e. `undefined`).
 */
export type AiRevisedQuestion = AiRevisedQuestionDto;

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
 * A durable AI-generation batch job. Re-exported under its original local
 * name so this feature's other files don't churn — see `ai.dto.ts` for the
 * full contract (the API's own record stays wider: `createdBy`/
 * `createdByRole` are storage/audit fields no web screen uses).
 */
export type GenerationJob = GenerationJobDto;
