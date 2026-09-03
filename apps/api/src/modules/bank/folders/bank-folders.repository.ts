import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";
import { Database, DRIZZLE_DB } from "../../../db/client";
import { courses, questionFolders, questions, tenants, topics } from "../../../db/schema";
import { FlatFolderRow } from "./domain/assemble-folder-tree";
import { SeedCourseRow, SeedFolderPlanNode, SeedTopicRow } from "./domain/build-seed-folder-plan";

/**
 * Postgres `23505 unique_violation`. The sibling-name rule is enforced by two
 * unique indexes rather than a SELECT-then-INSERT, so the race between two tabs
 * creating "Álgebra" at the same instant ends in a clean 409 instead of two
 * folders with the same name. `pg` surfaces the code on the error object.
 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

@Injectable()
export class BankFoldersRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async findFolder(tenantId: string, id: string): Promise<FlatFolderRow | undefined> {
    const [row] = await this.db
      .select({
        id: questionFolders.id,
        name: questionFolders.name,
        parentId: questionFolders.parentId,
        topicId: questionFolders.topicId,
        position: questionFolders.position,
      })
      .from(questionFolders)
      .where(and(eq(questionFolders.id, id), eq(questionFolders.tenantId, tenantId)))
      .limit(1);

    return row;
  }

  /**
   * How deep a folder sits: 1 for a root, 2 for its child, and so on. Walks
   * UPWARD through `parent_id` with a recursive CTE — cheap (the cap is 6) and,
   * more importantly, scoped to the tenant at the anchor so a crafted id from
   * another school can never be walked.
   */
  async folderDepth(tenantId: string, id: string): Promise<number> {
    const result = await this.db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id, 1 AS depth
          FROM question_folders
         WHERE id = ${id} AND tenant_id = ${tenantId}
        UNION ALL
        SELECT f.id, f.parent_id, c.depth + 1
          FROM question_folders f
          JOIN chain c ON f.id = c.parent_id
      )
      SELECT COALESCE(MAX(depth), 0)::int AS depth FROM chain
    `);
    return Number((result.rows[0] as { depth: number } | undefined)?.depth ?? 0);
  }

  /** Next free `position` among the siblings of `parentId` — new folders go last. */
  async nextPosition(tenantId: string, parentId: string | null): Promise<number> {
    const [row] = await this.db
      .select({ highest: max(questionFolders.position) })
      .from(questionFolders)
      .where(
        and(
          eq(questionFolders.tenantId, tenantId),
          parentId === null ? isNull(questionFolders.parentId) : eq(questionFolders.parentId, parentId),
        ),
      );

    return row?.highest === null || row?.highest === undefined ? 0 : Number(row.highest) + 1;
  }

  async insertFolder(row: {
    tenantId: string;
    parentId: string | null;
    name: string;
    position: number;
  }): Promise<FlatFolderRow> {
    const [inserted] = await this.db.insert(questionFolders).values(row).returning({
      id: questionFolders.id,
      name: questionFolders.name,
      parentId: questionFolders.parentId,
      topicId: questionFolders.topicId,
      position: questionFolders.position,
    });

    return inserted!;
  }

  async listFolders(tenantId: string): Promise<FlatFolderRow[]> {
    return this.db
      .select({
        id: questionFolders.id,
        name: questionFolders.name,
        parentId: questionFolders.parentId,
        topicId: questionFolders.topicId,
        position: questionFolders.position,
      })
      .from(questionFolders)
      .where(eq(questionFolders.tenantId, tenantId));
  }

  /**
   * Cheap, UNLOCKED read of the seeding marker — the fast path every call to
   * `GET /bank/folders` takes on every request after the first. Deliberately
   * outside a transaction and takes no row lock: the service only escalates to
   * `seedIfNeeded`'s `FOR UPDATE` path when this comes back `null`, so an
   * already-seeded tenant (the overwhelming majority of requests) never loads
   * the whole taxonomy or waits on a lock it doesn't need.
   */
  async getFoldersSeededAt(tenantId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ seededAt: tenants.foldersSeededAt })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return row?.seededAt ?? null;
  }

  /** The whole global taxonomy the seed plan is built from. Two flat reads, no join. */
  async loadSeedSource(): Promise<{ courses: SeedCourseRow[]; topics: SeedTopicRow[] }> {
    const [courseRows, topicRows] = await Promise.all([
      this.db.select({ id: courses.id, name: courses.name, stage: courses.stage }).from(courses),
      this.db
        .select({
          id: topics.id,
          courseId: topics.courseId,
          name: topics.name,
          gradeLevel: topics.gradeLevel,
        })
        .from(topics),
    ]);
    return { courses: courseRows, topics: topicRows };
  }

  /**
   * Seeds the tenant's default folder set, exactly once, ever.
   *
   * The whole thing runs inside ONE transaction that opens with
   * `SELECT … FOR UPDATE` on the tenant row: two browser tabs hitting
   * `GET /bank/folders` at the same moment both reach here, and the row lock is
   * what makes the second one WAIT for the first to commit and then read a
   * non-null `folders_seeded_at` — instead of both inserting the plan and the
   * unique indexes turning a race into a 500.
   */
  async seedIfNeeded(tenantId: string, plan: readonly SeedFolderPlanNode[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ seededAt: tenants.foldersSeededAt })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for("update");

      if (!locked || locked.seededAt !== null) {
        return;
      }

      const idByKey = new Map<string, string>();
      // Sequential on purpose: a child's `parent_id` is the id its parent just
      // returned, and `buildSeedFolderPlan` guarantees parents come first.
      for (const node of plan) {
        const [inserted] = await tx
          .insert(questionFolders)
          .values({
            tenantId,
            parentId: node.parentKey === null ? null : (idByKey.get(node.parentKey) ?? null),
            name: node.name,
            topicId: node.topicId,
            position: node.position,
          })
          .returning({ id: questionFolders.id });
        idByKey.set(node.key, inserted!.id);
      }

      await tx.update(tenants).set({ foldersSeededAt: new Date() }).where(eq(tenants.id, tenantId));
    });
  }

  /** `folder_id -> count` over the tenant's OWN questions. One GROUP BY, never one query per folder. */
  async countOwnByFolder(tenantId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ folderId: questions.folderId, total: count() })
      .from(questions)
      .where(and(eq(questions.tenantId, tenantId), isNotNull(questions.folderId)))
      .groupBy(questions.folderId);

    // `isNotNull` above is a runtime WHERE clause, not something Drizzle's
    // types narrow `folderId: string | null` on — the cast reflects what the
    // filter actually guarantees, not what the compiler can infer.
    return new Map(rows.map((row) => [row.folderId as string, Number(row.total)]));
  }

  /** `topic_id -> count` over CENTRAL questions only, restricted to the topics this tenant's folders link to. */
  async countCentralByTopic(topicIds: readonly string[]): Promise<Map<string, number>> {
    if (topicIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ topicId: questions.topicId, total: count() })
      .from(questions)
      .where(and(isNull(questions.tenantId), inArray(questions.topicId, [...topicIds])))
      .groupBy(questions.topicId);

    return new Map(rows.map((row) => [row.topicId, Number(row.total)]));
  }

  async countUnfiled(tenantId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(questions)
      .where(and(eq(questions.tenantId, tenantId), isNull(questions.folderId)));

    return Number(row?.total ?? 0);
  }
}
