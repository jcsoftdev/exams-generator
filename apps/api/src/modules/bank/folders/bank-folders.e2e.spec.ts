import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../../app.module";
import { db, pool } from "../../../db/client";
import { runMigrations } from "../../../db/migrate";
import { courses, questionFolders, tenants, topics, users } from "../../../db/schema";
import { TokenService } from "../../auth/token.service";

/**
 * Full HTTP e2e — real Nest app, real Postgres. The folder tree is a
 * per-tenant structure seeded from the GLOBAL taxonomy, so the isolation this
 * exercises ("tenant B never sees A's folders") is the same release gate
 * `bank.e2e.spec.ts` covers for questions, one level up.
 */
describe("Bank folders (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let courseColegioId: string;
  let coursePreId: string;
  let sharedNameTopic4Id: string;
  let sharedNameTopic5Id: string;
  let preTopicId: string;

  let tenantAId: string;
  let tenantBId: string;
  let teacherAId: string;
  let teacherBId: string;
  let staffUserId: string;

  let tokenA: string;
  let tokenB: string;
  let staffToken: string;

  const suffix = randomUUID();

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const [colegioCourse] = await db
      .insert(courses)
      .values({ name: `ZZ Folders Colegio ${suffix}`, stage: "colegio" })
      .returning({ id: courses.id });
    courseColegioId = colegioCourse!.id;

    const [preCourse] = await db
      .insert(courses)
      .values({ name: `ZZ Folders Pre ${suffix}`, stage: "preuniversitario" })
      .returning({ id: courses.id });
    coursePreId = preCourse!.id;

    // Two topics of the SAME course sharing a name, differing only in grade —
    // the exact case the grade suffix exists for.
    const [t4] = await db
      .insert(topics)
      .values({ courseId: courseColegioId, name: `Trigo ${suffix}`, gradeLevel: "secundaria_4" })
      .returning({ id: topics.id });
    sharedNameTopic4Id = t4!.id;

    const [t5] = await db
      .insert(topics)
      .values({ courseId: courseColegioId, name: `Trigo ${suffix}`, gradeLevel: "secundaria_5" })
      .returning({ id: topics.id });
    sharedNameTopic5Id = t5!.id;

    const [tPre] = await db
      .insert(topics)
      .values({ courseId: coursePreId, name: `Arco ${suffix}` })
      .returning({ id: topics.id });
    preTopicId = tPre!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `Folders A ${suffix}`, slug: `folders-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `Folders B ${suffix}`, slug: `folders-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `folders-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherAId = teacherA!.id;

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `folders-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherBId = teacherB!.id;

    const [staff] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: `folders-staff-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.ContentEditor,
      })
      .returning({ id: users.id });
    staffUserId = staff!.id;

    tokenA = tokenService.sign({ sub: teacherAId, tenantId: tenantAId, role: Role.Teacher });
    tokenB = tokenService.sign({ sub: teacherBId, tenantId: tenantBId, role: Role.Teacher });
    staffToken = tokenService.sign({ sub: staffUserId, tenantId: null, role: Role.ContentEditor });
  });

  afterAll(async () => {
    const cleanupSteps: Array<[string, () => Promise<unknown>]> = [
      // Folders cascade off the tenants below, but deleting them explicitly
      // keeps the failure readable if a FK ever changes.
      [
        "delete folders",
        () => db.delete(questionFolders).where(inArray(questionFolders.tenantId, [tenantAId, tenantBId])),
      ],
      [
        "delete users",
        () => db.delete(users).where(inArray(users.id, [teacherAId, teacherBId, staffUserId])),
      ],
      ["delete tenants", () => db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))],
      [
        "delete topics",
        () =>
          db.delete(topics).where(inArray(topics.id, [sharedNameTopic4Id, sharedNameTopic5Id, preTopicId])),
      ],
      ["delete courses", () => db.delete(courses).where(inArray(courses.id, [courseColegioId, coursePreId]))],
      ["close app", () => app.close()],
    ];
    for (const [label, step] of cleanupSteps) {
      try {
        await step();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[afterAll cleanup] "${label}" failed, continuing with remaining steps:`, err);
      }
    }
    await pool.end();
  });

  function foldersRequest(token: string) {
    return request(app.getHttpServer()).get("/bank/folders").set("Authorization", `Bearer ${token}`);
  }

  /** Flattens the nested response so a test can assert on one node without walking children by hand. */
  function flatten(nodes: readonly any[]): any[] {
    return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
  }

  it("seeds the default tree on the tenant's FIRST call: a root per stage, a folder per course, a folder per topic", async () => {
    const response = await foldersRequest(tokenA).expect(200);
    const all = flatten(response.body.folders);

    // Roots the fixture guarantees exist (the real catalog may add more).
    const roots = response.body.folders.map((node: any) => node.name);
    expect(roots).toEqual(expect.arrayContaining(["Colegio", "Preuniversitario"]));

    const courseFolder = all.find((node) => node.name === `ZZ Folders Colegio ${suffix}`);
    expect(courseFolder).toBeDefined();
    expect(courseFolder.topicId).toBeNull();

    const topicFolders = all.filter((node) => node.parentId === courseFolder.id);
    expect(topicFolders.map((node) => node.name).sort()).toEqual([
      `Trigo ${suffix} · 4° secundaria`,
      `Trigo ${suffix} · 5° secundaria`,
    ]);
    expect(topicFolders.map((node) => node.topicId).sort()).toEqual(
      [sharedNameTopic4Id, sharedNameTopic5Id].sort(),
    );

    // A topic whose name is unique in its course keeps its bare name.
    expect(all.find((node) => node.topicId === preTopicId).name).toBe(`Arco ${suffix}`);
  });

  it("does not re-seed on a second call — folders_seeded_at is the marker, not 'has rows'", async () => {
    const first = await foldersRequest(tokenA).expect(200);
    const before = flatten(first.body.folders).length;

    const [row] = await db
      .select({ seededAt: tenants.foldersSeededAt })
      .from(tenants)
      .where(eq(tenants.id, tenantAId));
    expect(row!.seededAt).not.toBeNull();

    // Emptying the cabinet on purpose must NOT bring the default set back.
    await db.delete(questionFolders).where(eq(questionFolders.tenantId, tenantAId));
    const second = await foldersRequest(tokenA).expect(200);

    expect(before).toBeGreaterThan(0);
    expect(second.body.folders).toEqual([]);
  });

  it("keeps tenants isolated — B's tree is its own, and B seeds independently", async () => {
    const responseB = await foldersRequest(tokenB).expect(200);
    const idsB = flatten(responseB.body.folders).map((node: any) => node.id);

    const rowsA = await db
      .select({ id: questionFolders.id })
      .from(questionFolders)
      .where(eq(questionFolders.tenantId, tenantAId));

    expect(idsB.length).toBeGreaterThan(0);
    for (const rowA of rowsA) {
      expect(idsB).not.toContain(rowA.id);
    }
  });

  it("returns unfiledCount and per-folder counts, both zero for a bank with no questions here", async () => {
    const response = await foldersRequest(tokenB).expect(200);
    const node = flatten(response.body.folders)[0];

    expect(response.body).toHaveProperty("unfiledCount", 0);
    expect(node).toMatchObject({ ownCount: 0, centralCount: 0 });
  });

  it("rejects a user with no tenant with 403 tenant_required", async () => {
    const response = await foldersRequest(staffToken).expect(403);
    expect(response.body).toMatchObject({ code: "tenant_required" });
  });

  it("rejects an unauthenticated request with 401", async () => {
    await request(app.getHttpServer()).get("/bank/folders").expect(401);
  });
});
