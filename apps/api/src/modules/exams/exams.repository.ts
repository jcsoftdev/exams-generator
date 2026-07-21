import { Difficulty } from "@exams-generator/shared";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db/client";
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
  questions,
  syllabusWeekMaps,
  tenants,
  topics,
} from "../../db/schema";
import { ExamStatus, QuestionType } from "../../db/schema/enums";
import { SyllabusEntry, TemplateRow } from "./domain/resolve-blueprint";

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
    return db.transaction(async (tx) => {
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

    const [{ value: total }] = await db.select({ value: count() }).from(exams).where(where);

    const rows = await db
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
    const rows = await db
      .select({ status: exams.status, total: count() })
      .from(exams)
      .where(eq(exams.tenantId, tenantId))
      .groupBy(exams.status);

    return rows.map((row) => ({ status: row.status, total: Number(row.total) }));
  }

  /** Dashboard aggregate (design doc §2): the tenant's `limit` most recent exams, newest first. */
  async listRecent(tenantId: string, limit: number): Promise<RecentExamRecord[]> {
    const rows = await db
      .select({ id: exams.id, title: exams.title, status: exams.status, createdAt: exams.createdAt })
      .from(exams)
      .where(eq(exams.tenantId, tenantId))
      .orderBy(desc(exams.createdAt))
      .limit(limit);

    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
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
    const visibility = questionVisibility(filter.tenantId);

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

    const groups = await db
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
    return db.transaction(async (tx) => {
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
    return db.transaction(async (tx) => {
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

    const rows = await db
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

    const rows = await db
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

    const [row] = await db
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
    const rows = await db
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
    return db
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

    const [row] = await db
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
    const [row] = await db
      .select({ courseScope: examTypes.courseScope, weekScope: examTypes.weekScope })
      .from(examTypes)
      .where(eq(examTypes.code, code));

    return row ?? null;
  }
}
