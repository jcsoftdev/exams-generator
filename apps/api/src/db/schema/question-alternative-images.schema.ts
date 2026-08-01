import { index, integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { assets } from "./assets.schema";
import { questions } from "./questions.schema";

/**
 * One image attached to a single alternative slot of a `type='structured'`
 * question — distinct from `questions.image_asset_id` (the ONE complement/
 * whole-question image). `alternative_index` is 0-based and matches the
 * position in `questions.alternatives`. `ON DELETE CASCADE` on `question_id`
 * so a deleted draft question never leaves orphaned rows here. Re-attaching
 * an alternative's image replaces the row at that slot (delete+insert in a
 * transaction) rather than accumulating history — see
 * `BankRepository.setAlternativeImages`.
 */
export const questionAlternativeImages = pgTable(
  "question_alternative_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    alternativeIndex: integer("alternative_index").notNull(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    questionIdIdx: index("question_alternative_images_question_id_idx").on(table.questionId),
    // One image per alternative slot — re-attaching replaces, never duplicates.
    questionIdAlternativeIndexIdx: uniqueIndex(
      "question_alternative_images_question_id_alternative_index_idx",
    ).on(table.questionId, table.alternativeIndex),
  }),
);
