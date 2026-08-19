import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Difficulty, Role } from "@exams-generator/shared";
import { AppModule } from "../../app.module";
import { db } from "../../db/client";
import {
  assets,
  examQuestions,
  examVersions,
  exams,
  questions,
  tenants,
  users,
} from "../../db/schema";
import { eq } from "drizzle-orm";
import { STORAGE_PORT } from "../bank/bank.constants";
import { StorageObjectNotFoundError, StoragePort } from "../exams/domain/ports/storage.port";
import { fakePng } from "../../test-support/image-fixtures";
import {
  closeDbPool,
  createTenantFixture,
  createUserFixture,
  deleteTenantFixture,
  deleteUserFixture,
  ensureGradeLevelsSeeded,
  ensureMigrated,
  ensureTopicFixture,
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
  let teacherA: UserFixture;
  let storage: StoragePort;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    await ensureMigrated();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    storage = moduleRef.get(STORAGE_PORT);

    tenantA = await createTenantFixture();
    tenantB = await createTenantFixture();
    platformAdmin = await createUserFixture({ role: Role.PlatformAdmin, tenantId: null });
    schoolAdminA = await createUserFixture({ role: Role.SchoolAdmin, tenantId: tenantA.id });
    schoolAdminB = await createUserFixture({ role: Role.SchoolAdmin, tenantId: tenantB.id });
    teacherA = await createUserFixture({ role: Role.Teacher, tenantId: tenantA.id });
  });

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await deleteTenantFixture(id);
    }
    await deleteUserFixture(platformAdmin.id);
    await deleteUserFixture(schoolAdminA.id);
    await deleteUserFixture(schoolAdminB.id);
    await deleteUserFixture(teacherA.id);
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

  describe("GET /tenants (list, N3)", () => {
    it("allows platform_admin to list all tenants (paginated)", async () => {
      const token = await loginAs(platformAdmin);
      const res = await request(app.getHttpServer())
        .get("/tenants")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      // Deliberately NOT asserting tenantA/tenantB are present: `tenants`
      // has no createdAt column, so `findAll` has no ORDER BY, and this
      // shared local Postgres accumulates tenants across unrelated e2e runs
      // over time — a specific row landing on the default-sized first page
      // isn't guaranteed. Presence is already covered by the `GET
      // /tenants/:id` tests below (fetched by id directly, not via list).
      // This test only asserts the paginated envelope itself is correct.
      expect(res.body.items.length).toBeLessThanOrEqual(20);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it("forbids school_admin from listing all tenants", async () => {
      const token = await loginAs(schoolAdminA);
      const res = await request(app.getHttpServer())
        .get("/tenants")
        .set("Authorization", `Bearer ${token}`);

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

    // The app shell reads the school name for EVERY signed-in role (it is the
    // topbar title). A teacher denied here does not see an error — the shell
    // swallows it and falls back to the product name, so the teacher is told
    // they are in "GeneraExamen" instead of their own school.
    it("allows teacher to read their own tenant", async () => {
      const token = await loginAs(teacherA);
      const res = await request(app.getHttpServer())
        .get(`/tenants/${tenantA.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(tenantA.id);
    });

    it("forbids teacher from reading another tenant", async () => {
      const token = await loginAs(teacherA);
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

    // Reading the school name is not permission to rename the school.
    it("forbids teacher from updating their own tenant", async () => {
      const token = await loginAs(teacherA);
      const res = await request(app.getHttpServer())
        .patch(`/tenants/${tenantA.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Renamed by a teacher" });

      expect(res.status).toBe(403);
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

    it("hard-deletes a school WITH data (user+asset+logo+question+exam+version) and purges its MinIO objects, leaving other tenants untouched", async () => {
      const token = await loginAs(platformAdmin);
      await ensureGradeLevelsSeeded();
      const topic = await ensureTopicFixture();

      const toDelete = await createTenantFixture();
      const user = await createUserFixture({ role: Role.Teacher, tenantId: toDelete.id });

      // A tenant-owned asset that is ALSO the tenant's logo (exercises the
      // tenants.logo_asset_id -> assets self-edge) and a question's image
      // (questions.image_asset_id -> assets), each with a real MinIO object.
      const logoKey = `test/tenant-delete/${randomUUID()}`;
      await storage.put(logoKey, fakePng(), "image/png");
      const [logoAsset] = await db
        .insert(assets)
        .values({ tenantId: toDelete.id, storageKey: logoKey, mime: "image/png" })
        .returning();
      await db.update(tenants).set({ logoAssetId: logoAsset!.id }).where(eq(tenants.id, toDelete.id));

      const pdfKey = `test/tenant-delete/${randomUUID()}`;
      await storage.put(pdfKey, Buffer.from("%PDF-fake"), "application/pdf");
      const [pdfAsset] = await db
        .insert(assets)
        .values({ tenantId: toDelete.id, storageKey: pdfKey, mime: "application/pdf" })
        .returning();

      const [question] = await db
        .insert(questions)
        .values({
          tenantId: toDelete.id,
          topicId: topic.id,
          difficulty: Difficulty.Easy,
          gradeLevel: "primaria_1",
          correctAnswer: "b",
          createdBy: user.id,
          imageAssetId: logoAsset!.id,
        })
        .returning();

      const [exam] = await db
        .insert(exams)
        .values({
          tenantId: toDelete.id,
          title: "Doomed exam",
          gradeLevel: "primaria_1",
          createdBy: user.id,
        })
        .returning();

      const [version] = await db
        .insert(examVersions)
        .values({
          examId: exam!.id,
          code: "A",
          questionOrder: [question!.id],
          answerKey: { "1": "b" },
          pdfAssetId: pdfAsset!.id,
        })
        .returning();

      await db
        .insert(examQuestions)
        .values({ examId: exam!.id, questionId: question!.id, position: 1 });

      // Sanity: a survivor tenant with its own user, untouched by the delete.
      const survivorUserId = teacherA.id;

      const res = await request(app.getHttpServer())
        .delete(`/tenants/${toDelete.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);

      // Every owned row is gone.
      expect(await db.select().from(tenants).where(eq(tenants.id, toDelete.id))).toHaveLength(0);
      expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
      expect(await db.select().from(questions).where(eq(questions.id, question!.id))).toHaveLength(0);
      expect(await db.select().from(exams).where(eq(exams.id, exam!.id))).toHaveLength(0);
      expect(await db.select().from(examVersions).where(eq(examVersions.id, version!.id))).toHaveLength(0);
      expect(await db.select().from(assets).where(eq(assets.tenantId, toDelete.id))).toHaveLength(0);

      // MinIO objects purged.
      await expect(storage.get(logoKey)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
      await expect(storage.get(pdfKey)).rejects.toBeInstanceOf(StorageObjectNotFoundError);

      // The other tenant's data survives.
      expect(await db.select().from(users).where(eq(users.id, survivorUserId))).toHaveLength(1);
      expect(await db.select().from(tenants).where(eq(tenants.id, tenantA.id))).toHaveLength(1);
    });
  });

  describe("POST /tenants/:id/logo (upload via StoragePort)", () => {
    it("allows school_admin to upload a logo for their own tenant", async () => {
      const token = await loginAs(schoolAdminA);

      const res = await request(app.getHttpServer())
        .post(`/tenants/${tenantA.id}/logo`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", fakePng(), {
          filename: "logo.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(201);
      expect(typeof res.body.logoAssetId).toBe("string");
    });

    it("rejects a logo whose bytes are not a real image with 400", async () => {
      const token = await loginAs(schoolAdminA);

      const res = await request(app.getHttpServer())
        .post(`/tenants/${tenantA.id}/logo`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("<svg><script>alert(1)</script></svg>"), {
          filename: "logo.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(400);
    });

    it("forbids school_admin from uploading a logo for another tenant", async () => {
      const token = await loginAs(schoolAdminA);

      const res = await request(app.getHttpServer())
        .post(`/tenants/${tenantB.id}/logo`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", fakePng(), {
          filename: "logo.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(403);
    });
  });
});
