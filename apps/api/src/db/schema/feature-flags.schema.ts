import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.schema";
import { users } from "./users.schema";

/**
 * The platform kill switch — one row per feature the superadmin has cut.
 *
 * There is deliberately NO tenant column here. The alternative considered
 * was a single table where `tenant_id IS NULL` meant "platform row",
 * mirroring the `questions.tenant_id IS NULL` convention. It was rejected on
 * a hard fact about the ORM: drizzle 0.33 exposes `.nullsNotDistinct()` on
 * the table-level `unique()` builder ONLY, never on `uniqueIndex()` — and
 * `questions.schema.ts`, the very shape that design would have copied, uses
 * `uniqueIndex` and RELIES on NULLs being distinct. Copying it would have
 * made several "platform" rows per key legal without a word of complaint
 * from Drizzle or the generated migration, leaving the resolver to read
 * whichever one Postgres handed back first.
 *
 * Splitting the layers into two tables makes that class of bug unreachable:
 * this table cannot be queried with a tenant id by accident, because it has
 * nowhere to put one.
 *
 * ABSENCE MEANS ENABLED. This layer only ever takes things away — a missing
 * row means "nobody cut this", which is the opposite of the tenant layer's
 * default. See `FEATURE_FLAG_DEFAULTS` in `@exams-generator/shared`.
 */
export const platformFeatureFlags = pgTable("platform_feature_flags", {
  /** A `FeatureFlag` value. The catalog lives in code, never here. */
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * Nullable with `SET NULL` rather than a plain FK: users are normally
   * tombstoned (`users.repository.ts`), but `TenantsService.remove` hard
   * deletes a tenant's users, and the specs delete users freely. A hard FK
   * here would turn "delete this school" into a foreign-key violation.
   */
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

/**
 * One school's override for one feature. A row exists ONLY where somebody
 * decided something other than `FEATURE_FLAG_DEFAULTS[key]`.
 *
 * That is why the migration seeds nothing. The rejected alternative —
 * "no row means off", with a migration seeding `true` for existing tenants —
 * would have silently stripped every tenant created afterwards:
 * `TenantsService.create` is a bare insert with no hook, the dev seed builds
 * its demo tenant the same way, and 26 e2e specs insert tenants directly.
 *
 * `ON DELETE CASCADE` covers the FK, but `TenantsService.remove` deletes by
 * hand in a fixed order and must delete these rows too — the rest of that
 * method does not lean on cascades, and a silent exception there is how a
 * tenant delete starts failing months later.
 */
export const tenantFeatureFlags = pgTable(
  "tenant_feature_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** A `FeatureFlag` value. The catalog lives in code, never here. */
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Same `SET NULL` reasoning as `platform_feature_flags.updated_by`. */
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    /**
     * `tenant_id` is NOT NULL, so this is an ordinary unique index — no
     * `NULLS NOT DISTINCT`, no `isNull()` branching at the call sites. That
     * plainness is the whole point of the two-table split.
     */
    tenantKeyUq: unique("tenant_feature_flags_tenant_id_key_uq").on(table.tenantId, table.key),
  }),
);
