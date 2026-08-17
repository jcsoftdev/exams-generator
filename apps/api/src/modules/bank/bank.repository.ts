import { Inject, Injectable } from "@nestjs/common";
import { Difficulty } from "@exams-generator/shared";
import { and, count, desc, eq, isNull, or, SQL } from "drizzle-orm";
import { Database, DRIZZLE_DB } from "../../db/client";
import { assets, courses, questionAlternativeImages, questions, subtopics, topics } from "../../db/schema";
import { QuestionStatus } from "../../db/schema/enums";
import { hashBodyTypst } from "./domain/hash-body-typst";
import {
  BankRepositoryPort,
  BankStatusDifficultyCount,
  BankTopicQuestionCount,
  CreateImageQuestionRecord,
  CreateStructuredQuestionRecord,
  QuestionListFilter,
  QuestionListItem,
  QuestionListPagination,
  UpdateStructuredQuestionRecord,
} from "./domain/ports/bank-repository.port";

/**
 * The WHERE clause shared by `listQuestions` and `countByCourseAndTopic`.
 * Extracted so the two can never drift: the tree's per-topic counts and the
 * per-topic question fetch that fills them in MUST see the same rows (see
 * `countByCourseAndTopic`'s doc).
 *
 * Visibility rule (design doc §3, MUST release gate): every query filters
 * `tenant_id IS NULL OR tenant_id = :current` — a tenant NEVER sees another
 * tenant's private questions. `currentTenantId: null` (platform staff)
 * resolves to `tenant_id IS NULL` only, since there is no "current tenant"
 * whose private rows staff should see by default.
 *
 * Assumes the caller joins `topics` (the `courseId` filter reads
 * `topics.course_id` — `questions` has no course column).
 */
function buildQuestionListConditions(filter: QuestionListFilter): SQL[] {
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

  return conditions;
}

// Data-contract types moved to `domain/ports/bank-repository.port.ts` (owned
// by the domain, not the adapter). Re-exported here so existing
// `import { XRecord } from "./bank.repository"` sites keep resolving.
export type {
  BankRepositoryPort,
  BankStatusDifficultyCount,
  BankTopicQuestionCount,
  CreateImageQuestionRecord,
  CreateStructuredQuestionRecord,
  QuestionListFilter,
  QuestionListItem,
  QuestionListPagination,
  UpdateStructuredQuestionRecord,
} from "./domain/ports/bank-repository.port";

/**
 * Drizzle-backed persistence for the bank module — implements
 * `BankRepositoryPort` (data contracts live in `domain/ports/`, re-exported
 * above for backward compatibility). The Drizzle `db` is injected via the
 * constructor (`DRIZZLE_DB`) instead of importing the singleton, so a test
 * can bind a fake database.
 */
