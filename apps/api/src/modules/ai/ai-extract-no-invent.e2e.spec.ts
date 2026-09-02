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
import { QUESTION_GENERATOR_PORT } from "./ai.constants";
import { QuestionGeneratorPort } from "./domain/ports/question-generator.port";

/**
 * A1 feature test: `POST /ai/questions/extract` must not invent alternatives
 * or a correct-answer key the source photo doesn't actually show — see the
 * design note in `ExtractedQuestion` (`domain/ports/question-generator.port.ts`).
 * Before this change, `EXTRACT_RESPONSE_JSON_SCHEMA` demanded exactly 5
 * alternatives and a letter `correctAnswer`, forcing the vision model to
 * fabricate whichever the photo didn't show; the schema, the validator, and
 * `ExtractQuestionService.extract` now all allow `alternatives: []` and
 * `correctAnswer: null` through UNCHANGED.
 *
 * Overrides `QUESTION_GENERATOR_PORT` with a scripted mock per test (mirrors
 * `ai-extract-crop.e2e.spec.ts`) rather than the fixed
 * `InMemoryQuestionGeneratorAdapter` — each test needs a DIFFERENT
 * `extractFromImage` payload, which a shared fixed fake can't provide.
 * `fakePng()` is not a real decodable PNG, so `ExtractQuestionService`'s crop
 * detection (`buildCrops`) fails fast on the sharp decode and is swallowed —
 * same as `ai-extract.e2e.spec.ts` — so this suite, like that one, needs no
 * `describeIfTesseract` gate.
 */
describe("POST /ai/questions/extract — does not invent alternatives or a key (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let tenantId: string;
  let teacherId: string;
  let token: string;

  const generator: jest.Mocked<QuestionGeneratorPort> = {
    generate: jest.fn(),
    reviseQuestion: jest.fn(),
    extractFromImage: jest.fn(),
  };

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QUESTION_GENERATOR_PORT)
      .useValue(generator)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [tenant] = await db
      .insert(tenants)
      .values({
        name: `AI Extract No-Invent E2E Tenant ${suffix}`,
        slug: `ai-extract-no-invent-e2e-${suffix}`,
      })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [teacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `ai-extract-no-invent-e2e-teacher-${suffix}@exams-generator.test`,
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

  it("returns alternatives: [] and correctAnswer: null AS-IS when the photo shows neither — never inventing 5 alternatives or a key", async () => {
    generator.extractFromImage.mockResolvedValueOnce({
      bodyTypst: "¿Qué muestra la figura?",
      alternatives: [],
      correctAnswer: null,
    });

    const response = await extractRequest()
      .attach("file", fakePng("no-alternatives"), { filename: "q.png", contentType: "image/png" })
      .expect(200);

    expect(response.body.bodyTypst).toBe("¿Qué muestra la figura?");
    expect(response.body.alternatives).toEqual([]);
    expect(response.body.correctAnswer).toBeNull();
  });

  it("returns correctAnswer: null AS-IS when 5 alternatives are visible but no key is — never guessing a letter", async () => {
    generator.extractFromImage.mockResolvedValueOnce({
      bodyTypst: "¿Cuánto es $2 + 2$?",
      alternatives: ["3", "4", "5", "6", "7"],
      correctAnswer: null,
    });

    const response = await extractRequest()
      .attach("file", fakePng("alternatives-no-key"), { filename: "q.png", contentType: "image/png" })
      .expect(200);

    expect(response.body.bodyTypst).toBe("¿Cuánto es $2 + 2$?");
    expect(response.body.alternatives).toEqual(["3", "4", "5", "6", "7"]);
    expect(response.body.correctAnswer).toBeNull();
  });
});
