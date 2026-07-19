import { Difficulty } from "@exams-generator/shared";
import { and, count, eq, isNull, or, SQL } from "drizzle-orm";
import { db } from "../../db/client";
import { assets, courses, questions, topics } from "../../db/schema";
import { QuestionStatus, QuestionType } from "../../db/schema/enums";

export interface CreateImageQuestionRecord {
  readonly tenantId: string | null;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly correctAnswer: string;
  readonly createdBy: string;
  readonly image: {
    readonly storageKey: string;
    readonly mime: string;
    readonly width?: number;
    readonly height?: number;
  };
}

export interface CreateStructuredQuestionRecord {
  readonly tenantId: string | null;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly figureCode: string | undefined;
  readonly createdBy: string;
  /**
   * Defaults to `'approved'` (manual creation is curated by definition).
   * The AI generation flow (Lane D3) passes `'draft'` explicitly — the AI
   * NEVER publishes directly to the bank.
   */
  readonly status?: QuestionStatus;
  /** Defaults to `false`. `true` only for AI-generated drafts (Lane D3). */
  readonly aiGenerated?: boolean;
}

export interface UpdateStructuredQuestionRecord {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly figureCode: string | undefined;
}

export interface QuestionListItem {
  readonly id: string;
  readonly tenantId: string | null;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly correctAnswer: string;
  readonly type: QuestionType;
  readonly status: QuestionStatus;
  readonly aiGenerated: boolean;
  readonly imageAssetId: string | null;
  readonly bodyTypst: string | null;
  readonly alternatives: unknown;
  readonly figureCode: string | null;
}

export interface QuestionListFilter {
  /** The requesting user's own tenant (null = platform staff). */
  readonly currentTenantId: string | null;
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly gradeLevel?: string;
  readonly status?: QuestionStatus;
}

/** S6: opt-in pagination for `listQuestions` — 1-indexed page, clamped by the caller (controller). */
export interface QuestionListPagination {
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Drizzle-backed persistence for the bank module. Kept as a thin class
 * (no repository port/interface) — unlike `StoragePort`, nothing in this
 * PR's scope needs a swappable implementation, so the extra abstraction
 * would be speculative.
 */
export class BankRepository {
  /**
   * Manual image-question upload (design doc 5.1): always inserts the
   * backing asset row plus the question row, wired together via
   * `imageAssetId`, and always at `status = 'approved'` — carga manual is
   * curated by definition, there is no draft state to pass through here.
   */
  async createImageQuestion(record: CreateImageQuestionRecord): Promise<{ id: string }> {
    return db.transaction(async (tx) => {
      const [asset] = await tx
        .insert(assets)
        .values({
          tenantId: record.tenantId,
          storageKey: record.image.storageKey,
          mime: record.image.mime,
          width: record.image.width,
          height: record.image.height,
        })
        .returning({ id: assets.id });

      if (!asset) {
        throw new Error("Insert invariant violated: asset row missing after insert");
      }

      const [question] = await tx
        .insert(questions)
        .values({
          tenantId: record.tenantId,
          type: "image",
          topicId: record.topicId,
          difficulty: record.difficulty,
          gradeLevel: record.gradeLevel,
          status: "approved",
          imageAssetId: asset.id,
          correctAnswer: record.correctAnswer,
          createdBy: record.createdBy,
        })
        .returning({ id: questions.id });

      if (!question) {
        throw new Error("Insert invariant violated: question row missing after insert");
      }

      return { id: question.id };
    });
  }

  /**
   * Manual structured-question creation (Lane D2, design doc §5.4): no
   * backing asset — the statement/alternatives/figure live directly on the
   * question row (`body_typst` / `alternatives` jsonb / `figure_code`).
   * Same as manual image upload, this is curated by definition, so it goes
   * straight to `status = 'approved'` (no draft state here; the AI-generated
   * draft flow is a separate lane).
   */
  async createStructuredQuestion(
    record: CreateStructuredQuestionRecord,
  ): Promise<{ id: string }> {
    const [question] = await db
      .insert(questions)
      .values({
        tenantId: record.tenantId,
        type: "structured",
        topicId: record.topicId,
        difficulty: record.difficulty,
        gradeLevel: record.gradeLevel,
        status: record.status ?? "approved",
        bodyTypst: record.bodyTypst,
        alternatives: record.alternatives,
        figureCode: record.figureCode,
        correctAnswer: record.correctAnswer,
        createdBy: record.createdBy,
        aiGenerated: record.aiGenerated ?? false,
      })
      .returning({ id: questions.id });

    if (!question) {
      throw new Error("Insert invariant violated: question row missing after insert");
    }

    return { id: question.id };
  }

