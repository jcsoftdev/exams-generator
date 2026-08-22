# Backend S1–S9 (screens restantes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar los endpoints S1–S9 del spec `docs/superpowers/specs/2026-07-18-ui-redesign-screens-design.md` (historial de exámenes, duplicar/eliminar, archivar/borrar pregunta, paginación, preview Typst, módulo users, timestamps).

**Architecture:** NestJS modular (apps/api) + Drizzle/PostgreSQL. Cada endpoint vive en su módulo existente (`exams`, `bank`) o en el módulo nuevo `users`. Tenant-scoping en el service vía `user.tenantId` (patrón `requireTenant`), lecturas repo devuelven `undefined` para cross-tenant → `NotFoundException`.

**Tech Stack:** NestJS, Drizzle ORM, drizzle-kit (migraciones), Jest + supertest (e2e), bcryptjs, Typst vía `PdfCompilerPort`.

## Global Constraints

- **Strict TDD**: test primero, verlo fallar, implementar mínimo, verlo pasar, commit. Runner: `pnpm --filter @exams-generator/api test` (Jest). E2e por módulo: `pnpm --filter @exams-generator/api test -- exams.e2e` etc.
- Commits convencionales, SIN Co-Authored-By ni atribución AI.
- NO editar `apps/api/src/app.module.ts`, `packages/shared/**`, `apps/api/src/db/schema/**` sin coordinar — regla de integrador del proyecto. Este plan SÍ los toca (Tasks 1 y 8): hacerlo en commits atómicos aislados para que el integrador los serialice.
- DB de test: la de `pnpm dev:infra` (postgres puerto 5439). Los e2e corren `runMigrations()` en `beforeAll`.
- El enum pg `question_status` gana valor `archived`; `ALTER TYPE ... ADD VALUE` no corre dentro de transacción en Postgres — verificar que la migración generada no lo envuelva en BEGIN/COMMIT.
- Rama de trabajo: `feat/ui-redesign` (la comparte el otro agente — pull/rebase antes de cada commit).

---

### Task 1: S9 — Migración: timestamps + `users.active` + estado `archived`

**Files:**

- Modify: `apps/api/src/db/schema/enums.ts` (QUESTION_STATUSES)
- Modify: `apps/api/src/db/schema/users.schema.ts` (active, createdAt)
- Modify: `apps/api/src/db/schema/exams.schema.ts` (createdAt)
- Modify: `apps/api/src/db/schema/questions.schema.ts` (createdAt)
- Create: `apps/api/drizzle/<generada>.sql` (vía drizzle-kit)

**Interfaces:**

- Produces: columnas `exams.created_at`, `questions.created_at`, `users.created_at` (todas `timestamptz NOT NULL DEFAULT now()`), `users.active boolean NOT NULL DEFAULT true`, y `QuestionStatus = "draft" | "approved" | "archived"`. Tasks 2, 5, 6, 8 dependen de esto.

- [ ] **Step 1: Editar los 4 schemas**

En `enums.ts` cambiar una línea:

```ts
export const QUESTION_STATUSES = ["draft", "approved", "archived"] as const;
```

En `users.schema.ts`:

```ts
import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
// ... dentro de pgTable("users", { ...columnas existentes... :
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
```

En `exams.schema.ts` y `questions.schema.ts`, agregar a la tabla principal (`exams`, `questions`) la misma columna:

```ts
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
```

(agregar `timestamp` al import de `drizzle-orm/pg-core` en cada archivo)

- [ ] **Step 2: Generar y aplicar migración**

Run: `pnpm --filter @exams-generator/api db:generate && pnpm --filter @exams-generator/api db:migrate`
Expected: nueva migración en `apps/api/drizzle/` con `ADD COLUMN created_at`, `ADD COLUMN active`, `ALTER TYPE "question_status" ADD VALUE 'archived'`. Abrir el .sql y verificar que el ADD VALUE no esté dentro de una transacción con otros statements que lo rompan (drizzle-kit lo maneja con `--> statement-breakpoint`; si falla el migrate, separar el ADD VALUE a su propia migración).

- [ ] **Step 3: Suite completa verde (regresión)**

