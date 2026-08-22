import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { UsersService } from "./users.service";

const ADMIN: AuthTokenPayload = { sub: "admin-1", tenantId: "tenant-1", role: Role.SchoolAdmin };

const TARGET = {
  id: "user-9",
  tenantId: "tenant-1",
  email: "profe@colegio.test",
  name: "Ana Quispe",
  role: Role.Teacher,
  active: true,
  createdAt: new Date("2026-01-15T10:00:00.000Z"),
};

function buildService(over: Partial<Record<string, unknown>> = {}) {
  const repository = {
    findByIdInTenant: jest.fn().mockResolvedValue(TARGET),
    countAuthored: jest.fn().mockResolvedValue({ questions: 12, exams: 3, generationJobs: 5 }),
    anonymize: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
  const accountStatus = { isUsable: jest.fn(), invalidate: jest.fn() };
  const service = new UsersService(
    repository as never,
    accountStatus as never,
  );
  return { service, repository, accountStatus };
}

describe("UsersService.exportPersonalData", () => {
  it("returns the identity and how much the account authored", async () => {
    const { service } = buildService();

    const result = await service.exportPersonalData(ADMIN, TARGET.id);

    expect(result.user).toEqual({
      id: TARGET.id,
      email: TARGET.email,
      name: TARGET.name,
      role: Role.Teacher,
      active: true,
      createdAt: "2026-01-15T10:00:00.000Z",
    });
    expect(result.authored).toEqual({ questions: 12, exams: 3, generationJobs: 5 });
    expect(result.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("never includes the password hash", async () => {
    // A hash is still a credential. "Everything we know about you" must not
    // include the key to the door.
    const { service } = buildService();

    const result = await service.exportPersonalData(ADMIN, TARGET.id);

    expect(JSON.stringify(result)).not.toMatch(/passwordHash|password_hash/i);
  });

  it("404s for a user outside the admin's tenant", async () => {
    const { service } = buildService({ findByIdInTenant: jest.fn().mockResolvedValue(undefined) });

    await expect(service.exportPersonalData(ADMIN, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses platform staff, who have no tenant to scope the request to", async () => {
    const { service } = buildService();
    const staff: AuthTokenPayload = { sub: "staff-1", tenantId: null, role: Role.PlatformAdmin };

    await expect(service.exportPersonalData(staff, TARGET.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("UsersService.anonymize", () => {
  it("replaces the identity with a tombstone and revokes the session", async () => {
    const { service, repository, accountStatus } = buildService();

    const result = await service.anonymize(ADMIN, TARGET.id);

    expect(result.email).toMatch(/^anonimizado\+user-9@/);
    expect(repository.anonymize).toHaveBeenCalledWith(TARGET.id, "tenant-1", result.email);
    // Same reason `setActive` does it: the token in their browser outlives the
    // row change otherwise (audit H3).
    expect(accountStatus.invalidate).toHaveBeenCalledWith(TARGET.id);
  });

  it("refuses to anonymize the admin running it", async () => {
    // Same guard as deactivation: locking yourself out by accident is not a
    // privacy feature.
    const { service } = buildService();

    await expect(service.anonymize(ADMIN, ADMIN.sub)).rejects.toBeInstanceOf(ConflictException);
  });

  it("404s for a user outside the admin's tenant", async () => {
    const { service } = buildService({ findByIdInTenant: jest.fn().mockResolvedValue(undefined) });

    await expect(service.anonymize(ADMIN, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });
});
