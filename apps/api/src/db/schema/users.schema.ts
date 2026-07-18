import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { roleEnum } from "./enums";
import { tenants } from "./tenants.schema";

/**
 * `tenant_id NULL` = platform staff (`platform_admin`, `content_editor` —
 * global scope, per design doc §2). Non-null = scoped to that tenant
 * (`school_admin`, `teacher`). The role/tenant pairing itself is enforced
 * by the auth module (PR5+), not by a DB constraint here.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
