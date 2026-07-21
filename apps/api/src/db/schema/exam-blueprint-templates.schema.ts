import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants.schema";
import { tracks } from "./tracks.schema";
import { universities } from "./universities.schema";

/**
 * The "recipe" of course + weight for a (university, track?) pair — what an
 * `exam_type` with `course_scope != 'none'` resolves against (design doc
 * §4). `track_id NULL` means the template applies to the whole university
 * (no track grouping); a non-null value scopes it to one `tracks` row.
 *
 * `tenant_id NULL` = platform-wide default template, visible to every
 * tenant; non-null = that tenant's own override for the same
 * (university, track) pair — same nullable-FK-as-visibility-scope pattern
 * as `questions.tenant_id`.
 *
 * `cycle_label` is free-text provenance ("2026-II") — where this data came
 * from, not a foreign key to `cycles` (Fase 3, not built yet).
 *
 * A plain `UNIQUE (university_id, track_id, tenant_id)` does not work as
 * intended here because Postgres treats `NULL <> NULL`, so two rows that
 * are both "global default, no track" would never collide. Instead we use a
 * unique partial index over an expression that folds NULL into a sentinel
 * UUID via `COALESCE`, scoped to `is_current = true` (design doc §4 gives
 * this SQL verbatim). `check()`/`.where()` with raw `sql` are natively
 * supported by the installed drizzle-orm (^0.33.0 — see `pg-core/checks.ts`
 * and `IndexBuilder.where()`), so this is expressed directly in the schema
 * builder rather than as a follow-up manual migration statement.
 */
export const examBlueprintTemplates = pgTable(
  "exam_blueprint_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: uuid("university_id")
      .notNull()
      .references(() => universities.id),
    trackId: uuid("track_id").references(() => tracks.id),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    cycleLabel: text("cycle_label").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    currentIdx: uniqueIndex("exam_blueprint_templates_current_idx")
      .on(
        table.universityId,
        sql`coalesce(${table.trackId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${table.tenantId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.isCurrent} = true`),
  }),
);
