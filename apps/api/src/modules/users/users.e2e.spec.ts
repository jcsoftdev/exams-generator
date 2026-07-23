import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { tenants, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";

/**
 * Full HTTP e2e for the `users` module (S8) — school_admin manages the
 * users of its own tenant (list/create with a server-generated temporary
 * password/activate-deactivate/reset password), and a deactivated user is
 * rejected at login.
 *
 * Setup mirrors `exams.e2e.spec.ts:30-77`: `runMigrations`, the real
 * `AppModule`, seeded tenant/users directly via `db`, and tokens signed
 * through `TokenService` (no HTTP round trip needed for the seed).
 */
describe("Users module (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  const suffix = randomUUID();

  let tenantAId: string;
  let tenantBId: string;
  let schoolAdminAId: string;
  let schoolAdminBId: string;
  let teacherAId: string;

  let schoolAdminAToken: string;
  let schoolAdminBToken: string;
  let teacherAToken: string;

  let tenantAUserIds: string[];

  let createdTeacherId: string;
  let createdTeacherEmail: string;
  let temporaryPassword: string;

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `UsersE2E Tenant A ${suffix}`, slug: `users-e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `UsersE2E Tenant B ${suffix}`, slug: `users-e2e-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [schoolAdminA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `users-e2e-admin-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.SchoolAdmin,
      })
      .returning({ id: users.id });
    schoolAdminAId = schoolAdminA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `users-e2e-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherAId = teacherA!.id;

    const [schoolAdminB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `users-e2e-admin-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.SchoolAdmin,
      })
      .returning({ id: users.id });
    schoolAdminBId = schoolAdminB!.id;

    tenantAUserIds = [schoolAdminAId, teacherAId];

    schoolAdminAToken = tokenService.sign({ sub: schoolAdminAId, tenantId: tenantAId, role: Role.SchoolAdmin });
    schoolAdminBToken = tokenService.sign({ sub: schoolAdminBId, tenantId: tenantBId, role: Role.SchoolAdmin });
    teacherAToken = tokenService.sign({ sub: teacherAId, tenantId: tenantAId, role: Role.Teacher });
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.tenantId, [tenantAId, tenantBId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    await app.close();
    await pool.end();
  });

  it("school_admin lists only own-tenant users", async () => {
    const res = await request(app.getHttpServer())
      .get("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .expect(200);
    expect(res.body.every((u: { id: string }) => tenantAUserIds.includes(u.id))).toBe(true);
  });

  it("GET /users returns the name field for a created teacher", async () => {
    const email = `named-${suffix}@e2e.test`;
    const created = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ email, name: "Lucía Campos", role: "teacher" })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .expect(200);
    const listed = res.body.find((u: { id: string }) => u.id === created.body.id);
    expect(listed.name).toBe("Lucía Campos");
  });

  it("teacher gets 403", async () => {
    await request(app.getHttpServer()).get("/users").set("Authorization", `Bearer ${teacherAToken}`).expect(403);
  });

  it("creates teacher with temporary password, who can login", async () => {
    const email = `teacher-new-${suffix}@e2e.test`;
    const res = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ email, name: "Jorge Quispe", role: "teacher" })
      .expect(201);
    expect(res.body.temporaryPassword).toHaveLength(12);
    expect(res.body.name).toBe("Jorge Quispe");

    createdTeacherId = res.body.id;
    createdTeacherEmail = email;
    temporaryPassword = res.body.temporaryPassword;

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: res.body.temporaryPassword })
      .expect(200);
  });

  it("rejects role escalation attempt on create (only teacher/school_admin allowed)", async () => {
    await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ email: `escalate-${suffix}@e2e.test`, name: "Escalate", role: "platform_admin" })
      .expect(400);
  });

  it("400 when name is missing or blank", async () => {
    await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ email: `noname-${suffix}@e2e.test`, role: "teacher" })
      .expect(400);
    await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ email: `blankname-${suffix}@e2e.test`, name: "   ", role: "teacher" })
      .expect(400);
  });

  it("409 on duplicate email", async () => {
    const email = `dup-${suffix}@e2e.test`;
    await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ email, name: "Duplicado", role: "teacher" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ email, name: "Duplicado", role: "teacher" })
      .expect(409);
  });

  it("409 on duplicate email ACROSS tenants — accounts are platform-wide by design (email has a GLOBAL unique constraint and login is email+password without tenant context)", async () => {
    const email = `dup-cross-${suffix}@e2e.test`;
    await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ email, name: "Tenant A user", role: "teacher" })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", `Bearer ${schoolAdminBToken}`)
      .send({ email, name: "Tenant B user", role: "teacher" })
      .expect(409);

    // The message must explain WHY the admin can't create the account — the
    // email belongs to a platform-wide account, not to "some other school".
    expect(res.body.message).toContain("platform");
  });

  it("deactivated user cannot login; reactivation restores access", async () => {
    await request(app.getHttpServer())
      .patch(`/users/${createdTeacherId}`)
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ active: false })
      .expect(200);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: createdTeacherEmail, password: temporaryPassword })
      .expect(401);

    await request(app.getHttpServer())
      .patch(`/users/${createdTeacherId}`)
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ active: true })
      .expect(200);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: createdTeacherEmail, password: temporaryPassword })
      .expect(200);
  });

  it("cannot deactivate self", async () => {
    await request(app.getHttpServer())
      .patch(`/users/${schoolAdminAId}`)
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ active: false })
      .expect(409);
  });

  it("reset-password returns a new working temporary password", async () => {
    const res = await request(app.getHttpServer())
      .post(`/users/${createdTeacherId}/reset-password`)
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .expect(200);
    expect(res.body.temporaryPassword).toHaveLength(12);

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: createdTeacherEmail, password: res.body.temporaryPassword })
      .expect(200);
  });

  it("404 managing cross-tenant user", async () => {
    await request(app.getHttpServer())
      .patch(`/users/${createdTeacherId}`)
      .set("Authorization", `Bearer ${schoolAdminBToken}`)
      .send({ active: false })
      .expect(404);
  });
});
