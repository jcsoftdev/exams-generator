import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../../app.module";
import { db, pool } from "../../../db/client";
import { runMigrations } from "../../../db/migrate";
import {
  assets,
  courses,
  questionFolders,
  questions,
  tenants,
  topicGrades,
  topics,
  users,
} from "../../../db/schema";
import { fakePng } from "../../../test-support/image-fixtures";
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
  let sharedNameTopicId: string;
  let preTopicId: string;

  let tenantAId: string;
  let tenantBId: string;
  let teacherAId: string;
  let teacherBId: string;
  let staffUserId: string;

  let tokenA: string;
  let tokenB: string;
  let staffToken: string;

  /** Real question rows the counts test inserts directly via Drizzle — cleaned up in `afterAll`. */
  const insertedQuestionIds: string[] = [];
  /** Question rows created through the HTTP write paths (`folderId on question write paths`) — cleaned up in `afterAll`. */
  const createdQuestionIds: string[] = [];
  /** Asset rows the multipart image-upload tests create — cleaned up in `afterAll` before tenants go. */
  const createdAssetIds: string[] = [];

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

    // ONE topic taught at two grades — the shape that replaced two rows that
    // differed only in grade. The seeded folder must be ONE folder, bare.
    const [trigo] = await db
      .insert(topics)
      .values({ courseId: courseColegioId, name: `Trigo ${suffix}` })
      .returning({ id: topics.id });
    sharedNameTopicId = trigo!.id;
    await db.insert(topicGrades).values([
      { topicId: sharedNameTopicId, gradeLevel: "secundaria_4" },
      { topicId: sharedNameTopicId, gradeLevel: "secundaria_5" },
    ]);

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
      [
        "delete created folders",
        async () => {
          if (createdFolderIds.length > 0) {
            await db.delete(questionFolders).where(inArray(questionFolders.id, createdFolderIds));
          }
        },
      ],
      // Must run BEFORE "delete folders": the questions reference `folderId`
      // (ON DELETE SET NULL, harmless either order) but also `topicId`
      // (NOT NULL, no cascade) — deleting topics before these rows exist
      // would fail the FK, not just leave a dangling reference.
      [
        "delete inserted questions",
        () => {
          const ids = [...insertedQuestionIds, ...createdQuestionIds];
          return ids.length > 0 ? db.delete(questions).where(inArray(questions.id, ids)) : Promise.resolve();
        },
      ],
      // Must run AFTER "delete inserted questions" (a question's
      // `imageAssetId` points at these) and BEFORE "delete tenants" (an
      // asset's `tenantId` points there too, no cascade on either FK).
      [
        "delete created assets",
        () =>
          createdAssetIds.length > 0
            ? db.delete(assets).where(inArray(assets.id, createdAssetIds))
            : Promise.resolve(),
      ],
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
      ["delete topics", () => db.delete(topics).where(inArray(topics.id, [sharedNameTopicId, preTopicId]))],
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

  function createFolderRequest(token: string) {
    return request(app.getHttpServer()).post("/bank/folders").set("Authorization", `Bearer ${token}`);
  }

  function patchFolderRequest(token: string, id: string) {
    return request(app.getHttpServer()).patch(`/bank/folders/${id}`).set("Authorization", `Bearer ${token}`);
  }

  function deleteFolderRequest(token: string, id: string) {
    return request(app.getHttpServer()).delete(`/bank/folders/${id}`).set("Authorization", `Bearer ${token}`);
  }

  /** Ids created by a test, torn down in `afterAll` before the tenants go. */
  const createdFolderIds: string[] = [];

  /**
   * Inserts a question straight through Drizzle rather than through
   * `POST /bank/questions/structured`: this suite is about FOLDERS, and the
   * creation endpoint has its own taxonomy validation, dedup-by-hash and
   * MinIO round-trip that would only add noise here.
   *
   * Pushes into `insertedQuestionIds` — the same cleanup list the counts
   * test above already populates and `afterAll` already drains before
   * folders/topics go — rather than a second parallel list.
   */
  async function insertQuestion(input: {
    tenantId: string | null;
    topicId: string;
    folderId: string | null;
    createdBy: string;
    /** Defaults to `Difficulty.Medium` — override to test filter composition. */
    difficulty?: Difficulty;
  }): Promise<string> {
    const [row] = await db
      .insert(questions)
      .values({
        tenantId: input.tenantId,
        topicId: input.topicId,
        folderId: input.folderId,
        difficulty: input.difficulty ?? Difficulty.Medium,
        gradeLevel: "secundaria_4",
        status: "approved",
        type: "structured",
        bodyTypst: `Enunciado ${randomUUID()}`,
        bodyHash: randomUUID(),
        alternatives: ["a", "b", "c", "d"],
        correctAnswer: "0",
        createdBy: input.createdBy,
      })
      .returning({ id: questions.id });

    insertedQuestionIds.push(row!.id);
    return row!.id;
  }

  async function makeFolder(token: string, body: Record<string, unknown>): Promise<any> {
    const response = await createFolderRequest(token).send(body).expect(201);
    createdFolderIds.push(response.body.id);
    return response.body;
  }

  /** Flattens the nested response so a test can assert on one node without walking children by hand. */
  function flatten(nodes: readonly any[]): any[] {
    return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
  }

  it("seeds the default tree on the tenant's FIRST call: a root per stage, a folder per course, a folder per topic, roots in school-progression order", async () => {
    const response = await foldersRequest(tokenA).expect(200);
    const all = flatten(response.body.folders);

    // Every root is a fixed STAGE, never a per-course thing — the local
    // catalog already has courses in all three stages (seeded independently
    // of this fixture), so this is an EXACT match, not `arrayContaining`.
    expect(response.body.folders.map((node: any) => [node.name, node.position])).toEqual([
      ["Escuela", 0],
      ["Colegio", 1],
      ["Preuniversitario", 2],
    ]);

    const courseFolder = all.find((node) => node.name === `ZZ Folders Colegio ${suffix}`);
    expect(courseFolder).toBeDefined();
    expect(courseFolder.topicId).toBeNull();

    const topicFolders = all.filter((node) => node.parentId === courseFolder.id);
    // One folder per TOPIC, named exactly like the topic — no grade suffix
    // exists any more, because two topics of one course can no longer share a
    // name (`topics_course_id_name_idx`).
    expect(topicFolders.map((node) => node.name)).toEqual([`Trigo ${suffix}`]);
    expect(topicFolders.map((node) => node.topicId)).toEqual([sharedNameTopicId]);

    // A topic whose name is unique in its course keeps its bare name.
    expect(all.find((node) => node.topicId === preTopicId).name).toBe(`Arco ${suffix}`);
  });

  it("keeps tenants isolated — B's tree shares no folder id with A's, and a lookup scoped to B never returns A's row", async () => {
    // Captured HERE, from a fresh call, rather than relying on a side effect
    // left over by another `it` — A's tree still fully exists at this point.
    const responseA = await foldersRequest(tokenA).expect(200);
    const idsA = flatten(responseA.body.folders).map((node: any) => node.id);
    expect(idsA.length).toBeGreaterThan(0);

    // B's FIRST call — seeds independently from the same global taxonomy.
    const responseB = await foldersRequest(tokenB).expect(200);
    const idsB = flatten(responseB.body.folders).map((node: any) => node.id);
    expect(idsB.length).toBeGreaterThan(0);

    for (const idA of idsA) {
      expect(idsB).not.toContain(idA);
    }

    // Persistence-level check, independent of how the controller assembles
    // the tree: a query scoped to tenant B can never resolve one of A's ids,
    // because `tenant_id` is part of the row, not of the lookup.
    const [oneOfAsFolderId] = idsA;
    const crossTenantRow = await db
      .select({ id: questionFolders.id })
      .from(questionFolders)
      .where(and(eq(questionFolders.id, oneOfAsFolderId), eq(questionFolders.tenantId, tenantBId)));
    expect(crossTenantRow).toEqual([]);
  });

  it("computes direct (non-rolled-up) ownCount/centralCount and unfiledCount from real rows", async () => {
    const treeA = flatten((await foldersRequest(tokenA).expect(200)).body.folders);
    const topicFolderA = treeA.find((node) => node.topicId === sharedNameTopicId);
    const courseFolderA = treeA.find((node) => node.id === topicFolderA.parentId);

    const treeB = flatten((await foldersRequest(tokenB).expect(200)).body.folders);
    const topicFolderB = treeB.find((node) => node.topicId === sharedNameTopicId);

    const baseRow = {
      topicId: sharedNameTopicId,
      difficulty: Difficulty.Easy,
      gradeLevel: "secundaria_4",
      correctAnswer: "a",
    };

    // Tenant A's own question, filed under the topic folder.
    const [ownA] = await db
      .insert(questions)
      .values({ ...baseRow, tenantId: tenantAId, folderId: topicFolderA.id, createdBy: teacherAId })
      .returning({ id: questions.id });
    // A CENTRAL question of the SAME topic — visible inside both A's and
    // B's folder for that topic, without belonging to either (never carries a folderId).
    const [central] = await db
      .insert(questions)
      .values({ ...baseRow, tenantId: null, folderId: null, createdBy: teacherAId })
      .returning({ id: questions.id });
    // Tenant A's own question with no folder at all.
    const [unfiledA] = await db
      .insert(questions)
      .values({ ...baseRow, tenantId: tenantAId, folderId: null, createdBy: teacherAId })
      .returning({ id: questions.id });
    insertedQuestionIds.push(ownA!.id, central!.id, unfiledA!.id);

    const responseA = await foldersRequest(tokenA).expect(200);
    const allA = flatten(responseA.body.folders);
    const refreshedTopicFolderA = allA.find((node) => node.id === topicFolderA.id);
    const refreshedCourseFolderA = allA.find((node) => node.id === courseFolderA.id);

    expect(refreshedTopicFolderA).toMatchObject({ ownCount: 1, centralCount: 1 });
    // Direct counts only — the parent course folder does NOT roll up its
    // children's counts.
    expect(refreshedCourseFolderA).toMatchObject({ ownCount: 0, centralCount: 0 });
    expect(responseA.body.unfiledCount).toBe(1);

    const responseB = await foldersRequest(tokenB).expect(200);
    const refreshedTopicFolderB = flatten(responseB.body.folders).find((node) => node.id === topicFolderB.id);

    // Same central question, visible through B's OWN folder for that topic —
    // but none of A's own/unfiled rows leak into B's counts.
    expect(refreshedTopicFolderB).toMatchObject({ ownCount: 0, centralCount: 1 });
    expect(responseB.body.unfiledCount).toBe(0);
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
    // Safe to run now (after the counts test above): the questions it
    // inserted are cleaned up separately, by id, in `afterAll`, and
    // `ON DELETE SET NULL` means deleting these folders only unfiles them.
    await db.delete(questionFolders).where(eq(questionFolders.tenantId, tenantAId));
    const second = await foldersRequest(tokenA).expect(200);

    expect(before).toBeGreaterThan(0);
    expect(second.body.folders).toEqual([]);
  });

  it("returns unfiledCount and per-folder counts, both zero for a folder the counts test never touched", async () => {
    // B's "Arco" topic folder — the counts test above only ever inserted
    // rows against `sharedNameTopicId`, so this one stays untouched.
    const response = await foldersRequest(tokenB).expect(200);
    const node = flatten(response.body.folders).find((n: any) => n.topicId === preTopicId);

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

  describe("GET /bank/questions?folderId=", () => {
    function listRequest(token: string) {
      return request(app.getHttpServer()).get("/bank/questions").set("Authorization", `Bearer ${token}`);
    }

    it("mixes the folder's OWN questions with the CENTRAL ones of its topic", async () => {
      const [seeded] = await db
        .select({ id: questionFolders.id })
        .from(questionFolders)
        .where(and(eq(questionFolders.tenantId, tenantBId), eq(questionFolders.topicId, preTopicId)));

      const own = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: seeded!.id,
        createdBy: teacherBId,
      });

      try {
        const central = await insertQuestion({
          tenantId: null,
          topicId: preTopicId,
          folderId: null,
          createdBy: staffUserId,
        });
        // Same tenant, same topic, but filed nowhere -> must NOT appear.
        const unrelated = await insertQuestion({
          tenantId: tenantBId,
          topicId: preTopicId,
          folderId: null,
          createdBy: teacherBId,
        });

        const response = await listRequest(tokenB).query({ folderId: seeded!.id }).expect(200);
        const ids = response.body.map((row: any) => row.id);

        expect(ids).toEqual(expect.arrayContaining([own, central]));
        expect(ids).not.toContain(unrelated);
      } finally {
        // Unfile OWN before the later DELETE-folder tests run: this suite reuses
        // the tenant's SEEDED per-topic folder (the only one that ever carries a
        // `topicId`), and `bank-folders.e2e.spec.ts`'s own "leaves CENTRAL
        // questions completely untouched" DELETE test asserts `unfiledQuestions:
        // 0` when it later deletes this same folder — a row left filed here
        // (even from a FAILED assertion above) would falsify that unrelated
        // assertion, so this runs unconditionally.
        await db.update(questions).set({ folderId: null }).where(eq(questions.id, own));
      }
    });

    it("returns each row's folderId so the client can render where it lives", async () => {
      const folder = await makeFolder(tokenB, { name: `Con folderId ${randomUUID()}` });
      const own = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: folder.id,
        createdBy: teacherBId,
      });

      const response = await listRequest(tokenB).query({ folderId: folder.id }).expect(200);
      expect(response.body.find((row: any) => row.id === own).folderId).toBe(folder.id);
    });

    it("folderId=unfiled returns ONLY the tenant's own questions with no folder — never central ones", async () => {
      const unfiled = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: null,
        createdBy: teacherBId,
      });
      const central = await insertQuestion({
        tenantId: null,
        topicId: preTopicId,
        folderId: null,
        createdBy: staffUserId,
      });

      const response = await listRequest(tokenB).query({ folderId: "unfiled" }).expect(200);
      const ids = response.body.map((row: any) => row.id);

      expect(ids).toContain(unfiled);
      expect(ids).not.toContain(central);
    });

    it("a folder with no topicId returns only its own questions", async () => {
      const folder = await makeFolder(tokenB, { name: `Sin tema ${randomUUID()}` });
      const own = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: folder.id,
        createdBy: teacherBId,
      });
      const central = await insertQuestion({
        tenantId: null,
        topicId: preTopicId,
        folderId: null,
        createdBy: staffUserId,
      });

      const response = await listRequest(tokenB).query({ folderId: folder.id }).expect(200);
      const ids = response.body.map((row: any) => row.id);

      expect(ids).toEqual([own]);
      expect(ids).not.toContain(central);
    });

    it("rejects another tenant's folder with 404 folder_not_found", async () => {
      const folderOfB = await makeFolder(tokenB, { name: `Privada ${randomUUID()}` });

      const response = await listRequest(tokenA).query({ folderId: folderOfB.id }).expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("rejects a non-uuid folderId with 404 folder_not_found instead of leaking a Postgres error", async () => {
      const response = await listRequest(tokenB).query({ folderId: "abc" }).expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("composes with another filter — folderId AND difficulty narrow to the matching subset", async () => {
      const folder = await makeFolder(tokenB, { name: `Compuesta ${randomUUID()}` });
      const matching = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: folder.id,
        createdBy: teacherBId,
        difficulty: Difficulty.Hard,
      });
      await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: folder.id,
        createdBy: teacherBId,
        difficulty: Difficulty.Easy,
      });

      const response = await listRequest(tokenB)
        .query({ folderId: folder.id, difficulty: Difficulty.Hard, page: "1", pageSize: "10" })
        .expect(200);

      expect(response.body).toMatchObject({ total: 1 });
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].id).toBe(matching);
    });

    it("keeps working with pagination", async () => {
      const folder = await makeFolder(tokenB, { name: `Paginada ${randomUUID()}` });
      await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: folder.id,
        createdBy: teacherBId,
      });

      const response = await listRequest(tokenB)
        .query({ folderId: folder.id, page: "1", pageSize: "10" })
        .expect(200);

      expect(response.body).toMatchObject({ total: 1 });
      expect(response.body.items).toHaveLength(1);
    });
  });

  describe("POST /bank/folders", () => {
    it("creates a root folder and returns the node, appended after existing roots", async () => {
      const folder = await makeFolder(tokenB, { name: "  Mis apuntes  " });

      expect(folder).toMatchObject({
        name: "Mis apuntes", // trimmed
        parentId: null,
        topicId: null,
        ownCount: 0,
        centralCount: 0,
        children: [],
      });
      expect(typeof folder.id).toBe("string");
    });

    it("creates a child under an existing folder", async () => {
      const parent = await makeFolder(tokenB, { name: `Padre ${randomUUID()}` });
      const child = await makeFolder(tokenB, { name: "Hija", parentId: parent.id });

      expect(child.parentId).toBe(parent.id);
    });

    it("rejects an empty name with 422 folder_name_invalid", async () => {
      const response = await createFolderRequest(tokenB).send({ name: "   " }).expect(422);
      expect(response.body).toMatchObject({ code: "folder_name_invalid" });
    });

    it("rejects a name longer than 80 characters with 422 folder_name_invalid", async () => {
      const response = await createFolderRequest(tokenB)
        .send({ name: "a".repeat(81) })
        .expect(422);
      expect(response.body).toMatchObject({ code: "folder_name_invalid" });
    });

    it("rejects a duplicate name among siblings with 409 folder_name_taken", async () => {
      const name = `Repetida ${randomUUID()}`;
      await makeFolder(tokenB, { name });

      const response = await createFolderRequest(tokenB).send({ name }).expect(409);
      expect(response.body).toMatchObject({ code: "folder_name_taken" });
    });

    it("allows the same name under a DIFFERENT parent", async () => {
      const parent = await makeFolder(tokenB, { name: `Otro padre ${randomUUID()}` });
      const name = `Compartida ${randomUUID()}`;
      await makeFolder(tokenB, { name });

      const nested = await makeFolder(tokenB, { name, parentId: parent.id });
      expect(nested.name).toBe(name);
    });

    it("rejects a parent that belongs to another tenant with 404 folder_not_found", async () => {
      const parentOfB = await makeFolder(tokenB, { name: `Ajena ${randomUUID()}` });

      const response = await createFolderRequest(tokenA)
        .send({ name: "Intrusa", parentId: parentOfB.id })
        .expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("rejects a non-uuid parentId with 404 folder_not_found instead of leaking a Postgres error", async () => {
      const response = await createFolderRequest(tokenB)
        .send({ name: `Malformada ${randomUUID()}`, parentId: "abc" })
        .expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("assigns a new root the next position after the current highest root", async () => {
      const before = await foldersRequest(tokenB).expect(200);
      const rootPositions = before.body.folders.map((node: any) => node.position);
      const maxBefore = rootPositions.length > 0 ? Math.max(...rootPositions) : -1;

      const folder = await makeFolder(tokenB, { name: `Segunda raíz ${randomUUID()}` });

      expect(folder.position).toBe(maxBefore + 1);
    });

    it("rejects a 7th level with 422 folder_depth_exceeded", async () => {
      let parentId: string | null = null;
      for (let level = 1; level <= 6; level += 1) {
        const node = await makeFolder(tokenB, { name: `N${level} ${randomUUID()}`, parentId });
        parentId = node.id;
      }

      const response = await createFolderRequest(tokenB).send({ name: "N7", parentId }).expect(422);
      expect(response.body).toMatchObject({ code: "folder_depth_exceeded" });
    });

    it("rejects a user with no tenant with 403 tenant_required", async () => {
      const response = await createFolderRequest(staffToken).send({ name: "X" }).expect(403);
      expect(response.body).toMatchObject({ code: "tenant_required" });
    });
  });

  describe("PATCH /bank/folders/:id", () => {
    it("renames a folder", async () => {
      const folder = await makeFolder(tokenB, { name: `Antes ${randomUUID()}` });
      const renamed = `Después ${randomUUID()}`;

      const response = await patchFolderRequest(tokenB, folder.id).send({ name: renamed }).expect(200);
      expect(response.body).toMatchObject({ id: folder.id, name: renamed, parentId: null });
    });

    it("moves a folder under another parent", async () => {
      const parent = await makeFolder(tokenB, { name: `Destino ${randomUUID()}` });
      const child = await makeFolder(tokenB, { name: `Viajera ${randomUUID()}` });

      const response = await patchFolderRequest(tokenB, child.id).send({ parentId: parent.id }).expect(200);
      expect(response.body.parentId).toBe(parent.id);
    });

    it("moves a folder to the next position among its new siblings", async () => {
      const parent = await makeFolder(tokenB, { name: `Posición padre ${randomUUID()}` });
      const existingSibling = await makeFolder(tokenB, {
        name: `Hermano existente ${randomUUID()}`,
        parentId: parent.id,
      });
      const mover = await makeFolder(tokenB, { name: `Viajera posición ${randomUUID()}` });

      const response = await patchFolderRequest(tokenB, mover.id).send({ parentId: parent.id }).expect(200);

      expect(response.body.position).toBe(existingSibling.position + 1);
    });

    it("moves a folder back to the root with parentId: null", async () => {
      const parent = await makeFolder(tokenB, { name: `Origen ${randomUUID()}` });
      const child = await makeFolder(tokenB, { name: `Hija ${randomUUID()}`, parentId: parent.id });

      const response = await patchFolderRequest(tokenB, child.id).send({ parentId: null }).expect(200);
      expect(response.body.parentId).toBeNull();
    });

    it("renames and moves in one request", async () => {
      const parent = await makeFolder(tokenB, { name: `Combo padre ${randomUUID()}` });
      const folder = await makeFolder(tokenB, { name: `Combo ${randomUUID()}` });
      const newName = `Combo nuevo ${randomUUID()}`;

      const response = await patchFolderRequest(tokenB, folder.id)
        .send({ name: newName, parentId: parent.id })
        .expect(200);
      expect(response.body).toMatchObject({ name: newName, parentId: parent.id });
    });

    it("rejects moving a folder into itself with 422 folder_cycle", async () => {
      const folder = await makeFolder(tokenB, { name: `Autoref ${randomUUID()}` });

      const response = await patchFolderRequest(tokenB, folder.id).send({ parentId: folder.id }).expect(422);
      expect(response.body).toMatchObject({ code: "folder_cycle" });
    });

    it("rejects moving a folder into its own descendant with 422 folder_cycle", async () => {
      const root = await makeFolder(tokenB, { name: `Abuela ${randomUUID()}` });
      const child = await makeFolder(tokenB, { name: `Madre ${randomUUID()}`, parentId: root.id });
      const grandchild = await makeFolder(tokenB, { name: `Nieta ${randomUUID()}`, parentId: child.id });

      const response = await patchFolderRequest(tokenB, root.id)
        .send({ parentId: grandchild.id })
        .expect(422);
      expect(response.body).toMatchObject({ code: "folder_cycle" });
    });

    it("allows a move that lands the subtree's deepest leaf EXACTLY at level 6", async () => {
      // A target parent chain of depth 3…
      let parentId: string | null = null;
      for (let level = 1; level <= 3; level += 1) {
        const node = await makeFolder(tokenB, { name: `P${level} ${randomUUID()}`, parentId });
        parentId = node.id;
      }

      // …and a subtree of height 3: 3 + 3 = 6, exactly the cap.
      const root = await makeFolder(tokenB, { name: `Raíz límite ${randomUUID()}` });
      const child = await makeFolder(tokenB, { name: `Hijo límite ${randomUUID()}`, parentId: root.id });
      await makeFolder(tokenB, { name: `Nieto límite ${randomUUID()}`, parentId: child.id });

      const response = await patchFolderRequest(tokenB, root.id).send({ parentId }).expect(200);
      expect(response.body.parentId).toBe(parentId);
    });

    it("rejects a move whose SUBTREE would pass level 6 with 422 folder_depth_exceeded", async () => {
      // A 3-level subtree…
      const a = await makeFolder(tokenB, { name: `A ${randomUUID()}` });
      const b = await makeFolder(tokenB, { name: `B ${randomUUID()}`, parentId: a.id });
      await makeFolder(tokenB, { name: `C ${randomUUID()}`, parentId: b.id });

      // …dropped under a parent at level 4 would put its deepest leaf at 7.
      let parentId: string | null = null;
      for (let level = 1; level <= 4; level += 1) {
        const node = await makeFolder(tokenB, { name: `D${level} ${randomUUID()}`, parentId });
        parentId = node.id;
      }

      const response = await patchFolderRequest(tokenB, a.id).send({ parentId }).expect(422);
      expect(response.body).toMatchObject({ code: "folder_depth_exceeded" });
    });

    it("rejects a rename that collides with a sibling with 409 folder_name_taken", async () => {
      const taken = `Ocupado ${randomUUID()}`;
      await makeFolder(tokenB, { name: taken });
      const other = await makeFolder(tokenB, { name: `Libre ${randomUUID()}` });

      const response = await patchFolderRequest(tokenB, other.id).send({ name: taken }).expect(409);
      expect(response.body).toMatchObject({ code: "folder_name_taken" });
    });

    it("rejects moving a folder under a parent that already has a same-named child with 409 folder_name_taken", async () => {
      const dupName = `Dup ${randomUUID()}`;
      const parent = await makeFolder(tokenB, { name: `Padre colisión ${randomUUID()}` });
      await makeFolder(tokenB, { name: dupName, parentId: parent.id });
      const mover = await makeFolder(tokenB, { name: dupName });

      const response = await patchFolderRequest(tokenB, mover.id).send({ parentId: parent.id }).expect(409);
      expect(response.body).toMatchObject({ code: "folder_name_taken" });
    });

    it("allows renaming+moving to a name that only collided with a FORMER sibling under the OLD parent", async () => {
      const oldParent = await makeFolder(tokenB, { name: `Padre viejo ${randomUUID()}` });
      const formerSiblingName = `Compartido ${randomUUID()}`;
      await makeFolder(tokenB, { name: formerSiblingName, parentId: oldParent.id });
      const mover = await makeFolder(tokenB, {
        name: `Original ${randomUUID()}`,
        parentId: oldParent.id,
      });
      const newParent = await makeFolder(tokenB, { name: `Padre nuevo ${randomUUID()}` });

      // Collision is judged against the NEW parent (empty), never the old one
      // the former sibling still lives under.
      const response = await patchFolderRequest(tokenB, mover.id)
        .send({ name: formerSiblingName, parentId: newParent.id })
        .expect(200);
      expect(response.body).toMatchObject({ name: formerSiblingName, parentId: newParent.id });
    });

    it("rejects an invalid name with 422 folder_name_invalid", async () => {
      const folder = await makeFolder(tokenB, { name: `Válida ${randomUUID()}` });

      const response = await patchFolderRequest(tokenB, folder.id).send({ name: "" }).expect(422);
      expect(response.body).toMatchObject({ code: "folder_name_invalid" });
    });

    it("rejects another tenant's folder with 404 folder_not_found", async () => {
      const folderOfB = await makeFolder(tokenB, { name: `Suya ${randomUUID()}` });

      const response = await patchFolderRequest(tokenA, folderOfB.id).send({ name: "Robada" }).expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("rejects a target parent from another tenant with 404 folder_not_found", async () => {
      const folderOfB = await makeFolder(tokenB, { name: `Mía ${randomUUID()}` });
      const [folderOfA] = await db
        .insert(questionFolders)
        .values({ tenantId: tenantAId, parentId: null, name: `De A ${randomUUID()}`, position: 0 })
        .returning({ id: questionFolders.id });
      createdFolderIds.push(folderOfA!.id);

      const response = await patchFolderRequest(tokenB, folderOfB.id)
        .send({ parentId: folderOfA!.id })
        .expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("rejects a non-uuid parentId with 404 folder_not_found instead of leaking a Postgres error", async () => {
      const folder = await makeFolder(tokenB, { name: `Blindada ${randomUUID()}` });

      const response = await patchFolderRequest(tokenB, folder.id).send({ parentId: "abc" }).expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });
  });

  describe("folderId on question write paths", () => {
    function structuredRequest(token: string) {
      return request(app.getHttpServer())
        .post("/bank/questions/structured")
        .set("Authorization", `Bearer ${token}`);
    }

    function patchQuestionRequest(token: string, id: string) {
      return request(app.getHttpServer())
        .patch(`/bank/questions/${id}`)
        .set("Authorization", `Bearer ${token}`);
    }

    function imageRequest(token: string) {
      return request(app.getHttpServer())
        .post("/bank/questions/image")
        .set("Authorization", `Bearer ${token}`);
    }

    function getQuestionRequest(token: string, id: string) {
      return request(app.getHttpServer())
        .get(`/bank/questions/${id}`)
        .set("Authorization", `Bearer ${token}`);
    }

    /** Tracks the uploaded question AND its backing asset row, both cleaned up in `afterAll`. */
    async function trackCreatedImageQuestion(id: string): Promise<void> {
      createdQuestionIds.push(id);
      const [row] = await db
        .select({ imageAssetId: questions.imageAssetId })
        .from(questions)
        .where(eq(questions.id, id));
      if (row?.imageAssetId) {
        createdAssetIds.push(row.imageAssetId);
      }
    }

    it("POST /bank/questions/image stores the folderId from a multipart form field", async () => {
      const folder = await makeFolder(tokenB, { name: `Imagen ${randomUUID()}` });

      const response = await imageRequest(tokenB)
        .field("courseId", coursePreId)
        .field("topicId", preTopicId)
        .field("difficulty", "medium")
        .field("gradeLevel", "secundaria_4")
        .field("correctAnswer", "b")
        .field("folderId", folder.id)
        .attach("image", fakePng(), "q.png")
        .expect(201);
      await trackCreatedImageQuestion(response.body.id);

      const [row] = await db
        .select({ folderId: questions.folderId })
        .from(questions)
        .where(eq(questions.id, response.body.id));
      expect(row!.folderId).toBe(folder.id);
    });

    it("POST /bank/questions/image treats a blank folderId form field as absent", async () => {
      const response = await imageRequest(tokenB)
        .field("courseId", coursePreId)
        .field("topicId", preTopicId)
        .field("difficulty", "medium")
        .field("gradeLevel", "secundaria_4")
        .field("correctAnswer", "b")
        .field("folderId", "")
        .attach("image", fakePng(), "q.png")
        .expect(201);
      await trackCreatedImageQuestion(response.body.id);

      const [row] = await db
        .select({ folderId: questions.folderId })
        .from(questions)
        .where(eq(questions.id, response.body.id));
      expect(row!.folderId).toBeNull();
    });

    it("POST /bank/questions/structured stores the folderId", async () => {
      const folder = await makeFolder(tokenB, { name: `Destino nuevo ${randomUUID()}` });

      const created = await structuredRequest(tokenB)
        .send({
          courseId: coursePreId,
          topicId: preTopicId,
          difficulty: "medium",
          gradeLevel: "secundaria_4",
          bodyTypst: `Enunciado ${randomUUID()}`,
          alternatives: ["a", "b", "c", "d"],
          correctAnswer: "0",
          folderId: folder.id,
        })
        .expect(201);
      createdQuestionIds.push(created.body.id);

      const [row] = await db
        .select({ folderId: questions.folderId })
        .from(questions)
        .where(eq(questions.id, created.body.id));
      expect(row!.folderId).toBe(folder.id);
    });

    it("PATCH /bank/questions/:id moves a question into a folder", async () => {
      const folder = await makeFolder(tokenB, { name: `Mudanza ${randomUUID()}` });
      const questionId = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: null,
        createdBy: teacherBId,
      });

      const response = await patchQuestionRequest(tokenB, questionId)
        .send({ folderId: folder.id })
        .expect(200);
      expect(response.body.folderId).toBe(folder.id);

      // GET /bank/questions/:id must reflect the same write, not just the PATCH response.
      const fetched = await getQuestionRequest(tokenB, questionId).expect(200);
      expect(fetched.body.folderId).toBe(folder.id);
    });

    it("PATCH with folderId: null unfiles a question", async () => {
      const folder = await makeFolder(tokenB, { name: `Salida ${randomUUID()}` });
      const questionId = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: folder.id,
        createdBy: teacherBId,
      });

      const response = await patchQuestionRequest(tokenB, questionId).send({ folderId: null }).expect(200);
      expect(response.body.folderId).toBeNull();
    });

    it("rejects a folder from another tenant with 404 folder_not_found", async () => {
      const folderOfB = await makeFolder(tokenB, { name: `De B ${randomUUID()}` });
      const questionOfA = await insertQuestion({
        tenantId: tenantAId,
        topicId: preTopicId,
        folderId: null,
        createdBy: teacherAId,
      });

      const response = await patchQuestionRequest(tokenA, questionOfA)
        .send({ folderId: folderOfB.id })
        .expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("PATCH rejects a non-uuid folderId with 404 folder_not_found instead of leaking a Postgres error", async () => {
      const questionId = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: null,
        createdBy: teacherBId,
      });

      const response = await patchQuestionRequest(tokenB, questionId).send({ folderId: "abc" }).expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("POST /bank/questions/structured rejects a non-uuid folderId with 404 folder_not_found", async () => {
      const response = await structuredRequest(tokenB)
        .send({
          courseId: coursePreId,
          topicId: preTopicId,
          difficulty: "medium",
          gradeLevel: "secundaria_4",
          bodyTypst: `Enunciado ${randomUUID()}`,
          alternatives: ["a", "b", "c", "d"],
          correctAnswer: "0",
          folderId: "abc",
        })
        .expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("rejects filing a CENTRAL question with 422 central_question_has_no_folder", async () => {
      const centralQuestionId = await insertQuestion({
        tenantId: null,
        topicId: preTopicId,
        folderId: null,
        createdBy: staffUserId,
      });

      const response = await patchQuestionRequest(staffToken, centralQuestionId)
        .send({ folderId: randomUUID() })
        .expect(422);
      expect(response.body).toMatchObject({ code: "central_question_has_no_folder" });
    });

    it("leaves folderId alone when the PATCH body does not mention it", async () => {
      const folder = await makeFolder(tokenB, { name: `Estable ${randomUUID()}` });
      const questionId = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: folder.id,
        createdBy: teacherBId,
      });

      const response = await patchQuestionRequest(tokenB, questionId)
        .send({ difficulty: "hard" })
        .expect(200);
      expect(response.body.folderId).toBe(folder.id);
    });
  });

  describe("DELETE /bank/folders/:id", () => {
    it("deletes the whole subtree and unfiles the tenant's own questions, without deleting a single question", async () => {
      const root = await makeFolder(tokenB, { name: `Borrable ${randomUUID()}` });
      const child = await makeFolder(tokenB, { name: `Hija ${randomUUID()}`, parentId: root.id });

      const inRoot = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: root.id,
        createdBy: teacherBId,
      });
      const inChild = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: child.id,
        createdBy: teacherBId,
      });

      const response = await deleteFolderRequest(tokenB, root.id).expect(200);
      expect(response.body).toEqual({ deletedFolders: 2, unfiledQuestions: 2 });

      const rows = await db
        .select({ id: questions.id, folderId: questions.folderId })
        .from(questions)
        .where(inArray(questions.id, [inRoot, inChild]));

      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.folderId === null)).toBe(true);

      const remaining = await db
        .select({ id: questionFolders.id })
        .from(questionFolders)
        .where(inArray(questionFolders.id, [root.id, child.id]));
      expect(remaining).toEqual([]);
    });

    it("leaves CENTRAL questions completely untouched — they were never filed here", async () => {
      // Both tenants seed their own copy of the "Arco" topic folder from the
      // same global taxonomy, so this is scoped to B's row explicitly rather
      // than picking whichever of the two rows Postgres happens to return
      // first — deleting with `tokenB` against A's copy would 404.
      const topicFolders = await db
        .select({
          id: questionFolders.id,
          topicId: questionFolders.topicId,
          tenantId: questionFolders.tenantId,
        })
        .from(questionFolders)
        .where(eq(questionFolders.topicId, preTopicId));
      const seeded = topicFolders.find((row) => row.tenantId === tenantBId)!;

      const centralQuestionId = await insertQuestion({
        tenantId: null,
        topicId: preTopicId,
        folderId: null,
        createdBy: staffUserId,
      });

      const response = await deleteFolderRequest(tokenB, seeded.id).expect(200);
      expect(response.body.unfiledQuestions).toBe(0);

      const [central] = await db
        .select({ id: questions.id, topicId: questions.topicId, folderId: questions.folderId })
        .from(questions)
        .where(eq(questions.id, centralQuestionId));

      expect(central).toMatchObject({ topicId: preTopicId, folderId: null });
    });

    it("does not touch another tenant's folders", async () => {
      const [folderOfA] = await db
        .insert(questionFolders)
        .values({ tenantId: tenantAId, parentId: null, name: `Intacta ${randomUUID()}`, position: 0 })
        .returning({ id: questionFolders.id });
      createdFolderIds.push(folderOfA!.id);

      const mine = await makeFolder(tokenB, { name: `Propia ${randomUUID()}` });
      await deleteFolderRequest(tokenB, mine.id).expect(200);

      const [stillThere] = await db
        .select({ id: questionFolders.id })
        .from(questionFolders)
        .where(eq(questionFolders.id, folderOfA!.id));
      expect(stillThere).toBeDefined();
    });

    it("rejects another tenant's folder with 404 folder_not_found", async () => {
      const folderOfB = await makeFolder(tokenB, { name: `Ajena del A ${randomUUID()}` });

      const response = await deleteFolderRequest(tokenA, folderOfB.id).expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("rejects a second delete of the same folder with 404 — the two-tab case", async () => {
      const folder = await makeFolder(tokenB, { name: `Doble ${randomUUID()}` });
      await deleteFolderRequest(tokenB, folder.id).expect(200);

      const response = await deleteFolderRequest(tokenB, folder.id).expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });
  });
});
