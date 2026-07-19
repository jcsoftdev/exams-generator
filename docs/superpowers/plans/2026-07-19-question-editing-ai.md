# Question Editing (manual + AI-assisted) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the broken "Editar" button into a real inline editor for bank questions (structured + image), with AI-assisted revision (instruction-driven) and OCR extraction from a photo.

**Architecture:** Backend extends the existing `PATCH /bank/questions/:id` edit path to allow `approved` questions + taxonomy fields, adds `POST /bank/questions/:id/image` (image swap), and adds two AI endpoints (`/ai/questions/:id/revise`, `/ai/questions/extract`) backed by two new `QuestionGeneratorPort` methods. Frontend turns the read-only detail panel in `bank-list.component` into an inline edit form with an AI instruction box + OCR upload. AI output is validated (Typst compile) and NEVER auto-persisted — it fills the form for human review.

**Tech Stack:** NestJS + Drizzle (Postgres) + `jest` (api); Angular standalone + signals + Tailwind v4 + `vitest`/`ng test` (web); OpenRouter via `QuestionGeneratorPort`; Typst via `PdfCompilerPort`.

## Global Constraints

- **Spanish (Perú), tuteo, no jerga** — all user-facing copy. Never voseo.
- **Strict TDD** — test first, watch it fail, minimal impl, watch it pass, commit.
- **AI never persists** — `revise`/`extract` return unsaved drafts; only the human `PATCH` saves.
- **Tenant scoping via `@CurrentUser()`** — never a route param. Cross-tenant = 404 (never leak existence). Central bank = read-only (403 on manage).
- **AI output is validated** — structured content runs through `validateStructuredContent` + Typst compile before it reaches the teacher; invalid = 422.
- **Shell commands:** `eza`/`bat`/`rg`/`fd`/`sd`, not `ls`/`cat`/`grep`/`find`/`sed`. Never build.
- **Conventional commits**, no AI attribution.
- **API tests:** `cd apps/api && pnpm exec jest <path>`. **Web tests:** `cd apps/web && pnpm exec ng test` (file-scoped vitest fails on `initTestEnvironment` — run the full `ng test`).
- **Author:** `jcsoftdev`.

---

## File Structure

**Backend (`apps/api/src/modules`):**
- `bank/bank.service.ts` — new `requireManageableQuestion` guard (draft+approved, block archived/central); `editQuestion` accepts taxonomy; `replaceImage`.
- `bank/bank.repository.ts` — `updateQuestionTaxonomy`, `replaceImageAsset`.
- `bank/bank.controller.ts` — extend `PATCH :id` body; add `POST :id/image`.
- `bank/domain/validate-question-taxonomy.ts` — new taxonomy validator.
- `ai/domain/ports/question-generator.port.ts` — add `reviseQuestion`, `extractFromImage` + I/O types.
- `ai/adapters/in-memory-question-generator.adapter.ts`, `lazy-question-generator.adapter.ts` — implement new methods (fakes).
- `ai/adapters/openrouter/openrouter.adapter.ts` (+ request-builder/response-parser) — real impl.
- `ai/revise-question.service.ts`, `ai/extract-question.service.ts` — new app services.
- `ai/ai.controller.ts` — add `POST :id/revise`, `POST extract`.

**Frontend (`apps/web/src/app/features`):**
- `bank/bank.models.ts` — `UpdateQuestionPayload`, `RevisedQuestion`, `ExtractedQuestion`.
- `bank/bank.service.ts` — `updateQuestion`, `replaceQuestionImage`.
- `ai/ai.service.ts` — `reviseQuestion`, `extractQuestionFromImage`.
- `bank/bank-list/bank-list.component.ts` + `.html` — inline edit mode, AI box, OCR upload.

---

## Task 1: Backend — allow editing approved questions + taxonomy

**Files:**
- Modify: `apps/api/src/modules/bank/bank.service.ts` (guard `requireVisibleDraft:242`, `editDraftQuestion`)
- Create: `apps/api/src/modules/bank/domain/validate-question-taxonomy.ts`
- Modify: `apps/api/src/modules/bank/bank.repository.ts`
- Modify: `apps/api/src/modules/bank/bank.controller.ts` (`EditDraftQuestionBody:47`, `@Patch(":id"):199`)
- Test: `apps/api/src/modules/bank/domain/validate-question-taxonomy.spec.ts`, `apps/api/src/modules/bank/bank-edit-approved.e2e.spec.ts`

