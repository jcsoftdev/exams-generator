import { Difficulty } from "@exams-generator/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ExamStatus } from "../../db/schema/enums";
import { AuthTokenPayload } from "../auth/token.service";
import { BlueprintRow, Candidate, select, selectPreview } from "./domain/blueprint-selector";
import { computeCurrentWeek } from "./domain/current-week";
import { matchesRowCriteria, pickReplacementQuestion } from "./domain/pick-replacement-question";
import { Rng, createSeededRng } from "./domain/ports/random.port";
import { CourseScope, resolveBlueprint, WeekScope } from "./domain/resolve-blueprint";
import { GRADE_LEVELS } from "./domain/value-objects/grade-level";
import { CreateExamInput, validateCreateExamInput } from "./domain/validate-create-exam-input";
import { PreviewExamInput, validatePreviewExamInput } from "./domain/validate-preview-exam-input";
import { StockBatchInput, validateStockBatchInput } from "./domain/validate-stock-batch-input";
import {
  BlueprintRowRecord,
  ExamDetailRecord,
  ExamListFilters,
  ExamListItem,
  ExamsRepository,
  StockCellFilter,
  VersionSummaryRecord,
} from "./exams.repository";

export interface CreateExamBlueprintRowDto {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly count?: number;
}

/**
 * `examType`/`universityId`/`trackId`/`cycleId`/`weekNumber` are OPTIONAL,
 * additive fields (design doc §4/§3.11): when the frontend calls
 * `resolveExamBlueprint()` first, it feeds these back into `POST /exams`
 * alongside the pre-filled `blueprint`, exactly as if the user had typed it
 * by hand. Every existing caller omits them, so `createExam()` behaves
 * exactly as before — see `ExamsRepository.createExam()`'s docstring.
 */
export interface CreateExamDto {
  readonly title?: string;
  readonly gradeLevel?: string;
  readonly blueprint?: readonly CreateExamBlueprintRowDto[];
  readonly examType?: string;
  readonly universityId?: string;
  readonly trackId?: string;
  readonly cycleId?: string;
  readonly weekNumber?: number;
}

export interface CreateExamResult {
  readonly id: string;
  readonly status: ExamStatus;
  readonly selectedQuestionIds: readonly string[];
}

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

/**
 * Thrown when the automatic blueprint selection can't fill every row from
 * the tenant-visible pool (design doc §5.3 step 3 / §7). Carries the exam
 * id (the exam + its blueprint rows ARE persisted so the caller can inspect
 * and fix the blueprint) plus every failing row, not just the first.
 */
export class InsufficientQuestionStockError extends Error {
  constructor(readonly examId: string, readonly shortages: readonly ShortageDetail[]) {
    super(`Insufficient question stock for ${shortages.length} blueprint row(s) on exam ${examId}`);
    this.name = "InsufficientQuestionStockError";
  }
}

export type ReplaceQuestionDto =
  | { readonly mode: "reroll" }
  | { readonly mode: "manual"; readonly replacementQuestionId: string };

export interface ReplaceQuestionResult {
  readonly examId: string;
  readonly oldQuestionId: string;
  readonly newQuestionId: string;
}

export interface ConfirmExamResult {
  readonly id: string;
  readonly status: ExamStatus;
}

/** `POST /exams/:examId/duplicate` (S2) response — the copy always lands `draft` (re-editable), regardless of the original's status. */
export interface DuplicateExamResult {
  readonly id: string;
  readonly title: string;
  readonly status: "draft";
}

/** Guard rail for `PATCH /exams/:examId` — long enough for any real exam name, short enough to keep the list readable. */
export const MAX_EXAM_TITLE_LENGTH = 120;

export interface StockBatchCellDto {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
}

export interface StockBatchDto {
  readonly gradeLevel?: string;
  readonly cells?: readonly StockBatchCellDto[];
}

export interface StockBatchCellResult {
  readonly courseId: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly available: number;
}

export interface StockBatchResult {
  readonly results: readonly StockBatchCellResult[];
}

/** One grade level in `GET /exams/stock/grades` — the FULL catalog, zeros included. */
export interface GradeLevelStockCell {
  readonly gradeLevel: string;
  readonly available: number;
}

