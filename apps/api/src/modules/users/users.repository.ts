import { and, count, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { users } from "../../db/schema";

export interface TenantUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: string;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface PagedTenantUsers {
  readonly items: readonly TenantUser[];
  readonly total: number;
}

export class UsersRepository {
  async listByTenant(tenantId: string, page: number, pageSize: number): Promise<PagedTenantUsers> {
    const [{ value: total }] = await db.select({ value: count() }).from(users).where(eq(users.tenantId, tenantId));
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.tenantId, tenantId))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return {
      items: rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role,
        active: r.active,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    };
  }

  async findByIdInTenant(id: string, tenantId: string) {
    const [row] = await db.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
    return row;
  }

  /**
   * Deliberately NOT tenant-scoped: `users.email` has a GLOBAL unique
   * constraint (see `users.schema.ts`) and login is email+password with no
   * tenant context, so an email identifies one account across the whole
   * platform. Do NOT "fix" this into a per-tenant lookup without changing
   * the schema constraint AND the login flow too — a scoped lookup here
   * would just move the failure to a raw unique-violation 500 at insert.
   */
  async findByEmail(email: string) {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return row;
  }

  async create(tenantId: string, email: string, name: string, role: string, passwordHash: string): Promise<{ id: string }> {
    const [row] = await db
      .insert(users)
      .values({ tenantId, email, name, passwordHash, role: role as never })
      .returning({ id: users.id });
    return row!;
  }

  async setActive(id: string, tenantId: string, active: boolean): Promise<void> {
    await db.update(users).set({ active }).where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
  }

  async setPasswordHash(id: string, tenantId: string, passwordHash: string): Promise<void> {
    await db.update(users).set({ passwordHash }).where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
  }
}