Run: `pnpm --filter @exams-generator/api test`
Expected: PASS (nada consume aún las columnas nuevas).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/schema apps/api/drizzle
git commit -m "feat(db): timestamps en exams/questions/users, users.active y estado archived (S9)"
```

---

### Task 2: S1 — `GET /exams` (listar exámenes del tenant)

**Files:**

- Modify: `apps/api/src/modules/exams/exams.repository.ts`
- Modify: `apps/api/src/modules/exams/exams.service.ts`
- Modify: `apps/api/src/modules/exams/exams.controller.ts`
- Test: `apps/api/src/modules/exams/exams.e2e.spec.ts`

**Interfaces:**

- Consumes: `exams.createdAt` (Task 1), patrón `requireTenant` existente (`exams.service.ts:141`).
- Produces: `GET /exams?status=&gradeLevel=&search=&page=1&pageSize=20` → `{ items: ExamListItem[], total: number }`, con `ExamListItem = { id, title, gradeLevel, status, questionCount, versionCount, createdAt }`. Orden `createdAt DESC`. El frontend (plan 2) consume esto.

- [ ] **Step 1: Test e2e que falla** — agregar al describe de `exams.e2e.spec.ts` (reusa `tenantAToken`/`tenantBToken` del setup):

```ts
describe("GET /exams (list)", () => {
  it("lists only own-tenant exams, newest first, with counts", async () => {
    const res = await request(app.getHttpServer())
      .get("/exams")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
    for (const item of res.body.items) {
      expect(item).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          title: expect.any(String),
          gradeLevel: expect.any(String),
          status: expect.stringMatching(/^(draft|ready)$/),
          questionCount: expect.any(Number),
          versionCount: expect.any(Number),
          createdAt: expect.any(String),
        }),
      );
    }
  });

  it("does not leak cross-tenant exams", async () => {
    const created = await request(app.getHttpServer())
      .post("/exams")
      .set("Authorization", `Bearer ${tenantBToken}`)
      .send(validCreateExamBodyForTenantB) // mismo body helper que usan los tests existentes de POST /exams
      .expect(201);
    createdExamIds.push(created.body.id);

    const res = await request(app.getHttpServer())
      .get("/exams?pageSize=100")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(res.body.items.some((i: { id: string }) => i.id === created.body.id)).toBe(false);
  });

  it("filters by status and paginates", async () => {
    const res = await request(app.getHttpServer())
      .get("/exams?status=draft&page=1&pageSize=1")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(res.body.items.length).toBeLessThanOrEqual(1);
    expect(res.body.items.every((i: { status: string }) => i.status === "draft")).toBe(true);
  });

  it("rejects staff users (no tenant)", async () => {
    await request(app.getHttpServer())
      .get("/exams")
      .set("Authorization", `Bearer ${staffToken}`)
      .expect(403);
  });
});
```

- [ ] **Step 2: Verificar que falla** — Run: `pnpm --filter @exams-generator/api test -- exams.e2e -t "GET /exams"` → FAIL 404 (ruta no existe).

- [ ] **Step 3: Repo + service + controller**

`exams.repository.ts` — nuevo método (patrón de `getExamById:215`):

```ts
export interface ExamListFilters {
  readonly status?: "draft" | "ready";
  readonly gradeLevel?: string;
  readonly search?: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface ExamListItem {
  readonly id: string;
  readonly title: string;
  readonly gradeLevel: string;
  readonly status: string;
  readonly questionCount: number;
  readonly versionCount: number;
  readonly createdAt: string;
}

  async listExams(tenantId: string, f: ExamListFilters): Promise<{ items: ExamListItem[]; total: number }> {
    const conditions = [eq(exams.tenantId, tenantId)];
    if (f.status) conditions.push(eq(exams.status, f.status));
    if (f.gradeLevel) conditions.push(eq(exams.gradeLevel, f.gradeLevel));
    if (f.search) conditions.push(ilike(exams.title, `%${f.search}%`));
    const where = and(...conditions);

    const [{ value: total }] = await db.select({ value: count() }).from(exams).where(where);

    const rows = await db
      .select({
        id: exams.id,
        title: exams.title,
        gradeLevel: exams.gradeLevel,
        status: exams.status,
        createdAt: exams.createdAt,
        questionCount: sql<number>`(select count(*)::int from ${examQuestions} where ${examQuestions.examId} = ${exams.id})`,
        versionCount: sql<number>`(select count(*)::int from ${examVersions} where ${examVersions.examId} = ${exams.id})`,
      })
      .from(exams)
      .where(where)
      .orderBy(desc(exams.createdAt))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize);

    return {
      items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total,
    };
  }