export interface GradeLevelStockResult {
  readonly results: readonly GradeLevelStockCell[];
}

/** `POST /exams/preview` (B2) request — same blueprint row shape as `CreateExamDto`, minus `title`. */
export interface PreviewExamDto {
  readonly gradeLevel?: string;
  readonly blueprint?: readonly CreateExamBlueprintRowDto[];
}

export interface PreviewSelectionRow {
  readonly rowIndex: number;
  readonly courseId: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly questionIds: readonly string[];
}

/** Preview's shortage shape mirrors `ShortageDetail` but keys by `rowIndex` — nothing is persisted, so there is no `blueprintRowId` (B2-R1/R3). */
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

/** `GET /exams/:examId` response — same shape as the repository's `ExamDetailRecord` (no extra mapping needed). */
export type ExamDetailResult = ExamDetailRecord;

/** `GET /exams/:examId/versions` response entry (B4) — same shape as the repository's `VersionSummaryRecord`. */
export type ExamVersionSummary = VersionSummaryRecord;

/** `POST /exams/blueprint/resolve` (design doc §3.11) request — `trackId: null` for a track-less university. */
export interface ResolveExamBlueprintInput {
  readonly examTypeCode: string;
  readonly universityId: string;
  readonly trackId: string | null;
  readonly tenantId: string | null;
  readonly selectedCourseIds?: readonly string[];
  readonly totalQuestionsOverride?: number;
}

/**
 * `templateId`/`weekNumber` are exposed alongside `blueprint` so the
 * frontend can feed them straight back into `POST /exams` as
 * `cycleId`/`weekNumber` provenance (design doc §4) without having to
 * re-derive anything client-side.
 */
export interface ResolveExamBlueprintResult {
  readonly blueprint: readonly BlueprintRow[];
  readonly weekNumber: number | null;
  readonly templateId: string | null;
  /**
   * True when a `current_only` type (`fastest`) got widened to cumulative
   * ("everything seen so far") because the calendar-computed current week
   * has no syllabus data of its own — see `resolveBlueprint()`'s docstring
   * (docs/audit-2026-08-14.md P0 fix, 2026-08-14). The frontend MUST surface
   * this: the teacher asked for "current week" and received something else.
   * Always `false` for `weekScope !== 'current_only'`.
   */
  readonly usedCumulativeFallback: boolean;
  /**
   * Refinement on top of the P0 fix above (docs/audit-2026-08-14.md, same
   * item, 2026-08-14): the last `weekNumber` this (university, track)
   * template's syllabus actually has content for — `Math.max` over
   * `getSyllabusForTemplate()`, `null` when the syllabus has zero rows.
   * Derived purely from the data, per template, never a global/hardcoded
   * value, so a track whose syllabus is still in range (e.g. UNCP) reports
   * the same number as `weekNumber`.
   *
   * This is a SEPARATE field from `weekNumber` on purpose — `weekNumber`
   * keeps meaning exactly what the doc comment above and the `exams` schema
   * say it means ("a frozen snapshot of `computeCurrentWeek()` at
   * generation time", i.e. the CALENDAR week), because that is the
   * provenance contract a future `POST /exams` caller relies on.
   * `effectiveWeekNumber` is what the UI should show/say the exam covers:
   * "hasta la semana N, la última con temario cargado" — the calendar week
   * nobody taught yet (week 23 in the P0 example) is not a fact worth
   * reporting to the teacher, but it must still be the number that gets
   * persisted as `exams.weekNumber` if this exam is created.
   */
  readonly effectiveWeekNumber: number | null;
}

function requireTenant(user: AuthTokenPayload): string {
  if (!user.tenantId) {
    throw new ForbiddenException("Only tenant users (school_admin/teacher) can manage exams");
  }
  return user.tenantId;
}


/**
 * Orchestrates exam creation, automatic question selection, row-scoped
 * replacement, and draft->ready confirmation. Wires the pure domain
 * `BlueprintSelector` to a real tenant-scoped repository query — the
 * domain never sees tenant ids or approval status, only a pre-filtered
 * pool (see `blueprint-selector.ts`'s docstring).
 */
