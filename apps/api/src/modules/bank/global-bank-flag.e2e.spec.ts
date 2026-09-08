import { randomUUID } from "node:crypto";
import { Difficulty, FeatureFlag, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, questions, tenantFeatureFlags, tenants, topics, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";

/**
 * Feature test for `global_bank`, the one flag that is NOT a guard.
 *
 * It changes the visibility predicate instead, and that predicate is read by
 * three separate places: the bank listing, the exam question pool, and the
 * folder tree's central-question badge. Only the first goes through
 * `BankRepository`; the other two are the ones a change like this forgets.
 * So this suite checks all three, on the same tenant, either side of one
 * switch.
 */
describe("global_bank flag (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let tenantId: string;
  let adminId: string;
  let teacherId: string;
  let courseId: string;
  let topicId: string;
  let centralQuestionId: string;
  let ownQuestionId: string;
  let platformToken: string;
  let teacherToken: string;

  async function setGlobalBank(enabled: boolean): Promise<void> {
    // Through the route, so the service drops its 60s cache — a direct
    // insert would leave the app answering from a stale layer.
    await request(app.getHttpServer())
      .put(`/tenants/${tenantId}/feature-flags/${FeatureFlag.GlobalBank}`)
      .set("Authorization", `Bearer ${platformToken}`)
      .send({ enabled })
      .expect(200);
  }

  async function listedQuestionIds(): Promise<string[]> {
    const response = await request(app.getHttpServer())
      .get(`/bank/questions?topicId=${topicId}`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);

    const items = Array.isArray(response.body) ? response.body : response.body.items;
    return (items as { id: string }[]).map((q) => q.id);
  }

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [tenant] = await db
      .insert(tenants)
      .values({ name: `Global Bank E2E ${suffix}`, slug: `global-bank-e2e-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    // Its OWN course and topic, so the CENTRAL question created below stays
    // invisible to every other suite. A `tenant_id IS NULL` question hung off
    // a SHARED topic shows up in every tenant's bank listing and in the
    // folder tree's badge for that topic, and quietly breaks assertions in
    // suites that have nothing to do with this flag.
    const [course] = await db
      .insert(courses)
      .values({ name: `Global Bank E2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `Global Bank E2E Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [admin] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: `global-bank-e2e-admin-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.PlatformAdmin,
      })
      .returning({ id: users.id });
    adminId = admin!.id;

    const [teacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `global-bank-e2e-teacher-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherId = teacher!.id;

    platformToken = tokenService.sign({ sub: adminId, tenantId: null, role: Role.PlatformAdmin });
    teacherToken = tokenService.sign({ sub: teacherId, tenantId, role: Role.Teacher });

    // One question in the central bank, one belonging to the school. The
    // whole flag is about whether the first is part of the second's bank.
    const [central] = await db
      .insert(questions)
      .values({
        tenantId: null,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        type: "structured",
        status: "approved",
        correctAnswer: "0",
        bodyTypst: `central ${suffix}`,
        alternatives: ["a", "b"],
        createdBy: adminId,
      })
      .returning({ id: questions.id });
    centralQuestionId = central!.id;

    const [own] = await db
      .insert(questions)
      .values({
        tenantId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        type: "structured",
        status: "approved",
        correctAnswer: "0",
        bodyTypst: `own ${suffix}`,
        alternatives: ["a", "b"],
        createdBy: teacherId,
      })
      .returning({ id: questions.id });
    ownQuestionId = own!.id;
  });

  afterAll(async () => {
    await db.delete(questions).where(inArray(questions.id, [centralQuestionId, ownQuestionId]));
    await db.delete(tenantFeatureFlags).where(eq(tenantFeatureFlags.tenantId, tenantId));
    await db.delete(users).where(inArray(users.id, [adminId, teacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantId]));

    // The course and topic are left for `db:purge-test-taxonomy`, which
    // reclaims them by their UUID-bearing names. Deleting them here would
    // race the folder seeding other suites trigger: `loadSeedSource` reads
    // EVERY course and topic to build a tenant's tree, so another worker can
    // be inserting a folder for this very topic at the moment it vanishes.
    await app.close();
    await pool.end();
  });

  it("serves central questions by default, since global_bank defaults on", async () => {
    await setGlobalBank(true);

    const ids = await listedQuestionIds();

    expect(ids).toContain(centralQuestionId);
    expect(ids).toContain(ownQuestionId);
  });

  it("drops central questions from the bank listing once the flag is off", async () => {
    await setGlobalBank(false);

    const ids = await listedQuestionIds();

    expect(ids).not.toContain(centralQuestionId);
    // The school's own bank is untouched — this withdraws a shared library,
    // it does not take away anything the school wrote.
    expect(ids).toContain(ownQuestionId);
  });

  it("hides a central question from direct id lookup too, not just the list", async () => {
    await setGlobalBank(false);

    // Otherwise the flag would be pure decoration: anyone with an id kept
    // reading the row the listing had stopped showing.
    await request(app.getHttpServer())
      .get(`/bank/questions/${centralQuestionId}`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(404);
  });

  // The folder tree's central badge is the third consumer of this rule, and
  // it is covered in `folders/bank-folders-global-bank.spec.ts` instead of
  // here. `GET /bank/folders` seeds from the GLOBAL courses/topics catalog
  // that a dozen other e2e suites create and delete rows in, so under
  // parallel workers this call 500s on a fixture race that has nothing to do
  // with the flag. See that file's docstring.

  it("keeps the central bank visible to platform staff, whose bank it is", async () => {
    await setGlobalBank(false);

    // The school's override says nothing about staff: they have no tenant
    // layer, and curating the central bank is their whole job.
    const response = await request(app.getHttpServer())
      .get(`/bank/questions?topicId=${topicId}`)
      .set("Authorization", `Bearer ${platformToken}`)
      .expect(200);

    const items = Array.isArray(response.body) ? response.body : response.body.items;
    expect((items as { id: string }[]).map((q) => q.id)).toContain(centralQuestionId);
  });

  it("brings the central bank back when the override is dropped", async () => {
    await setGlobalBank(false);

    await request(app.getHttpServer())
      .delete(`/tenants/${tenantId}/feature-flags/${FeatureFlag.GlobalBank}`)
      .set("Authorization", `Bearer ${platformToken}`)
      .expect(200);

    expect(await listedQuestionIds()).toContain(centralQuestionId);
  });
});
