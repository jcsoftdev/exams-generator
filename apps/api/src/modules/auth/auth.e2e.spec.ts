import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Role } from "@exams-generator/shared";
import {
  closeDbPool,
  createTenantFixture,
  createUserFixture,
  deleteTenantFixture,
  deleteUserFixture,
  ensureMigrated,
  TenantFixture,
  UserFixture,
} from "../../test-utils/db-fixtures";
import { AuthModule } from "./auth.module";
import { ProtectedFixtureController } from "./test-fixtures/protected-fixture.controller";

describe("Auth (e2e)", () => {
  let app: INestApplication;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let schoolAdminTenantA: UserFixture;
  let teacherTenantB: UserFixture;

  beforeAll(async () => {
    await ensureMigrated();

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [ProtectedFixtureController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    tenantA = await createTenantFixture();
    tenantB = await createTenantFixture();
    schoolAdminTenantA = await createUserFixture({ role: Role.SchoolAdmin, tenantId: tenantA.id });
    teacherTenantB = await createUserFixture({ role: Role.Teacher, tenantId: tenantB.id });
  });

  afterAll(async () => {
    await deleteUserFixture(schoolAdminTenantA.id);
    await deleteUserFixture(teacherTenantB.id);
    await deleteTenantFixture(tenantA.id);
    await deleteTenantFixture(tenantB.id);
    await app.close();
    await closeDbPool();
  });

  async function loginAs(user: UserFixture): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: user.plainPassword });
    return res.body.accessToken as string;
  }

  describe("POST /auth/login", () => {
    it("returns a JWT accessToken for valid credentials", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: schoolAdminTenantA.email, password: schoolAdminTenantA.plainPassword });

      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe("string");
      expect((res.body.accessToken as string).length).toBeGreaterThan(0);
    });

    it("returns the user's tenant slug for a tenant-scoped user", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: schoolAdminTenantA.email, password: schoolAdminTenantA.plainPassword });

      expect(res.status).toBe(200);
      expect(res.body.tenantSlug).toBe(tenantA.slug);
    });

    it("returns 401 for a wrong password", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: schoolAdminTenantA.email, password: "definitely-wrong" });

      expect(res.status).toBe(401);
    });

    it("returns 401 for an email that does not exist", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: "nobody@test.local", password: "whatever" });

      expect(res.status).toBe(401);
    });
  });

  describe("guard composition (JwtAuthGuard -> RolesGuard -> TenantGuard)", () => {
    it("returns 401 with no Authorization header", async () => {
      const res = await request(app.getHttpServer()).get(
        `/test-fixtures/tenants/${tenantA.id}/protected`,
      );

      expect(res.status).toBe(401);
    });

    it("returns 403 when the JWT role does not satisfy @Roles(SchoolAdmin)", async () => {
      const token = await loginAs(teacherTenantB);
      const res = await request(app.getHttpServer())
        .get(`/test-fixtures/tenants/${tenantB.id}/protected`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it("returns 403 when the JWT tenantId does not match the target resource's tenant", async () => {
      const token = await loginAs(schoolAdminTenantA);
      const res = await request(app.getHttpServer())
        .get(`/test-fixtures/tenants/${tenantB.id}/protected`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it("returns 200 when role and tenant both match", async () => {
      const token = await loginAs(schoolAdminTenantA);
      const res = await request(app.getHttpServer())
        .get(`/test-fixtures/tenants/${tenantA.id}/protected`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, tenantId: tenantA.id });
    });
  });

  describe("cross-origin login handoff (POST /auth/exchange-code + POST /auth/exchange)", () => {
    it("exchanges a login accessToken for a code, then the code back for the same accessToken", async () => {
      const accessToken = await loginAs(schoolAdminTenantA);

      const codeRes = await request(app.getHttpServer())
        .post("/auth/exchange-code")
        .send({ accessToken });
      expect(codeRes.status).toBe(200);
      expect(typeof codeRes.body.code).toBe("string");
      expect((codeRes.body.code as string).length).toBeGreaterThan(0);

      const exchangeRes = await request(app.getHttpServer())
        .post("/auth/exchange")
        .send({ code: codeRes.body.code });
      expect(exchangeRes.status).toBe(200);
      expect(exchangeRes.body.accessToken).toBe(accessToken);
    });

    it("POST /auth/exchange-code returns 401 for a garbage token", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/exchange-code")
        .send({ accessToken: "not-a-real-jwt" });

      expect(res.status).toBe(401);
    });

    it("POST /auth/exchange returns 401 for a code that was never issued", async () => {
      const res = await request(app.getHttpServer()).post("/auth/exchange").send({ code: "never-issued" });

      expect(res.status).toBe(401);
    });

    it("a code can only be redeemed once", async () => {
      const accessToken = await loginAs(schoolAdminTenantA);
      const codeRes = await request(app.getHttpServer())
        .post("/auth/exchange-code")
        .send({ accessToken });

      const first = await request(app.getHttpServer())
        .post("/auth/exchange")
        .send({ code: codeRes.body.code });
      expect(first.status).toBe(200);

      const second = await request(app.getHttpServer())
        .post("/auth/exchange")
        .send({ code: codeRes.body.code });
      expect(second.status).toBe(401);
    });
  });
});