@Injectable()
export class ExamsService {
  private readonly rngFactory: () => Rng;

  /**
   * `rngFactory` is `@Optional()` — NOT given a plain default parameter
   * value — because Nest's DI container always passes an explicit
   * argument (`undefined` when no provider matches, since a bare function
   * type has no injectable token) rather than omitting it, which would
   * silently bypass a `= default` parameter value. The fallback is
   * resolved in the constructor body instead, so it applies both under
   * real Nest DI and when tests `new ExamsService(mockRepo, customRng)`.
   */
  constructor(
    private readonly repository: ExamsRepository,
    @Optional() rngFactory?: () => Rng,
  ) {
    this.rngFactory = rngFactory ?? (() => createSeededRng(Date.now() ^ (Math.random() * 2 ** 31)));
  }

  /**
   * `GET /exams` (S1) — tenant-scoped, filtered, paginated exam list
   * (plan 2's web list screen). Pure pass-through to
   * `repository.listExams()`: `requireTenant()` is the only logic here,
   * page/pageSize defaulting+clamping is the controller's job.
   */
  async listExams(user: AuthTokenPayload, filters: ExamListFilters): Promise<{ items: ExamListItem[]; total: number }> {
    const tenantId = requireTenant(user);
    return this.repository.listExams(tenantId, filters);
  }

  async createExam(user: AuthTokenPayload, dto: CreateExamDto): Promise<CreateExamResult> {
    const tenantId = requireTenant(user);

    const validation = validateCreateExamInput(dto as CreateExamInput);
    if (!validation.ok) {
      throw new BadRequestException(validation.errors);
    }

    const gradeLevel = dto.gradeLevel as string;
    const { id: examId } = await this.repository.createExam({
      tenantId,
      title: dto.title as string,
      gradeLevel,
      createdBy: user.sub,
      blueprint: (dto.blueprint as CreateExamBlueprintRowDto[]).map((row) => ({
        courseId: row.courseId as string,
        topicId: row.topicId,
        difficulty: row.difficulty as Difficulty | undefined,
        count: row.count as number,
      })),
      examType: dto.examType,
      universityId: dto.universityId,
      trackId: dto.trackId,
      cycleId: dto.cycleId,
      weekNumber: dto.weekNumber,
    });

    const rows = await this.repository.getBlueprintRows(examId);
    const pool = await this.repository.getQuestionPool({ tenantId, gradeLevel });

    const selectorRows: (BlueprintRow & { readonly __rowRecord: BlueprintRowRecord })[] = rows.map((row) => ({
      courseId: row.courseId,
      topicId: row.topicId,
      difficulty: row.difficulty,
      count: row.count,
      __rowRecord: row,
    }));
    const candidates: Candidate[] = pool.map((c) => ({
      id: c.id,
      courseId: c.courseId,
      topicId: c.topicId,
      difficulty: c.difficulty,
    }));

    const result = select(selectorRows, candidates, this.rngFactory());

    if (!result.ok) {
      const shortages: ShortageDetail[] = result.shortages.map((shortage) => {
        const rowRecord = (shortage.row as (typeof selectorRows)[number]).__rowRecord;
        return {
          blueprintRowId: rowRecord.id,
          courseId: rowRecord.courseId,
          courseName: rowRecord.courseName,
          topicId: rowRecord.topicId,
          topicName: rowRecord.topicName,
          difficulty: rowRecord.difficulty,
          requested: rowRecord.count,
          available: shortage.available,
        };
      });
      throw new InsufficientQuestionStockError(examId, shortages);
    }

    let offset = 0;
    const selections = rows.map((row) => {
      const ids = result.questionIds.slice(offset, offset + row.count);
      offset += row.count;
      return ids.map((questionId) => ({ blueprintRowId: row.id, questionId }));
    }).flat();

    await this.repository.saveSelection(examId, selections);

    return { id: examId, status: "draft", selectedQuestionIds: result.questionIds };
  }

