import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { fakePng } from "../../test-support/image-fixtures";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { tenants, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";
import { InMemoryQuestionGeneratorAdapter } from "./adapters/in-memory-question-generator.adapter";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";

/**
 * Full HTTP e2e for `POST /ai/questions/extract` (question editing, Task 5):
 * OCR/vision extraction of a question from a photo, returning a VALIDATED,
 * UNSAVED draft — it never writes to the DB. Overrides
 * `QUESTION_GENERATOR_PORT` with the in-memory fake (mirrors
 * `ai-revise.e2e.spec.ts`/`ai.e2e.spec.ts`) so this suite never depends on
 * `AI_MODEL`/`OPENROUTER_API_KEY`/network access. Unlike `revise`, there is
 * no Typst compile step here (no `:id`, no existing content to merge with),
 * so no `typst` CLI availability guard is needed.
 */
describe("POST /ai/questions/extract (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let tenantId: string;
  let teacherId: string;
  let token: string;

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QUESTION_GENERATOR_PORT)
      .useValue(new InMemoryQuestionGeneratorAdapter())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [tenant] = await db
      .insert(tenants)
      .values({ name: `AI Extract E2E Tenant ${suffix}`, slug: `ai-extract-e2e-tenant-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [teacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `ai-extract-e2e-teacher-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherId = teacher!.id;

    token = tokenService.sign({ sub: teacherId, tenantId, role: Role.Teacher });
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.id, [teacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantId]));
    await app.close();
    await pool.end();
  });

  function extractRequest() {
    return request(app.getHttpServer()).post("/ai/questions/extract").set("Authorization", `Bearer ${token}`);
  }

  it("returns a validated, UNSAVED draft with correctAnswer converted from the generator's LETTER to an INDEX", async () => {
    const response = await extractRequest()
      .attach("file", fakePng(), { filename: "q.png", contentType: "image/png" })
      .expect(200);

    expect(response.body.bodyTypst).toBe("¿Cuánto es $2 + 2$? (extraída de imagen)");
    expect(response.body.alternatives).toEqual(["3", "4", "5", "6", "7"]);
    // Fake generator returns LETTER "a" — response convention is the 0-based INDEX "0".
    expect(response.body.correctAnswer).toBe("0");
  });

  it("rejects with 400 when no file is attached", async () => {
    await extractRequest().expect(400);
  });

  it("rejects with 400 a non-image file (spoofed content-type) before any vision call", async () => {
    await extractRequest()
      .attach("file", Buffer.from("<svg><script>alert(1)</script></svg>"), {
        filename: "q.png",
        contentType: "image/png",
      })
      .expect(400);
  });

  it("rejects with 401 when no Authorization header is sent", async () => {
    await request(app.getHttpServer())
      .post("/ai/questions/extract")
      .attach("file", fakePng(), { filename: "q.png", contentType: "image/png" })
      .expect(401);
  });
});
