import { randomUUID } from "node:crypto";
import { FeatureFlag, Role, TenantFeatureFlagStateDto } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { platformFeatureFlags, tenantFeatureFlags, tenants, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";

/**
 * Feature test for the whole flag stack: the two layers, their opposite
 * absence-defaults, the guard on the routes that start work, and the routes
 * that must stay reachable after a flag goes off.
 *
 * Writes go through the HTTP routes rather than straight into the tables on
 * purpose. `FeatureFlagsService` caches each layer for 60s and drops that
 * cache on its own writes; a spec that inserted rows behind its back would
 * be testing a stale cache and would pass or fail depending on timing.
 */
describe("Feature flags (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let tenantId: string;
  let adminId: string;
  let teacherId: string;
  let platformToken: string;
  let teacherToken: string;

  const flagsUrl = () => `/tenants/${tenantId}/feature-flags`;

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [tenant] = await db
      .insert(tenants)
      .values({ name: `Flags E2E Tenant ${suffix}`, slug: `flags-e2e-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [admin] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: `flags-e2e-admin-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.PlatformAdmin,
      })
      .returning({ id: users.id });
    adminId = admin!.id;

    const [teacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `flags-e2e-teacher-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherId = teacher!.id;

    platformToken = tokenService.sign({ sub: adminId, tenantId: null, role: Role.PlatformAdmin });
    teacherToken = tokenService.sign({ sub: teacherId, tenantId, role: Role.Teacher });
  });

  afterEach(async () => {
    // Every test starts from "nothing decided": no overrides, nothing cut.
    // Cleared through the routes so the service's cache is dropped too.
    for (const key of Object.values(FeatureFlag)) {
      await request(app.getHttpServer())
        .delete(`${flagsUrl()}/${key}`)
        .set("Authorization", `Bearer ${platformToken}`);
      await request(app.getHttpServer())
        .put(`/feature-flags/platform/${key}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ enabled: true });
    }
  });

  afterAll(async () => {
    await db.delete(tenantFeatureFlags).where(eq(tenantFeatureFlags.tenantId, tenantId));
    await db.delete(platformFeatureFlags);
    await db.delete(users).where(inArray(users.id, [adminId, teacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantId]));
    await app.close();
    await pool.end();
  });

  describe("who may touch the switches", () => {
    it("refuses the platform layer to a teacher", async () => {
      await request(app.getHttpServer())
        .get("/feature-flags/platform")
        .set("Authorization", `Bearer ${teacherToken}`)
        .expect(403);
    });

    it("refuses a school's own overrides to that school's teacher", async () => {
      // The school must not be able to grant itself a feature — the whole
      // reason flags do not ride on the tenant DTO, which `school_admin`
      // can already PATCH.
      await request(app.getHttpServer())
        .put(`${flagsUrl()}/${FeatureFlag.AiGeneration}`)
        .set("Authorization", `Bearer ${teacherToken}`)
        .send({ enabled: true })
        .expect(403);
    });

    it("rejects a key that is not in the catalog as a bad request, not a 404", async () => {
      await request(app.getHttpServer())
        .put("/feature-flags/platform/not_a_real_flag")
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ enabled: true })
        .expect(400);
    });

    it("rejects a non-boolean `enabled`", async () => {
      // The shared DTOs are interfaces, so the global ValidationPipe sees
      // `Object` and validates nothing. Without the hand check, "false"
      // would store a truthy string and turn the feature ON.
      await request(app.getHttpServer())
        .put(`/feature-flags/platform/${FeatureFlag.AiGeneration}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ enabled: "false" })
        .expect(400);
    });
  });

  describe("what a school gets before anyone decides anything", () => {
    it("hands a tenant with no rows exactly the catalog defaults", async () => {
      const response = await request(app.getHttpServer())
        .get(flagsUrl())
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(200);

      const rows = response.body as TenantFeatureFlagStateDto[];
      const effective = Object.fromEntries(rows.map((row) => [row.key, row.effective]));

      expect(effective).toEqual({
        global_bank: true,
        tenant_branding: true,
        ai_generation: false,
        ai_extraction: false,
        exam_versions: false,
      });
      expect(rows.every((row) => row.tenant === null)).toBe(true);
    });

    it("reports the same effective values on the teacher's own /auth/me", async () => {
      const response = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${teacherToken}`)
        .expect(200);

      expect(response.body.features).toEqual({
        global_bank: true,
        tenant_branding: true,
        ai_generation: false,
        ai_extraction: false,
        exam_versions: false,
      });
    });

    it("404s for a tenant id that does not exist instead of inventing defaults", async () => {
      await request(app.getHttpServer())
        .get(`/tenants/${randomUUID()}/feature-flags`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(404);
    });
  });

  describe("the guard on the routes that start work", () => {
    it("refuses AI generation while the school has no such permission", async () => {
      const response = await request(app.getHttpServer())
        .post("/ai/questions/jobs")
        .set("Authorization", `Bearer ${teacherToken}`)
        .send({ courseId: randomUUID(), topicId: randomUUID(), gradeLevel: "5s", count: 1 })
        .expect(403);

      // Names the key so the web can tell "your plan lacks this" apart from
      // "you lack the role", which are otherwise the same 403.
      expect(response.body).toMatchObject({ feature: FeatureFlag.AiGeneration });
    });

    it("lets the school in once the override grants it", async () => {
      await request(app.getHttpServer())
        .put(`${flagsUrl()}/${FeatureFlag.AiGeneration}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ enabled: true })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post("/ai/questions/jobs")
        .set("Authorization", `Bearer ${teacherToken}`)
        .send({ courseId: randomUUID(), topicId: randomUUID(), gradeLevel: "5s", count: 1 });

      // Anything but 403-for-this-feature means the gate opened; the body
      // is then the create route's own business (a 400/404 for the made-up
      // taxonomy ids above is a perfectly good outcome here).
      expect(response.body?.feature).toBeUndefined();
    });

    it("keeps the way OUT open while the way in is shut", async () => {
      // A job already queued must stay watchable and cancellable, or
      // switching the flag off strands work that is still spending budget.
      await request(app.getHttpServer())
        .get("/ai/questions/jobs")
        .set("Authorization", `Bearer ${teacherToken}`)
        .expect(200);
    });
  });

  describe("the platform layer beating the tenant layer", () => {
    it("keeps the school out even with its override switched on", async () => {
      await request(app.getHttpServer())
        .put(`${flagsUrl()}/${FeatureFlag.AiGeneration}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ enabled: true })
        .expect(200);

      await request(app.getHttpServer())
        .put(`/feature-flags/platform/${FeatureFlag.AiGeneration}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ enabled: false })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post("/ai/questions/jobs")
        .set("Authorization", `Bearer ${teacherToken}`)
        .send({ courseId: randomUUID(), topicId: randomUUID(), gradeLevel: "5s", count: 1 })
        .expect(403);

      expect(response.body).toMatchObject({ feature: FeatureFlag.AiGeneration });
    });

    it("shows the admin all three values, so a live override reads as ineffective", async () => {
      await request(app.getHttpServer())
        .put(`${flagsUrl()}/${FeatureFlag.AiGeneration}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ enabled: true })
        .expect(200);

      const response = await request(app.getHttpServer())
        .put(`/feature-flags/platform/${FeatureFlag.AiGeneration}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ enabled: false })
        .expect(200);

      const generation = (
        await request(app.getHttpServer()).get(flagsUrl()).set("Authorization", `Bearer ${platformToken}`)
      ).body.find(
        (row: TenantFeatureFlagStateDto) => row.key === FeatureFlag.AiGeneration,
      ) as TenantFeatureFlagStateDto;

      expect(generation).toMatchObject({ platform: false, tenant: true, effective: false });
      expect(response.body).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: FeatureFlag.AiGeneration, enabled: false })]),
      );
    });
  });

  describe("dropping an override", () => {
    it("returns the school to the catalog default rather than to `off`", async () => {
      // `global_bank` defaults ON, so an override switched OFF and then
      // deleted must come back ON. Writing the default's value instead of
      // deleting would look identical today and diverge the day the default
      // changes.
      await request(app.getHttpServer())
        .put(`${flagsUrl()}/${FeatureFlag.GlobalBank}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ enabled: false })
        .expect(200);

      const cleared = await request(app.getHttpServer())
        .delete(`${flagsUrl()}/${FeatureFlag.GlobalBank}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(200);

      expect(cleared.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: FeatureFlag.GlobalBank,
            tenant: null,
            effective: true,
          }),
        ]),
      );
    });
  });

  describe("deleting a school that has overrides", () => {
    it("does not break the hand-ordered tenant delete", async () => {
      const suffix = randomUUID();
      const [doomed] = await db
        .insert(tenants)
        .values({ name: `Flags E2E Doomed ${suffix}`, slug: `flags-e2e-doomed-${suffix}` })
        .returning({ id: tenants.id });
      const doomedId = doomed!.id;

      await request(app.getHttpServer())
        .put(`/tenants/${doomedId}/feature-flags/${FeatureFlag.AiGeneration}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .send({ enabled: true })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/tenants/${doomedId}`)
        .set("Authorization", `Bearer ${platformToken}`)
        .expect(200);

      const left = await db
        .select({ id: tenantFeatureFlags.id })
        .from(tenantFeatureFlags)
        .where(eq(tenantFeatureFlags.tenantId, doomedId));
      expect(left).toEqual([]);
    });
  });
});
