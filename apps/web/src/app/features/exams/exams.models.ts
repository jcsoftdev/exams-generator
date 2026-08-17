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

/**
 * Educational stage — mirrors the backend's `Stage` catalog at
 * apps/api/src/modules/exams/domain/value-objects/grade-level.ts. Courses
 * belong to exactly one stage; the exam builder filters the catalog by the
 * stage derived from the selected grade level.
 */
export const STAGES = ['escuela', 'colegio', 'preuniversitario'] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  escuela: 'Escuela (Primaria)',
  colegio: 'Colegio (Secundaria)',
  preuniversitario: 'Preuniversitario',
};

/** Maps a grade level to its educational stage — the axis the course catalog is divided by. */
export function stageForGrade(grade: GradeLevel): Stage {
  if (grade === 'pre') {
    return 'preuniversitario';
  }
  return grade.startsWith('secundaria_') ? 'colegio' : 'escuela';
}

export type ExamStatus = 'draft' | 'ready';

/**
 * GAP: the backend already exposes `GET /courses` and `GET /topics` via
 * TaxonomyController (see taxonomy.service.ts, used by the bank and
 * exam-blueprint features) — this form was just never wired to those
 * dropdowns, so `courseId`/`topicId` remain free-text UUID inputs here.
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
  /** Display name for `courseId` — the review screen renders this, never the uuid (audit 2026-08-15). */
  readonly courseName: string;
  readonly topicId: string;
  /** Display name for `topicId` — same reason as `courseName`. */
  readonly topicName: string;
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

/**
 * Mirrors `UniversityListItem` from
 * apps/api/src/modules/taxonomy/taxonomy.repository.ts — `GET /universities`
 * (design doc §3.11/§4), global catalog, no tenant scoping.
 */
export interface University {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * Mirrors `TrackListItem`. `kind` ('area' | 'cycle_track') is purely
 * descriptive for the UI label — it never changes resolution behavior
 * (design doc §3.1).
 */
export interface Track {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
}

/**
 * Mirrors `ExamTypeListItem` — the data-driven exam type catalog (design doc
 * §5). `courseScope`/`weekScope` decide which parts of the "Tipo de examen"
 * section the exam-builder screen shows for a given type; `manual`
 * (`courseScope: 'none'`) never needs a university/track/course selection.
 */
export interface ExamType {
  readonly code: string;
  readonly label: string;
  readonly courseScope: 'none' | 'all' | 'selected';
  readonly weekScope: 'none' | 'current_only' | 'cumulative';
}

/**
 * Mirrors `BlueprintRow` from
 * apps/api/src/modules/exams/domain/blueprint-selector.ts — one row of a
 * resolved template. `topicId`/`difficulty` are exactly as optional here as
 * they are on `CreateExamBlueprintRow`: a missing `topicId` means "whole
 * course" (design doc §3.11), a missing `difficulty` means the source data
 * had no NIVEL to translate (`resolveDifficultyFromSourceLevel`, UNI rows).
 */
export interface ResolvedBlueprintRow {
  readonly courseId: string;
  readonly topicId?: string;
  readonly count: number;
  readonly difficulty?: Difficulty;
}

/** `POST /exams/blueprint/resolve` (design doc §3.11) request — `trackId` omitted for a track-less university. */
export interface ResolveBlueprintPayload {
  readonly examTypeCode: string;
  readonly universityId: string;
  readonly trackId?: string;
  readonly selectedCourseIds?: readonly string[];
  readonly totalQuestionsOverride?: number;
}

/**
 * `weekNumber`/`templateId` are exposed alongside `blueprint` so a future
 * screen can feed them straight back into `POST /exams` as provenance
 * without re-deriving anything client-side (design doc §4) — the
 * exam-builder screen today only consumes `blueprint`.
 *
 * `usedCumulativeFallback` (optional — older/mocked responses may omit it,
 * treated as `false`): true when a `current_only` type ("Rápido (semana
 * actual)") got widened to cumulative because the current week has no
 * syllabus of its own — the P0 fix in docs/audit-2026-08-14.md. The exam
 * builder MUST show this, not swallow it: the teacher asked for "current
 * week" and got "everything seen so far" instead.
 */
export interface ResolveBlueprintResult {
  readonly blueprint: readonly ResolvedBlueprintRow[];
  readonly weekNumber: number | null;
  readonly templateId: string | null;
  readonly usedCumulativeFallback?: boolean;
  /**
   * Refinement on top of `usedCumulativeFallback` (docs/audit-2026-08-14.md,
   * same item): the last week this (university, track) syllabus actually has
   * content for — `null` when the backend has nothing to report (older/mocked
   * responses may omit the field entirely, treated the same as `null`).
   * `weekNumber` stays the calendar-computed week (provenance snapshot); this
   * is the one to SHOW the teacher — "cubre hasta la semana N".
   */
  readonly effectiveWeekNumber?: number | null;
}