```

(imports nuevos de `drizzle-orm`: `ilike`, `count`, `desc`, `sql`)

`exams.service.ts`:

```ts
  async listExams(user: AuthTokenPayload, filters: ExamListFilters): Promise<{ items: ExamListItem[]; total: number }> {
    const tenantId = requireTenant(user);
    return this.repository.listExams(tenantId, filters);
  }
```

`exams.controller.ts` (ANTES de `@Get(":examId")` para que no capture `exams?x` como param):

```ts
  @Get()
  async listExams(
    @CurrentUser() user: AuthTokenPayload,
    @Query("status") status?: "draft" | "ready",
    @Query("gradeLevel") gradeLevel?: string,
    @Query("search") search?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    return this.examsService.listExams(user, {
      status, gradeLevel, search,
      page: Math.max(1, Number(page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(pageSize) || 20)),
    });
  }
```

(agregar `Query` al import de `@nestjs/common`)

- [ ] **Step 4: Verde** — Run: `pnpm --filter @exams-generator/api test -- exams.e2e` → PASS.

- [ ] **Step 5: Commit** — `git add apps/api/src/modules/exams && git commit -m "feat(api): GET /exams listado paginado tenant-scoped (S1)"`

---

### Task 3: S2 — `POST /exams/:examId/duplicate`

**Files:**

- Modify: `apps/api/src/modules/exams/exams.repository.ts`, `exams.service.ts`, `exams.controller.ts`
- Test: `apps/api/src/modules/exams/exams.e2e.spec.ts`

**Interfaces:**

- Consumes: `getExamById(examId, tenantId)` existente; tablas `exams`, `examBlueprintRows`, `examQuestions`.
- Produces: `POST /exams/:examId/duplicate` → `201 { id: string, title: string, status: "draft" }`. Copia: título `"Copia de <original>"`, `gradeLevel`, blueprint rows y selección (`exam_questions` con `blueprintRowId` remapeado). El nuevo examen SIEMPRE nace `draft` (re-editable), sin versiones.

- [ ] **Step 1: Test e2e que falla**

```ts
describe("POST /exams/:examId/duplicate", () => {
  it("clones exam as draft with blueprint and selection", async () => {
    // examId = examen ready del tenant A creado en tests previos (o crear uno inline con POST /exams)
    const res = await request(app.getHttpServer())
      .post(`/exams/${examId}/duplicate`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.title).toBe(`Copia de ${originalTitle}`);
    createdExamIds.push(res.body.id);

    const detail = await request(app.getHttpServer())
      .get(`/exams/${res.body.id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(detail.body.questions.length).toBeGreaterThan(0);
  });

  it("404 on cross-tenant duplicate", async () => {
    await request(app.getHttpServer())
      .post(`/exams/${examId}/duplicate`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .expect(404);
  });
});
```

- [ ] **Step 2: FAIL** — Run: `pnpm --filter @exams-generator/api test -- exams.e2e -t duplicate` → 404.

- [ ] **Step 3: Implementación**

`exams.repository.ts`:

```ts
  async duplicateExam(examId: string, tenantId: string, createdBy: string): Promise<{ id: string; title: string } | undefined> {
    return db.transaction(async (tx) => {
      const [original] = await tx.select().from(exams).where(and(eq(exams.id, examId), eq(exams.tenantId, tenantId)));
      if (!original) return undefined;

      const [copy] = await tx
        .insert(exams)
        .values({
          tenantId,
          title: `Copia de ${original.title}`,
          gradeLevel: original.gradeLevel,
          status: "draft",
          createdBy,
        })
        .returning({ id: exams.id, title: exams.title });

      const rows = await tx.select().from(examBlueprintRows).where(eq(examBlueprintRows.examId, examId));
      const rowIdMap = new Map<string, string>();
      for (const row of rows) {
        const [newRow] = await tx
          .insert(examBlueprintRows)
          .values({ examId: copy!.id, courseId: row.courseId, topicId: row.topicId, difficulty: row.difficulty, count: row.count })
          .returning({ id: examBlueprintRows.id });
        rowIdMap.set(row.id, newRow!.id);
      }

      const selection = await tx.select().from(examQuestions).where(eq(examQuestions.examId, examId));
      if (selection.length > 0) {
        await tx.insert(examQuestions).values(
          selection.map((s) => ({
            examId: copy!.id,
            questionId: s.questionId,
            blueprintRowId: s.blueprintRowId ? (rowIdMap.get(s.blueprintRowId) ?? null) : null,
            position: s.position,
          })),
        );
      }
      return copy;
    });
  }
```

`exams.service.ts`:

```ts
  async duplicateExam(user: AuthTokenPayload, examId: string): Promise<{ id: string; title: string; status: "draft" }> {
    const tenantId = requireTenant(user);
    const copy = await this.repository.duplicateExam(examId, tenantId, user.sub);
    if (!copy) throw new NotFoundException(`Exam not found: ${examId}`);
    return { ...copy, status: "draft" };
  }
```

`exams.controller.ts`:

```ts
  @Post(":examId/duplicate")
  async duplicate(@CurrentUser() user: AuthTokenPayload, @Param("examId") examId: string) {
    return this.examsService.duplicateExam(user, examId);
  }
```

- [ ] **Step 4: Verde** — `pnpm --filter @exams-generator/api test -- exams.e2e` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): POST /exams/:id/duplicate — usar de plantilla (S2)"`

---

### Task 4: S3 — `DELETE /exams/:examId`

**Files:**

- Modify: `apps/api/src/modules/exams/exams.repository.ts`, `exams.service.ts`, `exams.controller.ts`
- Test: `apps/api/src/modules/exams/exams.e2e.spec.ts`

**Interfaces:**

- Produces: `DELETE /exams/:examId` → `204`. Borra en transacción: `exam_versions` (sus assets pdf/answer-sheet quedan huérfanos en storage — aceptado, no hay GC), `exam_questions`, `exam_blueprint_rows`, `exams`. 404 cross-tenant/inexistente. Sin restricción por status (la confirmación es del frontend).

- [ ] **Step 1: Test e2e que falla**

```ts
describe("DELETE /exams/:examId", () => {
  it("deletes draft exam and its children, then 404 on GET", async () => {
    // crear examen desechable inline con POST /exams (tenantAToken)
    await request(app.getHttpServer())
      .delete(`/exams/${disposableExamId}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/exams/${disposableExamId}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(404);
  });

  it("404 cross-tenant", async () => {
    await request(app.getHttpServer())
      .delete(`/exams/${tenantAExamId}`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .expect(404);
  });
});
```

- [ ] **Step 2: FAIL** — `pnpm --filter @exams-generator/api test -- exams.e2e -t "DELETE /exams"` → 404 route.

- [ ] **Step 3: Implementación**

`exams.repository.ts`:

```ts
  async deleteExam(examId: string, tenantId: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: exams.id })
        .from(exams)
        .where(and(eq(exams.id, examId), eq(exams.tenantId, tenantId)));
      if (!existing) return false;
      await tx.delete(examVersions).where(eq(examVersions.examId, examId));
      await tx.delete(examQuestions).where(eq(examQuestions.examId, examId));
      await tx.delete(examBlueprintRows).where(eq(examBlueprintRows.examId, examId));
      await tx.delete(exams).where(eq(exams.id, examId));
      return true;
    });
  }