@Injectable()
export class BankRepository implements BankRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  /**
   * Manual image-question upload (design doc 5.1): always inserts the
   * backing asset row plus the question row, wired together via
   * `imageAssetId`, and always at `status = 'approved'` — carga manual is
   * curated by definition, there is no draft state to pass through here.
   */
  async createImageQuestion(record: CreateImageQuestionRecord): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
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
          subtopicId: record.subtopicId,
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
    const [question] = await this.db
      .insert(questions)
      .values({
        tenantId: record.tenantId,
        type: "structured",
        topicId: record.topicId,
        difficulty: record.difficulty,
        gradeLevel: record.gradeLevel,
        status: record.status ?? "approved",
        bodyTypst: record.bodyTypst,
        bodyHash: record.bodyHash,
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
   * Dedupe check (see `questions_tenant_id_body_hash_idx`) — scoped to the
   * EXACT `tenantId` a new row would be written to, not the central+tenant
   * visibility OR every other query here uses: a duplicate only matters
   * within the specific bank being written into.
   */
  async findByBodyHash(tenantId: string | null, bodyHash: string): Promise<{ id: string } | undefined> {
    const tenantMatch = tenantId === null ? isNull(questions.tenantId) : eq(questions.tenantId, tenantId);

    const [row] = await this.db
      .select({ id: questions.id })
      .from(questions)
      .where(and(tenantMatch, eq(questions.bodyHash, bodyHash)));

    return row;
  }

  /**
   * Visibility + filter rules live in `buildQuestionListConditions` (shared
   * with `countByCourseAndTopic`) — see its doc for the tenant-isolation
   * release gate.
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
    const where = and(...buildQuestionListConditions(filter));
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

    // Newest first, with `id` breaking ties. Both halves are load-bearing.
    // LIMIT/OFFSET over an UNORDERED scan lets Postgres return rows in
    // whatever physical order the heap is in, so the same row can appear on
    // two pages while another appears on none — and because the default
    // window is only the first 100 of a 64k bank, a question a teacher just
    // uploaded was simply never in it. `createdAt` alone is not enough
    // either: the collected bank is seeded in bulk, so thousands of rows
    // share a timestamp and ties would still shuffle between calls.
    const order = [desc(questions.createdAt), desc(questions.id)];

    if (!pagination) {
      return this.db
        .select(selection)
        .from(questions)
        .innerJoin(topics, eq(questions.topicId, topics.id))
        .where(where)
        .orderBy(...order);
    }

    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(questions)
      .innerJoin(topics, eq(questions.topicId, topics.id))
      .where(where);

    const items = await this.db
      .select(selection)
      .from(questions)
      .innerJoin(topics, eq(questions.topicId, topics.id))
      .where(where)
      .orderBy(...order)
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    return { items, total };
  }

  /**
   * Per-topic totals for the web bank tree's lazy skeleton
   * (`GET /bank/questions/summary`). Same `innerJoin(topics)` and the SAME
   * condition set `listQuestions` builds (shared via
   * `buildQuestionListConditions`) — that's not cosmetic reuse, it's the
   * invariant the UI leans on: a bucket's `total` must equal the row count
   * `listQuestions({...filter, topicId})` would return, or the tree would
   * show a count that the topic's own fetch never fills.
   *
   * `groupBy(topics.courseId, questions.topicId)` instead of pulling every
   * row and counting client-side: this is the query that replaced shipping
   * 64k question rows to the browser on every `/app/bank` load.
   */
  async countByCourseAndTopic(filter: QuestionListFilter): Promise<BankTopicQuestionCount[]> {
    const rows = await this.db
      .select({ courseId: topics.courseId, topicId: questions.topicId, total: count() })
      .from(questions)
      .innerJoin(topics, eq(questions.topicId, topics.id))
      .where(and(...buildQuestionListConditions(filter)))
      .groupBy(topics.courseId, questions.topicId);

    return rows.map((row) => ({
      courseId: row.courseId,
      topicId: row.topicId,
      total: Number(row.total),
    }));
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

    const [row] = await this.db
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
    const [row] = await this.db
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

    const [row] = await this.db
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

    const deleted = await this.db
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

    const [row] = await this.db
      .update(questions)
      .set({
        bodyTypst: patch.bodyTypst,
        bodyHash: hashBodyTypst(patch.bodyTypst),
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

    const [topicRow] = await this.db
      .select({ courseId: topics.courseId })
      .from(topics)
      .where(eq(topics.id, row.topicId));

    return { ...row, courseId: topicRow?.courseId ?? "" };
  }

  /**
   * FK existence check for `topicId` (design doc: question editing, review
   * fix). `questions.topic_id` references `topics.id` — a syntactically
   * valid but nonexistent `topicId` would otherwise reach the DB as a raw
   * FK-violation error. Called by the service UP FRONT, before any write, so
   * a bad `topicId` fails fast with a mapped 400 instead of leaving a
   * partial update behind.
   */
  async topicExists(topicId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId)).limit(1);
    return row !== undefined;
  }

  /**
   * FK existence + ownership check for `subtopicId` (design doc: bank
   * create validation, review fix) — used by the service to reject a
   * `subtopicId` that doesn't exist, or whose own `topic_id` doesn't match
   * the request's `topicId`, before any write.
   */
  async getSubtopicTopicId(subtopicId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ topicId: subtopics.topicId })
      .from(subtopics)
      .where(eq(subtopics.id, subtopicId))
      .limit(1);
    return row?.topicId;
  }

  /**
   * Atomically persists BOTH the structured content patch AND the taxonomy
   * patch for `editQuestion` (design doc: question editing, review fix) in a
   * single `db.transaction` — `updateStructuredQuestion` and taxonomy used
   * to be two independent sequential writes, so a taxonomy failure (e.g. a
   * bad FK) could leave the content half of the edit already committed.
   * Same tenant-visibility scoping as the other question writes in this
   * class. Only taxonomy fields present in `taxonomyPatch` are set; an empty
   * taxonomy patch skips that second `UPDATE` entirely.
   *
   * NOTE: `taxonomyPatch.courseId` is not a thing — `questions` has no
   * `course_id` column (see `questions.schema.ts`); a question's course is
   * always derived by joining `topics.course_id` via `topic_id`. Moving a
   * question to a different course means moving it to a topic under that
   * course, i.e. changing `topicId`.
   */
  async updateStructuredQuestionAndTaxonomy(
    id: string,
    currentTenantId: string | null,
    contentPatch: UpdateStructuredQuestionRecord,
    taxonomyPatch: { topicId?: string; difficulty?: string; gradeLevel?: string },
  ): Promise<QuestionListItem | undefined> {
    return this.db.transaction(async (tx) => {
      const visibility: SQL = currentTenantId
        ? (or(isNull(questions.tenantId), eq(questions.tenantId, currentTenantId)) as SQL)
        : (isNull(questions.tenantId) as SQL);

      const returning = {
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
      };

      const [row] = await tx
        .update(questions)
        .set({
          bodyTypst: contentPatch.bodyTypst,
          bodyHash: hashBodyTypst(contentPatch.bodyTypst),
          alternatives: contentPatch.alternatives,
          correctAnswer: contentPatch.correctAnswer,
          figureCode: contentPatch.figureCode,
        })
        .where(and(eq(questions.id, id), visibility))
        .returning(returning);

      if (!row) {
        return undefined;
      }

      const set: Partial<{ topicId: string; difficulty: Difficulty; gradeLevel: string }> = {};
      if (taxonomyPatch.topicId !== undefined) set.topicId = taxonomyPatch.topicId;
      if (taxonomyPatch.difficulty !== undefined) set.difficulty = taxonomyPatch.difficulty as Difficulty;
      if (taxonomyPatch.gradeLevel !== undefined) set.gradeLevel = taxonomyPatch.gradeLevel;

      let finalRow = row;
      if (Object.keys(set).length > 0) {
        const [taxRow] = await tx
          .update(questions)
          .set(set)
          .where(and(eq(questions.id, id), visibility))
          .returning(returning);
        if (taxRow) {
          finalRow = taxRow;
        }
      }

      const [topicRow] = await tx
        .select({ courseId: topics.courseId })
        .from(topics)
        .where(eq(topics.id, finalRow.topicId));

      return { ...finalRow, courseId: topicRow?.courseId ?? "" };
    });
  }

  /**
   * Edits an IMAGE question's taxonomy (`topicId`/`difficulty`/`gradeLevel`)
   * and/or its `correctAnswer` — the LETTER of the marked option (a/b/c/d),
   * NOT a 0-based index (image questions have no `alternatives` to index
   * into). Deliberately never touches `bodyTypst`/`alternatives`/`figureCode`
   * (all null on an image row) or the image asset itself (that is a separate
   * `POST /:id/image` flow). Only sets the fields actually provided in the
   * patch, tenant-visibility-scoped like every other write here. Returns the
   * refreshed `QuestionListItem` (course re-derived from `topics.course_id`),
   * or `undefined` if no row matched — the caller turns that into a 404.
   */
  async updateImageQuestionTaxonomyAndCorrectAnswer(
    id: string,
    currentTenantId: string | null,
    patch: { correctAnswer?: string; topicId?: string; difficulty?: string; gradeLevel?: string },
  ): Promise<QuestionListItem | undefined> {
    const visibility: SQL = currentTenantId
      ? (or(isNull(questions.tenantId), eq(questions.tenantId, currentTenantId)) as SQL)
      : (isNull(questions.tenantId) as SQL);

    const set: Partial<{ correctAnswer: string; topicId: string; difficulty: Difficulty; gradeLevel: string }> = {};
    if (patch.correctAnswer !== undefined) set.correctAnswer = patch.correctAnswer;
    if (patch.topicId !== undefined) set.topicId = patch.topicId;
    if (patch.difficulty !== undefined) set.difficulty = patch.difficulty as Difficulty;
    if (patch.gradeLevel !== undefined) set.gradeLevel = patch.gradeLevel;

    const returning = {
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
    };

    // Nothing to change: still verify the row exists+is visible (so the caller
    // gets a truthful 404 vs a silent success) by reading it back.
    const [row] =
      Object.keys(set).length > 0
        ? await this.db
            .update(questions)
            .set(set)
            .where(and(eq(questions.id, id), visibility))
            .returning(returning)
        : await this.db
            .select(returning)
            .from(questions)
            .where(and(eq(questions.id, id), visibility));

    if (!row) {
      return undefined;
    }

    const [topicRow] = await this.db
      .select({ courseId: topics.courseId })
      .from(topics)
      .where(eq(topics.id, row.topicId));

    return { ...row, courseId: topicRow?.courseId ?? "" };
  }

  /**
   * Swaps an image question's backing asset (Task 2, question editing):
   * inserts a NEW `assets` row (tenant-scoped, same as `createImageQuestion`)
   * then points the question's `imageAssetId` at it, in a single transaction
   * — so a failure between the two never leaves the question referencing a
   * half-written asset. Same tenant-visibility scoping as the other question
   * writes in this class. The old asset row is intentionally left in place
   * (no cleanup here — out of scope for this task, mirrors how no other
   * write path in this class deletes orphaned assets either). Returns the
   * question id, or `undefined` if no row matched (not found / not visible
   * to `currentTenantId`) — the caller (service) turns that into a 404.
   */
  async replaceImageAsset(
    id: string,
    currentTenantId: string | null,
    image: { readonly storageKey: string; readonly mime: string },
  ): Promise<string | undefined> {
    return this.db.transaction(async (tx) => {
      const [asset] = await tx
        .insert(assets)
        .values({
          tenantId: currentTenantId,
          storageKey: image.storageKey,
          mime: image.mime,
        })
        .returning({ id: assets.id });

      if (!asset) {
        throw new Error("Insert invariant violated: asset row missing after insert");
      }

      const visibility: SQL = currentTenantId
        ? (or(isNull(questions.tenantId), eq(questions.tenantId, currentTenantId)) as SQL)
        : (isNull(questions.tenantId) as SQL);

      const [row] = await tx
        .update(questions)
        .set({ imageAssetId: asset.id })
        .where(and(eq(questions.id, id), visibility))
        .returning({ id: questions.id });

      return row?.id;
    });
  }

  /**
   * All-or-nothing re-attachment of a structured question's per-alternative
   * images: re-checks tenant visibility (belt-and-suspenders, same as
   * `replaceImageAsset`), wipes any existing `question_alternative_images`
   * rows for this question, then inserts one fresh `assets` row + one
   * `question_alternative_images` row per entry in `images`, at its array
   * index — all inside a single transaction, so a failure partway never
   * leaves a mix of old and new images attached. The caller (service) has
   * already asserted `type='structured'` and `images.length ===
   * alternatives.length` before reaching here.
   */
  async setAlternativeImages(
    id: string,
    currentTenantId: string | null,
    images: readonly { readonly storageKey: string; readonly mime: string }[],
  ): Promise<string | undefined> {
    return this.db.transaction(async (tx) => {
      const visibility: SQL = currentTenantId
        ? (or(isNull(questions.tenantId), eq(questions.tenantId, currentTenantId)) as SQL)
        : (isNull(questions.tenantId) as SQL);

      const [question] = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(and(eq(questions.id, id), visibility));

      if (!question) {
        return undefined;
      }

      await tx.delete(questionAlternativeImages).where(eq(questionAlternativeImages.questionId, id));

      for (let index = 0; index < images.length; index++) {
        const image = images[index]!;
        const [asset] = await tx
          .insert(assets)
          .values({ tenantId: currentTenantId, storageKey: image.storageKey, mime: image.mime })
          .returning({ id: assets.id });

        if (!asset) {
          throw new Error("Insert invariant violated: asset row missing after insert");
        }

        await tx.insert(questionAlternativeImages).values({
          questionId: id,
          alternativeIndex: index,
          assetId: asset.id,
        });
      }

      return question.id;
    });
  }

  /**
   * Soft-remove: `approved` -> `archived` (Lane D4, S4). The caller (service)
   * has already resolved visibility + the `status='approved'` precondition
   * via `findQuestionById`, so this is a plain unconditional status flip.
   */
  async updateStatus(id: string, status: QuestionStatus): Promise<void> {
    await this.db.update(questions).set({ status }).where(eq(questions.id, id));
  }

  /**
   * Hard delete of a `draft` question (Lane D4, S5). The caller (service)
   * has already resolved visibility + the `status='draft'` precondition via
   * `requireVisibleDraft`.
   */
  async deleteQuestion(id: string): Promise<void> {
    await this.db.delete(questions).where(eq(questions.id, id));
  }

  /**
   * Dashboard aggregate (design doc §2): one grouped count per
   * {difficulty, status} pair, visible to `tenantId` — SAME visibility
   * predicate as `listQuestions`/`findQuestionById` (`tenant_id IS NULL OR
   * tenant_id = :current`, or `IS NULL` only for platform staff). Mirrors
   * `ExamsRepository.countStock()`'s `groupBy` + `count()` shape.
   */
  async countByDifficultyAndStatus(tenantId: string | null): Promise<BankStatusDifficultyCount[]> {
    const visibility: SQL = tenantId
      ? (or(isNull(questions.tenantId), eq(questions.tenantId, tenantId)) as SQL)
      : (isNull(questions.tenantId) as SQL);

    const rows = await this.db
      .select({ difficulty: questions.difficulty, status: questions.status, total: count() })
      .from(questions)
      .where(visibility)
      .groupBy(questions.difficulty, questions.status);

    return rows.map((row) => ({ difficulty: row.difficulty, status: row.status, total: Number(row.total) }));
  }
}