**Interfaces:**
- Produces: `validateQuestionTaxonomy(patch): { ok: true } | { ok: false; errors: string[] }`; `BankService.editQuestion(user, id, patch)` where `patch` adds optional `courseId`, `topicId`, `difficulty`, `gradeLevel`; `PATCH /bank/questions/:id` accepts those fields and works on `status='approved'` (not archived/central).

- [ ] **Step 1: Failing taxonomy-validator test**

Create `apps/api/src/modules/bank/domain/validate-question-taxonomy.spec.ts`:
```ts
import { validateQuestionTaxonomy } from "./validate-question-taxonomy";

describe("validateQuestionTaxonomy", () => {
  it("accepts an empty patch (nothing to change)", () => {
    expect(validateQuestionTaxonomy({})).toEqual({ ok: true });
  });
  it("rejects a blank courseId", () => {
    const r = validateQuestionTaxonomy({ courseId: "  " });
    expect(r.ok).toBe(false);
  });
  it("rejects an invalid difficulty", () => {
    const r = validateQuestionTaxonomy({ difficulty: "trivial" });
    expect(r.ok).toBe(false);
  });
  it("accepts valid fields", () => {
    expect(validateQuestionTaxonomy({ courseId: "c1", topicId: "t1", difficulty: "easy", gradeLevel: "pre" })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/bank/domain/validate-question-taxonomy.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the validator**

Create `apps/api/src/modules/bank/domain/validate-question-taxonomy.ts`:
```ts
import { Difficulty } from "@exams-generator/shared";

export interface QuestionTaxonomyPatch {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
}

export type TaxonomyValidation = { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] };

const DIFFICULTIES = new Set<string>(Object.values(Difficulty));

