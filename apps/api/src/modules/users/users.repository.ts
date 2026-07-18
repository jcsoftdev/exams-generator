import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { users } from "../../db/schema";

export interface TenantUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly active: boolean;
  readonly createdAt: string;
}

export class UsersRepository {
  async listByTenant(tenantId: string): Promise<TenantUser[]> {
    const rows = await db.select().from(users).where(eq(users.tenantId, tenantId));
    return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, active: r.active, createdAt: r.createdAt.toISOString() }));
  }

  async findByIdInTenant(id: string, tenantId: string) {
    const [row] = await db.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
    return row;
  }

  async findByEmail(email: string) {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return row;
  }

  async create(tenantId: string, email: string, role: string, passwordHash: string): Promise<{ id: string }> {
    const [row] = await db.insert(users).values({ tenantId, email, passwordHash, role: role as never }).returning({ id: users.id });
    return row!;
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await db.update(users).set({ active }).where(eq(users.id, id));
  }

  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await db.update(users).set({ passwordHash }).where(eq(users.id, id));
  }
}