```

`exams.service.ts`:

```ts
  async deleteExam(user: AuthTokenPayload, examId: string): Promise<void> {
    const tenantId = requireTenant(user);
    const deleted = await this.repository.deleteExam(examId, tenantId);
    if (!deleted) throw new NotFoundException(`Exam not found: ${examId}`);
  }
```

`exams.controller.ts` (agregar `Delete` al import):

```ts
  @Delete(":examId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthTokenPayload, @Param("examId") examId: string): Promise<void> {
    await this.examsService.deleteExam(user, examId);
  }
```

- [ ] **Step 4: Verde** — suite exams.e2e PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): DELETE /exams/:id con borrado en cascada (S3)"`

---

### Task 5: S4+S5 — Archivar pregunta + borrar borrador

**Files:**

- Modify: `apps/api/src/modules/bank/bank.repository.ts`, `bank.service.ts`, `bank.controller.ts`
- Test: `apps/api/src/modules/bank/bank.e2e.spec.ts`

**Interfaces:**

- Consumes: `requireVisibleDraft` (`bank.service.ts:194`), `assertCanManageTenant`, estado `archived` (Task 1).
- Produces: `PATCH /bank/questions/:id/archive` → `200 { id, status: "archived" }` (solo `approved`, 409 si no; tenant/rol vía `canManageQuestionTenant`). `DELETE /bank/questions/:id` → `204` (solo `draft` propio — mismo gate que reject). Preguntas `archived` NUNCA entran a `getQuestionPool` (ya filtra `status=approved` — verificar con test).

