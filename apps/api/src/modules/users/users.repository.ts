import type { PagedTenantUsers, Role } from "@exams-generator/shared";
import { and, count, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { exams, generationJobs, questions, users } from "../../db/schema";

/**
 * `TenantUser`/`PagedTenantUsers` used to be declared here a second time
 * (`role` typed as a bare `string`, drifting from the `roleEnum` Postgres
 * column) on top of the web's own copy — now both come from
 * `@exams-generator/shared` (audit 2026-08-21, M4b).
 */
export class UsersRepository {
  async listByTenant(tenantId: string, page: number, pageSize: number): Promise<PagedTenantUsers> {
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.tenantId, tenantId));
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

  /**
   * How much of the platform carries this person's name (Ley 29733 access
   * request; audit M10). Counts, not content: an exam belongs to the school,
   * but how much of it they authored is the question being asked.
   */
  async countAuthored(userId: string): Promise<{ questions: number; exams: number; generationJobs: number }> {
    const [[q], [e], [j]] = await Promise.all([
      db.select({ value: count() }).from(questions).where(eq(questions.createdBy, userId)),
      db.select({ value: count() }).from(exams).where(eq(exams.createdBy, userId)),
      db.select({ value: count() }).from(generationJobs).where(eq(generationJobs.createdBy, userId)),
    ]);
    return { questions: q!.value, exams: e!.value, generationJobs: j!.value };
  }

  /**
   * Strips the person out of the row without deleting it (Ley 29733
   * cancellation; audit M10). The row survives because
   * `questions.created_by`/`exams.created_by` point at it and the school's
   * work must outlive the teacher — but nothing identifying stays.
   *
   * The password is replaced with a value that is not a valid hash, so it can
   * never match anything `comparePassword` is given: no login, and no
   * "reset it back" either.
   */
  async anonymize(id: string, tenantId: string, tombstoneEmail: string): Promise<void> {
    await db
      .update(users)
      .set({ email: tombstoneEmail, name: null, passwordHash: "anonymized-no-login", active: false })
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
  }

  async findByIdInTenant(id: string, tenantId: string) {
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
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

  async create(
    tenantId: string,
    email: string,
    name: string,
    role: Role,
    passwordHash: string,
  ): Promise<{ id: string }> {
    const [row] = await db
      .insert(users)
      .values({ tenantId, email, name, passwordHash, role: role as never })
      .returning({ id: users.id });
    return row!;
  }

  async setActive(id: string, tenantId: string, active: boolean): Promise<void> {
    await db
      .update(users)
      .set({ active })
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
  }

  async setPasswordHash(id: string, tenantId: string, passwordHash: string): Promise<void> {
    await db
      .update(users)
      .set({ passwordHash })
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
  }
}
