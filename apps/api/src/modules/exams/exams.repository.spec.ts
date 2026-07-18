import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { inArray } from "drizzle-orm";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import {
  assets,
  courses,
  examBlueprintRows,
  examQuestions,
  exams,
  examVersions,
  questions,
  tenants,
  topics,
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
  const repository = new ExamsRepository();

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
    if (createdAssetIds.length > 0) {
      await db.delete(assets).where(inArray(assets.id, createdAssetIds));
    }
    await db.delete(users).where(inArray(users.id, [staffUserId, tenantAUserId, tenantBUserId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    await db.delete(topics).where(inArray(topics.id, [topicId, otherTopicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId, otherCourseId]));
    await pool.end();
  });

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
      expect(forGeneration?.selectedQuestions[0]!.correctAnswer).toBe("a");
      expect(forGeneration?.selectedQuestions[0]!.imageStorageKey).toBeTruthy();
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
});
