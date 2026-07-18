import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Role } from "@exams-generator/shared";
import { db, pool } from "../db/client";
import { runMigrations } from "../db/migrate";
import { assets, courses, gradeLevels, questions, tenants, topics, users } from "../db/schema";
import { GRADE_LEVELS } from "../modules/exams/domain/value-objects/grade-level";
import { hashPassword } from "../modules/auth/password.util";

/**
 * Shared test-only helpers for e2e specs that hit the real docker-compose
 * Postgres (mirrors the pattern already used by `seed-idempotency.spec.ts`).
 * Every fixture uses a random suffix so concurrent/repeated test runs never
 * collide on unique columns (`users.email`, `tenants.slug`, ...).
 */

export async function ensureMigrated(): Promise<void> {
  await runMigrations();
}

export async function closeDbPool(): Promise<void> {
  await pool.end();
}

export interface TenantFixture {
  id: string;
  name: string;
  slug: string;
}

export async function createTenantFixture(overrides?: Partial<TenantFixture>): Promise<TenantFixture> {
  const slug = overrides?.slug ?? `test-tenant-${randomUUID()}`;
  const name = overrides?.name ?? slug;

  const [tenant] = await db.insert(tenants).values({ name, slug }).returning();
  if (!tenant) {
    throw new Error("Fixture invariant violated: tenant insert returned no row");
  }
  return { id: tenant.id, name: tenant.name, slug: tenant.slug };
}

export interface UserFixture {
  id: string;
  email: string;
  role: Role;
  tenantId: string | null;
  plainPassword: string;
}

export async function createUserFixture(params: {
  role: Role;
  tenantId: string | null;
  email?: string;
  password?: string;
}): Promise<UserFixture> {
  const email = params.email ?? `${randomUUID()}@test.local`;
  const plainPassword = params.password ?? "correct-horse-battery-staple";
  const passwordHash = await hashPassword(plainPassword);

  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, role: params.role, tenantId: params.tenantId })
    .returning();

  if (!user) {
    throw new Error("Fixture invariant violated: user insert returned no row");
  }

  return { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId, plainPassword };
}

export async function deleteUserFixture(id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}

/**
 * Deletes a tenant fixture, clearing `logoAssetId` and any `assets` rows
 * that reference it first — otherwise the FK constraints from
 * `tenants.logo_asset_id` and `assets.tenant_id` reject the delete (e.g.
 * after a logo-upload test leaves an asset behind).
 */
export async function deleteTenantFixture(id: string): Promise<void> {
  await db.update(tenants).set({ logoAssetId: null }).where(eq(tenants.id, id));
  await db.delete(assets).where(eq(assets.tenantId, id));
  await db.delete(tenants).where(eq(tenants.id, id));
}

export interface TopicFixture {
  id: string;
  courseId: string;
}

/** Reuses (or creates) a demo course/topic pair — courses/topics are global taxonomy, never tenant-scoped. */
export async function ensureTopicFixture(): Promise<TopicFixture> {
  const courseName = `Test Course ${randomUUID()}`;
  const [course] = await db.insert(courses).values({ name: courseName }).returning();
  if (!course) {
    throw new Error("Fixture invariant violated: course insert returned no row");
  }

  const [topic] = await db
    .insert(topics)
    .values({ courseId: course.id, name: `Test Topic ${randomUUID()}` })
    .returning();
  if (!topic) {
    throw new Error("Fixture invariant violated: topic insert returned no row");
  }

  return { id: topic.id, courseId: course.id };
}

export async function deleteTopicAndCourseFixture(fixture: TopicFixture): Promise<void> {
  await db.delete(topics).where(eq(topics.id, fixture.id));
  await db.delete(courses).where(eq(courses.id, fixture.courseId));
}

/**
 * Seeds the fixed `grade_levels` catalog if missing (idempotent, same
 * `onConflictDoNothing` pattern as `db/seed.ts`'s `seedGradeLevels`) — bank
 * e2e specs need real rows for the `questions.grade_level` FK, and can't
 * assume `db/seed.ts` already ran in this test process/worker.
 */
export async function ensureGradeLevelsSeeded(): Promise<void> {
  const rows = GRADE_LEVELS.map((code, index) => ({ code, sortOrder: index }));
  await db.insert(gradeLevels).values(rows).onConflictDoNothing({ target: gradeLevels.code });
}

/**
 * Deletes a question fixture created via the bank upload endpoint,
 * including its `imageAssetId` asset row — must run before deleting the
 * question's tenant/topic/course fixtures (FK ordering).
 */
export async function deleteQuestionFixture(id: string): Promise<void> {
  const [question] = await db.select().from(questions).where(eq(questions.id, id));
  await db.delete(questions).where(eq(questions.id, id));
  if (question?.imageAssetId) {
    await db.delete(assets).where(eq(assets.id, question.imageAssetId));
  }
}
