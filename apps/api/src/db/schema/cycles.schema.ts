import { boolean, date, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants.schema";
import { tracks } from "./tracks.schema";
import { universities } from "./universities.schema";

/**
 * Tracks the active admission-prep calendar for a (university, track?) pair
 * — what "current week" resolves against for `eta_by_week` (design doc §4,
 * §3.3). Deliberately decoupled from `exam_blueprint_templates`: a cycle
 * references `university_id` + `track_id?` directly, never a specific
 * `template_id`, because the calendar and the weighting table change on
 * independent schedules (design doc §3.4) — the vigent template is resolved
 * separately (`WHERE is_current = true`) at generation time.
 *
 * `currentWeek` is NEVER a stored column — it's a pure derivation in domain
 * code: `floor((today - starts_on) / week_length_days)` (design doc §3.3).
 * Storing it would need a cron to keep it in sync for zero benefit.
 *
 * `tenant_id NULL` = global default cycle shared by every tenant; non-null =
 * that tenant's own calendar override for the same (university, track) pair
 * — same nullable-FK-as-visibility-scope pattern as
 * `exam_blueprint_templates.tenant_id`.
 *
 * Same COALESCE-based partial unique index pattern as
 * `exam_blueprint_templates` (see that file for why a plain UNIQUE doesn't
 * work with nullable columns), but over a different column set:
 * `(tenant_id, university_id, track_id) WHERE is_active = true` (design doc
 * §4).
 */
export const cycles = pgTable(
  "cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    universityId: uuid("university_id")
      .notNull()
      .references(() => universities.id),
    trackId: uuid("track_id").references(() => tracks.id),
    label: text("label").notNull(),
    startsOn: date("starts_on", { mode: "date" }).notNull(),
    weekLengthDays: integer("week_length_days").notNull().default(7),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => ({
    activeIdx: uniqueIndex("cycles_active_idx")
      .on(
        sql`coalesce(${table.tenantId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        table.universityId,
        sql`coalesce(${table.trackId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.isActive} = true`),
  }),
);