  /**
   * Visibility rule (design doc §3, MUST release gate): every query filters
   * `tenant_id IS NULL OR tenant_id = :current` — a tenant NEVER sees
   * another tenant's private questions. `currentTenantId: null` (platform
   * staff) resolves to `tenant_id IS NULL` only, since there is no "current
   * tenant" whose private rows staff should see by default.
   *
   * S6: `pagination` is opt-in and retro-compat is load-bearing — omitting it
   * returns the SAME flat array shape this always returned (existing web
   * consumers — `bank.service.ts` and `ai.service.ts`'s `listDrafts` —
   * decode the response as an array, not `{items,total}`). Passing it
   * switches to a `{ items, total }` envelope with `count()` + `limit`/
   * `offset`, same pattern as `ExamsRepository.listExams` (T2).
   */
  async listQuestions(filter: QuestionListFilter): Promise<QuestionListItem[]>;
  async listQuestions(
    filter: QuestionListFilter,
    pagination: QuestionListPagination,
  ): Promise<{ items: QuestionListItem[]; total: number }>;
  async listQuestions(
    filter: QuestionListFilter,
    pagination?: QuestionListPagination,
  ): Promise<QuestionListItem[] | { items: QuestionListItem[]; total: number }> {
    const visibility: SQL = filter.currentTenantId
      ? (or(isNull(questions.tenantId), eq(questions.tenantId, filter.currentTenantId)) as SQL)
      : (isNull(questions.tenantId) as SQL);

    const conditions: SQL[] = [visibility];
    if (filter.courseId) {
      conditions.push(eq(topics.courseId, filter.courseId) as SQL);
    }
    if (filter.topicId) {
      conditions.push(eq(questions.topicId, filter.topicId) as SQL);
    }
    if (filter.difficulty) {
      conditions.push(eq(questions.difficulty, filter.difficulty) as SQL);
    }
    if (filter.gradeLevel) {
      conditions.push(eq(questions.gradeLevel, filter.gradeLevel) as SQL);
    }
    if (filter.status) {
      conditions.push(eq(questions.status, filter.status) as SQL);
    }

    const where = and(...conditions);
    const selection = {
      id: questions.id,
      tenantId: questions.tenantId,
      courseId: topics.courseId,
      topicId: questions.topicId,
      difficulty: questions.difficulty,
      gradeLevel: questions.gradeLevel,
      correctAnswer: questions.correctAnswer,
      type: questions.type,
      status: questions.status,
      aiGenerated: questions.aiGenerated,
      imageAssetId: questions.imageAssetId,
      bodyTypst: questions.bodyTypst,
      alternatives: questions.alternatives,
      figureCode: questions.figureCode,
    };

    if (!pagination) {
      return db.select(selection).from(questions).innerJoin(topics, eq(questions.topicId, topics.id)).where(where);
    }

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(questions)
      .innerJoin(topics, eq(questions.topicId, topics.id))
      .where(where);

    const items = await db
      .select(selection)
      .from(questions)
      .innerJoin(topics, eq(questions.topicId, topics.id))
      .where(where)
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    return { items, total };
  }

