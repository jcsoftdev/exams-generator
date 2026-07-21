import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { universities } from "./universities.schema";

/**
 * Global catalog, optional per university — generalizes "area by career"
 * (UNCP: I-V, career-based admission areas) and "prep-cycle track" (UNI:
 * Básico/Preuniversitario/Intensivo, calendar-based preparation tracks)
 * into one concept, since neither semantic can be forced onto the other
 * (design doc §3.1). `kind` is purely descriptive for UI labeling — it
 * never affects resolution/query logic. A university with no need for this
 * grouping simply has zero `tracks` rows; everything downstream uses
 * `track_id = NULL`.
 */
export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: uuid("university_id")
      .notNull()
      .references(() => universities.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
  },
  (table) => ({
    universityIdCodeIdx: uniqueIndex("tracks_university_id_code_idx").on(
      table.universityId,
      table.code,
    ),
  }),
);