  /**
   * `POST /exams/stock/batch` (B1) — pure read, no persistence (B1-R8).
   * `requireTenant()` + validate-before-query (B1-R2..R6), then ONE batched
   * `repository.countStock()` call, order-matched to the input cells.
   */
  async countStock(user: AuthTokenPayload, dto: StockBatchDto): Promise<StockBatchResult> {
    const tenantId = requireTenant(user);

    const validation = validateStockBatchInput(dto as StockBatchInput);
    if (!validation.ok) {
      throw new BadRequestException(validation.errors);
    }

    const gradeLevel = dto.gradeLevel as string;
    const cells: StockCellFilter[] = (dto.cells as StockBatchCellDto[]).map((cell) => ({
      courseId: cell.courseId as string,
      topicId: cell.topicId,
      difficulty: cell.difficulty as Difficulty | undefined,
    }));

    const counts = await this.repository.countStock({ tenantId, gradeLevel }, cells);

    return {
      results: cells.map((cell, index) => ({
        courseId: cell.courseId,
        topicId: cell.topicId,
        difficulty: cell.difficulty,
        available: counts[index] as number,
      })),
    };
  }

  /**
   * `PATCH /exams/:examId` (S4) — rename. Trims and rejects an empty title
   * before touching the DB (a blank name is worse than the autogenerated one it
   * would replace), and 404s a missing/cross-tenant exam without leaking which.
   */
  async renameExam(user: AuthTokenPayload, examId: string, title: string): Promise<{ id: string; title: string }> {
    const tenantId = requireTenant(user);
    const trimmed = (title ?? "").trim();
    if (trimmed.length === 0) {
      throw new BadRequestException("title is required");
    }
    if (trimmed.length > MAX_EXAM_TITLE_LENGTH) {
      throw new BadRequestException(`title must be at most ${MAX_EXAM_TITLE_LENGTH} characters`);
    }

    const renamed = await this.repository.renameExam(examId, tenantId, trimmed);
    if (!renamed) {
      throw new NotFoundException(`Exam not found: ${examId}`);
    }
    return { id: examId, title: trimmed };
  }

  /**
   * `GET /exams/stock/grades` — approved-question count per grade level, so
   * the builder's "Grado" dropdown can tell the teacher which grades have a
   * bank BEFORE they commit to one. Grades with nothing available are absent
   * from the repository result; they are filled in as `0` here so the client
   * gets the full catalog in one shot and never has to guess whether a
   * missing key means "zero" or "unknown" (audit 2026-08-15).
   */
  async countStockByGradeLevel(user: AuthTokenPayload): Promise<GradeLevelStockResult> {
    const tenantId = requireTenant(user);
    const counts = await this.repository.countApprovedByGradeLevel(tenantId);
    const byGrade = new Map(counts.map((row) => [row.gradeLevel, row.available]));

    return {
      results: GRADE_LEVELS.map((gradeLevel) => ({
        gradeLevel,
        available: byGrade.get(gradeLevel) ?? 0,
      })),
    };
  }

  /**
   * `POST /exams/preview` (B2) — runs the exact same pool query +
   * blueprint-selector matching as `createExam()`, but via `selectPreview()`
   * (never fails wholesale, B2-R3) and with ZERO persistence calls (B2-R2):
   * no `repository.createExam()`/`getBlueprintRows()`/`saveSelection()`.
   */
  async previewExam(user: AuthTokenPayload, dto: PreviewExamDto): Promise<PreviewExamResult> {
    const tenantId = requireTenant(user);

    const validation = validatePreviewExamInput(dto as PreviewExamInput);
    if (!validation.ok) {
      throw new BadRequestException(validation.errors);
    }

    const gradeLevel = dto.gradeLevel as string;
    const blueprint = dto.blueprint as CreateExamBlueprintRowDto[];

    const pool = await this.repository.getQuestionPool({ tenantId, gradeLevel });
    const candidates: Candidate[] = pool.map((c) => ({
      id: c.id,
      courseId: c.courseId,
      topicId: c.topicId,
      difficulty: c.difficulty,
    }));

    const rows: BlueprintRow[] = blueprint.map((row) => ({
      courseId: row.courseId as string,
      topicId: row.topicId,
      difficulty: row.difficulty as Difficulty | undefined,
      count: row.count as number,
    }));

    const rowResults = selectPreview(rows, candidates, this.rngFactory());

    const selections: PreviewSelectionRow[] = [];
    const shortages: PreviewShortageDetail[] = [];

    rows.forEach((row, rowIndex) => {
      const rowResult = rowResults[rowIndex]!;
      selections.push({
        rowIndex,
        courseId: row.courseId,
        topicId: row.topicId,
        difficulty: row.difficulty,
        questionIds: rowResult.questionIds,
      });
      if (rowResult.questionIds.length < rowResult.requested) {
        shortages.push({
          rowIndex,
          courseId: row.courseId,
          topicId: row.topicId,
          difficulty: row.difficulty,
          requested: rowResult.requested,
          available: rowResult.available,
        });
      }
    });

    return { selections, shortages };
  }

