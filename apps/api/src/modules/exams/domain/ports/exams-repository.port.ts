import { Difficulty } from "@exams-generator/shared";
import { ExamStatus, QuestionType } from "../../../../db/schema/enums";
import { SyllabusEntry, TemplateRow } from "../resolve-blueprint";

/**
 * The persistence port for the exams module. `ExamsRepository` (the Drizzle
 * adapter) implements this; the data-contract types (`*Record`, `*Filter`,
 * `*Item`) live here in the domain rather than in the adapter, so the
 * application layer no longer imports its DTOs from the persistence class.
 * For backward compatibility the adapter re-exports every type below, so
 * existing `import { XRecord } from "./exams.repository"` sites keep resolving.
 */

export interface CreateExamBlueprintRowRecord {
  readonly courseId: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly count: number;
}

/**
 * `examType`/`universityId`/`trackId`/`cycleId`/`weekNumber` are OPTIONAL —
 * metadata about how the blueprint was produced (design doc §4, `resolveExamBlueprint()`
 * wiring). When omitted (every caller before this change, every existing
 * test), `createExam()` leaves them out of the insert entirely so the DB's
 * own column defaults apply (`exam_type` -> `'manual'`, the rest -> `NULL`)
 * — byte-for-byte the same INSERT as before this field existed.
 */
export interface CreateExamRecord {
  readonly tenantId: string;
  readonly title: string;
  readonly gradeLevel: string;
  readonly createdBy: string;
  readonly blueprint: readonly CreateExamBlueprintRowRecord[];
  readonly examType?: string;
  readonly universityId?: string;
  readonly trackId?: string;
  readonly cycleId?: string;
  readonly weekNumber?: number;
}

/** `exam_blueprint_templates` row shape returned by `findCurrentTemplate()` — only what callers need to fetch its rows/syllabus by id. */
export interface CurrentTemplateRecord {
  readonly id: string;
}

/** `cycles` row shape returned by `findActiveCycle()` — only what `computeCurrentWeek()` needs. */
export interface ActiveCycleRecord {
  readonly startsOn: Date;
  readonly weekLengthDays: number;
}

/** `exam_types` row shape returned by `findExamType()` — the two axes that drive `resolveBlueprint()` (design doc §5). */
export interface ExamTypeRecord {
  readonly courseScope: string;
  readonly weekScope: string;
}

export interface ExamRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly gradeLevel: string;
  readonly status: ExamStatus;
  readonly createdBy: string;
}

/**
 * One grade level's approved-question count (`GET /exams/stock/grades`). Only
 * grades with `available > 0` are returned — see
 * `countApprovedByGradeLevel`.
 */
export interface GradeLevelStockRecord {
  readonly gradeLevel: string;
  readonly available: number;
}

/** `GET /exams` (S1) list filters — `page`/`pageSize` are always resolved (defaulted/clamped) by the controller before reaching the repository. */
export interface ExamListFilters {
  readonly status?: "draft" | "ready";
  readonly gradeLevel?: string;
  readonly search?: string;
  readonly page: number;
  readonly pageSize: number;
}

/** `GET /exams` (S1) list row — `questionCount`/`versionCount` are correlated subquery counts, not joins (avoids row fan-out). */
export interface ExamListItem {
  readonly id: string;
  readonly title: string;
  readonly gradeLevel: string;
  readonly status: string;
  readonly questionCount: number;
  readonly versionCount: number;
  readonly createdAt: string;
}

export interface BlueprintRowRecord {
  readonly id: string;
  readonly courseId: string;
  readonly courseName: string;
  readonly topicId?: string;
  readonly topicName?: string;
  readonly difficulty?: Difficulty;
  readonly count: number;
}

/** One `{status}` bucket from `countByStatus` — feeds the dashboard's exams card. */
export interface ExamStatusCount {
  readonly status: ExamStatus;
  readonly total: number;
}

/** One row from `listRecent` — feeds the dashboard's "recent exams" list. */
export interface RecentExamRecord {
  readonly id: string;
  readonly title: string;
  readonly status: ExamStatus;
  readonly createdAt: string;
}

/**
 * One candidate in the pool handed to `BlueprintSelector.select()`. This is
 * the exact shape the domain function needs — nothing more.
 */
export interface QuestionPoolCandidateRecord {
  readonly id: string;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
}

export interface QuestionPoolFilter {
  /** The requesting tenant. Exams always belong to a tenant (never central). */
  readonly tenantId: string;
  readonly gradeLevel: string;
}

export interface SaveSelectionEntry {
  readonly blueprintRowId: string;
  readonly questionId: string;
}

export interface ExamQuestionRecord {
  readonly blueprintRowId: string | null;
  readonly position: number;
}

/**
 * `type='image'` questions always carry `imageStorageKey`/`imageMime`;
 * `type='structured'` questions (design doc §5.4) carry
 * `bodyTypst`/`alternatives`/`figureCode`, and MAY also carry
 * `imageStorageKey`/`imageMime` if a complement image (chart/diagram/passage
 * scan) was attached via `POST :id/image` — see `bank.service.ts`
 * `replaceImage`. Both variants always carry `correctAnswer`, but its
 * MEANING differs by type — see `SelectedQuestion` in
 * `domain/version-shuffler.ts` for the exact contract (answer letter for
 * image, 0-based index into `alternatives` for structured).
 */
