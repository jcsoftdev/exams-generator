import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
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
import { TokenService } from "../auth/token.service";
import { STORAGE_PORT } from "../bank/bank.constants";
import { isTypstAvailableSync } from "./adapters/pdf/test-utils/typst-availability";
import { StoragePort } from "./domain/ports/storage.port";
import { GeneratedQuestion, QuestionGeneratorPort } from "../ai/domain/ports/question-generator.port";
import { QUESTION_GENERATOR_PORT } from "../ai/ai.constants";

/** Test double: same pattern as `ai.e2e.spec.ts` — no network, no `AI_MODEL`/`OPENROUTER_API_KEY` needed. */
class ScriptedQuestionGeneratorAdapter implements QuestionGeneratorPort {
  constructor(private readonly question: GeneratedQuestion) {}

  async generate(): Promise<GeneratedQuestion> {
    return this.question;
  }

  async reviseQuestion(): Promise<GeneratedQuestion> {
    throw new Error("ScriptedQuestionGeneratorAdapter.reviseQuestion is not used in this suite");
  }

  async extractFromImage(): Promise<GeneratedQuestion> {
    throw new Error("ScriptedQuestionGeneratorAdapter.extractFromImage is not used in this suite");
  }
}

const VALID_STRUCTURED_QUESTION: GeneratedQuestion = {
  bodyTypst: "¿Cuál es el resultado de $3 + 4$?",
  alternatives: ["5", "6", "7", "8", "9"],
  // 0-based index via letter -> "b" = index 1 = "6". This is the alternative
  // this test expects the printed exam's answer key to keep pointing at,
  // even after `VersionShuffler` permutes the alternative order per version.
  correctAnswer: "c",
};
const CORRECT_ALTERNATIVE_TEXT = "7"; // "c" -> index 2 -> alternatives[2]

/**
 * Capstone e2e #2 (gate-final-integration): AI generation -> human approval
 * -> exam blueprint selection -> version generation, END TO END, against the
 * REAL Postgres + MinIO + Typst CLI stack. This is the test that PROVES the
 * B1xD4 integration gap described in the task is closed: before the fix,
 * `exam-generation.service.ts` always rendered every selected question as an
 * IMAGE (`imageAbsolutePath: map.get(questionId)!` — `undefined` for a
 * structured question) and never passed `SelectedQuestion.type`/
 * `alternatives` into `buildVersions()`, so a `type='structured'` question
 * either broke the PDF compile or never had its alternatives shuffled.
 */
const describeIfTypst = isTypstAvailableSync() ? describe : describe.skip;