  async replaceQuestion(
    user: AuthTokenPayload,
    examId: string,
    questionId: string,
    dto: ReplaceQuestionDto,
  ): Promise<ReplaceQuestionResult> {
    const tenantId = requireTenant(user);

    const exam = await this.repository.getExamById(examId, tenantId);
    if (!exam) {
      throw new NotFoundException(`Exam not found: ${examId}`);
    }
    if (exam.status !== "draft") {
      throw new ConflictException("Exam selection is locked — only draft exams can have questions replaced");
    }

    const examQuestion = await this.repository.findExamQuestion(examId, questionId);
    if (!examQuestion || !examQuestion.blueprintRowId) {
      throw new NotFoundException(`Question ${questionId} is not part of this exam's current selection`);
    }

    const rows = await this.repository.getBlueprintRows(examId);
    const row = rows.find((r) => r.id === examQuestion.blueprintRowId);
    if (!row) {
      throw new NotFoundException(`Blueprint row not found for selected question ${questionId}`);
    }

    const pool = await this.repository.getQuestionPool({ tenantId, gradeLevel: exam.gradeLevel });
    const usedIds = new Set(await this.repository.getSelectedQuestionIds(examId));
    const matching = pool.filter((candidate) => matchesRowCriteria(candidate, row) && !usedIds.has(candidate.id));

    let newQuestionId: string;

    if (dto.mode === "reroll") {
      const picked = pickReplacementQuestion({ pool, row, excludedIds: usedIds, rng: this.rngFactory() });
      if (!picked) {
        throw new ConflictException(
          `No alternative question available for row ${row.courseName}${row.topicName ? `/${row.topicName}` : ""}`,
        );
      }
      newQuestionId = picked;
    } else {
      const candidate = matching.find((c) => c.id === dto.replacementQuestionId);
      if (!candidate) {
        throw new BadRequestException(
          `Replacement question ${dto.replacementQuestionId} does not match this row's criteria or is already used in this exam`,
        );
      }
      newQuestionId = candidate.id;
    }

    await this.repository.replaceQuestion(examId, questionId, newQuestionId);

    return { examId, oldQuestionId: questionId, newQuestionId };
  }

  /**
   * `GET /exams/:examId` — powers the web review screen so it can reload an
   * exam's current selection from a route param instead of only holding it
   * in memory (`ExamCreateComponent`'s GAP note). Same tenant-scoped
   * 404-on-mismatch pattern as `replaceQuestion`/`confirmExam`.
   */
  async getExamDetail(user: AuthTokenPayload, examId: string): Promise<ExamDetailResult> {
    const tenantId = requireTenant(user);

    const exam = await this.repository.getExamDetail(examId, tenantId);
    if (!exam) {
      throw new NotFoundException(`Exam not found: ${examId}`);
    }

    return exam;
  }

  /**
   * `POST /exams/:examId/duplicate` (S2) — "usar de plantilla": clones the
   * exam (title, blueprint, and selection) into a brand-new `draft` exam,
   * regardless of the original's status. Tenant-scoped 404-on-mismatch, same
   * as `getExamDetail`/`confirmExam` — `repository.duplicateExam()` returns
   * `undefined` for a missing/cross-tenant exam.
   */
  async duplicateExam(user: AuthTokenPayload, examId: string): Promise<DuplicateExamResult> {
    const tenantId = requireTenant(user);
    const copy = await this.repository.duplicateExam(examId, tenantId, user.sub);
    if (!copy) {
      throw new NotFoundException(`Exam not found: ${examId}`);
    }
    return { ...copy, status: "draft" };
  }

