import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { tenants, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";
import { InMemoryQuestionGeneratorAdapter } from "./adapters/in-memory-question-generator.adapter";
import { isTesseractAvailableSync } from "./adapters/ocr/test-utils/tesseract-availability";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";

const FIXTURES_DIR = path.join(__dirname, "__fixtures__");

const describeIfTesseract = isTesseractAvailableSync() ? describe : describe.skip;

/**
 * GOLDEN e2e for OCR-driven figure detection (design doc Task 6) — the ONLY
 * place in this branch the real `tesseract` binary is exercised. Every unit
 * spec covering `TesseractCliAdapter`'s TSV parsing, `findFigureRegions`'s
 * subtraction algorithm and `attributeFigureToAlternative` uses mocked OCR
 * output; this test is what proves those mocks agree with what the actual
 * binary emits on a real page, not with what a test author imagined it
 * would.
 *
 * Copies the app bootstrap and auth setup from `ai-extract.e2e.spec.ts`.
 * `QUESTION_GENERATOR_PORT` stays stubbed with the same in-memory fake: the
 * vision model producing the transcription is not what this test is about,
 * and a real call would make it non-deterministic and billable. The text
 * region detector (`TesseractCliAdapter`) and the image cropper
 * (`SharpImageCropperAdapter`) are left exactly as `AppModule` wires them —
 * both REAL.
 *
 * Guarded with `describe.skip` (not a fake pass) when `tesseract` isn't
 * installed — see infra/Dockerfile.api for the pinned version, and
 * `isTesseractAvailableSync` (mirrors `isTypstAvailableSync`).
 *
 * Fixtures under `__fixtures__/` are synthetic pages compiled with `typst`
 * (`typst compile --format png <file>.typ <out>.png`) rather than
 * photographs — deterministic, and a reviewer can open the PNG and see
 * exactly the geometry being asserted:
 *   - `question-with-circuit.png`: a 4-line question stem, a 3cm vertical
 *     gap, then a single unlabelled `#rect` (6.5cm x 4cm) on a 12cm x 16cm
 *     page. Text and drawing never touch, and the page has no `a)`/`b)`/...
 *     alternative markers anywhere.
 *   - `question-text-only.png`: the same stem plus a second paragraph of
 *     prose — no drawing anywhere on the page.
 */
describeIfTesseract("POST /ai/questions/extract — OCR figure detection (golden e2e, real tesseract)", () => {
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
      .values({ name: `AI Extract OCR E2E Tenant ${suffix}`, slug: `ai-extract-ocr-e2e-tenant-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [teacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `ai-extract-ocr-e2e-teacher-${suffix}@exams-generator.test`,
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

  it("detects exactly one figure in a page whose text and drawing are separate", async () => {
    const png = await fs.readFile(path.join(FIXTURES_DIR, "question-with-circuit.png"));

    const response = await request(app.getHttpServer())
      .post("/ai/questions/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, "question.png")
      .expect(200);

    expect(response.body.figureCrop).toBeDefined();
    expect(response.body.figureCrop.dataUrl).toMatch(/^data:image\/png;base64,/);
    // The crop is the drawing, not the whole page: a box that swallowed
    // the text would be nearly full height. The fixture's rect sits at
    // ~25% of the page height, well clear of this threshold.
    expect(response.body.figureCrop.box.h).toBeLessThan(0.8);
    // No `a)`/`b)`/... markers anywhere on this page, so
    // `attributeFigureToAlternative` treats the lone figure as the
    // statement's own complement rather than an alternative's drawing.
    expect(response.body.alternativeCrops).toBeUndefined();
  });

  it("finds no figure in a page that is only text", async () => {
    const png = await fs.readFile(path.join(FIXTURES_DIR, "question-text-only.png"));

    const response = await request(app.getHttpServer())
      .post("/ai/questions/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, "question.png")
      .expect(200);

    expect(response.body.figureCrop).toBeUndefined();
    // Nothing to re-crop means nothing gets cached: no extractionId.
    expect(response.body.extractionId).toBeUndefined();
  });
});