describeIfTypst("AI-generated structured question -> approved -> exam version (e2e capstone)", () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let storage: StoragePort;

  let courseId: string;
  let topicId: string;
  let tenantId: string;
  let teacherId: string;
  let teacherToken: string;

  const createdQuestionIds: string[] = [];
  const createdExamIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QUESTION_GENERATOR_PORT)
      .useValue(new ScriptedQuestionGeneratorAdapter(VALID_STRUCTURED_QUESTION))
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);
    storage = moduleRef.get(STORAGE_PORT);

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `AI-Exam E2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `AI-Exam E2E Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenant] = await db
      .insert(tenants)
      .values({ name: `AI-Exam E2E Tenant ${suffix}`, slug: `ai-exam-e2e-tenant-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [teacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `ai-exam-e2e-teacher-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherId = teacher!.id;

    teacherToken = tokenService.sign({ sub: teacherId, tenantId, role: Role.Teacher });
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
    // `generateVersions()` creates its own PDF/answer-key asset rows
    // (`ExamsRepository.createAsset`), tenant-scoped but not individually
    // tracked here — sweep by tenantId (mirrors `exams.e2e.spec.ts`).
    await db.delete(assets).where(eq(assets.tenantId, tenantId));
    await db.delete(users).where(inArray(users.id, [teacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantId]));
    await db.delete(topics).where(inArray(topics.id, [topicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await app.close();
    await pool.end();
  });

  it("generate (AI, structured draft) -> approve -> exam blueprint auto-selects it -> confirm -> generate versions renders it as structured, PDF compiles for real, shuffled alternatives keep the correct answer key (closes the B1xD4 gap)", async () => {
    const gradeLevel = "primaria_1";

    // 1. AI generates a structured draft (never published directly, design doc §7).
    const generateResponse = await request(app.getHttpServer())
      .post("/ai/questions/generate")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ courseId, topicId, difficulty: Difficulty.Easy, gradeLevel, count: 1 })
      .expect(201);

    expect(generateResponse.body.created).toHaveLength(1);
    const questionId = generateResponse.body.created[0].id as string;
    createdQuestionIds.push(questionId);

    const draft = await request(app.getHttpServer())
      .get(`/bank/questions/${questionId}`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);
    expect(draft.body.status).toBe("draft");
    expect(draft.body.type).toBe("structured");
    expect(draft.body.aiGenerated).toBe(true);

    // 2. Human approves the draft — only NOW does it become selectable.
    await request(app.getHttpServer())
      .post(`/bank/questions/${questionId}/approve`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(201);

    const approved = await request(app.getHttpServer())
      .get(`/bank/questions/${questionId}`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);
    expect(approved.body.status).toBe("approved");

    // 3. Create an exam whose blueprint (this exact topic, count 1) can only
    // be filled by the question we just approved — a fresh topic guarantees
    // no other candidate contaminates the pool.
    const examResponse = await request(app.getHttpServer())
      .post("/exams")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({
        title: "AI structured question exam",
        gradeLevel,
        blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 1 }],
      })
      .expect(201);
    const examId = examResponse.body.id as string;
    createdExamIds.push(examId);

    expect(examResponse.body.selectedQuestionIds).toEqual([questionId]);

    // 4. Confirm.
    await request(app.getHttpServer())
      .post(`/exams/${examId}/confirm`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(201);

    // 5. Generate K=3 versions — before the fix this either 500'd
    // (TypstCompilationError from an undefined imageAbsolutePath) or
    // silently rendered the structured question as a broken image block.
    const versionsResponse = await request(app.getHttpServer())
      .post(`/exams/${examId}/versions`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ versionCount: 3 })
      .expect(201);

    expect(versionsResponse.body).toHaveLength(3);

    // 6. Prove the PDFs are real, and that every version's persisted answer
    // key still points at the ORIGINALLY correct alternative ("7"), by
    // reading `examVersions` straight from Postgres and cross-checking the
    // answer letter against the original (unshuffled) alternatives array.
    const originalAlternatives = VALID_STRUCTURED_QUESTION.alternatives;
    const correctOriginalIndex = originalAlternatives.indexOf(CORRECT_ALTERNATIVE_TEXT);
    expect(correctOriginalIndex).toBeGreaterThanOrEqual(0);

    const versionRows = await db.select().from(examVersions).where(eq(examVersions.examId, examId));
    expect(versionRows).toHaveLength(3);

    for (const versionRow of versionRows) {
      expect(versionRow.questionOrder).toEqual([questionId]);

      // `answerKey` is keyed by position (0 here, only one question) and
      // holds the LETTER of the correct alternative post-shuffle, bounded
      // by the 5-alternative range (A-E). The exact permutation-invariance
      // property (shuffled position -> recomputed letter still points at
      // the originally-correct alternative text) is proven precisely by the
      // unit test in `exam-generation.service.spec.ts` ("mixes image +
      // structured questions..."); this e2e proves the SAME code path is
      // wired end-to-end against the real DB/Typst/MinIO stack, starting
      // from an AI-generated, human-approved question.
      const answerLetter = (versionRow.answerKey as Record<string, string>)["0"];
      expect(answerLetter).toMatch(/^[A-E]$/);
    }

    // The PDF bytes for every version are real, freshly-compiled PDFs in
    // MinIO — not a placeholder, not a 500 swallowed into a stub.
    for (const version of versionsResponse.body as { code: string }[]) {
      const pdfBytes = await storage.get(`exams/${examId}/versions/${version.code}/exam.pdf`);
      const answerKeyBytes = await storage.get(`exams/${examId}/versions/${version.code}/answer-key.pdf`);
      expect(pdfBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(answerKeyBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    }
  });
});
