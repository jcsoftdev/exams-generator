import { Difficulty } from "@exams-generator/shared";
import { and, asc, eq, isNull, or, SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db/client";
import {
  assets,
  courses,
  examBlueprintRows,
  examQuestions,
  exams,
  examVersions,
  questions,
  tenants,
  topics,
} from "../../db/schema";
import { ExamStatus, QuestionType } from "../../db/schema/enums";

export interface CreateExamBlueprintRowRecord {
  readonly courseId: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly count: number;
}

export interface CreateExamRecord {
  readonly tenantId: string;
  readonly title: string;
  readonly gradeLevel: string;
  readonly createdBy: string;
  readonly blueprint: readonly CreateExamBlueprintRowRecord[];
}

export interface ExamRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly gradeLevel: string;
  readonly status: ExamStatus;
  readonly createdBy: string;
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
 * `type='image'` questions carry `imageStorageKey`/`imageMime`
 * (`bodyTypst`/`alternatives`/`figureCode` are `null`); `type='structured'`
 * questions (design doc §5.4) carry `bodyTypst`/`alternatives`/`figureCode`
 * instead (`imageStorageKey`/`imageMime` are `null`). Both variants always
 * carry `correctAnswer`, but its MEANING differs by type — see
 * `SelectedQuestion` in `domain/version-shuffler.ts` for the exact contract
 * (answer letter for image, 0-based index into `alternatives` for
 * structured).
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
  readonly topicId: string;
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

export interface SaveVersionRecord {
  readonly code: string;
  readonly questionOrder: readonly string[];
  readonly answerKey: Readonly<Record<number, string>>;
  readonly pdfAssetId: string;
  readonly answerSheetAssetId: string;
}

const logoAssets = alias(assets, "logo_assets");

/**
 * Drizzle-backed persistence for the exams module. Mirrors the bank
 * module's structural convention (thin class, no repository port/interface
 * — nothing in this PR's scope needs a swappable implementation).
 */
export class ExamsRepository {
  /**
   * Inserts the exam row and every blueprint row in one transaction. Rows
   * are NOT deduplicated by criteria — two rows can share the same
   * {course, topic?, difficulty?} with different counts (see
   * `examBlueprintRows` schema docstring).
   */
  async createExam(record: CreateExamRecord): Promise<{ id: string }> {
    return db.transaction(async (tx) => {
      const [exam] = await tx
        .insert(exams)
        .values({
          tenantId: record.tenantId,
          title: record.title,
          gradeLevel: record.gradeLevel,
          createdBy: record.createdBy,
        })
        .returning({ id: exams.id });

      if (!exam) {
        throw new Error("Insert invariant violated: exam row missing after insert");
      }

      await tx.insert(examBlueprintRows).values(
        record.blueprint.map((row) => ({
          examId: exam.id,
          courseId: row.courseId,
          topicId: row.topicId,
          difficulty: row.difficulty,
          count: row.count,
        })),
      );

      return { id: exam.id };
    });
  }

  /** Tenant-scoped lookup — an exam is only ever visible to its own tenant. */
  async getExamById(examId: string, tenantId: string): Promise<ExamRecord | undefined> {
    const [row] = await db
      .select()
      .from(exams)
      .where(and(eq(exams.id, examId), eq(exams.tenantId, tenantId)));

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      tenantId: row.tenantId,
      title: row.title,
      gradeLevel: row.gradeLevel,
      status: row.status,
      createdBy: row.createdBy,
    };
  }

  /** Blueprint rows for an exam, with course/topic names resolved for human-readable shortage messages. */
  async getBlueprintRows(examId: string): Promise<BlueprintRowRecord[]> {
    const rows = await db
      .select({
        id: examBlueprintRows.id,
        courseId: examBlueprintRows.courseId,
        courseName: courses.name,
        topicId: examBlueprintRows.topicId,
        topicName: topics.name,
        difficulty: examBlueprintRows.difficulty,
        count: examBlueprintRows.count,
      })
      .from(examBlueprintRows)
      .innerJoin(courses, eq(examBlueprintRows.courseId, courses.id))
      .leftJoin(topics, eq(examBlueprintRows.topicId, topics.id))
      .where(eq(examBlueprintRows.examId, examId));

    return rows.map((row) => ({
      id: row.id,
      courseId: row.courseId,
      courseName: row.courseName,
      topicId: row.topicId ?? undefined,
      topicName: row.topicName ?? undefined,
      difficulty: row.difficulty ?? undefined,
      count: row.count,
    }));
  }

  /**
   * The release-gate query (design doc §3, §8): every question a tenant is
   * allowed to draw from — `tenant_id IS NULL OR tenant_id = :current`,
   * `status = 'approved'`, and matching the exam's `gradeLevel`. Feeds
   * `BlueprintSelector.select()` directly; this repository is the ONLY
   * place that decides tenant visibility for exam question selection.
   */
  async getQuestionPool(filter: QuestionPoolFilter): Promise<QuestionPoolCandidateRecord[]> {
    const visibility = or(isNull(questions.tenantId), eq(questions.tenantId, filter.tenantId)) as SQL;

    return db
      .select({
        id: questions.id,
        courseId: topics.courseId,
        topicId: questions.topicId,
        difficulty: questions.difficulty,
      })
      .from(questions)
      .innerJoin(topics, eq(questions.topicId, topics.id))
      .where(
        and(
          visibility,
          eq(questions.status, "approved"),
          eq(questions.gradeLevel, filter.gradeLevel),
        ),
      );
  }

  /**
   * Replaces the exam's full selection. Idempotent under re-run (deletes
   * any prior selection first) so a failed/retried create-exam flow never
   * leaves stale rows. Position is assigned by array order.
   */
  async saveSelection(examId: string, selections: readonly SaveSelectionEntry[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(examQuestions).where(eq(examQuestions.examId, examId));

      if (selections.length === 0) {
        return;
      }

      await tx.insert(examQuestions).values(
        selections.map((entry, position) => ({
          examId,
          questionId: entry.questionId,
          blueprintRowId: entry.blueprintRowId,
          position,
        })),
      );
    });
  }

  async getSelectedQuestionIds(examId: string): Promise<string[]> {
    const rows = await db
      .select({ questionId: examQuestions.questionId })
      .from(examQuestions)
      .where(eq(examQuestions.examId, examId))
      .orderBy(asc(examQuestions.position));

    return rows.map((row) => row.questionId);
  }

  /** Finds which blueprint row (and position) a currently-selected question fulfills. */
  async findExamQuestion(examId: string, questionId: string): Promise<ExamQuestionRecord | undefined> {
    const [row] = await db
      .select({ blueprintRowId: examQuestions.blueprintRowId, position: examQuestions.position })
      .from(examQuestions)
      .where(and(eq(examQuestions.examId, examId), eq(examQuestions.questionId, questionId)));

    return row;
  }

  /** Swaps the questionId at a fixed position/blueprintRowId — used by the replace-question flow. */
  async replaceQuestion(examId: string, oldQuestionId: string, newQuestionId: string): Promise<void> {
    await db
      .update(examQuestions)
      .set({ questionId: newQuestionId })
      .where(and(eq(examQuestions.examId, examId), eq(examQuestions.questionId, oldQuestionId)));
  }

  /** Moves an exam from `draft` to `ready` — no-op (0 rows) if it isn't currently `draft`. */
  async confirmExam(examId: string): Promise<void> {
    await db
      .update(exams)
      .set({ status: "ready" })
      .where(and(eq(exams.id, examId), eq(exams.status, "draft")));
  }

  /**
   * Everything version generation needs: the exam's title/tenant, the
   * tenant's logo image (if any), and every selected question's correct
   * answer + baked-in image, ordered by position. Tenant-scoped like
   * `getExamById` — returns `undefined` for another tenant's exam.
   */
  async getExamForGeneration(
    examId: string,
    tenantId: string,
  ): Promise<ExamForGenerationRecord | undefined> {
    const [examRow] = await db
      .select({
        id: exams.id,
        tenantId: exams.tenantId,
        title: exams.title,
        status: exams.status,
        logoStorageKey: logoAssets.storageKey,
      })
      .from(exams)
      .leftJoin(tenants, eq(exams.tenantId, tenants.id))
      .leftJoin(logoAssets, eq(tenants.logoAssetId, logoAssets.id))
      .where(and(eq(exams.id, examId), eq(exams.tenantId, tenantId)));

    if (!examRow) {
      return undefined;
    }

    const selectedRows = await db
      .select({
        questionId: examQuestions.questionId,
        position: examQuestions.position,
        type: questions.type,
        correctAnswer: questions.correctAnswer,
        imageStorageKey: assets.storageKey,
        imageMime: assets.mime,
        bodyTypst: questions.bodyTypst,
        alternatives: questions.alternatives,
        figureCode: questions.figureCode,
      })
      .from(examQuestions)
      .innerJoin(questions, eq(examQuestions.questionId, questions.id))
      .leftJoin(assets, eq(questions.imageAssetId, assets.id))
      .where(eq(examQuestions.examId, examId))
      .orderBy(asc(examQuestions.position));

    return {
      id: examRow.id,
      tenantId: examRow.tenantId,
      title: examRow.title,
      status: examRow.status,
      logoStorageKey: examRow.logoStorageKey,
      selectedQuestions: selectedRows.map((row) => ({
        questionId: row.questionId,
        position: row.position,
        type: row.type,
        correctAnswer: row.correctAnswer,
        imageStorageKey: row.imageStorageKey,
        imageMime: row.imageMime,
        bodyTypst: row.bodyTypst,
        alternatives: (row.alternatives as readonly string[] | null) ?? null,
        figureCode: row.figureCode,
      })),
    };
  }

  /**
   * `GET /exams/:examId` (design doc §5.3/§5.4 review screen): the exam's
   * header fields plus every selected question, ordered by position.
   * Tenant-scoped like `getExamById`/`getExamForGeneration` — returns
   * `undefined` for another tenant's exam so the caller turns it into a 404
   * without leaking existence.
   */
  async getExamDetail(examId: string, tenantId: string): Promise<ExamDetailRecord | undefined> {
    const exam = await this.getExamById(examId, tenantId);
    if (!exam) {
      return undefined;
    }

    const rows = await db
      .select({
        id: examQuestions.questionId,
        position: examQuestions.position,
        type: questions.type,
        courseId: topics.courseId,
        topicId: questions.topicId,
        difficulty: questions.difficulty,
        correctAnswer: questions.correctAnswer,
        imageAssetId: questions.imageAssetId,
        bodyTypst: questions.bodyTypst,
        alternatives: questions.alternatives,
        figureCode: questions.figureCode,
      })
      .from(examQuestions)
      .innerJoin(questions, eq(examQuestions.questionId, questions.id))
      .innerJoin(topics, eq(questions.topicId, topics.id))
      .where(eq(examQuestions.examId, examId))
      .orderBy(asc(examQuestions.position));

    return {
      id: exam.id,
      title: exam.title,
      gradeLevel: exam.gradeLevel,
      status: exam.status,
      questions: rows.map((row) => ({
        id: row.id,
        position: row.position,
        type: row.type,
        courseId: row.courseId,
        topicId: row.topicId,
        difficulty: row.difficulty,
        correctAnswer: row.correctAnswer,
        imageAssetId: row.imageAssetId,
        bodyTypst: row.bodyTypst,
        alternatives: (row.alternatives as readonly string[] | null) ?? null,
        figureCode: row.figureCode,
      })),
    };
  }

  /** Inserts an asset row (e.g. a compiled PDF) — mirrors the bank module's asset insert. */
  async createAsset(tenantId: string, storageKey: string, mime: string): Promise<{ id: string }> {
    const [asset] = await db
      .insert(assets)
      .values({ tenantId, storageKey, mime })
      .returning({ id: assets.id });

    if (!asset) {
      throw new Error("Insert invariant violated: asset row missing after insert");
    }

    return asset;
  }

  async saveVersion(examId: string, version: SaveVersionRecord): Promise<void> {
    await db.insert(examVersions).values({
      examId,
      code: version.code,
      questionOrder: version.questionOrder,
      answerKey: version.answerKey,
      pdfAssetId: version.pdfAssetId,
      answerSheetAssetId: version.answerSheetAssetId,
    });
  }
}
