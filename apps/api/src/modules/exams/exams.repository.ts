import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Database, DRIZZLE_DB } from "../../db/client";
import {
  assets,
  courses,
  cycles,
  examBlueprintRows,
  examBlueprintTemplateRows,
  examBlueprintTemplates,
  examQuestions,
  exams,
  examTypes,
  examVersions,
  questionAlternativeImages,
  questions,
  syllabusWeekMaps,
  tenants,
  topics,
} from "../../db/schema";
import { SyllabusEntry, TemplateRow } from "./domain/resolve-blueprint";
import {
  ActiveCycleRecord,
  BlueprintRowRecord,
  CreateExamRecord,
  CurrentTemplateRecord,
  ExamDetailRecord,
  ExamForGenerationRecord,
  ExamListFilters,
  ExamListItem,
  ExamQuestionRecord,
  ExamRecord,
  ExamsRepositoryPort,
  ExamStatusCount,
  ExamTypeRecord,
  QuestionPoolCandidateRecord,
  QuestionPoolFilter,
  RecentExamRecord,
  SaveSelectionEntry,
  SaveVersionRecord,
  StockCellFilter,
  VersionAssetRecord,
  VersionSummaryRecord,
} from "./domain/ports/exams-repository.port";

// Data-contract types (Records/Filters/Items) moved to
// `domain/ports/exams-repository.port.ts` (owned by the domain, not the
// adapter). Re-exported here so existing `import { XRecord } from
// "./exams.repository"` sites keep resolving unchanged.
export type {
  ActiveCycleRecord,
  BlueprintRowRecord,
  CreateExamBlueprintRowRecord,
  CreateExamRecord,
  CurrentTemplateRecord,
  ExamDetailQuestionRecord,
  ExamDetailRecord,
  ExamForGenerationRecord,
  ExamListFilters,
  ExamListItem,
  ExamQuestionRecord,
  ExamRecord,
  ExamsRepositoryPort,
  ExamStatusCount,
  ExamTypeRecord,
  QuestionPoolCandidateRecord,
  QuestionPoolFilter,
  RecentExamRecord,
  SaveSelectionEntry,
  SaveVersionRecord,
  SelectedQuestionForGeneration,
  StockCellFilter,
  VersionAssetRecord,
  VersionSummaryRecord,
} from "./domain/ports/exams-repository.port";

const logoAssets = alias(assets, "logo_assets");

/**
 * The tenant-visibility predicate shared by every query that reads from the
 * question bank on behalf of an exam (`getQuestionPool`, `countStock`):
 * `tenant_id IS NULL OR tenant_id = :tenant` (B1-R7 — must not be
 * duplicated).
 */
function questionVisibility(tenantId: string): SQL {
  return or(isNull(questions.tenantId), eq(questions.tenantId, tenantId)) as SQL;
}

/**
 * Drizzle-backed persistence for the exams module — implements
 * `ExamsRepositoryPort`. The data-contract types live in `domain/ports/`
 * (re-exported below for backward compatibility), and the Drizzle `db` is
 * injected via the constructor (`DRIZZLE_DB`) instead of importing the
 * singleton, so a test can bind a fake database.
 */
