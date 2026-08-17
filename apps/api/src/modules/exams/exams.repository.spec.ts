import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { eq, inArray, or } from "drizzle-orm";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import {
  assets,
  courses,
  cycles,
  examBlueprintRows,
  examBlueprintTemplateRows,
  examBlueprintTemplates,
  examQuestions,
  exams,
  examTypes,
  examVersionJobs,
  examVersions,
  questions,
  syllabusWeekMaps,
  tenants,
  topics,
  tracks,
  universities,
  users,
} from "../../db/schema";
import { ExamsRepository } from "./exams.repository";

/**
 * Integration test against the real docker-compose Postgres — same pattern
 * as `bank.repository.spec.ts`. The `getQuestionPool()` suite is the
 * release-gate query (design doc §3, §8): `(tenant_id IS NULL OR
 * tenant_id = :current) AND status = 'approved' AND grade_level = :level`.
 */
describe("ExamsRepository", () => {
  const repository = new ExamsRepository(db);

  let courseId: string;
  let topicId: string;
  let otherCourseId: string;
  let otherTopicId: string;
  let tenantAId: string;
  let tenantAUserId: string;
  let tenantBId: string;
  let tenantBUserId: string;
  let staffUserId: string;

  const createdExamIds: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdAssetIds: string[] = [];
  const createdCourseIds: string[] = [];
  const createdTopicIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `ExamsRepo Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `ExamsRepo Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [otherCourse] = await db
      .insert(courses)
      .values({ name: `ExamsRepo Other Course ${suffix}` })
      .returning({ id: courses.id });
    otherCourseId = otherCourse!.id;

    const [otherTopic] = await db
      .insert(topics)
      .values({ courseId: otherCourseId, name: `ExamsRepo Other Topic ${suffix}` })
      .returning({ id: topics.id });
    otherTopicId = otherTopic!.id;

    const [staff] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: `exams-repo-staff-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.ContentEditor,
      })
      .returning({ id: users.id });
    staffUserId = staff!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `ExamsRepo Tenant A ${suffix}`, slug: `exams-repo-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [tenantAUser] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `exams-repo-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantAUserId = tenantAUser!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `ExamsRepo Tenant B ${suffix}`, slug: `exams-repo-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [tenantBUser] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `exams-repo-teacher-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantBUserId = tenantBUser!.id;
  });

  afterAll(async () => {
    if (createdExamIds.length > 0) {
      await db.delete(examVersions).where(inArray(examVersions.examId, createdExamIds));
      await db.delete(examQuestions).where(inArray(examQuestions.examId, createdExamIds));
      await db.delete(examBlueprintRows).where(inArray(examBlueprintRows.examId, createdExamIds));
      await db.delete(exams).where(inArray(exams.id, createdExamIds));
    }
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    // Sweep by tenantId too: `clearVersions()`/`getVersions()` test fixtures
    // create their own PDF/answer-key asset rows (repository.createAsset)
    // whose ids aren't individually tracked in `createdAssetIds` — mirrors
    // `exams.e2e.spec.ts`'s cleanup convention.
    await db
      .delete(assets)
      .where(
        or(
          createdAssetIds.length > 0 ? inArray(assets.id, createdAssetIds) : undefined,
          inArray(assets.tenantId, [tenantAId, tenantBId]),
        ),
      );
    await db.delete(users).where(inArray(users.id, [staffUserId, tenantAUserId, tenantBUserId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    if (createdTopicIds.length > 0) {
      await db.delete(topics).where(inArray(topics.id, createdTopicIds));
    }
    await db.delete(topics).where(inArray(topics.id, [topicId, otherTopicId]));
    if (createdCourseIds.length > 0) {
      await db.delete(courses).where(inArray(courses.id, createdCourseIds));
    }
    await db.delete(courses).where(inArray(courses.id, [courseId, otherCourseId]));
    await pool.end();
  });

  /** Fresh course+topic pair, isolated per test so `countStock()` aggregate assertions can't be contaminated by sibling tests (mirrors `exams.e2e.spec.ts`'s `createTopic()` convention). */
  async function createCourseAndTopic(): Promise<{ courseId: string; topicId: string }> {
    const suffix = randomUUID();
    const [freshCourse] = await db
      .insert(courses)
      .values({ name: `StockBatch Course ${suffix}` })
      .returning({ id: courses.id });
    createdCourseIds.push(freshCourse!.id);

    const [freshTopic] = await db
      .insert(topics)
      .values({ courseId: freshCourse!.id, name: `StockBatch Topic ${suffix}` })
      .returning({ id: topics.id });
    createdTopicIds.push(freshTopic!.id);

    return { courseId: freshCourse!.id, topicId: freshTopic!.id };
  }

  async function createQuestion(params: {
    tenantId: string | null;
    createdBy: string;
    topicId?: string;
    difficulty?: Difficulty;
    gradeLevel?: string;
    status?: "draft" | "approved";
  }): Promise<string> {
    const [asset] = await db
      .insert(assets)
      .values({ tenantId: params.tenantId, storageKey: `test/${randomUUID()}`, mime: "image/png" })
      .returning({ id: assets.id });
    createdAssetIds.push(asset!.id);

    const [question] = await db
      .insert(questions)
      .values({
        tenantId: params.tenantId,
        type: "image",
        topicId: params.topicId ?? topicId,
        difficulty: params.difficulty ?? Difficulty.Easy,
        gradeLevel: params.gradeLevel ?? "primaria_1",
        status: params.status ?? "approved",
        imageAssetId: asset!.id,
        correctAnswer: "a",
        createdBy: params.createdBy,
      })
      .returning({ id: questions.id });
    createdQuestionIds.push(question!.id);
    return question!.id;
  }

  /** `type='structured'` variant (design doc §5.4) — no image asset; carries `bodyTypst`/`alternatives`/`figureCode` directly on the row. */
  async function createStructuredQuestion(params: {
    tenantId: string | null;
    createdBy: string;
    topicId?: string;
    difficulty?: Difficulty;
    gradeLevel?: string;
    status?: "draft" | "approved";
    alternatives?: readonly string[];
    correctAnswer?: string;
  }): Promise<string> {
    const [question] = await db
      .insert(questions)
      .values({
        tenantId: params.tenantId,
        type: "structured",
        topicId: params.topicId ?? topicId,
        difficulty: params.difficulty ?? Difficulty.Easy,
        gradeLevel: params.gradeLevel ?? "primaria_1",
        status: params.status ?? "approved",
        bodyTypst: "¿Cuánto es $2 + 2$?",
        alternatives: params.alternatives ?? ["3", "4", "5"],
        correctAnswer: params.correctAnswer ?? "1",
        createdBy: params.createdBy,
      })
      .returning({ id: questions.id });
    createdQuestionIds.push(question!.id);
    return question!.id;
  }

  describe("createExam() + getBlueprintRows()", () => {
    it("persists the exam and its blueprint rows, resolving course/topic names", async () => {
      const { id } = await repository.createExam({
        tenantId: tenantAId,
        title: "Simulacro Repo Test",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [
          { courseId, topicId, difficulty: Difficulty.Easy, count: 2 },
          { courseId: otherCourseId, count: 1 },
        ],
      });
      createdExamIds.push(id);

      const rows = await repository.getBlueprintRows(id);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        courseId,
        topicId,
        difficulty: Difficulty.Easy,
        count: 2,
      });
      expect(rows[0]!.courseName).toContain("ExamsRepo Course");
      expect(rows[0]!.topicName).toContain("ExamsRepo Topic");
      expect(rows[1]).toMatchObject({ courseId: otherCourseId, count: 1 });
      expect(rows[1]!.topicId).toBeUndefined();
    });
  });

  describe("getExamById()", () => {
    it("returns the exam scoped to its own tenant, and undefined for a different tenant", async () => {
      const { id } = await repository.createExam({
        tenantId: tenantAId,
        title: "Tenant-scoped exam",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(id);

      const forOwner = await repository.getExamById(id, tenantAId);
      const forOther = await repository.getExamById(id, tenantBId);

      expect(forOwner?.id).toBe(id);
      expect(forOwner?.status).toBe("draft");
      expect(forOther).toBeUndefined();
    });
  });

  describe("getQuestionPool() visibility (release gate)", () => {
    it("includes central (tenantId=null) approved questions matching gradeLevel", async () => {
      const centralId = await createQuestion({
        tenantId: null,
        createdBy: staffUserId,
        gradeLevel: "secundaria_2",
      });

      const pool = await repository.getQuestionPool({ tenantId: tenantAId, gradeLevel: "secundaria_2" });

      expect(pool.map((c) => c.id)).toContain(centralId);
    });

    it("includes the requesting tenant's own private approved questions", async () => {
      const privateId = await createQuestion({
        tenantId: tenantAId,
        createdBy: tenantAUserId,
        gradeLevel: "secundaria_3",
      });

      const pool = await repository.getQuestionPool({ tenantId: tenantAId, gradeLevel: "secundaria_3" });

      expect(pool.map((c) => c.id)).toContain(privateId);
    });

    it("NEVER includes another tenant's private questions — the release-gate isolation invariant", async () => {
      const privateToA = await createQuestion({
        tenantId: tenantAId,
        createdBy: tenantAUserId,
        gradeLevel: "secundaria_4",
      });

      const poolForB = await repository.getQuestionPool({ tenantId: tenantBId, gradeLevel: "secundaria_4" });

      expect(poolForB.map((c) => c.id)).not.toContain(privateToA);
    });

    it("excludes draft (unapproved) questions even when visible and matching gradeLevel", async () => {
      const draftId = await createQuestion({
        tenantId: null,
        createdBy: staffUserId,
        gradeLevel: "secundaria_1",
        status: "draft",
      });

      const pool = await repository.getQuestionPool({ tenantId: tenantAId, gradeLevel: "secundaria_1" });

      expect(pool.map((c) => c.id)).not.toContain(draftId);
    });

    it("excludes questions from a different gradeLevel", async () => {
      const wrongGradeId = await createQuestion({
        tenantId: null,
        createdBy: staffUserId,
        gradeLevel: "pre",
      });

      const pool = await repository.getQuestionPool({ tenantId: tenantAId, gradeLevel: "primaria_2" });

      expect(pool.map((c) => c.id)).not.toContain(wrongGradeId);
    });
  });

  describe("countStock() — B1 stock-batch aggregate", () => {
    const gradeLevel = "secundaria_5"; // unused by every other describe block in this file — safe to reuse across countStock tests since isolation comes from each test's fresh course/topic pair

    it("counts central + own-tenant approved questions matching a cell, order-matched to input", async () => {
      const cell = await createCourseAndTopic();
      await createQuestion({ tenantId: null, createdBy: staffUserId, gradeLevel, topicId: cell.topicId, difficulty: Difficulty.Easy });
      await createQuestion({ tenantId: null, createdBy: staffUserId, gradeLevel, topicId: cell.topicId, difficulty: Difficulty.Easy });
      await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, gradeLevel, topicId: cell.topicId, difficulty: Difficulty.Easy });

      const counts = await repository.countStock(
        { tenantId: tenantAId, gradeLevel },
        [{ courseId: cell.courseId, topicId: cell.topicId, difficulty: Difficulty.Easy }],
      );

      expect(counts).toEqual([3]);
    });

    it("returns 0 for a cell whose difficulty has no matching questions", async () => {
      const cell = await createCourseAndTopic();
      await createQuestion({ tenantId: null, createdBy: staffUserId, gradeLevel, topicId: cell.topicId, difficulty: Difficulty.Easy });

      const counts = await repository.countStock(
        { tenantId: tenantAId, gradeLevel },
        [{ courseId: cell.courseId, topicId: cell.topicId, difficulty: Difficulty.Hard }],
      );

      expect(counts).toEqual([0]);
    });

    it("counts 5 independent cells, order-matched, each isolated by its own criteria", async () => {
      const cellA = await createCourseAndTopic();
      const cellB = await createCourseAndTopic();
      await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, gradeLevel, topicId: cellA.topicId, difficulty: Difficulty.Easy });
      await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, gradeLevel, topicId: cellA.topicId, difficulty: Difficulty.Medium });
      await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, gradeLevel, topicId: cellA.topicId, difficulty: Difficulty.Medium });
      await createQuestion({
        tenantId: tenantAId,
        createdBy: tenantAUserId,
        gradeLevel,
        difficulty: Difficulty.Hard,
        topicId: cellB.topicId,
      });

      const counts = await repository.countStock({ tenantId: tenantAId, gradeLevel }, [
        { courseId: cellA.courseId, topicId: cellA.topicId, difficulty: Difficulty.Easy },
        { courseId: cellA.courseId, topicId: cellA.topicId, difficulty: Difficulty.Medium },
        { courseId: cellA.courseId, topicId: cellA.topicId, difficulty: Difficulty.Hard },
        { courseId: cellB.courseId, topicId: cellB.topicId, difficulty: Difficulty.Hard },
        { courseId: cellA.courseId, topicId: cellA.topicId }, // no difficulty -> counts across all difficulties for this topic
      ]);

      expect(counts).toEqual([1, 2, 0, 1, 3]);
    });

    it("excludes draft/rejected and cross-tenant questions from the count", async () => {
      const cell = await createCourseAndTopic();
      await createQuestion({ tenantId: null, createdBy: staffUserId, gradeLevel, topicId: cell.topicId, status: "draft" });
      await createQuestion({ tenantId: tenantBId, createdBy: tenantBUserId, gradeLevel, topicId: cell.topicId });
      await createQuestion({ tenantId: null, createdBy: staffUserId, gradeLevel, topicId: cell.topicId });

      const counts = await repository.countStock({ tenantId: tenantAId, gradeLevel }, [
        { courseId: cell.courseId, topicId: cell.topicId, difficulty: Difficulty.Easy },
      ]);

      expect(counts).toEqual([1]);
    });

    it("returns 0 (not an error) for a cell whose courseId/topicId has zero matching questions", async () => {
      const cell = await createCourseAndTopic();

      const counts = await repository.countStock({ tenantId: tenantAId, gradeLevel }, [
        { courseId: cell.courseId, topicId: cell.topicId, difficulty: Difficulty.Easy },
      ]);

      expect(counts).toEqual([0]);
    });
  });

  describe("selection + replace + confirm lifecycle", () => {
    it("saveSelection()/getSelectedQuestionIds()/findExamQuestion()/replaceQuestion()/confirmExam() end-to-end", async () => {
      const rowCourseId = courseId;
      const q1 = await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, gradeLevel: "primaria_3" });
      const q2 = await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, gradeLevel: "primaria_3" });
      const q3 = await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, gradeLevel: "primaria_3" });

      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Lifecycle exam",
        gradeLevel: "primaria_3",
        createdBy: tenantAUserId,
        blueprint: [{ courseId: rowCourseId, count: 2 }],
      });
      createdExamIds.push(examId);
      const [row] = await repository.getBlueprintRows(examId);

      await repository.saveSelection(examId, [
        { blueprintRowId: row!.id, questionId: q1 },
        { blueprintRowId: row!.id, questionId: q2 },
      ]);

      const selectedIds = await repository.getSelectedQuestionIds(examId);
      expect(selectedIds).toEqual([q1, q2]);

      const found = await repository.findExamQuestion(examId, q1);
      expect(found?.blueprintRowId).toBe(row!.id);
      expect(found?.position).toBe(0);

      const notFound = await repository.findExamQuestion(examId, q3);
      expect(notFound).toBeUndefined();

      await repository.replaceQuestion(examId, q1, q3);
      const afterReplace = await repository.getSelectedQuestionIds(examId);
      expect(afterReplace).toEqual([q3, q2]);

      const notReadyYet = await repository.getExamById(examId, tenantAId);
      expect(notReadyYet?.status).toBe("draft");

      await repository.confirmExam(examId);
      const readyExam = await repository.getExamById(examId, tenantAId);
      expect(readyExam?.status).toBe("ready");
    });
  });

  describe("getExamForGeneration()", () => {
    it("returns title, tenant, and selected questions with correctAnswer + image storage key, ordered by position", async () => {
      const q1 = await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, gradeLevel: "primaria_4" });
      const q2 = await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, gradeLevel: "primaria_4" });

      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Generation exam",
        gradeLevel: "primaria_4",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 2 }],
      });
      createdExamIds.push(examId);
      const [row] = await repository.getBlueprintRows(examId);
      await repository.saveSelection(examId, [
        { blueprintRowId: row!.id, questionId: q1 },
        { blueprintRowId: row!.id, questionId: q2 },
      ]);

      const forGeneration = await repository.getExamForGeneration(examId, tenantAId);

      expect(forGeneration?.title).toBe("Generation exam");
      expect(forGeneration?.tenantId).toBe(tenantAId);
      expect(forGeneration?.selectedQuestions.map((q) => q.questionId)).toEqual([q1, q2]);
      expect(forGeneration?.selectedQuestions[0]!.type).toBe("image");
      expect(forGeneration?.selectedQuestions[0]!.correctAnswer).toBe("a");
      expect(forGeneration?.selectedQuestions[0]!.imageStorageKey).toBeTruthy();
      expect(forGeneration?.selectedQuestions[0]!.bodyTypst).toBeNull();
      expect(forGeneration?.selectedQuestions[0]!.alternatives).toBeNull();
    });

    it("returns bodyTypst/alternatives/figureCode (and a null imageStorageKey) for a type='structured' selected question (Lane B1xD4 gap)", async () => {
      const structuredId = await createStructuredQuestion({
        tenantId: tenantAId,
        createdBy: tenantAUserId,
        gradeLevel: "primaria_5",
        alternatives: ["3", "4", "5"],
        correctAnswer: "1",
      });

      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Structured generation exam",
        gradeLevel: "primaria_5",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);
      const [row] = await repository.getBlueprintRows(examId);
      await repository.saveSelection(examId, [{ blueprintRowId: row!.id, questionId: structuredId }]);

      const forGeneration = await repository.getExamForGeneration(examId, tenantAId);
      const selected = forGeneration?.selectedQuestions[0];

      expect(selected?.questionId).toBe(structuredId);
      expect(selected?.type).toBe("structured");
      expect(selected?.correctAnswer).toBe("1");
      expect(selected?.imageStorageKey).toBeNull();
      expect(selected?.bodyTypst).toBe("¿Cuánto es $2 + 2$?");
      expect(selected?.alternatives).toEqual(["3", "4", "5"]);
      expect(selected?.figureCode).toBeNull();
    });

    it("returns undefined when the exam belongs to a different tenant", async () => {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Tenant guarded exam",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);

      const result = await repository.getExamForGeneration(examId, tenantBId);
      expect(result).toBeUndefined();
    });
  });

  describe("getExamDetail()", () => {
    it("returns the exam header + selected questions (image type) ordered by position, tenant-scoped", async () => {
      const q1 = await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, gradeLevel: "primaria_2" });
      const q2 = await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, gradeLevel: "primaria_2" });

      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Detail exam",
        gradeLevel: "primaria_2",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 2 }],
      });
      createdExamIds.push(examId);
      const [row] = await repository.getBlueprintRows(examId);
      await repository.saveSelection(examId, [
        { blueprintRowId: row!.id, questionId: q1 },
        { blueprintRowId: row!.id, questionId: q2 },
      ]);

      const detail = await repository.getExamDetail(examId, tenantAId);

      expect(detail?.id).toBe(examId);
      expect(detail?.title).toBe("Detail exam");
      expect(detail?.gradeLevel).toBe("primaria_2");
      expect(detail?.status).toBe("draft");
      expect(detail?.questions.map((q) => q.id)).toEqual([q1, q2]);
      expect(detail?.questions[0]).toMatchObject({
        position: 0,
        type: "image",
        courseId,
        difficulty: Difficulty.Easy,
        correctAnswer: "a",
        bodyTypst: null,
        alternatives: null,
      });
      expect(detail?.questions[0]!.imageAssetId).toBeTruthy();
    });

    /**
     * Audit 2026-08-15: la pantalla de revisión pintaba `courseId`/`topicId`
     * crudos porque el detalle solo devolvía ids — el docente veía
     * "22131249-54e3-… · 7c389685-23d9-…" y tenía que decidir si cambiar esa
     * pregunta. La consulta ya joinea `topics`; faltaban los nombres.
     */
    it("returns the course and topic NAMES alongside their ids", async () => {
      const { courseId: freshCourseId, topicId: freshTopicId } = await createCourseAndTopic();
      const questionId = await createQuestion({
        tenantId: tenantAId,
        createdBy: tenantAUserId,
        topicId: freshTopicId,
      });

      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Named detail exam",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId: freshCourseId, count: 1 }],
      });
      createdExamIds.push(examId);
      const [row] = await repository.getBlueprintRows(examId);
      await repository.saveSelection(examId, [{ blueprintRowId: row!.id, questionId }]);

      const [course] = await db.select().from(courses).where(eq(courses.id, freshCourseId));
      const [topic] = await db.select().from(topics).where(eq(topics.id, freshTopicId));

      const detail = await repository.getExamDetail(examId, tenantAId);

      expect(detail?.questions[0]).toMatchObject({
        courseId: freshCourseId,
        courseName: course!.name,
        topicId: freshTopicId,
        topicName: topic!.name,
      });
    });

    it("returns bodyTypst/alternatives/figureCode (and a null imageAssetId) for a type='structured' selected question", async () => {
      const structuredId = await createStructuredQuestion({
        tenantId: tenantAId,
        createdBy: tenantAUserId,
        gradeLevel: "primaria_6",
        alternatives: ["3", "4", "5"],
        correctAnswer: "1",
      });

      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Structured detail exam",
        gradeLevel: "primaria_6",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);
      const [row] = await repository.getBlueprintRows(examId);
      await repository.saveSelection(examId, [{ blueprintRowId: row!.id, questionId: structuredId }]);

      const detail = await repository.getExamDetail(examId, tenantAId);
      const selected = detail?.questions[0];

      expect(selected?.id).toBe(structuredId);
      expect(selected?.type).toBe("structured");
      expect(selected?.correctAnswer).toBe("1");
      expect(selected?.imageAssetId).toBeNull();
      expect(selected?.bodyTypst).toBe("¿Cuánto es $2 + 2$?");
      expect(selected?.alternatives).toEqual(["3", "4", "5"]);
      expect(selected?.figureCode).toBeNull();
    });

    it("returns undefined when the exam belongs to a different tenant", async () => {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Tenant guarded detail exam",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);

      const result = await repository.getExamDetail(examId, tenantBId);
      expect(result).toBeUndefined();
    });

    it("returns an empty questions array when nothing has been selected yet", async () => {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Unselected detail exam",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);

      const detail = await repository.getExamDetail(examId, tenantAId);
      expect(detail?.questions).toEqual([]);
    });
  });

  describe("createAsset() + saveVersion()", () => {
    it("persists an asset and an exam_version row referencing it", async () => {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Version exam",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);

      const pdfAsset = await repository.createAsset(tenantAId, `exams/${examId}/versions/A/exam.pdf`, "application/pdf");
      const answerAsset = await repository.createAsset(
        tenantAId,
        `exams/${examId}/versions/A/answer-key.pdf`,
        "application/pdf",
      );
      createdAssetIds.push(pdfAsset.id, answerAsset.id);

      await repository.saveVersion(examId, {
        code: "A",
        questionOrder: ["q1", "q2"],
        answerKey: { 0: "a", 1: "b" },
        pdfAssetId: pdfAsset.id,
        answerSheetAssetId: answerAsset.id,
      });

      const [versionRow] = await db.select().from(examVersions).where(inArray(examVersions.examId, [examId]));
      expect(versionRow?.code).toBe("A");
      expect(versionRow?.pdfAssetId).toBe(pdfAsset.id);
      expect(versionRow?.answerSheetAssetId).toBe(answerAsset.id);
    });
  });

  describe("clearVersions() — B4 idempotent regeneration", () => {
    async function createExamWithOneVersion(): Promise<{ examId: string; pdfAssetId: string; answerAssetId: string }> {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Clear-versions exam",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);

      const pdfAsset = await repository.createAsset(tenantAId, `exams/${examId}/versions/A/exam.pdf`, "application/pdf");
      const answerAsset = await repository.createAsset(
        tenantAId,
        `exams/${examId}/versions/A/answer-key.pdf`,
        "application/pdf",
      );

      await repository.saveVersion(examId, {
        code: "A",
        questionOrder: ["q1"],
        answerKey: { 0: "a" },
        pdfAssetId: pdfAsset.id,
        answerSheetAssetId: answerAsset.id,
      });

      return { examId, pdfAssetId: pdfAsset.id, answerAssetId: answerAsset.id };
    }

    it("deletes exam_versions rows THEN their assets rows, returning the deleted assets' storageKeys", async () => {
      const { examId, pdfAssetId, answerAssetId } = await createExamWithOneVersion();

      const deletedKeys = await repository.clearVersions(examId);

      expect([...deletedKeys].sort()).toEqual(
        [`exams/${examId}/versions/A/exam.pdf`, `exams/${examId}/versions/A/answer-key.pdf`].sort(),
      );

      const remainingVersions = await db.select().from(examVersions).where(eq(examVersions.examId, examId));
      expect(remainingVersions).toHaveLength(0);

      const remainingAssets = await db.select().from(assets).where(inArray(assets.id, [pdfAssetId, answerAssetId]));
      expect(remainingAssets).toHaveLength(0);
    });

    it("is a no-op (returns []) when the exam has zero prior versions", async () => {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "No-versions exam",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);

      const deletedKeys = await repository.clearVersions(examId);

      expect(deletedKeys).toEqual([]);
    });
  });

  /**
   * `exams` is referenced by FOUR tables, and `deleteExam` only cleared
   * three of them. Any exam whose generation had ever been REQUESTED — the
   * job row is written at enqueue time, so this includes every exam whose
   * generation failed — hit `exam_version_jobs_exam_id_exams_id_fk` and
   * surfaced as a bare 500 from `DELETE /exams/:examId` (audit 2026-08-15).
   */
  describe("deleteExam() — every table that references exams", () => {
    it("deletes an exam that has a version job", async () => {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Exam with a generation job",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      await db.insert(examVersionJobs).values({
        tenantId: tenantAId,
        examId,
        createdBy: tenantAUserId,
        createdByRole: Role.Teacher,
        versionCount: 2,
      });

      const deleted = await repository.deleteExam(examId, tenantAId);

      expect(deleted).toBe(true);
      const remainingJobs = await db.select().from(examVersionJobs).where(eq(examVersionJobs.examId, examId));
      expect(remainingJobs).toHaveLength(0);
      const remainingExams = await db.select().from(exams).where(eq(exams.id, examId));
      expect(remainingExams).toHaveLength(0);
    });
  });

  /**
   * `listExams()` (S1) had NO test coverage, and shipped with both count
   * columns silently returning 0 for every row: drizzle renders a bare
   * `${table.column}` inside a `sql` template UNQUALIFIED, so the correlated
   * predicate compiled to `where "exam_id" = "id"` — both resolved against
   * the SUBQUERY's own table (`exam_questions` has an `id` column too), never
   * against the outer `exams` row. The list screen therefore showed
   * "0 preguntas · 0 formas" for exams that had questions and downloadable
   * PDFs (audit 2026-08-15, hallazgo #1). These tests pin the counts to real
   * rows so a future refactor can't quietly decorrelate them again.
   */
  describe("listExams() — S1 list row counts", () => {
    async function createListedExam(params: { title: string; questionCount: number; versionCount: number }) {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: params.title,
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: params.questionCount }],
      });
      createdExamIds.push(examId);

      const [blueprintRow] = await repository.getBlueprintRows(examId);
      const questionIds: string[] = [];
      for (let i = 0; i < params.questionCount; i += 1) {
        questionIds.push(await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId }));
      }
      await repository.saveSelection(
        examId,
        questionIds.map((questionId) => ({ blueprintRowId: blueprintRow!.id, questionId })),
      );

      for (let i = 0; i < params.versionCount; i += 1) {
        const code = String.fromCharCode(65 + i);
        const pdfAsset = await repository.createAsset(
          tenantAId,
          `exams/${examId}/versions/${code}/exam.pdf`,
          "application/pdf",
        );
        const answerAsset = await repository.createAsset(
          tenantAId,
          `exams/${examId}/versions/${code}/answer-key.pdf`,
          "application/pdf",
        );
        await repository.saveVersion(examId, {
          code,
          questionOrder: questionIds,
          answerKey: { 0: "a" },
          pdfAssetId: pdfAsset.id,
          answerSheetAssetId: answerAsset.id,
        });
      }

      return examId;
    }

    it("reports each row's real questionCount and versionCount", async () => {
      const examId = await createListedExam({ title: `List counts exam ${randomUUID()}`, questionCount: 3, versionCount: 2 });

      const { items } = await repository.listExams(tenantAId, { page: 1, pageSize: 50 });
      const row = items.find((item) => item.id === examId);

      expect(row).toBeDefined();
      expect(row!.questionCount).toBe(3);
      expect(row!.versionCount).toBe(2);
    });

    it("reports 0/0 for an exam with no selection and no versions (the counts are real, not a constant)", async () => {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: `List counts empty exam ${randomUUID()}`,
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);

      const { items } = await repository.listExams(tenantAId, { page: 1, pageSize: 50 });
      const row = items.find((item) => item.id === examId);

      expect(row!.questionCount).toBe(0);
      expect(row!.versionCount).toBe(0);
    });

    it("counts per row — two exams in the same page never share each other's counts", async () => {
      const bigId = await createListedExam({ title: `List counts big ${randomUUID()}`, questionCount: 4, versionCount: 1 });
      const smallId = await createListedExam({ title: `List counts small ${randomUUID()}`, questionCount: 1, versionCount: 3 });

      const { items } = await repository.listExams(tenantAId, { page: 1, pageSize: 50 });

      const big = items.find((item) => item.id === bigId)!;
      const small = items.find((item) => item.id === smallId)!;
      expect([big.questionCount, big.versionCount]).toEqual([4, 1]);
      expect([small.questionCount, small.versionCount]).toEqual([1, 3]);
    });
  });

  /**
   * Audit 2026-08-15: el dropdown "Grado" ofrece los 12 niveles del catálogo y
   * 11 llevan a un callejón sin salida ("No hay preguntas aprobadas para este
   * grado todavía") — el banco sembrado es 100% `pre`. El frontend no tenía
   * forma de saberlo ANTES de que el docente eligiera, porque no existía un
   * conteo por grado.
   */
  describe("countApprovedByGradeLevel() — stock por grado (para no ofrecer callejones sin salida)", () => {
    /**
     * Assertions are DELTAS, not absolutes: this aggregate spans the whole
     * tenant-visible bank, and the local Postgres carries the seeded bank plus
     * whatever sibling specs left behind. Same before/after convention the
     * dashboard's `countByStatus` tests already use.
     */
    async function availableFor(tenantId: string, gradeLevel: string): Promise<number> {
      const counts = await repository.countApprovedByGradeLevel(tenantId);
      return counts.find((row) => row.gradeLevel === gradeLevel)?.available ?? 0;
    }

    it("counts only APPROVED questions, grouped by grade level", async () => {
      const { topicId: freshTopicId } = await createCourseAndTopic();
      const before = await availableFor(tenantAId, "secundaria_4");

      await createQuestion({
        tenantId: tenantAId,
        createdBy: tenantAUserId,
        topicId: freshTopicId,
        gradeLevel: "secundaria_4",
      });
      await createQuestion({
        tenantId: tenantAId,
        createdBy: tenantAUserId,
        topicId: freshTopicId,
        gradeLevel: "secundaria_4",
      });
      // A draft must NOT move the number — the builder offers grades by what
      // an exam could actually select from.
      await createQuestion({
        tenantId: tenantAId,
        createdBy: tenantAUserId,
        topicId: freshTopicId,
        gradeLevel: "secundaria_4",
        status: "draft",
      });

      expect(await availableFor(tenantAId, "secundaria_4")).toBe(before + 2);
    });

    it("applies the SAME visibility rule as the question pool — global questions count, another tenant's never do", async () => {
      const { topicId: freshTopicId } = await createCourseAndTopic();
      const before = await availableFor(tenantAId, "primaria_3");

      await createQuestion({
        tenantId: null,
        createdBy: staffUserId,
        topicId: freshTopicId,
        gradeLevel: "primaria_3",
      });
      await createQuestion({
        tenantId: tenantBId,
        createdBy: tenantBUserId,
        topicId: freshTopicId,
        gradeLevel: "primaria_3",
      });

      // +1, not +2: the global (tenant_id NULL) one is visible to A, tenant B's is not.
      expect(await availableFor(tenantAId, "primaria_3")).toBe(before + 1);
    });

    it("omits grade levels with nothing available (the caller treats a missing row as 0)", async () => {
      const counts = await repository.countApprovedByGradeLevel(tenantAId);

      expect(counts.every((row) => row.available > 0)).toBe(true);
    });
  });

  /**
   * Audit 2026-08-15: el título se autogenera ("Examen {grado} — {fecha}") y no
   * existía forma de cambiarlo después, así que dos exámenes del mismo día y
   * grado quedaban con nombres idénticos en una lista que se busca por título
   * — y duplicar apilaba "Copia de Copia de".
   */
  describe("renameExam() — S4 rename", () => {
    it("renames the exam and reports it changed", async () => {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Nombre viejo",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);

      const renamed = await repository.renameExam(examId, tenantAId, "Simulacro de marzo");

      expect(renamed).toBe(true);
      expect((await repository.getExamById(examId, tenantAId))?.title).toBe("Simulacro de marzo");
    });

    it("never renames another tenant's exam — returns false and leaves the row untouched", async () => {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Intocable",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);

      const renamed = await repository.renameExam(examId, tenantBId, "Robado");

      expect(renamed).toBe(false);
      expect((await repository.getExamById(examId, tenantAId))?.title).toBe("Intocable");
    });

    it("returns false for an exam that does not exist", async () => {
      expect(await repository.renameExam(randomUUID(), tenantAId, "Fantasma")).toBe(false);
    });
  });

  describe("getVersions() — B4 versions-history read", () => {
    it("returns {code, pdfUrl, answerSheetUrl}[] ordered by code ASC, using /assets/:id paths (DECISION B4-A/C)", async () => {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Versions history exam",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);

      // Insert codes out of order (C, then A, then B) to prove the ORDER BY, not insertion order, drives the result.
      for (const code of ["C", "A", "B"]) {
        const pdfAsset = await repository.createAsset(tenantAId, `exams/${examId}/versions/${code}/exam.pdf`, "application/pdf");
        const answerAsset = await repository.createAsset(
          tenantAId,
          `exams/${examId}/versions/${code}/answer-key.pdf`,
          "application/pdf",
        );
        await repository.saveVersion(examId, {
          code,
          questionOrder: ["q1"],
          answerKey: { 0: "a" },
          pdfAssetId: pdfAsset.id,
          answerSheetAssetId: answerAsset.id,
        });
      }

      const versions = await repository.getVersions(examId, tenantAId);

      expect(versions?.map((v: { code: string }) => v.code)).toEqual(["A", "B", "C"]);
      for (const version of versions ?? []) {
        expect(version.pdfUrl).toMatch(/^\/assets\//);
        expect(version.answerSheetUrl).toMatch(/^\/assets\//);
      }
    });

    it("returns [] for a zero-version exam (not undefined/404)", async () => {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Zero-versions exam",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);

      const versions = await repository.getVersions(examId, tenantAId);

      expect(versions).toEqual([]);
    });

    it("returns undefined for a nonexistent/cross-tenant exam (never leak existence)", async () => {
      const { id: examId } = await repository.createExam({
        tenantId: tenantAId,
        title: "Cross-tenant versions exam",
        gradeLevel: "primaria_1",
        createdBy: tenantAUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      createdExamIds.push(examId);

      expect(await repository.getVersions(examId, tenantBId)).toBeUndefined();
      expect(await repository.getVersions(randomUUID(), tenantAId)).toBeUndefined();
    });
  });

  describe("countByStatus() / listRecent() — dashboard aggregate", () => {
    let dashboardTenantId: string;
    let dashboardTeacherId: string;
    const dashboardExamIds: string[] = [];

    beforeAll(async () => {
      const suffix = randomUUID();
      const [tenant] = await db
        .insert(tenants)
        .values({ name: `Dashboard Agg Tenant ${suffix}`, slug: `dashboard-agg-${suffix}` })
        .returning({ id: tenants.id });
      dashboardTenantId = tenant!.id;

      const [teacher] = await db
        .insert(users)
        .values({
          tenantId: dashboardTenantId,
          email: `dashboard-agg-teacher-${suffix}@exams-generator.test`,
          passwordHash: "test-hash",
          role: Role.Teacher,
        })
        .returning({ id: users.id });
      dashboardTeacherId = teacher!.id;
    });

    afterAll(async () => {
      for (const examId of dashboardExamIds) {
        await repository.deleteExam(examId, dashboardTenantId);
      }
      await db.delete(users).where(eq(users.id, dashboardTeacherId));
      await db.delete(tenants).where(eq(tenants.id, dashboardTenantId));
    });

    it("groups the tenant's exams by status", async () => {
      const draft = await repository.createExam({
        tenantId: dashboardTenantId,
        title: "Draft Exam",
        gradeLevel: "primaria_1",
        createdBy: dashboardTeacherId,
        blueprint: [{ courseId, count: 1 }],
      });
      dashboardExamIds.push(draft.id);

      const ready = await repository.createExam({
        tenantId: dashboardTenantId,
        title: "Ready Exam",
        gradeLevel: "primaria_1",
        createdBy: dashboardTeacherId,
        blueprint: [{ courseId, count: 1 }],
      });
      dashboardExamIds.push(ready.id);
      await repository.confirmExam(ready.id);

      const groups = await repository.countByStatus(dashboardTenantId);

      expect(groups).toEqual(
        expect.arrayContaining([
          { status: "draft", total: 1 },
          { status: "ready", total: 1 },
        ]),
      );
    });

    it("scopes strictly to the given tenant — a new exam in tenant B never affects tenant A's (or dashboardTenant's) aggregate", async () => {
      const before = await repository.countByStatus(dashboardTenantId);
      const beforeReady = before.find((g) => g.status === "ready")?.total ?? 0;

      const tenantBExam = await repository.createExam({
        tenantId: tenantBId,
        title: "Tenant B Exam (isolation check)",
        gradeLevel: "primaria_1",
        createdBy: tenantBUserId,
        blueprint: [{ courseId, count: 1 }],
      });
      // Pushed to the FILE-LEVEL `createdExamIds` (declared near the top of
      // this file, swept by the outer `afterAll`) — NOT `dashboardExamIds`,
      // since this exam belongs to `tenantBId`, and this block's own
      // `afterAll` only cleans up via `deleteExam(id, dashboardTenantId)`.
      createdExamIds.push(tenantBExam.id);
      await repository.confirmExam(tenantBExam.id);

      const after = await repository.countByStatus(dashboardTenantId);
      const afterReady = after.find((g) => g.status === "ready")?.total ?? 0;

      expect(afterReady).toBe(beforeReady);
    });

    it("listRecent() returns the tenant's exams ordered by createdAt desc, capped at limit", async () => {
      const recent = await repository.listRecent(dashboardTenantId, 1);

      expect(recent).toHaveLength(1);
      expect(recent[0]!.title).toBe("Ready Exam"); // created after "Draft Exam" -> newest first
    });

    it("listRecent() returns every exam (up to limit) with id/title/status/createdAt as an ISO string", async () => {
      const recent = await repository.listRecent(dashboardTenantId, 10);

      expect(recent).toHaveLength(2);
      expect(recent.map((r) => r.title).sort()).toEqual(["Draft Exam", "Ready Exam"]);
      expect(typeof recent[0]!.createdAt).toBe("string");
    });
  });

  /**
   * `resolveExamBlueprint()` fetchers (design doc §4/§5, phase 4 wiring):
   * `findExamType`/`findCurrentTemplate`/`getTemplateRows`/
   * `getSyllabusForTemplate`/`findActiveCycle`. Fixtures are scoped to a
   * fresh `university`/`track` pair (isolated by `suffix`, same convention as
   * `createCourseAndTopic()`), reusing the file-level `courseId`/`topicId`/
   * `otherCourseId`/`tenantAId`/`tenantBId` fixtures for the blueprint/
   * syllabus rows themselves.
   */
  describe("resolveExamBlueprint() fetchers", () => {
    let universityId: string;
    let trackId: string;
    let examTypeCode: string;
    let globalTemplateId: string;
    let tenantOverrideTemplateId: string;
    let trackLessTemplateId: string;

    const createdUniversityIds: string[] = [];
    const createdTrackIds: string[] = [];
    const createdExamTypeCodes: string[] = [];
    const createdTemplateIds: string[] = [];
    const createdCycleIds: string[] = [];

    beforeAll(async () => {
      const suffix = randomUUID();

      const [university] = await db
        .insert(universities)
        .values({ code: `resolver-test-uni-${suffix}`, name: `Resolver Test University ${suffix}` })
        .returning({ id: universities.id });
      universityId = university!.id;
      createdUniversityIds.push(universityId);

      const [track] = await db
        .insert(tracks)
        .values({ universityId, code: `track-${suffix}`, name: `Resolver Test Track ${suffix}`, kind: "area" })
        .returning({ id: tracks.id });
      trackId = track!.id;
      createdTrackIds.push(trackId);

      examTypeCode = `resolver-test-type-${suffix}`;
      await db.insert(examTypes).values({
        code: examTypeCode,
        label: "Resolver Test Type",
        courseScope: "all",
        weekScope: "cumulative",
        // Sort order just needs to avoid the seeded catalog's 0-3 range —
        // this table has zero other constraints tying it to real exam types.
        sortOrder: 100_000 + Math.floor(Math.random() * 100_000),
      });
      createdExamTypeCodes.push(examTypeCode);

      const [globalTemplate] = await db
        .insert(examBlueprintTemplates)
        .values({ universityId, trackId, tenantId: null, cycleLabel: "2026-II", isCurrent: true })
        .returning({ id: examBlueprintTemplates.id });
      globalTemplateId = globalTemplate!.id;
      createdTemplateIds.push(globalTemplateId);

      const [tenantOverrideTemplate] = await db
        .insert(examBlueprintTemplates)
        .values({
          universityId,
          trackId,
          tenantId: tenantAId,
          cycleLabel: "2026-II (tenant A override)",
          isCurrent: true,
        })
        .returning({ id: examBlueprintTemplates.id });
      tenantOverrideTemplateId = tenantOverrideTemplate!.id;
      createdTemplateIds.push(tenantOverrideTemplateId);

      const [trackLessTemplate] = await db
        .insert(examBlueprintTemplates)
        .values({ universityId, trackId: null, tenantId: null, cycleLabel: "2026-II (no track)", isCurrent: true })
        .returning({ id: examBlueprintTemplates.id });
      trackLessTemplateId = trackLessTemplate!.id;
      createdTemplateIds.push(trackLessTemplateId);

      await db.insert(examBlueprintTemplateRows).values([
        { templateId: globalTemplateId, courseId, topicId, questionCount: 12, sourceLevel: "P.A." },
        { templateId: globalTemplateId, courseId: otherCourseId, weightPoints: "600", examSection: "E2" },
      ]);

      await db.insert(syllabusWeekMaps).values([{ templateId: globalTemplateId, courseId, topicId, weekNumber: 3 }]);
    });

    afterAll(async () => {
      await db.delete(syllabusWeekMaps).where(inArray(syllabusWeekMaps.templateId, createdTemplateIds));
      await db
        .delete(examBlueprintTemplateRows)
        .where(inArray(examBlueprintTemplateRows.templateId, createdTemplateIds));
      await db.delete(examBlueprintTemplates).where(inArray(examBlueprintTemplates.id, createdTemplateIds));
      if (createdCycleIds.length > 0) {
        await db.delete(cycles).where(inArray(cycles.id, createdCycleIds));
      }
      await db.delete(examTypes).where(inArray(examTypes.code, createdExamTypeCodes));
      await db.delete(tracks).where(inArray(tracks.id, createdTrackIds));
      await db.delete(universities).where(inArray(universities.id, createdUniversityIds));
    });

    describe("findExamType()", () => {
      it("returns courseScope/weekScope for a known code", async () => {
        const result = await repository.findExamType(examTypeCode);
        expect(result).toEqual({ courseScope: "all", weekScope: "cumulative" });
      });

      it("returns null for an unknown code", async () => {
        expect(await repository.findExamType(`unknown-${randomUUID()}`)).toBeNull();
      });
    });

    describe("findCurrentTemplate()", () => {
      it("resolves the global (tenant_id=null) template when the caller's tenant has no override", async () => {
        const result = await repository.findCurrentTemplate(universityId, trackId, tenantBId);
        expect(result?.id).toBe(globalTemplateId);
      });

      it("prefers the caller tenant's own override template over the global default", async () => {
        const result = await repository.findCurrentTemplate(universityId, trackId, tenantAId);
        expect(result?.id).toBe(tenantOverrideTemplateId);
      });

      it("matches track_id=null to track_id=null via IS NOT DISTINCT FROM, not plain '='", async () => {
        const result = await repository.findCurrentTemplate(universityId, null, tenantBId);
        expect(result?.id).toBe(trackLessTemplateId);
      });

      it("returns null when no current template matches the (university, track) pair", async () => {
        const result = await repository.findCurrentTemplate(randomUUID(), null, tenantBId);
        expect(result).toBeNull();
      });
    });

    describe("getTemplateRows()", () => {
      it("maps exam_blueprint_template_rows onto the domain TemplateRow shape (camelCase, weightPoints as a number)", async () => {
        const rows = await repository.getTemplateRows(globalTemplateId);

        expect(rows).toHaveLength(2);
        expect(rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ courseId, topicId, questionCount: 12, sourceLevel: "P.A." }),
            expect.objectContaining({ courseId: otherCourseId, weightPoints: 600 }),
          ]),
        );
        const weightRow = rows.find((r) => r.courseId === otherCourseId);
        expect(typeof weightRow?.weightPoints).toBe("number");
      });
    });

    describe("getSyllabusForTemplate()", () => {
      it("maps syllabus_week_maps onto the domain SyllabusEntry shape", async () => {
        const entries = await repository.getSyllabusForTemplate(globalTemplateId);
        expect(entries).toEqual([{ courseId, topicId, weekNumber: 3 }]);
      });

      it("returns [] for a template with no syllabus data (e.g. a UNCP-style template)", async () => {
        const entries = await repository.getSyllabusForTemplate(trackLessTemplateId);
        expect(entries).toEqual([]);
      });
    });

    describe("findActiveCycle()", () => {
      it("resolves the global active cycle, then prefers a tenant override once one exists", async () => {
        const [globalCycle] = await db
          .insert(cycles)
          .values({
            universityId,
            trackId,
            tenantId: null,
            label: "Global cycle",
            startsOn: new Date("2026-03-05"),
            weekLengthDays: 7,
            isActive: true,
          })
          .returning({ id: cycles.id });
        createdCycleIds.push(globalCycle!.id);

        const resultNoOverride = await repository.findActiveCycle(universityId, trackId, tenantBId);
        expect(resultNoOverride?.weekLengthDays).toBe(7);

        const [tenantCycle] = await db
          .insert(cycles)
          .values({
            universityId,
            trackId,
            tenantId: tenantAId,
            label: "Tenant A cycle",
            startsOn: new Date("2026-04-01"),
            weekLengthDays: 14,
            isActive: true,
          })
          .returning({ id: cycles.id });
        createdCycleIds.push(tenantCycle!.id);

        const resultWithOverride = await repository.findActiveCycle(universityId, trackId, tenantAId);
        expect(resultWithOverride?.weekLengthDays).toBe(14);
      });

      it("returns null when no active cycle matches the (university, track) pair", async () => {
        const result = await repository.findActiveCycle(randomUUID(), null, tenantBId);
        expect(result).toBeNull();
      });
    });
  });
});
