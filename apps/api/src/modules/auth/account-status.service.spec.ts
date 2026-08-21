import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db/client";
import { users } from "../../db/schema";
import {
  createTenantFixture,
  createUserFixture,
  deleteTenantFixture,
  deleteUserFixture,
  ensureMigrated,
  type TenantFixture,
} from "../../test-utils/db-fixtures";
import { ACCOUNT_STATUS_TTL_MS, AccountStatusService } from "./account-status.service";

/**
 * Integration test against the real docker-compose Postgres: the lookup is
 * half of what this service does, and the other half (the cache) is only
 * interesting relative to a real read.
 */
describe("AccountStatusService", () => {
  let tenant: TenantFixture;
  let userId: string;
  let service: AccountStatusService;

  beforeAll(async () => {
    await ensureMigrated();
    tenant = await createTenantFixture();
    const user = await createUserFixture({ tenantId: tenant.id, role: Role.Teacher });
    userId = user.id;
  });

  afterAll(async () => {
    await deleteUserFixture(userId);
    await deleteTenantFixture(tenant.id);
    await pool.end();
  });

  beforeEach(() => {
    service = new AccountStatusService();
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await db.update(users).set({ active: true }).where(eq(users.id, userId));
  });

  it("accepts an active account", async () => {
    await expect(service.isUsable(userId)).resolves.toBe(true);
  });

  it("rejects an account that no longer exists", async () => {
    await expect(service.isUsable(randomUUID())).resolves.toBe(false);
  });

  it("rejects a deactivated account once the cached answer expires", async () => {
    await service.isUsable(userId);
    await db.update(users).set({ active: false }).where(eq(users.id, userId));

    // Inside the window the cached "yes" still stands — that IS the revocation window.
    await expect(service.isUsable(userId)).resolves.toBe(true);

    jest.advanceTimersByTime(ACCOUNT_STATUS_TTL_MS + 1);

    await expect(service.isUsable(userId)).resolves.toBe(false);
  });

  it("drops the cached answer on demand, so a deactivation lands immediately", async () => {
    await service.isUsable(userId);
    await db.update(users).set({ active: false }).where(eq(users.id, userId));

    service.invalidate(userId);

    await expect(service.isUsable(userId)).resolves.toBe(false);
  });

});