export interface SelectedQuestionForGeneration {
  readonly questionId: string;
  readonly position: number;
  readonly type: QuestionType;
  readonly correctAnswer: string;
  readonly imageStorageKey: string | null;
  readonly imageMime: string | null;
  readonly bodyTypst: string | null;
  readonly alternatives: readonly string[] | null;
  readonly figureCode: string | null;
  /**
   * Per-alternative images (`question_alternative_images`), index-aligned
   * with `alternatives` — `alternativeImages[i]` is the image for
   * `alternatives[i]`, or `null` for an alternative with no attached image
   * (shouldn't happen given `BankService.setAlternativeImages`'s
   * all-or-nothing constraint, but keeps the type honest). `null`/absent
   * entirely when this question has no per-alternative images at all.
   */
  readonly alternativeImages?: readonly ({ storageKey: string; mime: string } | null)[] | null;
}

export interface ExamForGenerationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly status: ExamStatus;
  readonly logoStorageKey: string | null;
  readonly selectedQuestions: readonly SelectedQuestionForGeneration[];
}

/**
 * One selected question in `GET /exams/:examId` detail output (design doc
 * §5.3/§5.4 review screen). Same `type='image'` vs `type='structured'`
 * duality as `SelectedQuestionForGeneration` above, but exposes
 * `imageAssetId` (not `imageStorageKey`) — the review screen only needs an
 * asset reference, never the raw storage key.
 */
export interface ExamDetailQuestionRecord {
  readonly id: string;
  readonly position: number;
  readonly type: QuestionType;
  readonly courseId: string;
  /** Display name for `courseId` — the review screen used to render the raw uuid (audit 2026-08-15). */
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

export interface ExamDetailRecord {
  readonly id: string;
  readonly title: string;
  readonly gradeLevel: string;
  readonly status: ExamStatus;
  readonly questions: readonly ExamDetailQuestionRecord[];
}

/** One cell in a `countStock()` batch — same criteria shape as `Candidate`/`BlueprintRow`, minus `count` (B1). */
export interface StockCellFilter {
  readonly courseId: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
}

export interface SaveVersionRecord {
  readonly code: string;
  readonly questionOrder: readonly string[];
  readonly answerKey: Readonly<Record<number, string>>;
  readonly pdfAssetId: string;
  readonly answerSheetAssetId: string;
}

/** `GET /exams/:examId/versions` (B4) row shape — see `getVersions()`. */
export interface VersionSummaryRecord {
  readonly code: string;
  readonly pdfUrl: string;
  readonly answerSheetUrl: string;
}

/** `GET /exams/:examId/versions/zip` (N1) row shape — see `getVersionAssetRecords()`. Carries the raw storage coordinates the ZIP builder needs to pull bytes. */
export interface VersionAssetRecord {
  readonly code: string;
  readonly pdfStorageKey: string;
  readonly pdfMime: string;
  readonly answerSheetStorageKey: string;
  readonly answerSheetMime: string;
}

/** Persistence port for the exams module — implemented by `ExamsRepository`. */
export interface ExamsRepositoryPort {
  createExam(record: CreateExamRecord): Promise<{ id: string }>;
  duplicateExam(
    examId: string,
    tenantId: string,
    createdBy: string,
  ): Promise<{ id: string; title: string } | undefined>;
  getExamById(examId: string, tenantId: string): Promise<ExamRecord | undefined>;
  listExams(tenantId: string, f: ExamListFilters): Promise<{ items: ExamListItem[]; total: number }>;
  countByStatus(tenantId: string): Promise<ExamStatusCount[]>;
  listRecent(tenantId: string, limit: number): Promise<RecentExamRecord[]>;
  getBlueprintRows(examId: string): Promise<BlueprintRowRecord[]>;
  getQuestionPool(filter: QuestionPoolFilter): Promise<QuestionPoolCandidateRecord[]>;
  countStock(filter: QuestionPoolFilter, cells: readonly StockCellFilter[]): Promise<number[]>;
  countApprovedByGradeLevel(tenantId: string): Promise<GradeLevelStockRecord[]>;
  renameExam(examId: string, tenantId: string, title: string): Promise<boolean>;
  saveSelection(examId: string, selections: readonly SaveSelectionEntry[]): Promise<void>;
  getSelectedQuestionIds(examId: string): Promise<string[]>;
  findExamQuestion(examId: string, questionId: string): Promise<ExamQuestionRecord | undefined>;
  replaceQuestion(examId: string, oldQuestionId: string, newQuestionId: string): Promise<void>;
  /**
   * Takes one question out of circulation bank-wide (`status='archived'`), so
   * no future selection can pick it. Used when generation proves a question
   * cannot be compiled at all — leaving it `approved` would let it break the
   * next exam, and the one after that.
   */
  archiveQuestion(questionId: string): Promise<void>;
  confirmExam(examId: string): Promise<void>;
  getExamForGeneration(examId: string, tenantId: string): Promise<ExamForGenerationRecord | undefined>;
  getExamDetail(examId: string, tenantId: string): Promise<ExamDetailRecord | undefined>;
  createAsset(tenantId: string, storageKey: string, mime: string): Promise<{ id: string }>;
  saveVersion(examId: string, version: SaveVersionRecord): Promise<void>;
  clearVersions(examId: string): Promise<string[]>;
  deleteExam(examId: string, tenantId: string): Promise<boolean>;
  getVersions(examId: string, tenantId: string): Promise<VersionSummaryRecord[] | undefined>;
  getVersionAssetRecords(examId: string, tenantId: string): Promise<VersionAssetRecord[] | undefined>;
  findCurrentTemplate(
    universityId: string,
    trackId: string | null,
    tenantId: string | null,
  ): Promise<CurrentTemplateRecord | null>;
  getTemplateRows(templateId: string): Promise<TemplateRow[]>;
  getSyllabusForTemplate(templateId: string): Promise<SyllabusEntry[]>;
  findActiveCycle(
    universityId: string,
    trackId: string | null,
    tenantId: string | null,
  ): Promise<ActiveCycleRecord | null>;
  findExamType(code: string): Promise<ExamTypeRecord | null>;
}
