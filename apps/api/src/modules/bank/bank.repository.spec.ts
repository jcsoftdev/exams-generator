import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { inArray } from "drizzle-orm";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { assets, courses, questions, tenants, topics, users } from "../../db/schema";
import { QuestionStatus } from "../../db/schema/enums";
import { BankRepository } from "./bank.repository";

/**
 * Integration test against the real docker-compose Postgres — same pattern
 * as `db/seed-idempotency.spec.ts`. Every fixture uses a random suffix so
 * repeated runs never collide, and `afterAll` deletes everything this file
 * created so the shared dev DB doesn't grow unbounded.
 */
describe("BankRepository", () => {
  const repository = new BankRepository();

  let courseId: string;
  let topicId: string;
  let otherTopicId: string;
  let centralUserId: string;
  let tenantAId: string;
  let tenantAUserId: string;
  let tenantBId: string;
  let tenantBUserId: string;
  // Control tenant this file NEVER writes to — its aggregate delta cancels
  // concurrent central-question noise from other spec files (see the
  // countByDifficultyAndStatus describe below).
  let tenantCId: string;

  const createdQuestionIds: string[] = [];
  const createdAssetIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `Test Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `Test Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [topicOther] = await db
      .insert(topics)
      .values({ courseId, name: `Other Topic ${suffix}` })
      .returning({ id: topics.id });
    otherTopicId = topicOther!.id;

    const [centralUser] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: `staff-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.ContentEditor,
      })
      .returning({ id: users.id });
    centralUserId = centralUser!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `Tenant A ${suffix}`, slug: `tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [tenantAUser] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantAUserId = tenantAUser!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `Tenant B ${suffix}`, slug: `tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [tenantBUser] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `teacher-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantBUserId = tenantBUser!.id;

    const [tenantC] = await db
      .insert(tenants)
      .values({ name: `Tenant C (control) ${suffix}`, slug: `tenant-c-${suffix}` })
      .returning({ id: tenants.id });
    tenantCId = tenantC!.id;
  });

  afterAll(async () => {
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    if (createdAssetIds.length > 0) {
      await db.delete(assets).where(inArray(assets.id, createdAssetIds));
    }
    await db.delete(users).where(inArray(users.id, [centralUserId, tenantAUserId, tenantBUserId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId, tenantCId]));
    await db.delete(topics).where(inArray(topics.id, [topicId, otherTopicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await pool.end();
  });

  async function createQuestion(params: {
    tenantId: string | null;
    createdBy: string;
    topicId?: string;
    difficulty?: Difficulty;
    gradeLevel?: string;
  }): Promise<string> {
    const { id } = await repository.createImageQuestion({
      tenantId: params.tenantId,
      topicId: params.topicId ?? topicId,
      difficulty: params.difficulty ?? Difficulty.Easy,
      gradeLevel: params.gradeLevel ?? "primaria_1",
      correctAnswer: "a",
      createdBy: params.createdBy,
      image: { storageKey: `test/${randomUUID()}`, mime: "image/png" },
    });
    createdQuestionIds.push(id);

    const [row] = await db.select({ imageAssetId: questions.imageAssetId }).from(questions).where(inArray(questions.id, [id]));
    if (row?.imageAssetId) {
      createdAssetIds.push(row.imageAssetId);
    }

    return id;
  }

  it("createImageQuestion() persists a question row with status='approved' and its backing asset row", async () => {
    const id = await createQuestion({ tenantId: null, createdBy: centralUserId });

    const [row] = await db.select().from(questions).where(inArray(questions.id, [id]));
    expect(row?.status).toBe("approved");
    expect(row?.type).toBe("image");
    expect(row?.imageAssetId).toBeTruthy();

    const [assetRow] = await db
      .select()
      .from(assets)
      .where(inArray(assets.id, row?.imageAssetId ? [row.imageAssetId] : []));
    expect(assetRow).toBeDefined();
  });

  async function createStructuredQuestion(params: {
    tenantId: string | null;
    createdBy: string;
    topicId?: string;
    difficulty?: Difficulty;
    gradeLevel?: string;
  }): Promise<string> {
    const { id } = await repository.createStructuredQuestion({
      tenantId: params.tenantId,
      topicId: params.topicId ?? topicId,
      difficulty: params.difficulty ?? Difficulty.Easy,
      gradeLevel: params.gradeLevel ?? "primaria_1",
      bodyTypst: "$x + 1 = 2$, resuelve para $x$",
      alternatives: ["1", "2", "3"],
      correctAnswer: "0",
      figureCode: undefined,
      createdBy: params.createdBy,
    });
    createdQuestionIds.push(id);
    return id;
  }

  it("createStructuredQuestion() persists a question row with status='approved', type='structured' and no backing asset", async () => {
    const id = await createStructuredQuestion({ tenantId: null, createdBy: centralUserId });

    const [row] = await db.select().from(questions).where(inArray(questions.id, [id]));
    expect(row?.status).toBe("approved");
    expect(row?.type).toBe("structured");
    expect(row?.imageAssetId).toBeNull();
    expect(row?.bodyTypst).toBe("$x + 1 = 2$, resuelve para $x$");
    expect(row?.alternatives).toEqual(["1", "2", "3"]);
    expect(row?.correctAnswer).toBe("0");
  });

  it("createStructuredQuestion() persists figureCode when provided", async () => {
    const { id } = await repository.createStructuredQuestion({
      tenantId: null,
      topicId,
      difficulty: Difficulty.Easy,
      gradeLevel: "primaria_1",
      bodyTypst: "figura triangular",
      alternatives: ["a", "b"],
      correctAnswer: "1",
      figureCode: "cetz.canvas({ /* triangle */ })",
      createdBy: centralUserId,
    });
    createdQuestionIds.push(id);

    const [row] = await db.select().from(questions).where(inArray(questions.id, [id]));
    expect(row?.figureCode).toBe("cetz.canvas({ /* triangle */ })");
  });

  it("listQuestions() and findQuestionById() surface structured fields (bodyTypst/alternatives/figureCode/type)", async () => {
    const id = await createStructuredQuestion({ tenantId: null, createdBy: centralUserId });

    const list = await repository.listQuestions({ currentTenantId: null });
    const listed = list.find((q) => q.id === id);
    expect(listed).toBeDefined();
    expect(listed?.type).toBe("structured");
    expect(listed?.bodyTypst).toBe("$x + 1 = 2$, resuelve para $x$");
    expect(listed?.alternatives).toEqual(["1", "2", "3"]);
    expect(listed?.imageAssetId).toBeNull();

    const byId = await repository.findQuestionById(id, null);
    expect(byId?.type).toBe("structured");
    expect(byId?.bodyTypst).toBe("$x + 1 = 2$, resuelve para $x$");
  });

  it("listQuestions() surfaces type='image' with null structured fields for image questions", async () => {
    const id = await createQuestion({ tenantId: null, createdBy: centralUserId });

    const list = await repository.listQuestions({ currentTenantId: null });
    const listed = list.find((q) => q.id === id);
    expect(listed?.type).toBe("image");
    expect(listed?.bodyTypst).toBeNull();
    expect(listed?.alternatives).toBeNull();
  });

  describe("listQuestions() visibility", () => {
    it("a central (tenantId=null) question is visible to every tenant", async () => {
      const centralId = await createQuestion({ tenantId: null, createdBy: centralUserId });

      const forTenantA = await repository.listQuestions({ currentTenantId: tenantAId });
      const forTenantB = await repository.listQuestions({ currentTenantId: tenantBId });

      expect(forTenantA.map((q) => q.id)).toContain(centralId);
      expect(forTenantB.map((q) => q.id)).toContain(centralId);
    });

    it("a tenant-private question is NEVER visible to another tenant", async () => {
      const privateId = await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId });

      const forTenantA = await repository.listQuestions({ currentTenantId: tenantAId });
      const forTenantB = await repository.listQuestions({ currentTenantId: tenantBId });

      expect(forTenantA.map((q) => q.id)).toContain(privateId);
      expect(forTenantB.map((q) => q.id)).not.toContain(privateId);
    });

    it("is symmetric: tenant B's private question is NEVER visible to tenant A (or platform staff)", async () => {
      const privateId = await createQuestion({ tenantId: tenantBId, createdBy: tenantBUserId });

      const forTenantB = await repository.listQuestions({ currentTenantId: tenantBId });
      const forTenantA = await repository.listQuestions({ currentTenantId: tenantAId });
      const forStaff = await repository.listQuestions({ currentTenantId: null });

      expect(forTenantB.map((q) => q.id)).toContain(privateId);
      expect(forTenantA.map((q) => q.id)).not.toContain(privateId);
      expect(forStaff.map((q) => q.id)).not.toContain(privateId);
    });
  });

  describe("findQuestionById() visibility (release gate: direct-by-id access)", () => {
    it("returns a central (tenantId=null) question for any tenant", async () => {
      const centralId = await createQuestion({ tenantId: null, createdBy: centralUserId });

      const forTenantA = await repository.findQuestionById(centralId, tenantAId);
      const forTenantB = await repository.findQuestionById(centralId, tenantBId);

      expect(forTenantA?.id).toBe(centralId);
      expect(forTenantB?.id).toBe(centralId);
    });

    it("returns a tenant-private question to its own tenant", async () => {
      const privateId = await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId });

      const result = await repository.findQuestionById(privateId, tenantAId);

      expect(result?.id).toBe(privateId);
    });

    it("does NOT return a tenant-private question to another tenant (id enumeration guard)", async () => {
      const privateId = await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId });

      const forTenantB = await repository.findQuestionById(privateId, tenantBId);
      const forStaff = await repository.findQuestionById(privateId, null);

      expect(forTenantB).toBeUndefined();
      expect(forStaff).toBeUndefined();
    });

    it("returns undefined for a non-existent id", async () => {
      const result = await repository.findQuestionById(randomUUID(), tenantAId);

      expect(result).toBeUndefined();
    });
  });

  describe("createStructuredQuestion() draft/AI workflow (Lane D3)", () => {
    it("defaults to status='approved' and aiGenerated=false when not provided (backwards compatible with manual creation)", async () => {
      const id = await createStructuredQuestion({ tenantId: null, createdBy: centralUserId });

      const [row] = await db.select().from(questions).where(inArray(questions.id, [id]));
      expect(row?.status).toBe("approved");
      expect(row?.aiGenerated).toBe(false);
    });

    it("persists status='draft' and aiGenerated=true when explicitly requested (AI generation flow)", async () => {
      const { id } = await repository.createStructuredQuestion({
        tenantId: null,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        bodyTypst: "pregunta generada por IA",
        alternatives: ["1", "2", "3", "4", "5"],
        correctAnswer: "1",
        figureCode: undefined,
        createdBy: centralUserId,
        status: "draft",
        aiGenerated: true,
      });
      createdQuestionIds.push(id);

      const [row] = await db.select().from(questions).where(inArray(questions.id, [id]));
      expect(row?.status).toBe("draft");
      expect(row?.aiGenerated).toBe(true);
    });
  });

  describe("listQuestions() status filter", () => {
    it("filters by status='draft', excluding approved questions", async () => {
      const draftId = (
        await repository.createStructuredQuestion({
          tenantId: null,
          topicId,
          difficulty: Difficulty.Easy,
          gradeLevel: "primaria_1",
          bodyTypst: "draft q",
          alternatives: ["1", "2"],
          correctAnswer: "0",
          figureCode: undefined,
          createdBy: centralUserId,
          status: "draft",
          aiGenerated: true,
        })
      ).id;
      createdQuestionIds.push(draftId);
      const approvedId = await createStructuredQuestion({ tenantId: null, createdBy: centralUserId });

      const drafts = await repository.listQuestions({ currentTenantId: null, status: "draft" });
      const ids = drafts.map((q) => q.id);
      expect(ids).toContain(draftId);
      expect(ids).not.toContain(approvedId);
    });
  });

  describe("findCourseAndTopicNames()", () => {
    it("returns course and topic names when the topic belongs to the course", async () => {
      const result = await repository.findCourseAndTopicNames(courseId, topicId);

      expect(result).toBeDefined();
      expect(result?.courseName).toContain("Test Course");
      expect(result?.topicName).toContain("Test Topic");
    });

    it("returns undefined when the topic does not belong to the given course", async () => {
      const [otherCourse] = await db
        .insert(courses)
        .values({ name: `Unrelated Course ${randomUUID()}` })
        .returning({ id: courses.id });

      const result = await repository.findCourseAndTopicNames(otherCourse!.id, topicId);
      expect(result).toBeUndefined();

      await db.delete(courses).where(inArray(courses.id, [otherCourse!.id]));
    });

    it("returns undefined for a non-existent courseId/topicId", async () => {
      const result = await repository.findCourseAndTopicNames(randomUUID(), randomUUID());
      expect(result).toBeUndefined();
    });
  });

  describe("approveQuestion() / rejectQuestion() / updateStructuredQuestion() (Lane D3 draft workflow)", () => {
    async function createDraft(tenantId: string | null, createdBy: string): Promise<string> {
      const { id } = await repository.createStructuredQuestion({
        tenantId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        bodyTypst: "draft body",
        alternatives: ["1", "2", "3"],
        correctAnswer: "0",
        figureCode: undefined,
        createdBy,
        status: "draft",
        aiGenerated: true,
      });
      createdQuestionIds.push(id);
      return id;
    }

    it("approveQuestion() flips status draft -> approved, scoped to the requester's tenant visibility", async () => {
      const id = await createDraft(null, centralUserId);

      const result = await repository.approveQuestion(id, null);
      expect(result?.status).toBe("approved");

      const [row] = await db.select().from(questions).where(inArray(questions.id, [id]));
      expect(row?.status).toBe("approved");
    });

    it("approveQuestion() returns undefined when the draft belongs to another tenant", async () => {
      const id = await createDraft(tenantAId, tenantAUserId);

      const result = await repository.approveQuestion(id, tenantBId);
      expect(result).toBeUndefined();

      const [row] = await db.select().from(questions).where(inArray(questions.id, [id]));
      expect(row?.status).toBe("draft");
    });

    it("rejectQuestion() deletes the draft row, scoped to the requester's tenant visibility", async () => {
      const id = await createDraft(null, centralUserId);

      const result = await repository.rejectQuestion(id, null);
      expect(result).toBe(true);

      const [row] = await db.select().from(questions).where(inArray(questions.id, [id]));
      expect(row).toBeUndefined();
      createdQuestionIds.splice(createdQuestionIds.indexOf(id), 1);
    });

    it("rejectQuestion() returns false and does NOT delete when the draft belongs to another tenant", async () => {
      const id = await createDraft(tenantAId, tenantAUserId);

      const result = await repository.rejectQuestion(id, tenantBId);
      expect(result).toBe(false);

      const [row] = await db.select().from(questions).where(inArray(questions.id, [id]));
      expect(row).toBeDefined();
    });

    it("updateStructuredQuestion() overwrites bodyTypst/alternatives/correctAnswer/figureCode on a draft", async () => {
      const id = await createDraft(null, centralUserId);

      const result = await repository.updateStructuredQuestion(id, null, {
        bodyTypst: "edited body",
        alternatives: ["a", "b"],
        correctAnswer: "1",
        figureCode: "cetz.canvas({})",
      });

      expect(result?.bodyTypst).toBe("edited body");
      expect(result?.alternatives).toEqual(["a", "b"]);
      expect(result?.correctAnswer).toBe("1");
      expect(result?.figureCode).toBe("cetz.canvas({})");

      const [row] = await db.select().from(questions).where(inArray(questions.id, [id]));
      expect(row?.bodyTypst).toBe("edited body");
    });

    it("updateStructuredQuestion() returns undefined when the draft belongs to another tenant", async () => {
      const id = await createDraft(tenantAId, tenantAUserId);

      const result = await repository.updateStructuredQuestion(id, tenantBId, {
        bodyTypst: "hacked",
        alternatives: ["x", "y"],
        correctAnswer: "0",
        figureCode: undefined,
      });

      expect(result).toBeUndefined();
    });
  });

  describe("listQuestions() filters", () => {
    it("combines courseId, topicId, difficulty and gradeLevel filters", async () => {
      const matching = await createQuestion({
        tenantId: null,
        createdBy: centralUserId,
        topicId,
        difficulty: Difficulty.Hard,
        gradeLevel: "secundaria_3",
      });
      const wrongTopic = await createQuestion({
        tenantId: null,
        createdBy: centralUserId,
        topicId: otherTopicId,
        difficulty: Difficulty.Hard,
        gradeLevel: "secundaria_3",
      });
      const wrongDifficulty = await createQuestion({
        tenantId: null,
        createdBy: centralUserId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "secundaria_3",
      });

      const results = await repository.listQuestions({
        currentTenantId: null,
        courseId,
        topicId,
        difficulty: Difficulty.Hard,
        gradeLevel: "secundaria_3",
      });

      const ids = results.map((q) => q.id);
      expect(ids).toContain(matching);
      expect(ids).not.toContain(wrongTopic);
      expect(ids).not.toContain(wrongDifficulty);
    });
  });

  describe("countByDifficultyAndStatus() — dashboard aggregate", () => {
    // Every assertion below is DIFFERENTIAL: the delta of the tenant under
    // test is compared against the delta of a CONTROL tenant this file never
    // writes to (tenantC). Both aggregates count the same central
    // (tenantId=null) rows, so subtracting the control's delta cancels any
    // central questions inserted CONCURRENTLY by other spec files running in
    // parallel jest workers against this shared dev Postgres — a plain
    // before/after `+1` assertion flakes whenever another suite lands a
    // central row in the same difficulty/status bucket mid-test.
    //
    // Known residual window (accepted): the before-reads (and after-reads)
    // are fired concurrently via Promise.all but are not ONE atomic query,
    // and a concurrent central-row DELETE (another suite's afterAll cleanup)
    // landing mid-test can still offset a delta by ±1. The window is a few
    // ms of network jitter — orders of magnitude smaller than the
    // HTTP-round-trip window the old assertions had.
    async function totalFor(
      tenantId: string | null,
      difficulty: Difficulty,
      status: QuestionStatus,
    ): Promise<number> {
      const rows = await repository.countByDifficultyAndStatus(tenantId);
      return rows.find((g) => g.difficulty === difficulty && g.status === status)?.total ?? 0;
    }

    it("includes a newly created own-tenant question in the caller's aggregate", async () => {
      const [beforeA, beforeC] = await Promise.all([
        totalFor(tenantAId, Difficulty.Hard, "approved"),
        totalFor(tenantCId, Difficulty.Hard, "approved"),
      ]);

      await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, difficulty: Difficulty.Hard });

      const [afterA, afterC] = await Promise.all([
        totalFor(tenantAId, Difficulty.Hard, "approved"),
        totalFor(tenantCId, Difficulty.Hard, "approved"),
      ]);
      expect(afterA - beforeA - (afterC - beforeC)).toBe(1);
    });

    it("includes a newly created central question in every tenant's aggregate", async () => {
      const [beforeA, beforeC] = await Promise.all([
        totalFor(tenantAId, Difficulty.Easy, "approved"),
        totalFor(tenantCId, Difficulty.Easy, "approved"),
      ]);

      await createQuestion({ tenantId: null, createdBy: centralUserId, difficulty: Difficulty.Easy });

      const [deltaA, deltaC] = await Promise.all([
        totalFor(tenantAId, Difficulty.Easy, "approved"),
        totalFor(tenantCId, Difficulty.Easy, "approved"),
      ]).then(([afterA, afterC]) => [afterA - beforeA, afterC - beforeC]);
      // Both aggregates include central rows, so both must move — and by the
      // SAME amount, since any concurrent central noise from other suites
      // lands in both deltas identically.
      expect(deltaA).toBe(deltaC);
      expect(deltaA).toBeGreaterThanOrEqual(1);
    });

    it("excludes another tenant's private question from the caller's aggregate", async () => {
      const [beforeA, beforeB, beforeC] = await Promise.all([
        totalFor(tenantAId, Difficulty.Medium, "approved"),
        totalFor(tenantBId, Difficulty.Medium, "approved"),
        totalFor(tenantCId, Difficulty.Medium, "approved"),
      ]);

      await createQuestion({ tenantId: tenantBId, createdBy: tenantBUserId, difficulty: Difficulty.Medium });

      const [afterA, afterB, afterC] = await Promise.all([
        totalFor(tenantAId, Difficulty.Medium, "approved"),
        totalFor(tenantBId, Difficulty.Medium, "approved"),
        totalFor(tenantCId, Difficulty.Medium, "approved"),
      ]);
      const deltaA = afterA - beforeA;
      const deltaB = afterB - beforeB;
      const deltaC = afterC - beforeC;

      // Two assertions, each catching a different failure mode:
      //  - deltaA === deltaC: tenant B's row is invisible to tenant A (the
      //    control cancels concurrent central noise — and any regression that
      //    leaks B's row into A's aggregate but not C's shows up here).
      //  - deltaB - deltaC === 1: the row genuinely landed (and counts for
      //    its owner) — under a global "aggregate counts ALL tenants"
      //    regression BOTH deltas absorb B's row, so this difference
      //    collapses to 0 and the test goes red. Without this second
      //    assertion the test is vacuous against exactly the regression it
      //    is named for.
      expect(deltaA).toBe(deltaC);
      expect(deltaB - deltaC).toBe(1);
    });

    it("groups by status independently of difficulty (a draft never counts as approved)", async () => {
      const [beforeA, beforeC] = await Promise.all([
        totalFor(tenantAId, Difficulty.Medium, "draft"),
        totalFor(tenantCId, Difficulty.Medium, "draft"),
      ]);

      const draft = await repository.createStructuredQuestion({
        tenantId: tenantAId,
        topicId,
        difficulty: Difficulty.Medium,
        gradeLevel: "primaria_1",
        bodyTypst: "$x + 1 = 2$",
        alternatives: ["1", "2"],
        correctAnswer: "0",
        figureCode: undefined,
        createdBy: tenantAUserId,
        status: "draft",
      });
      createdQuestionIds.push(draft.id);

      const [afterA, afterC] = await Promise.all([
        totalFor(tenantAId, Difficulty.Medium, "draft"),
        totalFor(tenantCId, Difficulty.Medium, "draft"),
      ]);
      expect(afterA - beforeA - (afterC - beforeC)).toBe(1);
    });

    it("scopes to central-only (tenant_id IS NULL) when tenantId is null (platform staff) — a tenant-private question never leaks in", async () => {
      const [beforeNull, beforeC] = await Promise.all([
        totalFor(null, Difficulty.Hard, "approved"),
        totalFor(tenantCId, Difficulty.Hard, "approved"),
      ]);

      await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, difficulty: Difficulty.Hard });

      const [afterNull, afterC] = await Promise.all([
        totalFor(null, Difficulty.Hard, "approved"),
        totalFor(tenantCId, Difficulty.Hard, "approved"),
      ]);
      // A tenant-private row is invisible to BOTH the null (central-only)
      // aggregate and the control tenant's aggregate — deltas stay equal.
      // Under a null-scope regression (null aggregate starts counting tenant
      // rows), deltaNull absorbs tenant A's insert but deltaC does not.
      expect(afterNull - beforeNull).toBe(afterC - beforeC);
    });
  });
});
