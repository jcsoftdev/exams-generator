import { Difficulty } from "@exams-generator/shared";
import { and, eq, isNull, or, SQL } from "drizzle-orm";
import { db } from "../../db/client";
import { assets, questions, topics } from "../../db/schema";

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

export interface QuestionListItem {
  readonly id: string;
  readonly tenantId: string | null;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly correctAnswer: string;
  readonly imageAssetId: string | null;
}

export interface QuestionListFilter {
  /** The requesting user's own tenant (null = platform staff). */
  readonly currentTenantId: string | null;
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly gradeLevel?: string;
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
   * Visibility rule (design doc §3, MUST release gate): every query filters
   * `tenant_id IS NULL OR tenant_id = :current` — a tenant NEVER sees
   * another tenant's private questions. `currentTenantId: null` (platform
   * staff) resolves to `tenant_id IS NULL` only, since there is no "current
   * tenant" whose private rows staff should see by default.
   */
  async listQuestions(filter: QuestionListFilter): Promise<QuestionListItem[]> {
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

    return db
      .select({
        id: questions.id,
        tenantId: questions.tenantId,
        courseId: topics.courseId,
        topicId: questions.topicId,
        difficulty: questions.difficulty,
        gradeLevel: questions.gradeLevel,
        correctAnswer: questions.correctAnswer,
        imageAssetId: questions.imageAssetId,
      })
      .from(questions)
      .innerJoin(topics, eq(questions.topicId, topics.id))
      .where(and(...conditions));
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
        imageAssetId: questions.imageAssetId,
      })
      .from(questions)
      .innerJoin(topics, eq(questions.topicId, topics.id))
      .where(and(eq(questions.id, id), visibility));

    return row;
  }
}