export function validateQuestionTaxonomy(patch: QuestionTaxonomyPatch): TaxonomyValidation {
  const errors: string[] = [];
  const nonBlank = (v: string | undefined, name: string) => {
    if (v !== undefined && v.trim() === "") errors.push(`${name} must not be blank`);
  };
  nonBlank(patch.courseId, "courseId");
  nonBlank(patch.topicId, "topicId");
  nonBlank(patch.gradeLevel, "gradeLevel");
  if (patch.difficulty !== undefined && !DIFFICULTIES.has(patch.difficulty)) {
    errors.push(`difficulty must be one of ${[...DIFFICULTIES].join(", ")}`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `cd apps/api && pnpm exec jest src/modules/bank/domain/validate-question-taxonomy.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add a manageable-question guard + taxonomy edit to the service**

In `bank.service.ts`, add a guard next to `requireVisibleDraft` (do NOT change `requireVisibleDraft` — approve/reject still need draft-only):
```ts
/**
 * Edit precondition (broader than requireVisibleDraft): a question the caller
 * can MANAGE and that is still editable content-wise — `draft` OR `approved`
 * (never `archived`; never central-bank, which is read-only for tenants).
 */
private async requireManageableQuestion(user: AuthTokenPayload, id: string): Promise<QuestionListItem> {
  const question = await this.repository.findQuestionById(id, user.tenantId);
  if (!question) {
    throw new NotFoundException(`Question not found: ${id}`);
  }
  assertCanManageTenant(user.role, question.tenantId);
  if (question.status === "archived") {
    throw new ConflictException(`Question ${id} is archived and cannot be edited`);
  }
  return question;
}
```
Then repoint the edit method (currently `editDraftQuestion`, which calls `requireVisibleDraft`) to `requireManageableQuestion`, and extend it to also apply taxonomy. Rename it `editQuestion(user, id, patch)` where `patch` includes the existing structured fields PLUS `courseId?/topicId?/difficulty?/gradeLevel?`. After the existing structured-content validation + Typst compile, validate taxonomy via `validateQuestionTaxonomy(patch)` (400 on failure) and call `repository.updateQuestionTaxonomy(id, user.tenantId, {courseId,topicId,difficulty,gradeLevel})` for the provided fields. Keep the preview-cache invalidation.

- [ ] **Step 6: Add the repository taxonomy update**

In `bank.repository.ts` add:
```ts
async updateQuestionTaxonomy(
  id: string,
  tenantId: string | null,
  patch: { courseId?: string; topicId?: string; difficulty?: string; gradeLevel?: string },
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (patch.courseId !== undefined) set.courseId = patch.courseId;
  if (patch.topicId !== undefined) set.topicId = patch.topicId;
  if (patch.difficulty !== undefined) set.difficulty = patch.difficulty;
  if (patch.gradeLevel !== undefined) set.gradeLevel = patch.gradeLevel;
  if (Object.keys(set).length === 0) return;
  await db.update(questions).set(set).where(and(eq(questions.id, id), tenantVisibility(tenantId)));
}
```
(Follow the tenant predicate helper already used in this file for question writes; match its exact name.)

- [ ] **Step 7: Extend the controller PATCH body**

In `bank.controller.ts`, extend `EditDraftQuestionBody` to add `courseId?`, `topicId?`, `difficulty?`, `gradeLevel?` (all `readonly … ?: string`), and point the `@Patch(":id")` handler at `service.editQuestion(...)`.

- [ ] **Step 8: Failing e2e — edit an approved question + taxonomy**

Create `apps/api/src/modules/bank/bank-edit-approved.e2e.spec.ts` (mirror the harness in `bank.e2e.spec.ts`: bootstrap `AppModule`, seed a course/topic/tenant/teacher, sign a token). Assert:
- `PATCH /bank/questions/:id` on an OWN `approved` structured question with `{ bodyTypst: "Nuevo enunciado $2+2$", difficulty: "hard" }` → 200; a follow-up `GET /bank/questions/:id` reflects both changes.
- Same PATCH cross-tenant → 404.
- PATCH on an `archived` question → 409.

- [ ] **Step 9: Run e2e green**

Run: `cd apps/api && pnpm exec jest src/modules/bank/bank-edit-approved.e2e.spec.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/bank
git commit -m "feat(api): edit approved questions + taxonomy via PATCH /bank/questions/:id"
```

---

## Task 2: Backend — replace an image question's image

**Files:**
- Modify: `apps/api/src/modules/bank/bank.service.ts`, `bank.repository.ts`, `bank.controller.ts`
- Test: `apps/api/src/modules/bank/bank-replace-image.e2e.spec.ts`

**Interfaces:**
- Produces: `POST /bank/questions/:id/image` (multipart `file`) → `{ id: string }`; only `type='image'`, manageable (draft+approved, own). Swaps `imageAssetId` to a new asset.

- [ ] **Step 1: Failing e2e**

Create `apps/api/src/modules/bank/bank-replace-image.e2e.spec.ts`. Seed an OWN image question. Assert:
- `POST /bank/questions/:id/image` with `.attach("file", pngBuffer, {filename,contentType})` → 201 `{ id }`; `GET /bank/questions/:id` shows a DIFFERENT `imageAssetId`.
- Same on a `structured` question → 400.
- Cross-tenant → 404.

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/bank/bank-replace-image.e2e.spec.ts`
Expected: FAIL — route 404.

- [ ] **Step 3: Service method**

In `bank.service.ts` add (mirror `createImageQuestion`'s storage.put + asset insert):
```ts
async replaceImage(user: AuthTokenPayload, id: string, file: UploadedImageFile): Promise<{ id: string }> {
  const question = await this.requireManageableQuestion(user, id);
  if (question.type !== "image") {
    throw new BadRequestException("Only image questions have an image to replace");
  }
  const storageKey = `bank/questions/${randomUUID()}`;
  await this.storage.put(storageKey, file.buffer, file.mimetype);
  await this.repository.replaceImageAsset(id, user.tenantId, { storageKey, mime: file.mimetype });
  return { id };
}
```
(Use the SAME `UploadedImageFile`/storage-port types `createImageQuestion` uses. `replaceImageAsset` inserts a new asset row + points the question's `imageAssetId` at it, in one transaction.)

- [ ] **Step 4: Repository method**

In `bank.repository.ts` add `replaceImageAsset(id, tenantId, {storageKey, mime})`: insert into `assets` (tenant-scoped), then `db.update(questions).set({ imageAssetId: asset.id }).where(and(eq(questions.id,id), tenantVisibility(tenantId)))`. Return the question id (or undefined if no row updated).

- [ ] **Step 5: Controller route**

In `bank.controller.ts`:
```ts
@Post(":id/image")
@HttpCode(201)
@UseInterceptors(FileInterceptor("file"))
async replaceImage(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string, @UploadedFile() file: Express.Multer.File) {
  return this.service.replaceImage(user, id, { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname });
}
```

- [ ] **Step 6: Run e2e green**

Run: `cd apps/api && pnpm exec jest src/modules/bank/bank-replace-image.e2e.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/bank
git commit -m "feat(api): POST /bank/questions/:id/image to swap an image question's image"
```

---

## Task 3: Backend — extend QuestionGeneratorPort (revise + extract) with fakes

**Files:**
- Modify: `apps/api/src/modules/ai/domain/ports/question-generator.port.ts`
- Modify: `apps/api/src/modules/ai/adapters/in-memory-question-generator.adapter.ts`, `lazy-question-generator.adapter.ts`
- Test: `apps/api/src/modules/ai/adapters/in-memory-question-generator.adapter.spec.ts` (extend if exists, else create)

**Interfaces:**
- Produces on `QuestionGeneratorPort`:
```ts
reviseQuestion(input: ReviseQuestionInput): Promise<GeneratedQuestion>;
extractFromImage(input: ExtractQuestionInput): Promise<GeneratedQuestion>;
```
with:
```ts
export interface ReviseQuestionInput {
  readonly current: { bodyTypst: string; alternatives: readonly string[]; correctAnswer: string };
  readonly instruction: string;
  readonly difficulty: Difficulty;
}
export interface ExtractQuestionInput {
  readonly image: Buffer;
  readonly mimeType: string;
}
```

- [ ] **Step 1: Failing fake-adapter test**

In the in-memory adapter spec, add:
```ts
it("reviseQuestion returns a valid GeneratedQuestion echoing the instruction", async () => {
  const out = await adapter.reviseQuestion({
    current: { bodyTypst: "2+2", alternatives: ["4","5","6","7","8"], correctAnswer: "a" },
    instruction: "hazla más difícil",
    difficulty: Difficulty.Hard,
  });
  expect(out.alternatives).toHaveLength(5);
  expect(typeof out.bodyTypst).toBe("string");
  expect("abcde").toContain(out.correctAnswer);
});
it("extractFromImage returns a valid GeneratedQuestion", async () => {
  const out = await adapter.extractFromImage({ image: Buffer.from("png"), mimeType: "image/png" });
  expect(out.alternatives).toHaveLength(5);
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/ai/adapters/in-memory-question-generator.adapter.spec.ts`
Expected: FAIL — `reviseQuestion` not a function.

- [ ] **Step 3: Add the port methods + types**

Add the two interfaces + methods to `question-generator.port.ts` (as in Interfaces above).

- [ ] **Step 4: Implement in both fakes**

In-memory adapter: `reviseQuestion` returns `{ bodyTypst: `${input.current.bodyTypst} (revisado: ${input.instruction})`, alternatives: input.current.alternatives.slice(0,5) as GeneratedAlternatives (pad to 5 deterministically), correctAnswer: input.current.correctAnswer }`. `extractFromImage` returns a fixed valid `GeneratedQuestion` (5 alternatives, `correctAnswer:"a"`). Lazy adapter: delegate/throw the same way its `generate` does.

- [ ] **Step 5: Run it green + full ai suite**

Run: `cd apps/api && pnpm exec jest src/modules/ai/adapters`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ai/domain apps/api/src/modules/ai/adapters
git commit -m "feat(api): add reviseQuestion + extractFromImage to QuestionGeneratorPort (+ fakes)"
```

---

## Task 4: Backend — POST /ai/questions/:id/revise

**Files:**
- Create: `apps/api/src/modules/ai/revise-question.service.ts`
- Modify: `apps/api/src/modules/ai/ai.controller.ts`, `ai/ai.module.ts`
- Test: `apps/api/src/modules/ai/revise-question.service.spec.ts`, `apps/api/src/modules/ai/ai-revise.e2e.spec.ts`

**Interfaces:**
- Consumes: `QuestionGeneratorPort.reviseQuestion`, `BankRepository.findQuestionById`, `PdfCompilerPort` (validation), `validateStructuredContent`.
- Produces: `POST /ai/questions/:id/revise` body `{ instruction: string }` → `{ bodyTypst, alternatives, correctAnswer }` (unsaved). 404 missing/cross-tenant; 400 blank instruction; 422 AI output fails validation/compile.

- [ ] **Step 1: Failing service unit test**

Create `revise-question.service.spec.ts` with a fake repo (returns a structured question), a fake generator (returns a `GeneratedQuestion`), and a fake `PdfCompilerPort` (compiles OK). Assert:
- `revise(user, "q1", { instruction: "más difícil" })` resolves to the generator's output shape, and does NOT call any repo write.
- blank instruction → `BadRequestException`.
- generator output that fails `validateStructuredContent` (e.g. 2 alternatives) → `UnprocessableEntityException`.
- repo returns undefined → `NotFoundException`.

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/ai/revise-question.service.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the service**

Create `revise-question.service.ts`:
```ts
@Injectable()
export class ReviseQuestionService {
  constructor(
    @Inject(QUESTION_GENERATOR_PORT) private readonly generator: QuestionGeneratorPort,
    @Inject(PDF_COMPILER_PORT) private readonly pdfCompiler: PdfCompilerPort,
    private readonly bankRepository: BankRepository,
  ) {}

  async revise(user: AuthTokenPayload, id: string, instruction: string): Promise<GeneratedQuestion> {
    if (!instruction || instruction.trim() === "") {
      throw new BadRequestException("instruction must not be blank");
    }
    const q = await this.bankRepository.findQuestionById(id, user.tenantId);
    if (!q) throw new NotFoundException(`Question not found: ${id}`);
    const revised = await this.generator.reviseQuestion({
      current: { bodyTypst: q.bodyTypst ?? "", alternatives: (q.alternatives as string[]) ?? [], correctAnswer: q.correctAnswer },
      instruction,
      difficulty: q.difficulty,
    });
    const errors = validateStructuredContent({ bodyTypst: revised.bodyTypst, alternatives: revised.alternatives, correctAnswer: revised.correctAnswer, figureCode: revised.figureCode });
    if (errors.length > 0) {
      throw new UnprocessableEntityException({ message: "AI produced invalid content", errors });
    }
    // Compile-guard, same as manual structured edits — reject non-compiling markup.
    await this.compileOrThrow(revised);
    return revised;
  }

  private async compileOrThrow(q: GeneratedQuestion): Promise<void> {
    try {
      await this.pdfCompiler.compilePreviewFromContent(q.bodyTypst, q.alternatives, q.figureCode);
    } catch (e) {
      if (e instanceof TypstCompilationError) throw new UnprocessableEntityException("AI produced content that does not compile");
      throw e;
    }
  }
}
```
**Prerequisite for this step:** `bank.service.previewQuestion` (`bank.service.ts:295`) currently builds the single-question Typst preview input INLINE before calling the compiler. Extract that builder into a shared helper `compilePreviewFromContent(bodyTypst, alternatives, figureCode)` (co-locate it with `PdfCompilerPort`, or a `bank/domain` module the ai module can import) and call it from BOTH `previewQuestion` and here, so manual edits and AI revisions are validated identically. Read `previewQuestion` first to copy its exact input shape.

- [ ] **Step 4: Run unit green**

Run: `cd apps/api && pnpm exec jest src/modules/ai/revise-question.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Controller route + module wiring**

In `ai.controller.ts`:
```ts
@Post("questions/:id/revise")
@HttpCode(200)
async revise(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string, @Body() body: { instruction?: string }) {
  return this.reviseService.revise(user, id, body.instruction ?? "");
}
```
Register `ReviseQuestionService` in `ai.module.ts` providers (it needs `BankRepository` — import `BankModule` or provide the repo, matching how `GenerateQuestionsService` already accesses it).

- [ ] **Step 6: Failing + green e2e**

Create `ai-revise.e2e.spec.ts` (AppModule uses the in-memory generator in test). Seed an OWN structured question. Assert:
- `POST /ai/questions/:id/revise { instruction: "más difícil" }` → 200 with `{ bodyTypst, alternatives, correctAnswer }`; a follow-up `GET /bank/questions/:id` is UNCHANGED (not persisted).
- blank instruction → 400. Cross-tenant → 404.

Run: `cd apps/api && pnpm exec jest src/modules/ai/ai-revise.e2e.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/ai
git commit -m "feat(api): POST /ai/questions/:id/revise (AI edit, validated, never persisted)"
```

---

## Task 5: Backend — POST /ai/questions/extract (OCR)

**Files:**
- Create: `apps/api/src/modules/ai/extract-question.service.ts`
- Modify: `apps/api/src/modules/ai/ai.controller.ts`, `ai/ai.module.ts`
- Test: `apps/api/src/modules/ai/extract-question.service.spec.ts`, `apps/api/src/modules/ai/ai-extract.e2e.spec.ts`

**Interfaces:**
- Produces: `POST /ai/questions/extract` (multipart `file`) → `{ bodyTypst, alternatives, correctAnswer }` (unsaved). 400 no file; 422 invalid AI output.

- [ ] **Step 1: Failing service unit test**

`extract-question.service.spec.ts`: fake generator returns a valid `GeneratedQuestion`; assert `extract(user, {buffer,mimetype})` returns it, validates it (same `validateStructuredContent`), and 422s on invalid output.

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/ai/extract-question.service.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the service**

```ts
@Injectable()
export class ExtractQuestionService {
  constructor(@Inject(QUESTION_GENERATOR_PORT) private readonly generator: QuestionGeneratorPort) {}
  async extract(file: { buffer: Buffer; mimetype: string }): Promise<GeneratedQuestion> {
    const out = await this.generator.extractFromImage({ image: file.buffer, mimeType: file.mimetype });
    const errors = validateStructuredContent({ bodyTypst: out.bodyTypst, alternatives: out.alternatives, correctAnswer: out.correctAnswer, figureCode: out.figureCode });
    if (errors.length > 0) throw new UnprocessableEntityException({ message: "AI produced invalid content", errors });
    return out;
  }
}
```

- [ ] **Step 4: Run unit green**

Run: `cd apps/api && pnpm exec jest src/modules/ai/extract-question.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Controller + module**

```ts
@Post("questions/extract")
@HttpCode(200)
@UseInterceptors(FileInterceptor("file"))
async extract(@UploadedFile() file: Express.Multer.File) {
  if (!file) throw new BadRequestException("file is required");
  return this.extractService.extract({ buffer: file.buffer, mimetype: file.mimetype });
}
```
Register `ExtractQuestionService` in `ai.module.ts`.

- [ ] **Step 6: e2e green**

Create `ai-extract.e2e.spec.ts`: `POST /ai/questions/extract` with `.attach("file", png, ...)` → 200 `{ bodyTypst, alternatives, correctAnswer }`; no file → 400.
Run: `cd apps/api && pnpm exec jest src/modules/ai/ai-extract.e2e.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/ai
git commit -m "feat(api): POST /ai/questions/extract (OCR image -> structured fields)"
```

---

## Task 6: Backend — OpenRouter adapter real impl (revise + extract)

**Files:**
- Modify: `apps/api/src/modules/ai/adapters/openrouter/openrouter.adapter.ts` (+ `openrouter-request-builder.ts`, `openrouter-response-parser.ts`)
- Test: extend `apps/api/src/modules/ai/adapters/openrouter/*.spec.ts`

**Interfaces:**
- Consumes: same OpenRouter chat-completions plumbing `generate()` already uses.
- Produces: real `reviseQuestion`/`extractFromImage` on the OpenRouter adapter, parsing the same JSON `{ bodyTypst, alternatives, correctAnswer, figureCode? }` shape.

- [ ] **Step 1: Failing request-builder test**

In `openrouter-request-builder.spec.ts` add a test that `buildReviseRequest(input)` produces a chat payload whose user message contains the instruction AND the current statement, and asks for the SAME JSON schema `buildGenerateRequest` asks for. For extract, `buildExtractRequest(image, mime)` produces a multimodal message with an `image_url` data-URI part.

- [ ] **Step 2: Run it, expect fail** — `cd apps/api && pnpm exec jest src/modules/ai/adapters/openrouter`. Expected: FAIL.

- [ ] **Step 3: Implement builders + adapter methods**

Add `buildReviseRequest` / `buildExtractRequest` mirroring `buildGenerateRequest`'s model + response-format. In the adapter, `reviseQuestion`/`extractFromImage` POST to OpenRouter, run the response through the SAME `parse` + `validate` pipeline `generate` uses (reuse `openrouter-response-parser`/`-validator`), and map errors to `AiRateLimitError`/`AiInvalidResponseError`. For extract, encode the image as a `data:${mime};base64,...` URL.

- [ ] **Step 4: Run green** — `cd apps/api && pnpm exec jest src/modules/ai/adapters/openrouter`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai/adapters/openrouter
git commit -m "feat(api): OpenRouter reviseQuestion + extractFromImage"
```

---

## Task 7: Frontend — services + models

**Files:**
- Modify: `apps/web/src/app/features/bank/bank.models.ts`, `bank/bank.service.ts` (+ `.spec.ts`)
- Modify: `apps/web/src/app/features/ai/ai.service.ts`, `ai/ai.models.ts` (+ `ai.service.spec.ts`)

**Interfaces:**
- Produces:
```ts
// bank.models.ts
export interface UpdateQuestionPayload {
  courseId?: string; topicId?: string; difficulty?: Difficulty; gradeLevel?: string;
  correctAnswer?: string; bodyTypst?: string; alternatives?: readonly string[];
}
export interface AiRevisedQuestion { bodyTypst: string; alternatives: readonly string[]; correctAnswer: string; }
// BankService
updateQuestion(id: string, patch: UpdateQuestionPayload): Observable<BankQuestion>;
replaceQuestionImage(id: string, image: File): Observable<{ id: string }>;
// AiService
reviseQuestion(id: string, instruction: string): Observable<AiRevisedQuestion>;
extractQuestionFromImage(image: File): Observable<AiRevisedQuestion>;
```

- [ ] **Step 1: Failing BankService spec**

In `bank.service.spec.ts` (uses `HttpTestingController`), add: `updateQuestion('q1', { difficulty: Difficulty.Hard })` issues `PATCH .../bank/questions/q1` with that body; `replaceQuestionImage('q1', file)` issues `POST .../bank/questions/q1/image` with `FormData` containing `file`.

- [ ] **Step 2: Run, expect fail** — `cd apps/web && pnpm exec ng test`. Expected: FAIL (new tests).

- [ ] **Step 3: Implement BankService methods** (mirror `uploadImageQuestion` for the FormData path; `editDraft` on AiService for PATCH shape). Add `UpdateQuestionPayload`/`AiRevisedQuestion` to models.

- [ ] **Step 4: Failing AiService spec**

Add: `reviseQuestion('q1','más difícil')` → `POST .../ai/questions/q1/revise { instruction }`; `extractQuestionFromImage(file)` → `POST .../ai/questions/extract` with FormData `file`.

- [ ] **Step 5: Implement AiService methods.**

- [ ] **Step 6: Run green** — `cd apps/web && pnpm exec ng test`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/bank apps/web/src/app/features/ai
git commit -m "feat(web): bank/ai service methods for edit, image-swap, AI revise, OCR extract"
```

---

## Task 8: Frontend — inline edit mode in the detail panel

**Files:**
- Modify: `apps/web/src/app/features/bank/bank-list/bank-list.component.ts` + `.html` (+ `.spec.ts`)

**Interfaces:**
- Consumes: `BankService.updateQuestion`, `replaceQuestionImage`; existing `selected()`, `imageUrl()`, taxonomy option lists.
- Produces: panel `editing` signal; `startEdit()`, `cancelEdit()`, `saveEdit()`; edit form with `data-testid`: `panel-edit-form`, `edit-warning`, `edit-save`, `edit-cancel`.

- [ ] **Step 1: Failing component test**

In `bank-list.component.spec.ts` add (detail-panel describe): clicking `[data-testid="panel-edit"] button` on a structured question renders `[data-testid="panel-edit-form"]` with the enunciado value in a textarea; editing it + clicking `[data-testid="edit-save"]` calls `updateQuestion('q1', objectContaining({ bodyTypst: ... }))`. Add a second test: an approved question with `usedInExamCount: 2` shows `[data-testid="edit-warning"]` in edit mode.

- [ ] **Step 2: Run, expect fail** — `cd apps/web && pnpm exec ng test`. Expected: FAIL.

- [ ] **Step 3: Implement edit mode**

Add `editing = signal(false)` + field signals (enunciado, alternativas text, clave, taxonomy). `startEdit()` seeds them from `selected()`. `edit(q)` (currently navigates — `bank-list.component.ts:409`) becomes `startEdit()`. Template: when `editing()`, replace the read-only `dl`/enunciado/alternatives with inputs (`ui-select` for taxonomy, textarea for enunciado/alternativas, input for clave; image type → thumbnail + file input `data-testid="edit-image"`). Warning banner when `selected().status==='approved' && (selected().usedInExamCount ?? 0) > 0`. `saveEdit()` builds `UpdateQuestionPayload`, calls `updateQuestion`, then (if a new file) `replaceQuestionImage`, then reloads + exits edit. `cancelEdit()` clears `editing`.

- [ ] **Step 4: Run green** — `cd apps/web && pnpm exec ng test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/bank/bank-list
git commit -m "feat(web): inline edit mode in bank detail panel (structured + image, used-warning)"
```

---

## Task 9: Frontend — AI instruction box (revise)

**Files:**
- Modify: `apps/web/src/app/features/bank/bank-list/bank-list.component.ts` + `.html` (+ `.spec.ts`)

**Interfaces:**
- Consumes: `AiService.reviseQuestion`.
- Produces: in edit mode, `data-testid`: `ai-instruction` (input), `ai-revise` (button), `ai-error`. On success, populates the edit form signals.

- [ ] **Step 1: Failing test** — in edit mode, typing into `[data-testid="ai-instruction"]` + clicking `[data-testid="ai-revise"]` calls `reviseQuestion('q1', 'más difícil')`; on the mocked response the enunciado textarea updates to the revised body. Add: a `reviseQuestion` that errors shows `[data-testid="ai-error"]`.

- [ ] **Step 2: Run, expect fail** — `cd apps/web && pnpm exec ng test`. Expected: FAIL.

- [ ] **Step 3: Implement** — `aiInstruction = signal('')`, `revising = signal(false)`, `aiError = signal<string|null>(null)`, `reviseWithAi()` calls `AiService.reviseQuestion`, and on success sets the enunciado/alternativas/clave signals to the returned values (human still reviews + saves). Inject `AiService`. Template block under the form.

- [ ] **Step 4: Run green** — `cd apps/web && pnpm exec ng test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/bank/bank-list
git commit -m "feat(web): AI instruction box to revise a question inline"
```

---

## Task 10: Frontend — OCR extract from image

**Files:**
- Modify: `apps/web/src/app/features/bank/bank-list/bank-list.component.ts` + `.html` (+ `.spec.ts`)

**Interfaces:**
- Consumes: `AiService.extractQuestionFromImage`.
- Produces: `data-testid`: `ocr-upload` (file input), `ocr-run` (button). On success, fills the structured edit form.

- [ ] **Step 1: Failing test** — in edit mode, selecting a file on `[data-testid="ocr-upload"]` + clicking `[data-testid="ocr-run"]` calls `extractQuestionFromImage(file)`; the enunciado/alternativas/clave signals update to the returned values.

- [ ] **Step 2: Run, expect fail** — `cd apps/web && pnpm exec ng test`. Expected: FAIL.

- [ ] **Step 3: Implement** — `ocrFile = signal<File|null>(null)`, `extracting = signal(false)`, `extractFromImage()` calls `AiService.extractQuestionFromImage`, populates the structured form signals on success, reuses `aiError` for failures. Template block under the AI box.

- [ ] **Step 4: Run green** — `cd apps/web && pnpm exec ng test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/bank/bank-list
git commit -m "feat(web): OCR extract from image to fill the edit form"
```

---

## Final verification

- [ ] **Backend suite:** `cd apps/api && pnpm exec jest` → all green.
- [ ] **Web suite:** `cd apps/web && pnpm exec ng test` → all green.
- [ ] **Live smoke (Playwright):** login → bank → select a structured question → Editar → change enunciado → Guardar → reflected; AI box "hazla más difícil" → form updates; OCR upload → fields fill; image question → replace image → saved.
