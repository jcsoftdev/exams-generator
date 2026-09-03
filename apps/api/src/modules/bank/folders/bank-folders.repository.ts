import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Database, DRIZZLE_DB } from "../../../db/client";
import { courses, questionFolders, questions, tenants, topics } from "../../../db/schema";
import { FlatFolderRow } from "./domain/assemble-folder-tree";
import { SeedCourseRow, SeedFolderPlanNode, SeedTopicRow } from "./domain/build-seed-folder-plan";

@Injectable()
export class BankFoldersRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

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