  async confirmExam(user: AuthTokenPayload, examId: string): Promise<ConfirmExamResult> {
    const tenantId = requireTenant(user);

    const exam = await this.repository.getExamById(examId, tenantId);
    if (!exam) {
      throw new NotFoundException(`Exam not found: ${examId}`);
    }
    if (exam.status === "ready") {
      throw new ConflictException("Exam is already confirmed");
    }

    const selectedIds = await this.repository.getSelectedQuestionIds(examId);
    if (selectedIds.length === 0) {
      throw new ConflictException("Cannot confirm an exam with no selected questions");
    }

    await this.repository.confirmExam(examId);

    return { id: examId, status: "ready" };
  }

  /**
   * `GET /exams/:examId/versions` (B4) — same tenant-scoped 404-on-mismatch
   * pattern as `getExamDetail`/`confirmExam` (B4-R2): `repository.getVersions()`
   * returns `undefined` for a missing/cross-tenant exam and `[]` for a
   * zero-version exam (B4-R3) — only `undefined` becomes a 404.
   */
  async listVersions(user: AuthTokenPayload, examId: string): Promise<readonly ExamVersionSummary[]> {
    const tenantId = requireTenant(user);

    const versions = await this.repository.getVersions(examId, tenantId);
    if (versions === undefined) {
      throw new NotFoundException(`Exam not found: ${examId}`);
    }

    return versions;
  }

  /**
   * `DELETE /exams/:examId` (S3) — cascading delete. Tenant-scoped
   * 404-on-mismatch, same pattern as `getExamDetail`/`confirmExam`:
   * `repository.deleteExam()` returns `false` for a missing/cross-tenant
   * exam instead of deleting anything. No status check — confirmation of
   * the destructive action is the frontend's responsibility.
   */
  async deleteExam(user: AuthTokenPayload, examId: string): Promise<void> {
    const tenantId = requireTenant(user);
    const deleted = await this.repository.deleteExam(examId, tenantId);
    if (!deleted) {
      throw new NotFoundException(`Exam not found: ${examId}`);
    }
  }