  /**
   * Direct-by-id lookup (release gate: id enumeration guard). Applies the
   * SAME visibility rule as `listQuestions` — `tenant_id IS NULL OR
   * tenant_id = :current` — so a guessed/enumerated id belonging to another
   * tenant resolves to `undefined` exactly like a non-existent id. Callers
   * (the service) turn that into a 404, never leaking whether the id exists.
   */
  async findQuestionById(
    id: string,
    currentTenantId: string | null,
  ): Promise<QuestionListItem | undefined> {
    const visibility: SQL = currentTenantId
      ? (or(isNull(questions.tenantId), eq(questions.tenantId, currentTenantId)) as SQL)
      : (isNull(questions.tenantId) as SQL);

    const [row] = await db
      .select({
        id: questions.id,
        tenantId: questions.tenantId,
        courseId: topics.courseId,
        topicId: questions.topicId,
        difficulty: questions.difficulty,
        gradeLevel: questions.gradeLevel,
        correctAnswer: questions.correctAnswer,
        type: questions.type,
        status: questions.status,
        aiGenerated: questions.aiGenerated,
        imageAssetId: questions.imageAssetId,
        bodyTypst: questions.bodyTypst,
        alternatives: questions.alternatives,
        figureCode: questions.figureCode,
      })
      .from(questions)
      .innerJoin(topics, eq(questions.topicId, topics.id))
      .where(and(eq(questions.id, id), visibility));

    return row;
  }

  /**
   * Resolves the human-readable course/topic names the AI prompt needs
   * (`QuestionGeneratorPort.generate()` takes `course`/`topic` as free text,
   * see design doc §5.2) from the client-supplied ids. Returns `undefined`
   * when either id doesn't exist OR the topic doesn't belong to the given
   * course — the caller turns that into a 404/400, never a raw FK error.
   */
  async findCourseAndTopicNames(
    courseId: string,
    topicId: string,
  ): Promise<{ courseName: string; topicName: string } | undefined> {
    const [row] = await db
      .select({ courseName: courses.name, topicName: topics.name })
      .from(topics)
      .innerJoin(courses, eq(topics.courseId, courses.id))
      .where(and(eq(topics.id, topicId), eq(courses.id, courseId)));

    return row;
  }

  /**
   * Draft -> approved (Lane D3 human curation step). Scoped to the SAME
   * visibility rule as `findQuestionById`/`listQuestions` — a tenant can
   * only approve its own (or central) drafts. Also requires the row to
   * currently be `status = 'draft'` (`and()` bakes that into the `UPDATE ...
   * WHERE`, so it's atomic: no read-then-write race), so re-approving an
   * already-approved question, or approving another tenant's draft, both
   * resolve to `undefined` — the caller distinguishes 404 vs 409 by doing
   * its own pre-check via `findQuestionById` before calling this.
   */
  async approveQuestion(
    id: string,
    currentTenantId: string | null,
  ): Promise<{ id: string; status: QuestionStatus } | undefined> {
    const visibility: SQL = currentTenantId
      ? (or(isNull(questions.tenantId), eq(questions.tenantId, currentTenantId)) as SQL)
      : (isNull(questions.tenantId) as SQL);

    const [row] = await db
      .update(questions)
      .set({ status: "approved" })
      .where(and(eq(questions.id, id), eq(questions.status, "draft"), visibility))
      .returning({ id: questions.id, status: questions.status });

    return row;
  }

  /**
   * Rejects a draft by deleting its row outright (design doc §5.2: rejected
   * AI drafts are discarded, not archived). Same tenant-visibility +
   * `status = 'draft'` scoping as `approveQuestion`. Returns `true` only
   * when a row was actually deleted.
   */
  async rejectQuestion(id: string, currentTenantId: string | null): Promise<boolean> {
    const visibility: SQL = currentTenantId
      ? (or(isNull(questions.tenantId), eq(questions.tenantId, currentTenantId)) as SQL)
      : (isNull(questions.tenantId) as SQL);

    const deleted = await db
      .delete(questions)
      .where(and(eq(questions.id, id), eq(questions.status, "draft"), visibility))
      .returning({ id: questions.id });

    return deleted.length > 0;
  }