- [ ] **Step 1: Tests e2e que fallan** (en `bank.e2e.spec.ts`, reusando helpers de creación de preguntas del setup):

```ts
describe("archive & delete", () => {
  it("archives an approved own-tenant question", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/bank/questions/${approvedQuestionId}/archive`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(res.body.status).toBe("archived");
  });

  it("409 archiving a draft", async () => {
    await request(app.getHttpServer())
      .patch(`/bank/questions/${draftQuestionId}/archive`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(409);
  });

  it("teacher cannot archive central-bank question", async () => {
    await request(app.getHttpServer())
      .patch(`/bank/questions/${centralQuestionId}/archive`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(403);
  });

  it("deletes an own draft, 404 after", async () => {
    await request(app.getHttpServer())
      .delete(`/bank/questions/${ownDraftId}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/bank/questions/${ownDraftId}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(404);
  });

  it("409 deleting an approved question", async () => {
    await request(app.getHttpServer())
      .delete(`/bank/questions/${anotherApprovedId}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(409);
  });
});
```

- [ ] **Step 2: FAIL** — `pnpm --filter @exams-generator/api test -- bank.e2e -t "archive & delete"`.

- [ ] **Step 3: Implementación**

`bank.service.ts`:

```ts
  async archiveQuestion(user: AuthTokenPayload, id: string): Promise<{ id: string; status: "archived" }> {
    const question = await this.repository.findQuestionById(id, user.tenantId);
    if (!question) throw new NotFoundException(`Question not found: ${id}`);
    assertCanManageTenant(user.role, question.tenantId);
    if (question.status !== "approved") {
      throw new ConflictException(`Only approved questions can be archived (status=${question.status})`);
    }
    await this.repository.updateStatus(id, "archived");
    return { id, status: "archived" };
  }

  async deleteDraftQuestion(user: AuthTokenPayload, id: string): Promise<void> {
    const draft = await this.requireVisibleDraft(user, id); // ya valida 404/403/409
    await this.repository.deleteQuestion(draft.id);
  }
```

`bank.repository.ts` (si no existen ya con ese nombre — seguir patrón de los updates existentes):

```ts
  async updateStatus(id: string, status: QuestionStatus): Promise<void> {
    await db.update(questions).set({ status }).where(eq(questions.id, id));
  }

  async deleteQuestion(id: string): Promise<void> {
    await db.delete(questions).where(eq(questions.id, id));
  }
```

`bank.controller.ts` (agregar `Patch`/`Delete`/`HttpCode`/`HttpStatus` a imports si faltan):

```ts
  @Patch(":id/archive")
  async archive(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string) {
    return this.service.archiveQuestion(user, id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeDraft(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string): Promise<void> {
    await this.service.deleteDraftQuestion(user, id);
  }
```

- [ ] **Step 4: Verde** — bank.e2e PASS completo (regresión incluida).
- [ ] **Step 5: Commit** — `git commit -m "feat(api): archivar pregunta aprobada y borrar borrador (S4, S5)"`

---

### Task 6: S6 — Paginación retro-compatible en `GET /bank/questions`

**Files:**

- Modify: `apps/api/src/modules/bank/bank.controller.ts`, `bank.service.ts`, `bank.repository.ts`
- Test: `apps/api/src/modules/bank/bank.e2e.spec.ts`

**Interfaces:**

- Produces: `GET /bank/questions` SIN `page` → array plano (comportamiento actual, NO romper al web/ai actuales). CON `?page=&pageSize=` → `{ items: QuestionListItem[], total: number }`. Filtro `status=archived` ahora es válido.

- [ ] **Step 1: Test e2e que falla**

```ts
describe("GET /bank/questions pagination", () => {
  it("returns flat array without page param (legacy)", async () => {
    const res = await request(app.getHttpServer())
      .get("/bank/questions")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns {items,total} with page param", async () => {
    const res = await request(app.getHttpServer())
      .get("/bank/questions?page=1&pageSize=2")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeLessThanOrEqual(2);
    expect(typeof res.body.total).toBe("number");
  });
});
```

- [ ] **Step 2: FAIL** — el segundo test devuelve array, no objeto.

- [ ] **Step 3: Implementación** — en `bank.repository.ts` extender el list query con `limit/offset` opcionales + `count()` total (mismo patrón del Task 2 Step 3). En `bank.service.ts`, `listQuestions` gana overload con `pagination?: { page: number; pageSize: number }` y devuelve `QuestionListItem[] | { items; total }`. En el controller:

```ts
  @Get()
  async listQuestions(@CurrentUser() user: AuthTokenPayload, @Query() query: ListQuestionsQueryParams) {
    const filters = { /* mapeo existente sin cambios */ };
    if (query.page === undefined) {
      return this.service.listQuestions(user, filters);
    }
    return this.service.listQuestions(user, filters, {
      page: Math.max(1, Number(query.page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(query.pageSize) || 20)),
    });
  }
```

(agregar `page?/pageSize?: string` a `ListQuestionsQueryParams`)

- [ ] **Step 4: Verde** — bank.e2e PASS (incluye legacy tests intactos = retro-compat probada).
- [ ] **Step 5: Commit** — `git commit -m "feat(api): paginacion opcional retrocompatible en GET /bank/questions (S6)"`

---

### Task 7: S7 — `GET /bank/questions/:id/preview` (PDF Typst con caché)

**Files:**

- Modify: `apps/api/src/modules/bank/bank.controller.ts`, `bank.service.ts`
- Test: `apps/api/src/modules/bank/bank.e2e.spec.ts`

**Interfaces:**

- Consumes: `PdfCompilerPort.compileExam()` (token `PDF_COMPILER_PORT` ya inyectado en `BankService` — ver `bank.module.ts`), patrón single-question de `editDraftQuestion` (`bank.service.ts:277-296`).
- Produces: `GET /bank/questions/:id/preview` → `200` con `Content-Type: application/pdf`, body = PDF de UNA pregunta (`versionLabel: "preview"`). Solo preguntas `type=structured` (400 para `image` — el front muestra la imagen directa). Caché en memoria `Map<questionId, Buffer>`, invalidada por `PATCH :id` (edit). 404 tenant-scope.

- [ ] **Step 1: Test e2e que falla**

```ts
describe("GET /bank/questions/:id/preview", () => {
  it("returns a PDF for a structured draft", async () => {
    const res = await request(app.getHttpServer())
      .get(`/bank/questions/${structuredDraftId}/preview`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.body.length).toBeGreaterThan(500);
  });

  it("400 for image questions", async () => {
    await request(app.getHttpServer())
      .get(`/bank/questions/${imageQuestionId}/preview`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(400);
  });
});
```

Nota: los e2e usan el adapter Typst real (CLI) — igual que los tests existentes de generación. Si el runner no tiene typst instalado, estos tests fallarán por entorno: correr los e2e existentes de versiones primero para confirmar que typst está disponible.

- [ ] **Step 2: FAIL** — 404 route.

- [ ] **Step 3: Implementación** — en `bank.service.ts`:

```ts
  private readonly previewCache = new Map<string, Buffer>();

  async previewQuestion(user: AuthTokenPayload, id: string): Promise<Buffer> {
    const question = await this.repository.findQuestionById(id, user.tenantId);
    if (!question) throw new NotFoundException(`Question not found: ${id}`);
    if (question.type !== "structured" || !question.bodyTypst) {
      throw new BadRequestException("Preview is only available for structured questions");
    }
    const cached = this.previewCache.get(id);
    if (cached) return cached;

    const pdf = await this.pdfCompiler.compileExam({
      title: "Vista previa",
      versionLabel: "preview",
      questions: [{
        id: question.id,
        type: "structured",
        bodyTypst: question.bodyTypst,
        alternatives: (question.alternatives ?? []) as string[],
        figureCode: question.figureCode ?? undefined,
      }],
    });
    this.previewCache.set(id, pdf);
    return pdf;
  }
```

En el método de edición existente (`editDraftQuestion`), agregar `this.previewCache.delete(id);` tras persistir. En `bank.controller.ts`:

```ts
  @Get(":id/preview")
  async preview(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.service.previewQuestion(user, id);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  }
```

(import `Res` de `@nestjs/common`, `Response` de `express`; colocar la ruta ANTES de `@Get(":id")` si el orden de matching lo requiere — en Nest las rutas estáticas más específicas van primero en el archivo)

- [ ] **Step 4: Verde** — bank.e2e PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): preview PDF Typst por pregunta con cache (S7)"`

---

### Task 8: S8 — Módulo `users` completo

**Files:**

- Create: `apps/api/src/modules/users/users.module.ts`, `users.controller.ts`, `users.service.ts`, `users.repository.ts`
- Create: `apps/api/src/modules/users/users.e2e.spec.ts`
- Modify: `apps/api/src/app.module.ts` (import UsersModule — commit atómico, regla de integrador)
- Modify: `apps/api/src/modules/auth/auth.service.ts` (login rechaza `active=false`)

**Interfaces:**

- Consumes: tabla `users` + columna `active` (Task 1), `hashPassword` (`auth/password.util.ts`), guards `JwtAuthGuard`+`RolesGuard`.
- Produces:
  - `GET /users` → `{ id, email, role, active, createdAt }[]` del tenant del caller (school_admin).
  - `POST /users` body `{ email, role: "teacher" | "school_admin" }` → `201 { id, email, role, temporaryPassword }` (password generada server-side, hash guardado; el plaintext se devuelve SOLO en esta respuesta).
  - `PATCH /users/:id` body `{ active: boolean }` → `200 { id, active }` (no puede desactivarse a sí mismo → 409).
  - `POST /users/:id/reset-password` → `200 { id, temporaryPassword }`.
  - Login de usuario `active=false` → 401.

- [ ] **Step 1: E2e spec nuevo que falla** — `users.e2e.spec.ts` con setup calcado de `exams.e2e.spec.ts:30-77` (runMigrations, AppModule real, seed tenant A + school_admin A + teacher A + tenant B + school_admin B, tokens vía `tokenService.sign`):

```ts
describe("Users module (e2e)", () => {
  it("school_admin lists only own-tenant users", async () => {
    const res = await request(app.getHttpServer())
      .get("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .expect(200);
    expect(res.body.every((u: { id: string }) => tenantAUserIds.includes(u.id))).toBe(true);
  });

  it("teacher gets 403", async () => {
    await request(app.getHttpServer())
      .get("/users")
      .set("Authorization", `Bearer ${teacherAToken}`)
      .expect(403);
  });

  it("creates teacher with temporary password, who can login", async () => {
    const email = `teacher-new-${suffix}@e2e.test`;
    const res = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ email, role: "teacher" })
      .expect(201);
    expect(res.body.temporaryPassword).toHaveLength(12);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: res.body.temporaryPassword })
      .expect(200);
  });

  it("409 on duplicate email", async () => {
    const email = `dup-${suffix}@e2e.test`;
    await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ email, role: "teacher" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ email, role: "teacher" })
      .expect(409);
  });

  it("deactivated user cannot login; reactivation restores access", async () => {
    await request(app.getHttpServer())
      .patch(`/users/${createdTeacherId}`)
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ active: false })
      .expect(200);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: createdTeacherEmail, password: temporaryPassword })
      .expect(401);
  });

  it("cannot deactivate self", async () => {
    await request(app.getHttpServer())
      .patch(`/users/${schoolAdminAId}`)
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ active: false })
      .expect(409);
  });

  it("reset-password returns a new working temporary password", async () => {
    // reactivar primero al teacher desactivado en el test anterior
    await request(app.getHttpServer())
      .patch(`/users/${createdTeacherId}`)
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .send({ active: true })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`/users/${createdTeacherId}/reset-password`)
      .set("Authorization", `Bearer ${schoolAdminAToken}`)
      .expect(200);
    expect(res.body.temporaryPassword).toHaveLength(12);

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: createdTeacherEmail, password: res.body.temporaryPassword })
      .expect(200);
  });

  it("404 managing cross-tenant user", async () => {
    await request(app.getHttpServer())
      .patch(`/users/${createdTeacherId}`)
      .set("Authorization", `Bearer ${schoolAdminBToken}`)
      .send({ active: false })
      .expect(404);
  });
});
```

- [ ] **Step 2: FAIL** — `pnpm --filter @exams-generator/api test -- users.e2e` → rutas 404.

- [ ] **Step 3: Implementación**

`users.repository.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { users } from "../../db/schema";

export interface TenantUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly active: boolean;
  readonly createdAt: string;
}

export class UsersRepository {
  async listByTenant(tenantId: string): Promise<TenantUser[]> {
    const rows = await db.select().from(users).where(eq(users.tenantId, tenantId));
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async findByIdInTenant(id: string, tenantId: string) {
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
    return row;
  }

  async findByEmail(email: string) {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return row;
  }

  async create(
    tenantId: string,
    email: string,
    role: string,
    passwordHash: string,
  ): Promise<{ id: string }> {
    const [row] = await db
      .insert(users)
      .values({ tenantId, email, passwordHash, role: role as never })
      .returning({ id: users.id });
    return row!;
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await db.update(users).set({ active }).where(eq(users.id, id));
  }

  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await db.update(users).set({ passwordHash }).where(eq(users.id, id));
  }
}
```

`users.service.ts`:

```ts
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../auth/password.util";
import { AuthTokenPayload } from "../auth/token.service";
import { TenantUser, UsersRepository } from "./users.repository";

function requireTenant(user: AuthTokenPayload): string {
  if (!user.tenantId) throw new ForbiddenException("Only tenant admins can manage users");
  return user.tenantId;
}

/** 12 chars url-safe — se muestra una sola vez */
function generateTemporaryPassword(): string {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async list(user: AuthTokenPayload): Promise<TenantUser[]> {
    return this.repository.listByTenant(requireTenant(user));
  }

  async create(user: AuthTokenPayload, email: string, role: "teacher" | "school_admin") {
    const tenantId = requireTenant(user);
    if (await this.repository.findByEmail(email)) {
      throw new ConflictException(`Email already in use: ${email}`);
    }
    const temporaryPassword = generateTemporaryPassword();
    const { id } = await this.repository.create(
      tenantId,
      email,
      role,
      await hashPassword(temporaryPassword),
    );
    return { id, email, role, temporaryPassword };
  }

  async setActive(user: AuthTokenPayload, targetId: string, active: boolean) {
    const tenantId = requireTenant(user);
    if (targetId === user.sub && !active) {
      throw new ConflictException("You cannot deactivate your own account");
    }
    const target = await this.repository.findByIdInTenant(targetId, tenantId);
    if (!target) throw new NotFoundException(`User not found: ${targetId}`);
    await this.repository.setActive(targetId, active);
    return { id: targetId, active };
  }

  async resetPassword(user: AuthTokenPayload, targetId: string) {
    const tenantId = requireTenant(user);
    const target = await this.repository.findByIdInTenant(targetId, tenantId);
    if (!target) throw new NotFoundException(`User not found: ${targetId}`);
    const temporaryPassword = generateTemporaryPassword();
    await this.repository.setPasswordHash(targetId, await hashPassword(temporaryPassword));
    return { id: targetId, temporaryPassword };
  }
}
```

`users.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { Role } from "@exams-generator/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SchoolAdmin)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthTokenPayload) {
    return this.service.list(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: { email: string; role: "teacher" | "school_admin" },
  ) {
    return this.service.create(user, body.email, body.role);
  }

  @Patch(":id")
  setActive(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id") id: string,
    @Body() body: { active: boolean },
  ) {
    return this.service.setActive(user, id, body.active);
  }

  @Post(":id/reset-password")
  resetPassword(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string) {
    return this.service.resetPassword(user, id);
  }
}
```

`users.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersRepository } from "./users.repository";
import { UsersService } from "./users.service";

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
})
export class UsersModule {}
```

`app.module.ts`: agregar `UsersModule` al array `imports` (+ su import statement). **Commit separado** (regla integrador).

`auth.service.ts`: en el login, tras verificar password, agregar:

```ts
if (!user.active) {
  throw new UnauthorizedException("Account is deactivated");
}
```

(ubicar el punto exacto leyendo el método login actual; el select del login debe incluir la columna `active`)

- [ ] **Step 4: Verde** — `pnpm --filter @exams-generator/api test -- users.e2e` PASS + `pnpm --filter @exams-generator/api test` PASS completo (auth.e2e sigue verde).
- [ ] **Step 5: Commits**

```bash
git add apps/api/src/modules/users apps/api/src/modules/auth
git commit -m "feat(api): modulo users — alta con password temporal, activar/desactivar, reset (S8)"
git add apps/api/src/app.module.ts
git commit -m "chore(api): registrar UsersModule en app.module (integrador)"
```

---

### Task 9: Verificación final

- [ ] **Step 1:** `pnpm --filter @exams-generator/api test` → TODO verde.
- [ ] **Step 2:** Smoke manual contra dev: `pnpm dev:infra && pnpm --filter @exams-generator/api dev` → `curl -s localhost:3012/exams -H "Authorization: Bearer <token>"` devuelve `{items,total}`.
- [ ] **Step 3:** `git push` (previo pull/rebase de `feat/ui-redesign`).