  /**
   * `POST /exams/blueprint/resolve` (design doc §3.11 / §7.4) — the Fase 4
   * wiring orchestrator: reads `course_scope`/`week_scope` off the exam type
   * (data-driven, design doc §5), resolves the current template for
   * (university, track?), and — only when the type is week-scoped — the
   * active cycle's frozen `currentWeek`, then delegates the actual row
   * construction to the pure `resolveBlueprint()` domain function. `manual`
   * (`course_scope='none'`) short-circuits before touching any template.
   *
   * Every "no data" case throws loudly (`NotFoundException`) instead of
   * defaulting — a missing template or missing cycle means the tenant's
   * catalog is incomplete, and defaulting `weekNumber` to `0` would silently
   * produce a nonsensical `eta_by_week` result (design doc's explicit
   * instruction: the UI is supposed to prevent this by not offering an exam
   * type with no template, but the backend must still fail loudly, never
   * silently, if it happens anyway).
   */
  async resolveExamBlueprint(input: ResolveExamBlueprintInput): Promise<ResolveExamBlueprintResult> {
    const examType = await this.repository.findExamType(input.examTypeCode);
    if (!examType) {
      throw new NotFoundException(`Exam type not found: ${input.examTypeCode}`);
    }

    if (examType.courseScope === "none") {
      return { blueprint: [], weekNumber: null, templateId: null, usedCumulativeFallback: false, effectiveWeekNumber: null };
    }

    const template = await this.repository.findCurrentTemplate(input.universityId, input.trackId, input.tenantId);
    if (!template) {
      throw new NotFoundException(
        `No current blueprint template found for university=${input.universityId} track=${input.trackId ?? "none"}`,
      );
    }

    const [templateRows, syllabus] = await Promise.all([
      this.repository.getTemplateRows(template.id),
      this.repository.getSyllabusForTemplate(template.id),
    ]);

    const inScopeRows =
      examType.courseScope === "selected"
        ? templateRows.filter((row) => (input.selectedCourseIds ?? []).includes(row.courseId))
        : templateRows;

    if (
      inScopeRows.some((row) => row.questionCount === undefined || row.questionCount === null) &&
      input.totalQuestionsOverride === undefined
    ) {
      throw new BadRequestException(
        "Esta plantilla no tiene conteo de preguntas por curso — indica un total de preguntas.",
      );
    }

    let weekNumber: number | null = null;
    if (examType.weekScope !== "none") {
      const cycle = await this.repository.findActiveCycle(input.universityId, input.trackId, input.tenantId);
      if (!cycle) {
        throw new NotFoundException(
          `No active cycle found for university=${input.universityId} track=${input.trackId ?? "none"} — cannot resolve the current week`,
        );
      }
      try {
        weekNumber = computeCurrentWeek(cycle.startsOn, cycle.weekLengthDays, new Date());
      } catch (error) {
        // Bad server-side cycle data (week_length_days <= 0 / NaN) — say so
        // explicitly instead of letting a poisoned weekNumber silently
        // resolve to an empty blueprint.
        if (error instanceof RangeError) {
          throw new BadRequestException(
            `El ciclo activo tiene un week_length_days inválido (${cycle.weekLengthDays}) — corrige el ciclo antes de resolver la plantilla.`,
          );
        }
        throw error;
      }
    }

    const { rows: blueprint, usedCumulativeFallback } = resolveBlueprint({
      courseScope: examType.courseScope as CourseScope,
      weekScope: examType.weekScope as WeekScope,
      templateRows,
      syllabus,
      currentWeek: weekNumber ?? undefined,
      selectedCourseIds: input.selectedCourseIds,
      totalQuestionsOverride: input.totalQuestionsOverride,
    });

    // A week-scoped type (`fastest`/`eta_by_week`) resolving to ZERO rows is
    // never a legitimate "empty exam" — it means this template/cycle has no
    // usable syllabus for the courses in scope (nothing loaded at all, or a
    // course with no syllabus whatsoever). `current_only` already widens to
    // cumulative when possible (see `resolveBlueprint()`); if it's STILL
    // empty after that, there is genuinely nothing to build from. Say so
    // loudly instead of returning a silent 200 with `blueprint: []` — the P0
    // bug this fixes (docs/audit-2026-08-14.md) was exactly this: a 200 that
    // looked like success and left the grid at 0/1,656 cells with no
    // explanation.
    //
    // Guarded by `inScopeRows.length > 0`: for `courseScope: 'selected'`
    // (fastest), the exam-builder auto-fires this call the moment a
    // track/university completes (`onTrackChange()`) — BEFORE the user has
    // ticked any course checkbox. `inScopeRows` is legitimately `[]` then
    // (nothing to filter courses against yet), and an empty blueprint is the
    // correct, harmless answer, not an error — caught this via the live app,
    // not the test suite (docs/audit-2026-08-14.md verification note).
    if (examType.weekScope !== "none" && inScopeRows.length > 0 && blueprint.length === 0) {
      throw new BadRequestException(
        `No hay temario cargado para la semana ${weekNumber} de este ciclo — no se puede generar el examen. Carga el temario o elige otro tipo de examen.`,
      );
    }

    // Refinement on top of the P0 fix (docs/audit-2026-08-14.md, same item):
    // `weekNumber` is the calendar week, which can run past the last week
    // anyone actually taught (the P0 example: week 23 with syllabus stopping
    // at 20). `effectiveWeekNumber` is derived purely from `syllabus` — the
    // same array already fetched above for this exact template — never a
    // second query and never a global constant, so it's naturally scoped per
    // (university, track) and leaves an in-range track (UNCP) untouched.
    const syllabusWeeks = syllabus.map((entry) => entry.weekNumber);
    const maxSyllabusWeek = syllabusWeeks.length > 0 ? Math.max(...syllabusWeeks) : null;
    const effectiveWeekNumber =
      examType.weekScope === "none" || maxSyllabusWeek === null
        ? null
        : Math.min(weekNumber ?? maxSyllabusWeek, maxSyllabusWeek);

    return { blueprint, weekNumber, templateId: template.id, usedCumulativeFallback, effectiveWeekNumber };
  }
}
