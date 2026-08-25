import { Difficulty } from '@exams-generator/shared';
import type {
  ExamDetail,
  ExamDetailQuestion,
  ExamListItem,
  ExamListResult,
  ExamStatus,
  QuestionType,
} from '@exams-generator/shared';

/**
 * Grade levels, stages and the mapping between them are re-exported from
 * `@exams-generator/shared`: they are a contract the API compiles against too,
 * and they had been written out separately here, in bank.models.ts and in
 * ai.models.ts (audit 2026-08-20, M4). The Spanish labels are UI copy and live
 * once in the taxonomy feature.
 */
export { GRADE_LEVELS, STAGES, stageForGrade } from '@exams-generator/shared';
export type { GradeLevel, Stage } from '@exams-generator/shared';
export { GRADE_LEVEL_LABELS, STAGE_LABELS } from '../taxonomy/grade-level-labels';

/**
 * The exam status union, the `GET /exams` list row and its paginated
 * response, and the `GET /exams/:examId` detail (header + questions, plus
 * the question-type union) all come from `@exams-generator/shared`, which
 * the API compiles against too — re-exported here so this feature keeps its
 * own local imports. They used to be declared a second time on each side,
 * with nothing tying a field renamed on the wire to a compile failure on
 * the client (audit 2026-08-21, M4b).
 */
export type {
  ExamStatus,
  QuestionType,
  ExamListItem,
  ExamListResult,
  ExamDetailQuestion,
  ExamDetail,
};

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
  { readonly mode: 'reroll' } | { readonly mode: 'manual'; readonly replacementQuestionId: string };

export interface ReplaceQuestionResult {
  readonly examId: string;
  readonly oldQuestionId: string;
  readonly newQuestionId: string;
}

export interface ConfirmExamResult {
  readonly id: string;
  readonly status: ExamStatus;
}

/**
 * `GET /exams/stock/grades` — one row per grade level of the catalog, zeros
 * included, so the builder can say which grades actually have questions
 * behind them (audit 2026-08-15).
 */
export interface GradeLevelStockCell {
  readonly gradeLevel: string;
  readonly available: number;
}

export interface GradeLevelStockResult {
  readonly results: readonly GradeLevelStockCell[];
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
  /**
   * Official layout resolved by the template (design doc §4). The backend
   * already returns these and `POST /exams` already accepts them back; the
   * builder does NOT yet carry them across its grid, so a template-backed
   * exam created from the UI still prints without sections. See the note on
   * `toCreateExamBlueprintRow` in `exam-builder.component.ts`.
   *
   * Not editable from the UI by design — block order is not something a
   * teacher adjusts (design doc §9); these are transported, not shown.
   */
  readonly sortOrder?: number;
  readonly blockCode?: string | null;
  readonly blockLabel?: string | null;
  readonly sectionCode?: string | null;
  readonly sectionLabel?: string | null;
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
   * True when the university's template publishes its own per-course counts,
   * so a requested total was NOT applied. Optional for the same reason as
   * `usedCumulativeFallback` — older/mocked responses may omit it.
   */
  readonly countsFromTemplate?: boolean;
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
