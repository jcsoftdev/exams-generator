import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { assets, courses, questions, tenants, topics, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { hashBodyTypst } from "../bank/domain/hash-body-typst";
import { ExamsRepository } from "../exams/exams.repository";

describe("GET /dashboard/stats (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let bankRepository: BankRepository;
  let examsRepository: ExamsRepository;

  let courseId: string;
  let topicId: string;
  let tenantId: string;
  let teacherId: string;
  let staffId: string;
  let token: string;
  let staffToken: string;

  const createdQuestionIds: string[] = [];
  const createdExamIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);
    // Direct instantiation (not `moduleRef.get(...)`) for the two repositories
    // — mirrors `bank.repository.spec.ts`/`exams.repository.spec.ts`'s own
    // convention (`new BankRepository(db)`/`new ExamsRepository(db)`) — the
    // repos take the Drizzle `db` as their only constructor dependency
    // (injected via `DRIZZLE_DB` in the modules), so the spec passes the
    // module-level `db` singleton directly — no DI container needed.
    bankRepository = new BankRepository(db);
    examsRepository = new ExamsRepository(db);

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `Dashboard E2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `Dashboard E2E Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenant] = await db
      .insert(tenants)
      .values({ name: `Dashboard E2E Tenant ${suffix}`, slug: `dashboard-e2e-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [teacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `dashboard-e2e-teacher-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherId = teacher!.id;

    const [staff] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: `dashboard-e2e-staff-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.ContentEditor,
      })
      .returning({ id: users.id });
    staffId = staff!.id;

    token = tokenService.sign({ sub: teacherId, tenantId, role: Role.Teacher });
    staffToken = tokenService.sign({ sub: staffId, tenantId: null, role: Role.ContentEditor });

    const q1 = await bankRepository.createImageQuestion({
      tenantId,
      topicId,
      difficulty: Difficulty.Easy,
      gradeLevel: "primaria_1",
      correctAnswer: "a",
      createdBy: teacherId,
      image: { storageKey: `test/${randomUUID()}`, mime: "image/png" },
    });
    createdQuestionIds.push(q1.id);

    const q2 = await bankRepository.createStructuredQuestion({
      tenantId,
      topicId,
      difficulty: Difficulty.Hard,
      gradeLevel: "primaria_1",
      bodyTypst: "$x = 1$",
      bodyHash: hashBodyTypst("$x = 1$"),
      alternatives: ["1", "2"],
      correctAnswer: "0",
      figureCode: undefined,
      createdBy: teacherId,
      status: "draft",
      aiGenerated: true,
    });
    createdQuestionIds.push(q2.id);

    const exam1 = await examsRepository.createExam({
      tenantId,
      title: "Examen Ready",
      gradeLevel: "primaria_1",
      createdBy: teacherId,
      blueprint: [{ courseId, count: 1 }],
    });
    createdExamIds.push(exam1.id);
    await examsRepository.confirmExam(exam1.id);

    const exam2 = await examsRepository.createExam({
      tenantId,
      title: "Examen Draft",
      gradeLevel: "primaria_1",
      createdBy: teacherId,
      blueprint: [{ courseId, count: 1 }],
    });
    createdExamIds.push(exam2.id);
  });

  afterAll(async () => {
    const cleanupSteps: Array<[string, () => Promise<unknown>]> = [
      ["close app", () => app.close()],
      [
        "delete exams",
        async () => {
          for (const id of createdExamIds) {
            await examsRepository.deleteExam(id, tenantId);
          }
        },
      ],
      [
        "delete questions",
        async () => {
          if (createdQuestionIds.length > 0) {
            await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
          }
        },
      ],
      // `createImageQuestion` also inserts a backing `assets` row (tenant-scoped
      // FK) — must be cleared before deleting `tenants`, or the delete below
      // violates `assets_tenant_id_tenants_id_fk` (mirrors `bank.e2e.spec.ts`'s
      // own asset cleanup convention).
      ["delete assets", () => db.delete(assets).where(inArray(assets.tenantId, [tenantId]))],
      ["delete users", () => db.delete(users).where(inArray(users.id, [teacherId, staffId]))],
      ["delete tenants", () => db.delete(tenants).where(inArray(tenants.id, [tenantId]))],
      ["delete topics", () => db.delete(topics).where(inArray(topics.id, [topicId]))],
      ["delete courses", () => db.delete(courses).where(inArray(courses.id, [courseId]))],
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

  it("returns bank + exam + aiDrafts stats scoped to the caller's tenant", async () => {
    const response = await request(app.getHttpServer())
      .get("/dashboard/stats")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.exams.total).toBe(2);
    expect(response.body.exams.byStatus).toEqual({ draft: 1, ready: 1 });
    expect(response.body.exams.recent).toHaveLength(2);
    expect(response.body.exams.recent.map((e: { title: string }) => e.title).sort()).toEqual([
      "Examen Draft",
      "Examen Ready",
    ]);
    expect(response.body.bank.byDifficulty.easy).toBeGreaterThanOrEqual(1);
    expect(response.body.bank.byDifficulty.hard).toBeGreaterThanOrEqual(1);
    expect(response.body.bank.byStatus.draft).toBeGreaterThanOrEqual(1);
    expect(response.body.aiDrafts.pending).toBeGreaterThanOrEqual(1);
  });

  it("returns zeroed exam stats for platform staff (tenantId=null)", async () => {
    const response = await request(app.getHttpServer())
      .get("/dashboard/stats")
      .set("Authorization", `Bearer ${staffToken}`)
      .expect(200);

    expect(response.body.exams).toEqual({ total: 0, byStatus: { draft: 0, ready: 0 }, recent: [] });
  });

  it("rejects with 401 when no Authorization header is sent", async () => {
    await request(app.getHttpServer()).get("/dashboard/stats").expect(401);
  });
});