@Injectable()
export class ExamsRepository implements ExamsRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  /**
   * Inserts the exam row and every blueprint row in one transaction. Rows
   * are NOT deduplicated by criteria — two rows can share the same
   * {course, topic?, difficulty?} with different counts (see
   * `examBlueprintRows` schema docstring).
   */
  async createExam(record: CreateExamRecord): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const [exam] = await tx
        .insert(exams)
        .values({
          tenantId: record.tenantId,
          title: record.title,
          gradeLevel: record.gradeLevel,
          createdBy: record.createdBy,
          ...(record.examType !== undefined ? { examType: record.examType } : {}),
          ...(record.universityId !== undefined ? { universityId: record.universityId } : {}),
          ...(record.trackId !== undefined ? { trackId: record.trackId } : {}),
          ...(record.cycleId !== undefined ? { cycleId: record.cycleId } : {}),
          ...(record.weekNumber !== undefined ? { weekNumber: record.weekNumber } : {}),
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

  /**
   * `POST /exams/:examId/duplicate` (S2) — "usar de plantilla": clones the
   * exam row (title `"Copia de <original>"`, always `draft`, never
   * versions), its blueprint rows, and its current selection in ONE
   * transaction. `blueprintRowId` on the copied `exam_questions` rows is
   * remapped through `rowIdMap` (old row id -> new row id) so the copy's
   * selection still points at ITS OWN blueprint rows, not the original's.
   * Tenant-scoped like `getExamById` — returns `undefined` (never leaks
   * existence) for a missing/cross-tenant exam.
   */
  async duplicateExam(
    examId: string,
    tenantId: string,
    createdBy: string,
  ): Promise<{ id: string; title: string } | undefined> {
    return this.db.transaction(async (tx) => {
      const [original] = await tx
        .select()
        .from(exams)
        .where(and(eq(exams.id, examId), eq(exams.tenantId, tenantId)));
      if (!original) return undefined;

      const [copy] = await tx
        .insert(exams)
        .values({
          tenantId,
          title: `Copia de ${original.title}`,
          gradeLevel: original.gradeLevel,
          status: "draft",
          createdBy,
        })
        .returning({ id: exams.id, title: exams.title });

      const rows = await tx.select().from(examBlueprintRows).where(eq(examBlueprintRows.examId, examId));
      const rowIdMap = new Map<string, string>();
      for (const row of rows) {
        const [newRow] = await tx
          .insert(examBlueprintRows)
          .values({
            examId: copy!.id,
            courseId: row.courseId,
            topicId: row.topicId,
            difficulty: row.difficulty,
            count: row.count,
          })
          .returning({ id: examBlueprintRows.id });
        rowIdMap.set(row.id, newRow!.id);
      }

      const selection = await tx.select().from(examQuestions).where(eq(examQuestions.examId, examId));
      if (selection.length > 0) {
        await tx.insert(examQuestions).values(
          selection.map((s) => ({
            examId: copy!.id,
            questionId: s.questionId,
            blueprintRowId: s.blueprintRowId ? (rowIdMap.get(s.blueprintRowId) ?? null) : null,
            position: s.position,
          })),
        );
      }
      return copy;
    });
  }

  /** Tenant-scoped lookup — an exam is only ever visible to its own tenant. */
  async getExamById(examId: string, tenantId: string): Promise<ExamRecord | undefined> {
    const [row] = await this.db
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

  /**
   * `GET /exams` (S1) — tenant-scoped, filtered, paginated exam list
   * (design doc plan 2, web-consumed). `createdAt DESC` is the fixed sort
   * (S1 has no sort param). `questionCount`/`versionCount` are correlated
   * scalar subqueries so the base row set isn't multiplied by joins.
   */
  async listExams(tenantId: string, f: ExamListFilters): Promise<{ items: ExamListItem[]; total: number }> {
    const conditions = [eq(exams.tenantId, tenantId)];
    if (f.status) conditions.push(eq(exams.status, f.status));
    if (f.gradeLevel) conditions.push(eq(exams.gradeLevel, f.gradeLevel));
    if (f.search) conditions.push(ilike(exams.title, `%${f.search}%`));
    const where = and(...conditions);

    const [{ value: total }] = await this.db.select({ value: count() }).from(exams).where(where);

    const rows = await this.db
      .select({
        id: exams.id,
        title: exams.title,
        gradeLevel: exams.gradeLevel,
        status: exams.status,
        createdAt: exams.createdAt,
        questionCount: sql<number>`(select count(*)::int from ${examQuestions} where ${examQuestions.examId} = ${exams.id})`,
        versionCount: sql<number>`(select count(*)::int from ${examVersions} where ${examVersions.examId} = ${exams.id})`,
      })
      .from(exams)
      .where(where)
      .orderBy(desc(exams.createdAt))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize);

    return {
      items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total,
    };
  }

  /** Dashboard aggregate (design doc §2): grouped exam count by status for a tenant. */
  async countByStatus(tenantId: string): Promise<ExamStatusCount[]> {
    const rows = await this.db
      .select({ status: exams.status, total: count() })
      .from(exams)
      .where(eq(exams.tenantId, tenantId))
      .groupBy(exams.status);

    return rows.map((row) => ({ status: row.status, total: Number(row.total) }));
  }

  /** Dashboard aggregate (design doc §2): the tenant's `limit` most recent exams, newest first. */
  async listRecent(tenantId: string, limit: number): Promise<RecentExamRecord[]> {
    const rows = await this.db
      .select({ id: exams.id, title: exams.title, status: exams.status, createdAt: exams.createdAt })
      .from(exams)
      .where(eq(exams.tenantId, tenantId))
      .orderBy(desc(exams.createdAt))
      .limit(limit);

    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  /** Blueprint rows for an exam, with course/topic names resolved for human-readable shortage messages. */
  async getBlueprintRows(examId: string): Promise<BlueprintRowRecord[]> {
    const rows = await this.db
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
    const visibility = questionVisibility(filter.tenantId);

    return this.db
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
   * `POST /exams/stock/batch` (B1): ONE grouped query over the same
   * release-gate visibility as `getQuestionPool()` (B1-R7 — factored via
   * `questionVisibility()`, not duplicated), `GROUP BY` course/topic/
   * difficulty, then one `available` count projected per input cell in
   * input order. A cell with no matching group yields `0` (B1-R9), not an
   * error. Omitting a cell's `topicId`/`difficulty` sums across every
   * group that still matches the cell's other criteria.
   */
  async countStock(filter: QuestionPoolFilter, cells: readonly StockCellFilter[]): Promise<number[]> {
    const visibility = questionVisibility(filter.tenantId);

    const groups = await this.db
      .select({
        courseId: topics.courseId,
        topicId: questions.topicId,
        difficulty: questions.difficulty,
        total: count(),
      })
      .from(questions)
      .innerJoin(topics, eq(questions.topicId, topics.id))
      .where(and(visibility, eq(questions.status, "approved"), eq(questions.gradeLevel, filter.gradeLevel)))
      .groupBy(topics.courseId, questions.topicId, questions.difficulty);

    return cells.map((cell) =>
      groups
        .filter(
          (group) =>
            group.courseId === cell.courseId &&
            (cell.topicId === undefined || group.topicId === cell.topicId) &&
            (cell.difficulty === undefined || group.difficulty === cell.difficulty),
        )
        .reduce((sum, group) => sum + Number(group.total), 0),
    );
  }

  /**
   * Replaces the exam's full selection. Idempotent under re-run (deletes
   * any prior selection first) so a failed/retried create-exam flow never
   * leaves stale rows. Position is assigned by array order.
   */
  async saveSelection(examId: string, selections: readonly SaveSelectionEntry[]): Promise<void> {
    await this.db.transaction(async (tx) => {
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
    const rows = await this.db
      .select({ questionId: examQuestions.questionId })
      .from(examQuestions)
      .where(eq(examQuestions.examId, examId))
      .orderBy(asc(examQuestions.position));

    return rows.map((row) => row.questionId);
  }

  /** Finds which blueprint row (and position) a currently-selected question fulfills. */
  async findExamQuestion(examId: string, questionId: string): Promise<ExamQuestionRecord | undefined> {
    const [row] = await this.db
      .select({ blueprintRowId: examQuestions.blueprintRowId, position: examQuestions.position })
      .from(examQuestions)
      .where(and(eq(examQuestions.examId, examId), eq(examQuestions.questionId, questionId)));

    return row;
  }

  /** Swaps the questionId at a fixed position/blueprintRowId — used by the replace-question flow. */
  async replaceQuestion(examId: string, oldQuestionId: string, newQuestionId: string): Promise<void> {
    await this.db
      .update(examQuestions)
      .set({ questionId: newQuestionId })
      .where(and(eq(examQuestions.examId, examId), eq(examQuestions.questionId, oldQuestionId)));
  }

  /**
   * Takes one question out of circulation bank-wide. `archived` is the only
   * non-selectable terminal status the schema has (`getQuestionPool` filters
   * on `approved`), so this is what quarantines a question that generation
   * proved uncompilable — without it the same broken row keeps poisoning
   * every future exam that happens to select it.
   */
  async archiveQuestion(questionId: string): Promise<void> {
    await this.db.update(questions).set({ status: "archived" }).where(eq(questions.id, questionId));
  }

  /** Moves an exam from `draft` to `ready` — no-op (0 rows) if it isn't currently `draft`. */
  async confirmExam(examId: string): Promise<void> {
    await this.db
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
    const [examRow] = await this.db
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

    const selectedRows = await this.db
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

    const alternativeImagesByQuestionId = await this.getAlternativeImagesByQuestionId(
      selectedRows.map((row) => row.questionId),
    );

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
        alternativeImages: alternativeImagesByQuestionId.get(row.questionId) ?? null,
      })),
    };
  }

  /**
   * Batched, parallel query (design doc: alternative images) — a SECOND
   * roundtrip keyed by the same question ids from `getExamForGeneration`'s
   * main select, rather than a `leftJoin` there, since a per-alternative-image
   * join would fan out one row per image and break that query's
   * one-row-per-selected-question shape. Returns `undefined` (not an
   * all-null array) for a question with zero `question_alternative_images`
   * rows — `SelectedQuestionForGeneration.alternativeImages` stays
   * `null`/absent for those (see its doc comment).
   */
  private async getAlternativeImagesByQuestionId(
    questionIds: readonly string[],
  ): Promise<Map<string, readonly ({ storageKey: string; mime: string } | null)[]>> {
    const result = new Map<string, readonly ({ storageKey: string; mime: string } | null)[]>();
    if (questionIds.length === 0) {
      return result;
    }

    const rows = await this.db
      .select({
        questionId: questionAlternativeImages.questionId,
        alternativeIndex: questionAlternativeImages.alternativeIndex,
        storageKey: assets.storageKey,
        mime: assets.mime,
      })
      .from(questionAlternativeImages)
      .innerJoin(assets, eq(questionAlternativeImages.assetId, assets.id))
      .where(inArray(questionAlternativeImages.questionId, questionIds as string[]))
      .orderBy(asc(questionAlternativeImages.alternativeIndex));

    const rowsByQuestionId = new Map<string, { alternativeIndex: number; storageKey: string; mime: string }[]>();
    for (const row of rows) {
      const bucket = rowsByQuestionId.get(row.questionId) ?? [];
      bucket.push(row);
      rowsByQuestionId.set(row.questionId, bucket);
    }

    for (const [questionId, bucket] of rowsByQuestionId) {
      const maxIndex = Math.max(...bucket.map((row) => row.alternativeIndex));
      const images: ({ storageKey: string; mime: string } | null)[] = Array.from(
        { length: maxIndex + 1 },
        () => null,
      );
      for (const row of bucket) {
        images[row.alternativeIndex] = { storageKey: row.storageKey, mime: row.mime };
      }
      result.set(questionId, images);
    }

    return result;
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

    const rows = await this.db
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
    const [asset] = await this.db
      .insert(assets)
      .values({ tenantId, storageKey, mime })
      .returning({ id: assets.id });

    if (!asset) {
      throw new Error("Insert invariant violated: asset row missing after insert");
    }

    return asset;
  }

  async saveVersion(examId: string, version: SaveVersionRecord): Promise<void> {
    await this.db.insert(examVersions).values({
      examId,
      code: version.code,
      questionOrder: version.questionOrder,
      answerKey: version.answerKey,
      pdfAssetId: version.pdfAssetId,
      answerSheetAssetId: version.answerSheetAssetId,
    });
  }

  /**
   * B4-B (idempotent regeneration): in ONE transaction, reads the exam's
   * existing `exam_versions` rows, deletes them (must happen BEFORE
   * deleting their `assets` rows — `exam_versions.pdfAssetId`/
   * `answerSheetAssetId` FK-reference `assets.id`), then deletes those
   * asset rows too, returning their `storageKey`s so the caller can
   * best-effort clean up the actual storage objects. No-op (`[]`) when the
   * exam has zero prior versions — a first-time generation is unaffected
   * (B4-R7).
   */
  async clearVersions(examId: string): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ pdfAssetId: examVersions.pdfAssetId, answerSheetAssetId: examVersions.answerSheetAssetId })
        .from(examVersions)
        .where(eq(examVersions.examId, examId));

      if (existing.length === 0) {
        return [];
      }

      const assetIds = existing
        .flatMap((row) => [row.pdfAssetId, row.answerSheetAssetId])
        .filter((id): id is string => id !== null);

      await tx.delete(examVersions).where(eq(examVersions.examId, examId));

      if (assetIds.length === 0) {
        return [];
      }

      const assetRows = await tx.select({ storageKey: assets.storageKey }).from(assets).where(inArray(assets.id, assetIds));
      await tx.delete(assets).where(inArray(assets.id, assetIds));

      return assetRows.map((row) => row.storageKey);
    });
  }

  /**
   * `DELETE /exams/:examId` (S3) — cascades to every child row in ONE
   * transaction: `exam_versions`, `exam_questions`, `exam_blueprint_rows`,
   * then the `exams` row itself. Deliberately does NOT touch the assets
   * referenced by `exam_versions.pdfAssetId`/`answerSheetAssetId` — those
   * become orphaned storage objects, accepted per the design doc (no GC
   * pass exists yet). Tenant-scoped like `getExamById`/`duplicateExam`:
   * returns `false` for a missing/cross-tenant exam instead of deleting
   * anything, so a cross-tenant caller never mutates another tenant's data.
   * No status restriction — the frontend is responsible for confirming the
   * destructive action before calling this endpoint.
   */
  async deleteExam(examId: string, tenantId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: exams.id })
        .from(exams)
        .where(and(eq(exams.id, examId), eq(exams.tenantId, tenantId)));
      if (!existing) return false;

      await tx.delete(examVersions).where(eq(examVersions.examId, examId));
      await tx.delete(examQuestions).where(eq(examQuestions.examId, examId));
      await tx.delete(examBlueprintRows).where(eq(examBlueprintRows.examId, examId));
      await tx.delete(exams).where(eq(exams.id, examId));

      return true;
    });
  }

  /**
   * `GET /exams/:examId/versions` (B4): tenant-scoped like `getExamById`
   * (returns `undefined` — never leak existence, B4-R2). `pdfUrl`/
   * `answerSheetUrl` are constructed directly from the asset ids
   * (DECISION B4-A — `/assets/:id`, no join needed since only the id is
   * used), ordered by `code ASC` (DECISION B4-C).
   */
  async getVersions(examId: string, tenantId: string): Promise<VersionSummaryRecord[] | undefined> {
    const exam = await this.getExamById(examId, tenantId);
    if (!exam) {
      return undefined;
    }

    const rows = await this.db
      .select({
        code: examVersions.code,
        pdfAssetId: examVersions.pdfAssetId,
        answerSheetAssetId: examVersions.answerSheetAssetId,
      })
      .from(examVersions)
      .where(eq(examVersions.examId, examId))
      .orderBy(asc(examVersions.code));

    return rows.map((row) => ({
      code: row.code,
      pdfUrl: row.pdfAssetId ? `/assets/${row.pdfAssetId}` : "",
      answerSheetUrl: row.answerSheetAssetId ? `/assets/${row.answerSheetAssetId}` : "",
    }));
  }

  /**
   * `GET /exams/:examId/versions/zip` (N1): tenant-scoped like `getVersions`
   * (returns `undefined` for a missing/cross-tenant exam — never leak
   * existence). Unlike `getVersions` (which only needs asset ids for URLs),
   * the ZIP download needs the actual `storageKey`/`mime` to pull bytes from
   * `StoragePort`, so this joins `exam_versions` -> `assets` twice (pdf +
   * answer sheet). `innerJoin` skips any half-generated version missing an
   * asset — a fully generated version always has both. Ordered by `code ASC`.
   */
  async getVersionAssetRecords(
    examId: string,
    tenantId: string,
  ): Promise<VersionAssetRecord[] | undefined> {
    const exam = await this.getExamById(examId, tenantId);
    if (!exam) {
      return undefined;
    }

    const pdfAssets = alias(assets, "pdf_assets");
    const answerSheetAssets = alias(assets, "answer_sheet_assets");

    const rows = await this.db
      .select({
        code: examVersions.code,
        pdfStorageKey: pdfAssets.storageKey,
        pdfMime: pdfAssets.mime,
        answerSheetStorageKey: answerSheetAssets.storageKey,
        answerSheetMime: answerSheetAssets.mime,
      })
      .from(examVersions)
      .innerJoin(pdfAssets, eq(examVersions.pdfAssetId, pdfAssets.id))
      .innerJoin(answerSheetAssets, eq(examVersions.answerSheetAssetId, answerSheetAssets.id))
      .where(eq(examVersions.examId, examId))
      .orderBy(asc(examVersions.code));

    return rows;
  }

  /**
   * Resolves the CURRENT (`is_current = true`) blueprint template for
   * (university, track?), preferring the caller's tenant-specific override
   * over the platform-wide default when both exist (design doc §3.7 —
   * "default global editable por tenant vía fila-override"). Same
   * nullable-tenant_id visibility pattern as `questionVisibility()`, but this
   * query must settle on exactly ONE winner (unlike question-pool visibility,
   * which just needs "any match"), hence the explicit `ORDER BY ... IS NULL`
   * tiebreak — a non-null (tenant-owned) row sorts before a null (global) one.
   *
   * `trackId` matches with `IS NOT DISTINCT FROM` semantics (raw `sql`, not
   * `eq`/`isNull`) because plain `=` never matches `NULL = NULL` in
   * Postgres — a track-less university must still match a track-less
   * template row, not silently return nothing.
   */
  async findCurrentTemplate(
    universityId: string,
    trackId: string | null,
    tenantId: string | null,
  ): Promise<CurrentTemplateRecord | null> {
    const tenantCondition = tenantId
      ? or(isNull(examBlueprintTemplates.tenantId), eq(examBlueprintTemplates.tenantId, tenantId))
      : isNull(examBlueprintTemplates.tenantId);

    const [row] = await this.db
      .select({ id: examBlueprintTemplates.id })
      .from(examBlueprintTemplates)
      .where(
        and(
          eq(examBlueprintTemplates.universityId, universityId),
          sql`${examBlueprintTemplates.trackId} IS NOT DISTINCT FROM ${trackId}`,
          eq(examBlueprintTemplates.isCurrent, true),
          tenantCondition,
        ),
      )
      .orderBy(sql`${examBlueprintTemplates.tenantId} IS NULL`)
      .limit(1);

    return row ?? null;
  }

  /**
   * Maps `exam_blueprint_template_rows` onto the exact `TemplateRow` shape
   * `resolveBlueprint()` (design doc §5) expects — `weight_points` comes back
   * from Postgres as a string (drizzle's default `numeric` mode), so it's
   * converted to a number here; every other column already matches 1:1.
   */
  async getTemplateRows(templateId: string): Promise<TemplateRow[]> {
    const rows = await this.db
      .select({
        courseId: examBlueprintTemplateRows.courseId,
        topicId: examBlueprintTemplateRows.topicId,
        questionCount: examBlueprintTemplateRows.questionCount,
        weightPoints: examBlueprintTemplateRows.weightPoints,
        sourceLevel: examBlueprintTemplateRows.sourceLevel,
      })
      .from(examBlueprintTemplateRows)
      .where(eq(examBlueprintTemplateRows.templateId, templateId));

    return rows.map((row) => ({
      courseId: row.courseId,
      topicId: row.topicId,
      questionCount: row.questionCount,
      weightPoints: row.weightPoints !== null ? Number(row.weightPoints) : null,
      sourceLevel: row.sourceLevel,
    }));
  }

  /**
   * Maps `syllabus_week_maps` onto the domain `SyllabusEntry` shape — every
   * column here is `NOT NULL`, so this is a pure passthrough (unlike
   * `getTemplateRows()`, no nullability/type reconciliation needed).
   */
  async getSyllabusForTemplate(templateId: string): Promise<SyllabusEntry[]> {
    return this.db
      .select({
        courseId: syllabusWeekMaps.courseId,
        topicId: syllabusWeekMaps.topicId,
        weekNumber: syllabusWeekMaps.weekNumber,
      })
      .from(syllabusWeekMaps)
      .where(eq(syllabusWeekMaps.templateId, templateId));
  }

  /**
   * Resolves the ACTIVE (`is_active = true`) cycle for (university, track?),
   * same tenant-override-wins + `IS NOT DISTINCT FROM` track matching as
   * `findCurrentTemplate()` — the two queries are deliberately independent
   * (design doc §3.4: a cycle references university/track directly, never a
   * `template_id`), so the pattern is duplicated rather than shared.
   */
  async findActiveCycle(
    universityId: string,
    trackId: string | null,
    tenantId: string | null,
  ): Promise<ActiveCycleRecord | null> {
    const tenantCondition = tenantId
      ? or(isNull(cycles.tenantId), eq(cycles.tenantId, tenantId))
      : isNull(cycles.tenantId);

    const [row] = await this.db
      .select({ startsOn: cycles.startsOn, weekLengthDays: cycles.weekLengthDays })
      .from(cycles)
      .where(
        and(
          eq(cycles.universityId, universityId),
          sql`${cycles.trackId} IS NOT DISTINCT FROM ${trackId}`,
          eq(cycles.isActive, true),
          tenantCondition,
        ),
      )
      .orderBy(sql`${cycles.tenantId} IS NULL`)
      .limit(1);

    return row ?? null;
  }

  /** Trivial `exam_types` lookup — the two axes (`course_scope`/`week_scope`) that drive `resolveBlueprint()` (design doc §5). */
  async findExamType(code: string): Promise<ExamTypeRecord | null> {
    const [row] = await this.db
      .select({ courseScope: examTypes.courseScope, weekScope: examTypes.weekScope })
      .from(examTypes)
      .where(eq(examTypes.code, code));

    return row ?? null;
  }
}