  /**
   * Human edit of a structured question's content — a `draft` (Lane D3:
   * "un humano pueda editar el draft antes de aprobar") OR an already
   * `approved` question (post-approval correction, question editing). Same
   * tenant-visibility scoping as `approveQuestion`; unlike the original
   * draft-only version, this does NOT constrain by `status` — the service
   * (`requireManageableQuestion`) has already resolved the draft/approved/
   * not-archived precondition, so this is a plain scoped `UPDATE`.
   */
  async updateStructuredQuestion(
    id: string,
    currentTenantId: string | null,
    patch: UpdateStructuredQuestionRecord,
  ): Promise<QuestionListItem | undefined> {
    const visibility: SQL = currentTenantId
      ? (or(isNull(questions.tenantId), eq(questions.tenantId, currentTenantId)) as SQL)
      : (isNull(questions.tenantId) as SQL);

    const [row] = await db
      .update(questions)
      .set({
        bodyTypst: patch.bodyTypst,
        alternatives: patch.alternatives,
        correctAnswer: patch.correctAnswer,
        figureCode: patch.figureCode,
      })
      .where(and(eq(questions.id, id), visibility))
      .returning({
        id: questions.id,
        tenantId: questions.tenantId,
        topicId: questions.topicId,
        difficulty: questions.difficulty,
        gradeLevel: questions.gradeLevel,
        correctAnswer: questions.correctAnswer,
        type: questions.type,
        status: questions.status,
        aiGenerated: questions.aiGenerated,
        imageAssetId: questions.imageAssetId,
        bodyTypst: questions.bodyTypst,
        alternatives: questions.alternatives,
        figureCode: questions.figureCode,
      });

    if (!row) {
      return undefined;
    }

    const [topicRow] = await db
      .select({ courseId: topics.courseId })
      .from(topics)
      .where(eq(topics.id, row.topicId));

    return { ...row, courseId: topicRow?.courseId ?? "" };
  }

  /**
   * Persists taxonomy fields for `editQuestion` (design doc: question
   * editing). Same tenant-visibility scoping as the other question writes in
   * this class — a tenant can only retaxonomize its own (or central)
   * questions. Unlike `updateStructuredQuestion`, this does NOT constrain by
   * `status` — the service (`requireManageableQuestion`) has already
   * resolved the draft/approved precondition, so this is a plain scoped
   * `UPDATE`. Only fields present in `patch` are set; an empty patch is a
   * no-op (no DB round-trip).
   *
   * NOTE: `patch.courseId` is intentionally NOT written here — `questions`
   * has no `course_id` column (see `questions.schema.ts`); a question's
   * course is always derived by joining `topics.course_id` via `topic_id`,
   * exactly like `createStructuredQuestion`/`validateCreateStructuredQuestionInput`
   * already accept-but-don't-persist `courseId` on creation. Moving a
   * question to a different course means moving it to a topic under that
   * course, i.e. changing `topicId`.
   */
  async updateQuestionTaxonomy(
    id: string,
    currentTenantId: string | null,
    patch: { courseId?: string; topicId?: string; difficulty?: string; gradeLevel?: string },
  ): Promise<void> {
    const set: Partial<{ topicId: string; difficulty: Difficulty; gradeLevel: string }> = {};
    if (patch.topicId !== undefined) set.topicId = patch.topicId;
    if (patch.difficulty !== undefined) set.difficulty = patch.difficulty as Difficulty;
    if (patch.gradeLevel !== undefined) set.gradeLevel = patch.gradeLevel;
    if (Object.keys(set).length === 0) {
      return;
    }

    const visibility: SQL = currentTenantId
      ? (or(isNull(questions.tenantId), eq(questions.tenantId, currentTenantId)) as SQL)
      : (isNull(questions.tenantId) as SQL);

    await db
      .update(questions)
      .set(set)
      .where(and(eq(questions.id, id), visibility));
  }

  /**
   * Soft-remove: `approved` -> `archived` (Lane D4, S4). The caller (service)
   * has already resolved visibility + the `status='approved'` precondition
   * via `findQuestionById`, so this is a plain unconditional status flip.
   */
  async updateStatus(id: string, status: QuestionStatus): Promise<void> {
    await db.update(questions).set({ status }).where(eq(questions.id, id));
  }

  /**
   * Hard delete of a `draft` question (Lane D4, S5). The caller (service)
   * has already resolved visibility + the `status='draft'` precondition via
   * `requireVisibleDraft`.
   */
  async deleteQuestion(id: string): Promise<void> {
    await db.delete(questions).where(eq(questions.id, id));
  }
}
