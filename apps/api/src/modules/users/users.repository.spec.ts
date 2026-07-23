import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { tenants, users } from "../../db/schema";
import { UsersRepository } from "./users.repository";

/**
 * Integration test against the real docker-compose Postgres — same pattern
 * as `bank.repository.spec.ts`. Every fixture uses a random suffix so
 * repeated runs never collide, and `afterAll` deletes everything this file
 * created so the shared dev DB doesn't grow unbounded.
 */
describe("UsersRepository", () => {
  const repository = new UsersRepository();

  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    await runMigrations();

    const suffix = randomUUID();

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `Tenant A ${suffix}`, slug: `tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `Tenant B ${suffix}`, slug: `tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [userA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "original-hash",
        role: Role.Teacher,
        active: true,
      })
      .returning({ id: users.id });
    userAId = userA!.id;

    const [userB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `teacher-b-${suffix}@exams-generator.test`,
        passwordHash: "original-hash",
        role: Role.Teacher,
        active: true,
      })
      .returning({ id: users.id });
    userBId = userB!.id;
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.id, [userAId, userBId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
  });

  describe("setActive", () => {
    it("does not affect a user in a different tenant", async () => {
      await repository.setActive(userBId, tenantAId, false);

      const [row] = await db.select({ active: users.active }).from(users).where(inArray(users.id, [userBId]));
      expect(row!.active).toBe(true);
    });

    it("updates the user when the tenant matches", async () => {
      await repository.setActive(userAId, tenantAId, false);

      const [row] = await db.select({ active: users.active }).from(users).where(inArray(users.id, [userAId]));
      expect(row!.active).toBe(false);
    });
  });

  describe("setPasswordHash", () => {
    it("does not affect a user in a different tenant", async () => {
      await repository.setPasswordHash(userBId, tenantAId, "attacker-controlled-hash");

      const [row] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(inArray(users.id, [userBId]));
      expect(row!.passwordHash).toBe("original-hash");
    });

    it("updates the user when the tenant matches", async () => {
      await repository.setPasswordHash(userAId, tenantAId, "new-hash");

      const [row] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(inArray(users.id, [userAId]));
      expect(row!.passwordHash).toBe("new-hash");
    });
  });
});
