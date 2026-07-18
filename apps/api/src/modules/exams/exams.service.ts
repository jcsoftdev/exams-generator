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
import { BlueprintRow, Candidate, select } from "./domain/blueprint-selector";
import { Rng, createSeededRng, shuffleArray } from "./domain/ports/random.port";
import { CreateExamInput, validateCreateExamInput } from "./domain/validate-create-exam-input";
import { BlueprintRowRecord, ExamsRepository, QuestionPoolCandidateRecord } from "./exams.repository";

export interface CreateExamBlueprintRowDto {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly count?: number;
}

export interface CreateExamDto {
  readonly title?: string;
  readonly gradeLevel?: string;
  readonly blueprint?: readonly CreateExamBlueprintRowDto[];
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

function requireTenant(user: AuthTokenPayload): string {
  if (!user.tenantId) {
    throw new ForbiddenException("Only tenant users (school_admin/teacher) can manage exams");
  }
  return user.tenantId;
}

function matchesRowCriteria(candidate: QuestionPoolCandidateRecord, row: BlueprintRowRecord): boolean {
  if (candidate.courseId !== row.courseId) {
    return false;
  }
  if (row.topicId !== undefined && candidate.topicId !== row.topicId) {
    return false;
  }
  if (row.difficulty !== undefined && candidate.difficulty !== row.difficulty) {
    return false;
  }
  return true;
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
      if (matching.length === 0) {
        throw new ConflictException(
          `No alternative question available for row ${row.courseName}${row.topicName ? `/${row.topicName}` : ""}`,
        );
      }
      newQuestionId = shuffleArray(matching, this.rngFactory())[0]!.id;
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
}
