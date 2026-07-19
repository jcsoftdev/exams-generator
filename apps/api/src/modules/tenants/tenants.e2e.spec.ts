import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Role } from "@exams-generator/shared";
import { AppModule } from "../../app.module";
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

describe("Tenants (e2e)", () => {
  let app: INestApplication;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let platformAdmin: UserFixture;
  let schoolAdminA: UserFixture;
  let schoolAdminB: UserFixture;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    await ensureMigrated();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    tenantA = await createTenantFixture();
    tenantB = await createTenantFixture();
    platformAdmin = await createUserFixture({ role: Role.PlatformAdmin, tenantId: null });
    schoolAdminA = await createUserFixture({ role: Role.SchoolAdmin, tenantId: tenantA.id });
    schoolAdminB = await createUserFixture({ role: Role.SchoolAdmin, tenantId: tenantB.id });
  });

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await deleteTenantFixture(id);
    }
    await deleteUserFixture(platformAdmin.id);
    await deleteUserFixture(schoolAdminA.id);
    await deleteUserFixture(schoolAdminB.id);
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

  describe("POST /tenants (create)", () => {
    it("allows platform_admin to create a tenant", async () => {
      const token = await loginAs(platformAdmin);
      const slug = `e2e-new-tenant-${randomUUID()}`;

      const res = await request(app.getHttpServer())
        .post("/tenants")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "New Tenant", slug });

      expect(res.status).toBe(201);
      expect(res.body.slug).toBe(slug);
      createdTenantIds.push(res.body.id as string);
    });

    it("forbids school_admin from creating a tenant", async () => {
      const token = await loginAs(schoolAdminA);
      const res = await request(app.getHttpServer())
        .post("/tenants")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Nope", slug: `e2e-nope-${randomUUID()}` });

      expect(res.status).toBe(403);
    });
  });

  describe("GET /tenants/:id (read)", () => {
    it("allows school_admin to read their own tenant", async () => {
      const token = await loginAs(schoolAdminA);
      const res = await request(app.getHttpServer())
        .get(`/tenants/${tenantA.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(tenantA.id);
    });

    it("forbids school_admin from reading another tenant", async () => {
      const token = await loginAs(schoolAdminA);
      const res = await request(app.getHttpServer())
        .get(`/tenants/${tenantB.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it("allows platform_admin (global) to read any tenant", async () => {
      const token = await loginAs(platformAdmin);
      const res = await request(app.getHttpServer())
        .get(`/tenants/${tenantB.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(tenantB.id);
    });
  });

  describe("PATCH /tenants/:id (update)", () => {
    it("allows school_admin to update their own tenant", async () => {
      const token = await loginAs(schoolAdminA);
      const res = await request(app.getHttpServer())
        .patch(`/tenants/${tenantA.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Renamed by owner" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Renamed by owner");
    });

    it("forbids school_admin from updating another tenant", async () => {
      const token = await loginAs(schoolAdminA);
      const res = await request(app.getHttpServer())
        .patch(`/tenants/${tenantB.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Hijacked" });

      expect(res.status).toBe(403);
    });

    it("allows school_admin to update their own tenant's city, and GET reflects it", async () => {
      const token = await loginAs(schoolAdminA);
      const res = await request(app.getHttpServer())
        .patch(`/tenants/${tenantA.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ city: "Arequipa" });

      expect(res.status).toBe(200);
      expect(res.body.city).toBe("Arequipa");

      const getRes = await request(app.getHttpServer())
        .get(`/tenants/${tenantA.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.city).toBe("Arequipa");
    });
  });

  describe("DELETE /tenants/:id", () => {
    it("forbids school_admin from deleting a tenant", async () => {
      const token = await loginAs(schoolAdminB);
      const res = await request(app.getHttpServer())
        .delete(`/tenants/${tenantB.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it("allows platform_admin to delete a tenant", async () => {
      const token = await loginAs(platformAdmin);
      const toDelete = await createTenantFixture();

      const res = await request(app.getHttpServer())
        .delete(`/tenants/${toDelete.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });

  describe("POST /tenants/:id/logo (upload via StoragePort)", () => {
    it("allows school_admin to upload a logo for their own tenant", async () => {
      const token = await loginAs(schoolAdminA);

      const res = await request(app.getHttpServer())
        .post(`/tenants/${tenantA.id}/logo`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("fake-png-bytes"), {
          filename: "logo.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(201);
      expect(typeof res.body.logoAssetId).toBe("string");
    });

    it("forbids school_admin from uploading a logo for another tenant", async () => {
      const token = await loginAs(schoolAdminA);

      const res = await request(app.getHttpServer())
        .post(`/tenants/${tenantB.id}/logo`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("fake-png-bytes"), {
          filename: "logo.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(403);
    });
  });
});
