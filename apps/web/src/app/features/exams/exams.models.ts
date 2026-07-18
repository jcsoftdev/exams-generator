import { Difficulty } from '@exams-generator/shared';

/**
 * LOCAL grade-level catalog for apps/web's exams feature.
 *
 * Intentional duplicate of `GRADE_LEVELS`/`GRADE_LEVEL_LABELS` in
 * apps/web/src/app/features/bank/bank.models.ts (same "kept as a local
 * duplicate" pattern that file already uses, itself borrowed from
 * auth.models.ts). Both mirror the backend's fixed catalog at
 * apps/api/src/modules/exams/domain/value-objects/grade-level.ts. Kept
 * local instead of importing from the bank feature to avoid cross-feature
 * coupling between lanes; replace every copy with a shared import once that
 * catalog is promoted to `@exams-generator/shared`.
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

export type ExamStatus = 'draft' | 'ready';

/**
 * GAP (see exams.service.ts): there is no `GET /courses` or `GET /topics`
 * listing endpoint on the backend yet — `courseId`/`topicId` are free-text
 * UUID inputs here, same workaround the bank feature uses for its filters.
 */
export interface CreateExamBlueprintRow {
  readonly courseId: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly count: number;
}

export interface CreateExamPayload {
  readonly title: string;
  readonly gradeLevel: string;
  readonly blueprint: readonly CreateExamBlueprintRow[];
}

export interface CreateExamResult {
  readonly id: string;
  readonly status: ExamStatus;
  readonly selectedQuestionIds: readonly string[];
}

/**
 * Mirrors `ShortageDetail` from apps/api/src/modules/exams/exams.service.ts
 * — one entry per blueprint row that couldn't be filled from the
 * tenant-visible pool.
 */
export interface ShortageDetail {
  readonly blueprintRowId: string;
  readonly courseId: string;
  readonly courseName: string;
  readonly topicId?: string;
  readonly topicName?: string;
  readonly difficulty?: Difficulty;
  readonly requested: number;
  readonly available: number;
}

/** Body of the 422 `UnprocessableEntityException` thrown by `POST /exams`. */
export interface InsufficientStockErrorBody {
  readonly message: string;
  readonly examId: string;
  readonly shortages: readonly ShortageDetail[];
}

export type ReplaceQuestionPayload =
  | { readonly mode: 'reroll' }
  | { readonly mode: 'manual'; readonly replacementQuestionId: string };

export interface ReplaceQuestionResult {
  readonly examId: string;
  readonly oldQuestionId: string;
  readonly newQuestionId: string;
}

export interface ConfirmExamResult {
  readonly id: string;
  readonly status: ExamStatus;
}

export type QuestionType = 'image' | 'structured';

/**
 * One selected question as returned by `GET /exams/:examId` (mirrors
 * `ExamDetailQuestionRecord` in apps/api/src/modules/exams/exams.repository.ts).
 * `type='image'` questions carry `imageAssetId` (`bodyTypst`/`alternatives`/
 * `figureCode` are `null`); `type='structured'` questions carry
 * `bodyTypst`/`alternatives`/`figureCode` instead (`imageAssetId` is `null`).
 */
export interface ExamDetailQuestion {
  readonly id: string;
  readonly position: number;
  readonly type: QuestionType;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly correctAnswer: string;
  readonly imageAssetId: string | null;
  readonly bodyTypst: string | null;
  readonly alternatives: readonly string[] | null;
  readonly figureCode: string | null;
}

/** `GET /exams/:examId` response — the exam header plus its full selection, ordered by position. */
export interface ExamDetail {
  readonly id: string;
  readonly title: string;
  readonly gradeLevel: string;
  readonly status: ExamStatus;
  readonly questions: readonly ExamDetailQuestion[];
}

/**
 * `POST /exams/stock/batch` (B1) request cell — mirrors `StockBatchCellDto`
 * in apps/api/src/modules/exams/exams.service.ts. `topicId`/`difficulty`
 * are optional at the API level, but the exam-builder screen always sends
 * both (one cell per curso·tema·nivel).
 */
export interface StockBatchCellPayload {
  readonly courseId: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
}

export interface StockBatchPayload {
  readonly gradeLevel: string;
  readonly cells: readonly StockBatchCellPayload[];
}

/** Mirrors `StockBatchCellResult` — one entry per input cell, order-matched. */
export interface StockBatchCellResult {
  readonly courseId: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly available: number;
}

export interface StockBatchResult {
  readonly results: readonly StockBatchCellResult[];
}

/** `POST /exams/preview` (B2) request — same blueprint row shape as `CreateExamPayload` minus `title`. */
export interface PreviewExamPayload {
  readonly gradeLevel: string;
  readonly blueprint: readonly CreateExamBlueprintRow[];
}

/** Mirrors `PreviewSelectionRow` — one entry per blueprint row, keyed by `rowIndex` (nothing persists, so no `blueprintRowId`). */
export interface PreviewSelectionRow {
  readonly rowIndex: number;
  readonly courseId: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly questionIds: readonly string[];
}

/** Mirrors `PreviewShortageDetail`. */
export interface PreviewShortageDetail {
  readonly rowIndex: number;
  readonly courseId: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly requested: number;
  readonly available: number;
}

export interface PreviewExamResult {
  readonly selections: readonly PreviewSelectionRow[];
  readonly shortages: readonly PreviewShortageDetail[];
}

/** `GET /exams` (S1) query params — all optional, server paginates. */
export interface ExamListFilters {
  readonly status?: ExamStatus;
  readonly gradeLevel?: string;
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

/** One row in the `GET /exams` (S1) response `items` array. */
export interface ExamListItem {
  readonly id: string;
  readonly title: string;
  readonly gradeLevel: string;
  readonly status: ExamStatus;
  readonly questionCount: number;
  readonly versionCount: number;
  readonly createdAt: string;
}

/** `GET /exams` (S1) response. */
export interface ExamListResult {
  readonly items: readonly ExamListItem[];
  readonly total: number;
}

/** `POST /exams/:id/duplicate` (S2) response — the new draft copy. */
export interface DuplicateExamResult {
  readonly id: string;
  readonly title: string;
  readonly status: 'draft';
}
