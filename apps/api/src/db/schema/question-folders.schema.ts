import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.schema";
import { topics } from "./topics.schema";

/**
 * A tenant's OWN folder tree over the question bank — never global, never
 * shared. The global taxonomy (`courses` -> `topics` -> `subtopics`) is
 * untouched and stays the official classification the exam builder and the AI
 * read; this table is the school's private filing cabinet on top of it.
 *
 * `parent_id` is the self-reference, resolved through Drizzle's documented
 * lazy `(): AnyPgColumn => questionFolders.id` callback (same pattern as
 * `tenants.logo_asset_id`). `ON DELETE CASCADE` on BOTH FKs is load-bearing:
 * dropping a tenant drops its whole cabinet, and deleting a folder deletes its
 * subtree in one statement instead of a recursive delete in application code.
 *
 * `topic_id` is set only on folders seeded from a topic and is what makes a
 * CENTRAL-bank question (`questions.tenant_id IS NULL`) visible inside a
 * tenant's folder without belonging to it — a central question can never carry
 * a `folder_id`, since folders are per-tenant and the central bank is shared.
 * `ON DELETE SET NULL`: retiring a topic from the taxonomy must not delete a
 * school's folder or unfile its questions.
 */
export const questionFolders = pgTable(
  "question_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => questionFolders.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
    /** Order among siblings. Seeded folders follow the seed order; new ones go last. */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * Sibling uniqueness for NON-root folders. Postgres treats every NULL as
     * distinct in a unique index, so this one silently permits any number of
     * same-named ROOTS — which is why the partial index below exists. Same
     * NULL-distinct trap `topics_course_id_slug_grade_idx` documents.
     */
    siblingNameIdx: uniqueIndex("question_folders_sibling_name_idx").on(
      table.tenantId,
      table.parentId,
      table.name,
    ),
    /** The root half of the rule above — the case the plain unique index cannot cover. */
    rootNameIdx: uniqueIndex("question_folders_root_name_idx")
      .on(table.tenantId, table.name)
      .where(sql`${table.parentId} is null`),
    /**
     * One topic maps to at most ONE folder per tenant, so a central question
     * surfaces in exactly one place in the tree. Partial (`topic_id IS NOT
     * NULL`) because every hand-made folder has a NULL topic and they must not
     * collide with each other.
     */
    tenantTopicIdx: uniqueIndex("question_folders_tenant_topic_idx")
      .on(table.tenantId, table.topicId)
      .where(sql`${table.topicId} is not null`),
    /** Loading one level of children, and the recursive CTEs that walk the tree. */
    parentIdx: index("question_folders_tenant_parent_idx").on(table.tenantId, table.parentId),
  }),
);
