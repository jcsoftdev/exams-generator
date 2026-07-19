# Dashboard Layout Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the app shell (sidebar + topbar) to match the reference Figma layout using only existing `@theme` tokens, and add a real-data Dashboard landing page (bank/exam/AI-queue stats with two charts) as the new `/app` index.

**Architecture:** Backend adds a `dashboard` module (`GET /dashboard/stats`) that assembles a `DashboardStats` DTO from two new grouped-count repository methods (`BankRepository.countByDifficultyAndStatus`, `ExamsRepository.countByStatus` + `listRecent`), mirroring the existing `countStock()` grouped-aggregate pattern. Frontend adds a `dashboard` feature (service + signal-based component) rendered through two new thin `ui/*` chart wrappers (`chart.js` + `ng2-charts`, newly installed), and restyles the two shell primitives (`ui/sidebar`, `ui/topbar`) plus the two shell-template sizing spots that reference them (`shell.component.html`).

**Tech Stack:** NestJS + Drizzle (Postgres) + `jest` (api); Angular 22 standalone + signals + Tailwind v4 CSS-first `@theme` + `vitest` via `ng test` (web); `chart.js` v4 + `ng2-charts` v10 (new).

## Global Constraints

- **No new color tokens** — every new class/chart color resolves to a hex already defined in `apps/web/src/styles.css`'s `@theme` block (`--color-easy-bg`, `--color-tint-activo`, `--color-n*`, etc.). Never add a new `--color-*` custom property.
- **No `@Input`/`@Output` API changes** to `SidebarComponent`/`TopbarComponent` — the topbar's new search field is a plain, unbound `<input>` (no signal `input()`/`output()` added).
- **Spanish (Perú), tuteo, no jerga** — all new user-facing copy (e.g. "Cargando estadísticas…", "Borrador"/"Lista"). Never voseo.
- **Strict TDD** — test first, watch it fail, minimal impl, watch it pass, commit.
- **Tenant scoping via `@CurrentUser()`**, never a route param — mirrors every other controller in this codebase.
- **`ExamsModule` currently does NOT export `ExamsRepository`** (confirmed by reading `apps/api/src/modules/exams/exams.module.ts` — no `exports` array at all, unlike `BankModule`, which already exports `BankRepository`). Task 2 adds `exports: [ExamsRepository]` — required for `DashboardModule` to import `ExamsModule` and inject `ExamsRepository`, and safe: nothing else in the codebase currently depends on it staying unexported.
- **`chart.js`/`ng2-charts` are confirmed absent** from `apps/web/package.json`, devDependencies, and `pnpm-lock.yaml` today.
- **`ng2-charts@10.0.0` declares `@angular/cdk >=21.0.0` as a peer dependency but its published runtime bundle (`fesm2022/ng2-charts.mjs`) never imports `@angular/cdk`** (verified by unpacking the npm tarball) — the peer dep is only referenced by the package's `ng-add` schematic. Expect (and ignore) a pnpm peer-dependency warning on install; do **not** add `@angular/cdk` to silence it.
- **`provideCharts(withDefaultRegisterables())` must be registered in TWO places**: `apps/web/src/app/app.config.ts` (real app) AND inside every spec's own `TestBed.configureTestingModule` that renders a chart wrapper (`TestBed` does not inherit `app.config.ts` providers — this mirrors the existing per-spec Lucide `LucideAngularModule.pick(...)` pattern already used in `topbar.component.spec.ts`/`shell.component.spec.ts`).
- **jsdom has no real `<canvas>` 2D context** — Chart.js's `new Chart(ctx, ...)` throws without one. Task 5 adds `vitest-canvas-mock` as a devDependency plus a `src/test-setup.ts` wired via `angular.json`'s `test.options.setupFiles`, so `fixture.detectChanges()` never throws on a component that contains a chart.
- **Backend tests:** `cd apps/api && pnpm exec jest <path>` (Jest — confirmed via `apps/api/package.json`'s `"test": "jest"` and `jest.config.js`).
- **Frontend tests:** `cd apps/web && pnpm exec ng test` — run the **full** suite. A prior plan in this repo (`docs/superpowers/plans/2026-07-19-question-editing-ai.md`) already documents that file-scoped vitest runs fail on `initTestEnvironment` in this exact Angular 22 + `@angular/build:unit-test` setup — do not try to scope a single spec file.
- **Shell commands:** `eza`/`bat`/`rg`/`fd`/`sd`, not `ls`/`cat`/`grep`/`find`/`sed`. Never build.
- **Conventional commits**, no AI attribution. **Author:** `jcsoftdev`.

## File Structure

**Backend (`apps/api/src/modules`):**
- `bank/bank.repository.ts` — new `countByDifficultyAndStatus(tenantId)`.
- `bank/bank.repository.spec.ts` — new describe block (real-DB integration test, same convention as the rest of the file).
- `exams/exams.repository.ts` — new `countByStatus(tenantId)`, `listRecent(tenantId, limit)`.
- `exams/exams.repository.spec.ts` — new describe block.
- `exams/exams.module.ts` — add `exports: [ExamsRepository]`.
- `dashboard/dashboard.module.ts`, `dashboard/dashboard.controller.ts`, `dashboard/dashboard-stats.service.ts` — new module (mirrors `ai/`).
- `dashboard/dashboard-stats.service.spec.ts` — new unit test (fake repos, mirrors `bank.service.spec.ts`).
- `dashboard/dashboard.e2e.spec.ts` — new e2e test (mirrors `ai/ai.e2e.spec.ts`).
- `app.module.ts` — register `DashboardModule`.

**Frontend (`apps/web/src/app`):**
- `app.config.ts` — add `provideCharts(withDefaultRegisterables())`.
- `ui/bar-chart/bar-chart.component.ts` (+ spec) — new.
- `ui/donut-chart/donut-chart.component.ts` (+ spec) — new.
- `features/dashboard/dashboard.models.ts`, `dashboard.service.ts` (+ spec), `dashboard.component.ts` + `.html` (+ spec) — new.
- `app.routes.ts` — add `/app/dashboard` + redirect.
- `features/shell/shell.component.ts` — add "Dashboard" nav item.
- `features/shell/shell.component.html` — sidebar/avatar sizing (`w-64`→`w-60`, `h-9 w-9`→`h-8 w-8`).
- `ui/sidebar/sidebar.component.ts`, `ui/topbar/topbar.component.ts` — Tailwind class changes.
- `ui/topbar/topbar.component.spec.ts` — update icon `.pick()` for the new search icon.
- `src/test-setup.ts` (new), `angular.json` — canvas mock wiring.

---

### Task 1: Backend — `BankRepository.countByDifficultyAndStatus`

**Files:**
- Modify: `apps/api/src/modules/bank/bank.repository.ts` (append after `deleteQuestion`, class ends at line 573)
- Modify: `apps/api/src/modules/bank/bank.repository.spec.ts` (append a new `describe` block; reuses `tenantAId`, `tenantAUserId`, `tenantBId`, `tenantBUserId`, `centralUserId`, `topicId`, `createQuestion`, `createdQuestionIds` already defined in the file)

**Interfaces:**
- Produces: `BankStatusDifficultyCount { difficulty: Difficulty; status: QuestionStatus; total: number }` and `BankRepository.countByDifficultyAndStatus(tenantId: string | null): Promise<BankStatusDifficultyCount[]>` — Task 3's `DashboardStatsService` consumes this exact shape.

- [ ] **Step 1: Write the failing repository test**

Append to `apps/api/src/modules/bank/bank.repository.spec.ts` (before the final closing `});` of the outer `describe("BankRepository", ...)`):

```ts
  describe("countByDifficultyAndStatus() — dashboard aggregate", () => {
    // Every assertion below is DELTA-based (before/after the same query),
    // never a raw total — this file runs against a SHARED dev Postgres, so
    // other spec files' central (tenantId=null) rows are always present and
    // would make an absolute-count assertion flaky.

    it("includes a newly created own-tenant question in the caller's aggregate", async () => {
      const before = await repository.countByDifficultyAndStatus(tenantAId);
      const beforeTotal =
        before.find((g) => g.difficulty === Difficulty.Hard && g.status === "approved")?.total ?? 0;

      await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, difficulty: Difficulty.Hard });

      const after = await repository.countByDifficultyAndStatus(tenantAId);
      const afterTotal =
        after.find((g) => g.difficulty === Difficulty.Hard && g.status === "approved")?.total ?? 0;

      expect(afterTotal).toBe(beforeTotal + 1);
    });

    it("includes a newly created central question in every tenant's aggregate", async () => {
      const before = await repository.countByDifficultyAndStatus(tenantAId);
      const beforeTotal =
        before.find((g) => g.difficulty === Difficulty.Easy && g.status === "approved")?.total ?? 0;

      await createQuestion({ tenantId: null, createdBy: centralUserId, difficulty: Difficulty.Easy });

      const after = await repository.countByDifficultyAndStatus(tenantAId);
      const afterTotal =
        after.find((g) => g.difficulty === Difficulty.Easy && g.status === "approved")?.total ?? 0;

      expect(afterTotal).toBe(beforeTotal + 1);
    });

    it("excludes another tenant's private question from the caller's aggregate", async () => {
      const before = await repository.countByDifficultyAndStatus(tenantAId);
      const beforeTotal =
        before.find((g) => g.difficulty === Difficulty.Medium && g.status === "approved")?.total ?? 0;

      await createQuestion({ tenantId: tenantBId, createdBy: tenantBUserId, difficulty: Difficulty.Medium });

      const after = await repository.countByDifficultyAndStatus(tenantAId);
      const afterTotal =
        after.find((g) => g.difficulty === Difficulty.Medium && g.status === "approved")?.total ?? 0;

      expect(afterTotal).toBe(beforeTotal);
    });

    it("groups by status independently of difficulty (a draft never counts as approved)", async () => {
      const before = await repository.countByDifficultyAndStatus(tenantAId);
      const beforeDraft =
        before.find((g) => g.difficulty === Difficulty.Medium && g.status === "draft")?.total ?? 0;

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

      const after = await repository.countByDifficultyAndStatus(tenantAId);
      const afterDraft =
        after.find((g) => g.difficulty === Difficulty.Medium && g.status === "draft")?.total ?? 0;

      expect(afterDraft).toBe(beforeDraft + 1);
    });

    it("scopes to central-only (tenant_id IS NULL) when tenantId is null (platform staff) — a tenant-private question never leaks in", async () => {
      const before = await repository.countByDifficultyAndStatus(null);
      const beforeTotal =
        before.find((g) => g.difficulty === Difficulty.Hard && g.status === "approved")?.total ?? 0;

      await createQuestion({ tenantId: tenantAId, createdBy: tenantAUserId, difficulty: Difficulty.Hard });

      const after = await repository.countByDifficultyAndStatus(null);
      const afterTotal =
        after.find((g) => g.difficulty === Difficulty.Hard && g.status === "approved")?.total ?? 0;

      expect(afterTotal).toBe(beforeTotal);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec jest src/modules/bank/bank.repository.spec.ts`
Expected: FAIL with `repository.countByDifficultyAndStatus is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/src/modules/bank/bank.repository.ts`, inside `export class BankRepository { ... }`, right before its final closing brace (after `deleteQuestion`):

```ts
  /**
   * Dashboard aggregate (design doc §2): one grouped count per
   * {difficulty, status} pair, visible to `tenantId` — SAME visibility
   * predicate as `listQuestions`/`findQuestionById` (`tenant_id IS NULL OR
   * tenant_id = :current`, or `IS NULL` only for platform staff). Mirrors
   * `ExamsRepository.countStock()`'s `groupBy` + `count()` shape.
   */
  async countByDifficultyAndStatus(tenantId: string | null): Promise<BankStatusDifficultyCount[]> {
    const visibility: SQL = tenantId
      ? (or(isNull(questions.tenantId), eq(questions.tenantId, tenantId)) as SQL)
      : (isNull(questions.tenantId) as SQL);

    const rows = await db
      .select({ difficulty: questions.difficulty, status: questions.status, total: count() })
      .from(questions)
      .where(visibility)
      .groupBy(questions.difficulty, questions.status);

    return rows.map((row) => ({ difficulty: row.difficulty, status: row.status, total: Number(row.total) }));
  }
```

And add this interface near the top of the same file, alongside `QuestionListItem`/`QuestionListFilter` (no new imports needed — `count`, `or`, `isNull`, `eq`, `SQL` and `Difficulty`/`QuestionStatus` are already imported):

```ts
/** One `{difficulty, status}` bucket from `countByDifficultyAndStatus` — feeds the dashboard's bank card. */
export interface BankStatusDifficultyCount {
  readonly difficulty: Difficulty;
  readonly status: QuestionStatus;
  readonly total: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec jest src/modules/bank/bank.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/bank/bank.repository.ts apps/api/src/modules/bank/bank.repository.spec.ts
git commit -m "feat(api): add BankRepository.countByDifficultyAndStatus for dashboard stats"
```

---

### Task 2: Backend — `ExamsRepository.countByStatus` + `listRecent`, export `ExamsRepository`

**Files:**
- Modify: `apps/api/src/modules/exams/exams.repository.ts` (append after `listExams`, around line 364)
- Modify: `apps/api/src/modules/exams/exams.repository.spec.ts` (append a new `describe` block with its own dedicated tenant fixture — this file's other describe blocks already reuse the outer `tenantAId`/`tenantBId` across many tests, so a fresh, dedicated tenant is the only way to get exact, non-flaky counts)
- Modify: `apps/api/src/modules/exams/exams.module.ts` (add `exports: [ExamsRepository]`)

**Interfaces:**
- Produces: `ExamStatusCount { status: ExamStatus; total: number }`, `RecentExamRecord { id: string; title: string; status: ExamStatus; createdAt: string }`, `ExamsRepository.countByStatus(tenantId: string): Promise<ExamStatusCount[]>`, `ExamsRepository.listRecent(tenantId: string, limit: number): Promise<RecentExamRecord[]>` — Task 3 consumes both exactly.
- Produces: `ExamsModule` now exports `ExamsRepository` (previously module-private) — Task 3's `DashboardModule` depends on this.

- [ ] **Step 1: Write the failing repository test**

Append to `apps/api/src/modules/exams/exams.repository.spec.ts` (before the final closing `});` of the outer `describe("ExamsRepository", ...)`):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec jest src/modules/exams/exams.repository.spec.ts`
Expected: FAIL with `repository.countByStatus is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/src/modules/exams/exams.repository.ts`, inside `export class ExamsRepository { ... }`, right after `listExams()` (around line 364):

```ts
  /** Dashboard aggregate (design doc §2): grouped exam count by status for a tenant. */
  async countByStatus(tenantId: string): Promise<ExamStatusCount[]> {
    const rows = await db
      .select({ status: exams.status, total: count() })
      .from(exams)
      .where(eq(exams.tenantId, tenantId))
      .groupBy(exams.status);

    return rows.map((row) => ({ status: row.status, total: Number(row.total) }));
  }

  /** Dashboard aggregate (design doc §2): the tenant's `limit` most recent exams, newest first. */
  async listRecent(tenantId: string, limit: number): Promise<RecentExamRecord[]> {
    const rows = await db
      .select({ id: exams.id, title: exams.title, status: exams.status, createdAt: exams.createdAt })
      .from(exams)
      .where(eq(exams.tenantId, tenantId))
      .orderBy(desc(exams.createdAt))
      .limit(limit);

    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }
```

Add these two interfaces near the top of the file, alongside `ExamListItem` (no new imports needed — `count`, `eq`, `desc` are already imported):

```ts
/** One `{status}` bucket from `countByStatus` — feeds the dashboard's exams card. */
export interface ExamStatusCount {
  readonly status: ExamStatus;
  readonly total: number;
}

/** One row from `listRecent` — feeds the dashboard's "recent exams" list. */
export interface RecentExamRecord {
  readonly id: string;
  readonly title: string;
  readonly status: ExamStatus;
  readonly createdAt: string;
}
```

In `apps/api/src/modules/exams/exams.module.ts`, add an `exports` array (currently absent):

```ts
@Module({
  controllers: [ExamsController],
  providers: [
    ExamsRepository,
    ExamsService,
    ExamVersionGenerationService,
    { provide: STORAGE_PORT, useFactory: resolveStorageAdapter },
    { provide: PDF_COMPILER_PORT, useFactory: resolvePdfCompilerAdapter },
  ],
  exports: [ExamsRepository],
})
export class ExamsModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec jest src/modules/exams/exams.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/exams/exams.repository.ts apps/api/src/modules/exams/exams.repository.spec.ts apps/api/src/modules/exams/exams.module.ts
git commit -m "feat(api): add ExamsRepository.countByStatus/listRecent and export ExamsRepository"
```

---

### Task 3: Backend — `dashboard` module (controller + service)

**Files:**
- Create: `apps/api/src/modules/dashboard/dashboard-stats.service.ts`
- Create: `apps/api/src/modules/dashboard/dashboard.controller.ts`
- Create: `apps/api/src/modules/dashboard/dashboard.module.ts`
- Create: `apps/api/src/modules/dashboard/dashboard-stats.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register `DashboardModule`)

**Interfaces:**
- Consumes: `BankRepository.countByDifficultyAndStatus` (Task 1), `ExamsRepository.countByStatus`/`listRecent` (Task 2), `AuthTokenPayload` from `apps/api/src/modules/auth/token.service.ts`.
- Produces: `DashboardStats` interface (`bank: { total, byDifficulty: Record<Difficulty, number>, byStatus: Record<QuestionStatus, number> }`, `exams: { total, byStatus: Record<ExamStatus, number>, recent: Array<{id,title,status,createdAt}> }`, `aiDrafts: { pending }`) and `GET /dashboard/stats` — Task 4 (e2e) and the frontend `dashboard.models.ts` (Task 7) mirror this exact shape.

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/modules/dashboard/dashboard-stats.service.spec.ts`:

```ts
import { Difficulty, Role } from "@exams-generator/shared";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { ExamsRepository } from "../exams/exams.repository";
import { DashboardStatsService } from "./dashboard-stats.service";

const TEACHER_USER: AuthTokenPayload = { sub: "teacher-1", tenantId: "tenant-1", role: Role.Teacher };
const STAFF_USER: AuthTokenPayload = { sub: "staff-1", tenantId: null, role: Role.ContentEditor };

function buildDeps() {
  const bankRepository = {
    countByDifficultyAndStatus: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<BankRepository>;

  const examsRepository = {
    countByStatus: jest.fn().mockResolvedValue([]),
    listRecent: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<ExamsRepository>;

  const service = new DashboardStatsService(bankRepository, examsRepository);
  return { service, bankRepository, examsRepository };
}

describe("DashboardStatsService.getStats", () => {
  it("aggregates bank counts by difficulty and status, zero-filling missing buckets", async () => {
    const { service, bankRepository } = buildDeps();
    bankRepository.countByDifficultyAndStatus.mockResolvedValue([
      { difficulty: Difficulty.Easy, status: "approved", total: 5 },
      { difficulty: Difficulty.Easy, status: "draft", total: 2 },
      { difficulty: Difficulty.Hard, status: "approved", total: 3 },
    ]);

    const result = await service.getStats(TEACHER_USER);

    expect(result.bank.total).toBe(10);
    expect(result.bank.byDifficulty).toEqual({ easy: 7, medium: 0, hard: 3 });
    expect(result.bank.byStatus).toEqual({ draft: 2, approved: 8, archived: 0 });
  });

  it("derives aiDrafts.pending from the draft bucket of the same bank query (no extra call)", async () => {
    const { service, bankRepository } = buildDeps();
    bankRepository.countByDifficultyAndStatus.mockResolvedValue([
      { difficulty: Difficulty.Medium, status: "draft", total: 4 },
    ]);

    const result = await service.getStats(TEACHER_USER);

    expect(result.aiDrafts.pending).toBe(4);
  });

  it("scopes the bank query to the requester's tenantId", async () => {
    const { service, bankRepository } = buildDeps();

    await service.getStats(TEACHER_USER);

    expect(bankRepository.countByDifficultyAndStatus).toHaveBeenCalledWith("tenant-1");
  });

  it("aggregates exam counts by status and returns recent exams for a tenant user", async () => {
    const { service, examsRepository } = buildDeps();
    examsRepository.countByStatus.mockResolvedValue([
      { status: "draft", total: 1 },
      { status: "ready", total: 2 },
    ]);
    examsRepository.listRecent.mockResolvedValue([
      { id: "exam-1", title: "Examen de Álgebra", status: "ready", createdAt: "2026-07-01T00:00:00.000Z" },
    ]);

    const result = await service.getStats(TEACHER_USER);

    expect(result.exams.total).toBe(3);
    expect(result.exams.byStatus).toEqual({ draft: 1, ready: 2 });
    expect(result.exams.recent).toEqual([
      { id: "exam-1", title: "Examen de Álgebra", status: "ready", createdAt: "2026-07-01T00:00:00.000Z" },
    ]);
    expect(examsRepository.listRecent).toHaveBeenCalledWith("tenant-1", 5);
  });

  it("returns zeroed exam stats for platform staff (tenantId=null), never calling ExamsRepository", async () => {
    const { service, examsRepository } = buildDeps();

    const result = await service.getStats(STAFF_USER);

    expect(result.exams).toEqual({ total: 0, byStatus: { draft: 0, ready: 0 }, recent: [] });
    expect(examsRepository.countByStatus).not.toHaveBeenCalled();
    expect(examsRepository.listRecent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm exec jest src/modules/dashboard/dashboard-stats.service.spec.ts`
Expected: FAIL — `Cannot find module './dashboard-stats.service'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/modules/dashboard/dashboard-stats.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { Difficulty } from "@exams-generator/shared";
import { EXAM_STATUSES, ExamStatus, QUESTION_STATUSES, QuestionStatus } from "../../db/schema/enums";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { ExamsRepository } from "../exams/exams.repository";

const RECENT_EXAMS_LIMIT = 5;

export interface DashboardStats {
  readonly bank: {
    readonly total: number;
    readonly byDifficulty: Record<Difficulty, number>;
    readonly byStatus: Record<QuestionStatus, number>;
  };
  readonly exams: {
    readonly total: number;
    readonly byStatus: Record<ExamStatus, number>;
    readonly recent: ReadonlyArray<{ id: string; title: string; status: ExamStatus; createdAt: string }>;
  };
  readonly aiDrafts: { readonly pending: number };
}

function zeroedByDifficulty(): Record<Difficulty, number> {
  return { [Difficulty.Easy]: 0, [Difficulty.Medium]: 0, [Difficulty.Hard]: 0 };
}

function zeroedByQuestionStatus(): Record<QuestionStatus, number> {
  const result = {} as Record<QuestionStatus, number>;
  for (const status of QUESTION_STATUSES) result[status] = 0;
  return result;
}

function zeroedByExamStatus(): Record<ExamStatus, number> {
  const result = {} as Record<ExamStatus, number>;
  for (const status of EXAM_STATUSES) result[status] = 0;
  return result;
}

/**
 * Assembles `GET /dashboard/stats` (design doc §2). `aiDrafts.pending` is
 * derived from the SAME grouped bank query as `byStatus` (sum of the
 * `draft` bucket) — no separate repository call, per design doc §2.
 *
 * Platform staff (`user.tenantId === null`) have no owning tenant, and
 * `exams.tenant_id` is NOT NULL (an exam always belongs to a school —
 * `exams.schema.ts`). Unlike `exams.service.ts`'s private `requireTenant()`,
 * which throws `ForbiddenException` for staff, this dashboard is reachable
 * by every role (it's the first `PRINCIPAL_GROUP` nav item, not gated like
 * `settings`) — so staff simply see zeroed exam stats instead of a 403.
 */
@Injectable()
export class DashboardStatsService {
  constructor(
    private readonly bankRepository: BankRepository,
    private readonly examsRepository: ExamsRepository,
  ) {}

  async getStats(user: AuthTokenPayload): Promise<DashboardStats> {
    const bankGroups = await this.bankRepository.countByDifficultyAndStatus(user.tenantId);

    const byDifficulty = zeroedByDifficulty();
    const byStatus = zeroedByQuestionStatus();
    for (const group of bankGroups) {
      byDifficulty[group.difficulty] += group.total;
      byStatus[group.status] += group.total;
    }
    const bankTotal = bankGroups.reduce((sum, g) => sum + g.total, 0);

    const exams = user.tenantId
      ? await this.buildExamStats(user.tenantId)
      : { total: 0, byStatus: zeroedByExamStatus(), recent: [] };

    return {
      bank: { total: bankTotal, byDifficulty, byStatus },
      exams,
      aiDrafts: { pending: byStatus.draft },
    };
  }

  private async buildExamStats(tenantId: string): Promise<DashboardStats["exams"]> {
    const [examGroups, recent] = await Promise.all([
      this.examsRepository.countByStatus(tenantId),
      this.examsRepository.listRecent(tenantId, RECENT_EXAMS_LIMIT),
    ]);

    const byStatus = zeroedByExamStatus();
    for (const group of examGroups) {
      byStatus[group.status] += group.total;
    }
    const total = examGroups.reduce((sum, g) => sum + g.total, 0);

    return { total, byStatus, recent };
  }
}
```

Create `apps/api/src/modules/dashboard/dashboard.controller.ts`:

```ts
import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { DashboardStats, DashboardStatsService } from "./dashboard-stats.service";

/** `GET /dashboard/stats` (design doc §2) — reachable by every authenticated role, no `RolesGuard`. */
@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly service: DashboardStatsService) {}

  @Get("stats")
  async stats(@CurrentUser() user: AuthTokenPayload): Promise<DashboardStats> {
    return this.service.getStats(user);
  }
}
```

Create `apps/api/src/modules/dashboard/dashboard.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { BankModule } from "../bank/bank.module";
import { ExamsModule } from "../exams/exams.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardStatsService } from "./dashboard-stats.service";

@Module({
  imports: [BankModule, ExamsModule],
  controllers: [DashboardController],
  providers: [DashboardStatsService],
})
export class DashboardModule {}
```

In `apps/api/src/app.module.ts`, register the new module:

```ts
import { Module } from "@nestjs/common";
import { AiModule } from "./modules/ai/ai.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BankModule } from "./modules/bank/bank.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { ExamsModule } from "./modules/exams/exams.module";
import { HealthModule } from "./modules/health/health.module";
import { TaxonomyModule } from "./modules/taxonomy/taxonomy.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { UsersModule } from "./modules/users/users.module";

@Module({
  imports: [
    HealthModule,
    AuthModule,
    BankModule,
    TenantsModule,
    ExamsModule,
    AiModule,
    TaxonomyModule,
    AssetsModule,
    UsersModule,
    DashboardModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec jest src/modules/dashboard/dashboard-stats.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/dashboard apps/api/src/app.module.ts
git commit -m "feat(api): add dashboard module with GET /dashboard/stats"
```

---

### Task 4: Backend — e2e test for `GET /dashboard/stats`

**Files:**
- Create: `apps/api/src/modules/dashboard/dashboard.e2e.spec.ts`

**Interfaces:**
- Consumes: `DashboardModule` (Task 3), `BankRepository`/`ExamsRepository` (Tasks 1-2, injected via `Test.createTestingModule`), `TokenService` (existing).

- [ ] **Step 1: Write the failing e2e test**

Create `apps/api/src/modules/dashboard/dashboard.e2e.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, questions, tenants, topics, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
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
    // convention (`new BankRepository()`/`new ExamsRepository()`), since
    // both classes have no constructor dependencies (they use the module-
    // level `db` singleton directly) — no DI container needed to build them.
    bankRepository = new BankRepository();
    examsRepository = new ExamsRepository();

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
    await app.close();
    for (const id of createdExamIds) {
      await examsRepository.deleteExam(id, tenantId);
    }
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    await db.delete(users).where(inArray(users.id, [teacherId, staffId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantId]));
    await db.delete(topics).where(inArray(topics.id, [topicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId]));
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
```

- [ ] **Step 2: Run test to verify it fails**

This task is a verification lock, not a red-green step: Task 3 already implements `GET /dashboard/stats` end-to-end (controller, guard, service, real repositories), so this e2e suite is expected to PASS the first time it runs against real Postgres — it exists to lock in real HTTP + migrations + guard behavior (things a mocked unit test can't catch: routing, `JwtAuthGuard` wiring, real FK constraints), not to drive new implementation.

Run: `cd apps/api && pnpm exec jest src/modules/dashboard/dashboard.e2e.spec.ts`
Expected: PASS immediately. If anything fails, that is a genuine gap in Task 3's implementation — fix it there (not here) before continuing.

- [ ] **Step 3: Write minimal implementation**

No implementation changes needed (see Step 2) — proceed to Step 4.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm exec jest src/modules/dashboard/dashboard.e2e.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/dashboard/dashboard.e2e.spec.ts
git commit -m "test(api): add e2e coverage for GET /dashboard/stats"
```

---

### Task 5: Frontend — install `chart.js`/`ng2-charts`, canvas-mock test infra, `ui/bar-chart`

**Files:**
- Modify: `apps/web/package.json` (add `chart.js`, `ng2-charts`, `vitest-canvas-mock`)
- Modify: `apps/web/src/app/app.config.ts` (register `provideCharts(withDefaultRegisterables())`)
- Create: `apps/web/src/test-setup.ts`
- Modify: `apps/web/angular.json` (wire `test.options.setupFiles`)
- Create: `apps/web/src/app/ui/bar-chart/bar-chart.component.ts`
- Create: `apps/web/src/app/ui/bar-chart/bar-chart.component.spec.ts`

**Interfaces:**
- Produces: `ChartDatum { label: string; value: number }`, `BarChartComponent` with `data = input.required<readonly ChartDatum[]>()`, selector `ui-bar-chart` — Task 8's `DashboardComponent` consumes this.

- [ ] **Step 0 (prerequisite, not TDD-driven): install dependencies and wire test infra**

Install the new dependencies (peer-dependency warnings about `@angular/cdk` are expected and safe to ignore — see Global Constraints):

```bash
cd apps/web
pnpm add chart.js@^4.5.1 ng2-charts@^10.0.0
pnpm add -D vitest-canvas-mock@^1.1.4
```

Create `apps/web/src/test-setup.ts`:

```ts
import 'vitest-canvas-mock';
```

Modify `apps/web/angular.json`'s `test` architect target to wire it in:

```json
        "test": {
          "builder": "@angular/build:unit-test",
          "options": {
            "setupFiles": ["src/test-setup.ts"]
          }
        }
```

This step exists so Step 2's failure is attributable ONLY to the missing `BarChartComponent` (not to a missing package or a canvas-mock crash).

- [ ] **Step 1: Write the failing render test**

Create `apps/web/src/app/ui/bar-chart/bar-chart.component.spec.ts`:

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { BarChartComponent, ChartDatum } from './bar-chart.component';

@Component({
  standalone: true,
  imports: [BarChartComponent],
  template: `<ui-bar-chart [data]="data"></ui-bar-chart>`,
})
class HostComponent {
  data: ChartDatum[] = [
    { label: 'Fácil', value: 5 },
    { label: 'Media', value: 3 },
    { label: 'Difícil', value: 2 },
  ];
}

function setup() {
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [provideCharts(withDefaultRegisterables())],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('BarChartComponent', () => {
  it('renders a canvas without throwing when given data', () => {
    expect(() => setup()).not.toThrow();
  });

  it('renders exactly one canvas element', () => {
    const { compiled } = setup();
    expect(compiled.querySelectorAll('[data-testid="bar-chart"]').length).toBe(1);
  });

  it('builds one dataset value per input entry', () => {
    const { fixture } = setup();
    const barChartDebugEl = fixture.debugElement.children[0];
    const instance = barChartDebugEl.componentInstance as unknown as {
      chartData: () => { datasets: { data: number[] }[] };
    };

    expect(instance.chartData().datasets[0].data).toEqual([5, 3, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — `Cannot find module './bar-chart.component'`.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/src/app/app.config.ts`, register chart providers:

```ts
import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import {
  LucideAngularModule,
  Menu, X, Sparkles, Lock, Download, Ellipsis, Check, TriangleAlert, Search, School,
  LogOut, User, Users, Trash2, Pencil, Archive, ChevronLeft, ChevronRight, ChevronDown, Plus, Minus,
} from 'lucide-angular';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { authErrorInterceptor } from './core/auth/auth-error.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor, authErrorInterceptor])),
    provideCharts(withDefaultRegisterables()),
    importProvidersFrom(
      LucideAngularModule.pick({
        Menu, X, Sparkles, Lock, Download, Ellipsis, Check, TriangleAlert, Search, School,
        LogOut, User, Users, Trash2, Pencil, Archive, ChevronLeft, ChevronRight, ChevronDown, Plus, Minus,
      }),
    ),
  ],
};
```

Create `apps/web/src/app/ui/bar-chart/bar-chart.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';

export interface ChartDatum {
  readonly label: string;
  readonly value: number;
}

/**
 * Reads an existing `@theme` CSS custom property at runtime; falls back to
 * its known hex (copied from `styles.css`, used ONLY as a safety net for
 * environments with no loaded stylesheet, e.g. unit tests) — never
 * introduces a new color (DECISION: no new `@theme` tokens, design doc §5).
 */
function themeColor(cssVar: string, fallbackHex: string): string {
  if (typeof document === 'undefined') {
    return fallbackHex;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return value || fallbackHex;
}

const PALETTE = [
  themeColor('--color-easy-bg', '#dcfce7'),
  themeColor('--color-medium-bg', '#fef3c7'),
  themeColor('--color-hard-bg', '#fee2e2'),
];

/**
 * Thin `ng2-charts` wrapper (design doc §5): one bar per `data()` entry,
 * colored from the SAME easy/medium/hard tokens `ui/tag` already uses — no
 * new palette. Requires `provideCharts(withDefaultRegisterables())` to be
 * registered (app-wide in `app.config.ts`; per-spec in tests).
 */
@Component({
  selector: 'ui-bar-chart',
  standalone: true,
  imports: [BaseChartDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas data-testid="bar-chart" baseChart [data]="chartData()" [options]="options" [type]="'bar'"></canvas>
  `,
})
export class BarChartComponent {
  readonly data = input.required<readonly ChartDatum[]>();

  protected readonly chartData = computed<ChartData<'bar'>>(() => ({
    labels: this.data().map((d) => d.label),
    datasets: [
      {
        data: this.data().map((d) => d.value),
        backgroundColor: this.data().map((_, i) => PALETTE[i % PALETTE.length]),
      },
    ],
  }));

  protected readonly options: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    plugins: { legend: { display: false } },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS (full suite — do not scope to one file, see Global Constraints).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/angular.json apps/web/src/test-setup.ts apps/web/src/app/app.config.ts apps/web/src/app/ui/bar-chart
git commit -m "feat(web): install chart.js/ng2-charts and add ui-bar-chart wrapper"
```

---

### Task 6: Frontend — `ui/donut-chart`

**Files:**
- Create: `apps/web/src/app/ui/donut-chart/donut-chart.component.ts`
- Create: `apps/web/src/app/ui/donut-chart/donut-chart.component.spec.ts`

**Interfaces:**
- Consumes: `ChartDatum` (Task 5).
- Produces: `DonutChartComponent` with `data = input.required<readonly ChartDatum[]>()`, selector `ui-donut-chart` — Task 8 consumes this.

- [ ] **Step 1: Write the failing render test**

Create `apps/web/src/app/ui/donut-chart/donut-chart.component.spec.ts`:

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { DonutChartComponent } from './donut-chart.component';
import { ChartDatum } from '../bar-chart/bar-chart.component';

@Component({
  standalone: true,
  imports: [DonutChartComponent],
  template: `<ui-donut-chart [data]="data"></ui-donut-chart>`,
})
class HostComponent {
  data: ChartDatum[] = [
    { label: 'Borrador', value: 1 },
    { label: 'Lista', value: 2 },
  ];
}

function setup() {
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [provideCharts(withDefaultRegisterables())],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('DonutChartComponent', () => {
  it('renders a canvas without throwing when given data', () => {
    expect(() => setup()).not.toThrow();
  });

  it('renders exactly one canvas element', () => {
    const { compiled } = setup();
    expect(compiled.querySelectorAll('[data-testid="donut-chart"]').length).toBe(1);
  });

  it('builds one dataset value per input entry', () => {
    const { fixture } = setup();
    const donutChartDebugEl = fixture.debugElement.children[0];
    const instance = donutChartDebugEl.componentInstance as unknown as {
      chartData: () => { datasets: { data: number[] }[] };
    };

    expect(instance.chartData().datasets[0].data).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — `Cannot find module './donut-chart.component'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/app/ui/donut-chart/donut-chart.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';
import { ChartDatum } from '../bar-chart/bar-chart.component';

function themeColor(cssVar: string, fallbackHex: string): string {
  if (typeof document === 'undefined') {
    return fallbackHex;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return value || fallbackHex;
}

const PALETTE = [themeColor('--color-tint-activo', '#deedfb'), themeColor('--color-n300', '#c3c8ce')];

/**
 * Thin `ng2-charts` wrapper (design doc §5), doughnut variant — same shape
 * as `BarChartComponent` (`ChartDatum` input, existing-token palette only).
 */
@Component({
  selector: 'ui-donut-chart',
  standalone: true,
  imports: [BaseChartDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas
      data-testid="donut-chart"
      baseChart
      [data]="chartData()"
      [options]="options"
      [type]="'doughnut'"
    ></canvas>
  `,
})
export class DonutChartComponent {
  readonly data = input.required<readonly ChartDatum[]>();

  protected readonly chartData = computed<ChartData<'doughnut'>>(() => ({
    labels: this.data().map((d) => d.label),
    datasets: [
      {
        data: this.data().map((d) => d.value),
        backgroundColor: this.data().map((_, i) => PALETTE[i % PALETTE.length]),
      },
    ],
  }));

  protected readonly options: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    plugins: { legend: { position: 'bottom' } },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/ui/donut-chart
git commit -m "feat(web): add ui-donut-chart wrapper component"
```

---

### Task 7: Frontend — `dashboard.models.ts` + `dashboard.service.ts`

**Files:**
- Create: `apps/web/src/app/features/dashboard/dashboard.models.ts`
- Create: `apps/web/src/app/features/dashboard/dashboard.service.ts`
- Create: `apps/web/src/app/features/dashboard/dashboard.service.spec.ts`

**Interfaces:**
- Produces: `DashboardStats` (exact shape mirrors Task 3's backend `DashboardStats`: `bank.total`, `bank.byDifficulty: Record<Difficulty, number>`, `bank.byStatus: Record<'draft'|'approved'|'archived', number>`, `exams.total`, `exams.byStatus: Record<'draft'|'ready', number>`, `exams.recent: {id,title,status,createdAt}[]`, `aiDrafts.pending`), `DashboardService.getStats(): Observable<DashboardStats>` — Task 8 consumes both.

- [ ] **Step 1: Write the failing service test**

Create `apps/web/src/app/features/dashboard/dashboard.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Difficulty } from '@exams-generator/shared';
import { DashboardService } from './dashboard.service';
import { environment } from '../../../environments/environment';
import { DashboardStats } from './dashboard.models';

const STATS: DashboardStats = {
  bank: {
    total: 10,
    byDifficulty: { [Difficulty.Easy]: 4, [Difficulty.Medium]: 3, [Difficulty.Hard]: 3 },
    byStatus: { draft: 1, approved: 8, archived: 1 },
  },
  exams: {
    total: 2,
    byStatus: { draft: 1, ready: 1 },
    recent: [{ id: 'exam-1', title: 'Examen 1', status: 'ready', createdAt: '2026-07-01T00:00:00.000Z' }],
  },
  aiDrafts: { pending: 1 },
};

describe('DashboardService', () => {
  let service: DashboardService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DashboardService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('GETs /dashboard/stats and returns the parsed response', () => {
    let result: DashboardStats | undefined;
    service.getStats().subscribe((stats) => (result = stats));

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/dashboard/stats`);
    expect(req.request.method).toBe('GET');
    req.flush(STATS);

    expect(result).toEqual(STATS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — `Cannot find module './dashboard.service'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/app/features/dashboard/dashboard.models.ts`:

```ts
import { Difficulty } from '@exams-generator/shared';

/** Bank question lifecycle status (mirrors the API's `QUESTION_STATUSES` — `apps/api/src/db/schema/enums.ts`). */
export type BankQuestionStatus = 'draft' | 'approved' | 'archived';

/** Exam lifecycle status (mirrors the API's `EXAM_STATUSES` — `apps/api/src/db/schema/enums.ts`). */
export type DashboardExamStatus = 'draft' | 'ready';

export interface DashboardRecentExam {
  readonly id: string;
  readonly title: string;
  readonly status: DashboardExamStatus;
  readonly createdAt: string;
}

/** `GET /dashboard/stats` response shape (design doc §2) — mirrors the API's `DashboardStats`. */
export interface DashboardStats {
  readonly bank: {
    readonly total: number;
    readonly byDifficulty: Record<Difficulty, number>;
    readonly byStatus: Record<BankQuestionStatus, number>;
  };
  readonly exams: {
    readonly total: number;
    readonly byStatus: Record<DashboardExamStatus, number>;
    readonly recent: readonly DashboardRecentExam[];
  };
  readonly aiDrafts: { readonly pending: number };
}
```

Create `apps/web/src/app/features/dashboard/dashboard.service.ts`:

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DashboardStats } from './dashboard.models';

/**
 * Angular client for `GET /dashboard/stats` (design doc §4) — mirrors
 * `BankService`'s shape: `inject(HttpClient)`, one method per endpoint. The
 * bearer JWT is attached automatically by `authInterceptor`.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  getStats(): Observable<DashboardStats> {
    return this.http.get<DashboardStats>(`${environment.apiBaseUrl}/dashboard/stats`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/dashboard/dashboard.models.ts apps/web/src/app/features/dashboard/dashboard.service.ts apps/web/src/app/features/dashboard/dashboard.service.spec.ts
git commit -m "feat(web): add DashboardService and DashboardStats model"
```

---

### Task 8: Frontend — `dashboard.component.ts` + `.html`

**Files:**
- Create: `apps/web/src/app/features/dashboard/dashboard.component.ts`
- Create: `apps/web/src/app/features/dashboard/dashboard.component.html`
- Create: `apps/web/src/app/features/dashboard/dashboard.component.spec.ts`

**Interfaces:**
- Consumes: `DashboardService`/`DashboardStats` (Task 7), `BarChartComponent`/`ChartDatum` (Task 5), `DonutChartComponent` (Task 6), `CardComponent` (existing `ui/card`).
- Produces: `DashboardComponent` (selector `app-dashboard`) — Task 9's route wiring consumes this.

- [ ] **Step 1: Write the failing component test**

Create `apps/web/src/app/features/dashboard/dashboard.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { provideRouter } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { DashboardComponent } from './dashboard.component';
import { DashboardService } from './dashboard.service';
import { DashboardStats } from './dashboard.models';
import { Difficulty } from '@exams-generator/shared';

const STATS: DashboardStats = {
  bank: {
    total: 12,
    byDifficulty: { [Difficulty.Easy]: 5, [Difficulty.Medium]: 4, [Difficulty.Hard]: 3 },
    byStatus: { draft: 2, approved: 9, archived: 1 },
  },
  exams: {
    total: 3,
    byStatus: { draft: 1, ready: 2 },
    recent: [{ id: 'exam-1', title: 'Examen de Álgebra', status: 'ready', createdAt: '2026-07-01T00:00:00.000Z' }],
  },
  aiDrafts: { pending: 2 },
};

function setup(getStatsImpl: (...args: unknown[]) => unknown = () => of(STATS)) {
  const getStats = vi.fn(getStatsImpl);
  TestBed.configureTestingModule({
    imports: [DashboardComponent],
    providers: [
      { provide: DashboardService, useValue: { getStats } },
      provideRouter([]),
      provideCharts(withDefaultRegisterables()),
    ],
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, getStats };
}

describe('DashboardComponent', () => {
  it('fetches stats on init and renders the bank/exams/ai cards', () => {
    const { compiled, getStats } = setup();

    expect(getStats).toHaveBeenCalledTimes(1);
    expect(compiled.querySelector('[data-testid="dashboard-card-bank"]')?.textContent).toContain('12');
    expect(compiled.querySelector('[data-testid="dashboard-card-exams"]')?.textContent).toContain('3');
    expect(compiled.querySelector('[data-testid="dashboard-card-ai"]')?.textContent).toContain('2');
  });

  it('renders the recent exams list with a status tag', () => {
    const { compiled } = setup();

    const row = compiled.querySelector('[data-testid="dashboard-recent-exam"]');
    expect(row?.textContent).toContain('Examen de Álgebra');
    expect(row?.textContent).toContain('Lista');
  });

  it('shows an error message when the stats request fails', () => {
    const { compiled } = setup(() => throwError(() => new Error('network error')));

    expect(compiled.querySelector('[data-testid="dashboard-error"]')).toBeTruthy();
  });

  it('links the AI card to /app/ai/review', () => {
    const { compiled } = setup();

    const link = compiled.querySelector('[data-testid="dashboard-ai-link"]');
    expect(link?.getAttribute('href')).toBe('/app/ai/review');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — `Cannot find module './dashboard.component'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/app/features/dashboard/dashboard.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Difficulty } from '@exams-generator/shared';
import { CardComponent } from '../../ui/card/card.component';
import { BarChartComponent, ChartDatum } from '../../ui/bar-chart/bar-chart.component';
import { DonutChartComponent } from '../../ui/donut-chart/donut-chart.component';
import { DashboardService } from './dashboard.service';
import { DashboardStats } from './dashboard.models';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};

const ERROR_MESSAGE = 'No se pudieron cargar las estadísticas. Inténtalo de nuevo.';

/**
 * Dashboard landing page (design doc §4): three `ui-card`s (bank/exams/AI
 * queue) fed by `DashboardService.getStats()`, fetched once in the
 * constructor — mirrors `BankListComponent`'s shape (inject service, load
 * eagerly, render via signals).
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CardComponent, BarChartComponent, DonutChartComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private readonly dashboardService = inject(DashboardService);

  protected readonly stats = signal<DashboardStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly bankChartData = computed<ChartDatum[]>(() => {
    const s = this.stats();
    if (!s) return [];
    return Object.values(Difficulty).map((d) => ({
      label: DIFFICULTY_LABELS[d],
      value: s.bank.byDifficulty[d] ?? 0,
    }));
  });

  protected readonly examChartData = computed<ChartDatum[]>(() => {
    const s = this.stats();
    if (!s) return [];
    return [
      { label: 'Borrador', value: s.exams.byStatus.draft ?? 0 },
      { label: 'Lista', value: s.exams.byStatus.ready ?? 0 },
    ];
  });

  constructor() {
    this.dashboardService.getStats().subscribe({
      next: (stats) => {
        this.stats.set(stats);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set(ERROR_MESSAGE);
      },
    });
  }

  protected examStatusLabel(status: 'draft' | 'ready'): string {
    return status === 'ready' ? 'Lista' : 'Borrador';
  }
}
```

Create `apps/web/src/app/features/dashboard/dashboard.component.html`:

```html
@if (loading()) {
  <p data-testid="dashboard-loading" class="text-sm text-n600">Cargando estadísticas…</p>
} @else if (errorMessage()) {
  <p data-testid="dashboard-error" class="text-sm text-hard-text">{{ errorMessage() }}</p>
} @else if (stats(); as s) {
  <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
    <ui-card data-testid="dashboard-card-bank">
      <div header><p class="text-sm font-medium text-n600">Banco de preguntas</p></div>
      <p class="text-2xl font-semibold text-n900">{{ s.bank.total }}</p>
      <ui-bar-chart [data]="bankChartData()"></ui-bar-chart>
    </ui-card>

    <ui-card data-testid="dashboard-card-exams">
      <div header><p class="text-sm font-medium text-n600">Exámenes</p></div>
      <p class="text-2xl font-semibold text-n900">{{ s.exams.total }}</p>
      <ui-donut-chart [data]="examChartData()"></ui-donut-chart>
      <ul class="mt-3 flex flex-col gap-2">
        @for (exam of s.exams.recent; track exam.id) {
          <li data-testid="dashboard-recent-exam" class="flex items-center justify-between text-sm">
            <span class="text-n800">{{ exam.title }}</span>
            <span
              class="rounded-full px-2 py-0.5 text-xs font-medium"
              [class]="exam.status === 'ready' ? 'bg-tint-activo text-tint-texto' : 'bg-n100 text-n700'"
              >{{ examStatusLabel(exam.status) }}</span
            >
          </li>
        }
      </ul>
    </ui-card>

    <ui-card data-testid="dashboard-card-ai">
      <div header><p class="text-sm font-medium text-n600">Cola de revisión IA</p></div>
      <p class="text-2xl font-semibold text-n900">{{ s.aiDrafts.pending }}</p>
      <a routerLink="/app/ai/review" data-testid="dashboard-ai-link" class="text-sm text-primary-600 hover:underline"
        >Revisar drafts</a
      >
    </ui-card>
  </div>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/dashboard/dashboard.component.ts apps/web/src/app/features/dashboard/dashboard.component.html apps/web/src/app/features/dashboard/dashboard.component.spec.ts
git commit -m "feat(web): add DashboardComponent with bank/exams/AI-queue cards"
```

---

### Task 9: Frontend — route wiring (`/app/dashboard` + nav item)

**Files:**
- Modify: `apps/web/src/app/app.routes.ts` (add `dashboard` child route + change the `app` route's empty-path redirect)
- Modify: `apps/web/src/app/app.routes.spec.ts` (new assertions)
- Modify: `apps/web/src/app/features/shell/shell.component.ts` (add "Dashboard" to `PRINCIPAL_GROUP`)
- Modify: `apps/web/src/app/features/shell/shell.component.spec.ts` (new assertion)

**Interfaces:**
- Consumes: `DashboardComponent` (Task 8).

- [ ] **Step 1: Write the failing route/nav tests**

Append to `apps/web/src/app/app.routes.spec.ts` (inside the existing `describe('app routes', ...)`, before its final closing `});`):

```ts
  it('exposes /app/dashboard under the protected /app shell', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const dashboardRoute = appRoute?.children?.find((route) => route.path === 'dashboard');
    expect(dashboardRoute).toBeTruthy();
  });

  it('redirects the empty /app child path to dashboard (design doc §4)', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const indexRoute = appRoute?.children?.find(
      (route) => route.path === '' && route.redirectTo,
    );
    expect(indexRoute?.redirectTo).toBe('dashboard');
  });
```

Append to `apps/web/src/app/features/shell/shell.component.spec.ts`'s `describe('ShellComponent', ...)`, before its final closing `});`:

```ts
  it('lists "Dashboard" as the first item of the Principal group', () => {
    const { compiled } = setup(Role.Teacher);

    // NOTE: this file's Router mock stubs `serializeUrl: () => ''`, so
    // `RouterLink`'s computed `href` is always empty here — assert on the
    // rendered label/order instead (same style as this file's other tests),
    // not on `getAttribute('href')`.
    const links = Array.from(compiled.querySelectorAll('a[data-testid="nav-item"]'));
    expect(links[0]?.textContent).toContain('Dashboard');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — `/app/dashboard` route not found, "Dashboard" nav item not found.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/src/app/app.routes.ts`, add the import and the two route entries:

```ts
import { Routes } from '@angular/router';
import { Role } from '@exams-generator/shared';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';
import { LoginComponent } from './features/login/login.component';
import { ShellComponent } from './features/shell/shell.component';
import { ForbiddenComponent } from './features/forbidden/forbidden.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { BankListComponent } from './features/bank/bank-list/bank-list.component';
import { BankUploadComponent } from './features/bank/bank-upload/bank-upload.component';
import { BankNewComponent } from './features/bank/bank-new/bank-new.component';
import { ExamListComponent } from './features/exams/exam-list/exam-list.component';
import { ExamVersionsPanelComponent } from './features/exam-versions/exam-versions-panel/exam-versions-panel.component';
import { ExamBuilderComponent } from './features/exams/exam-builder/exam-builder.component';
import { ExamReviewComponent } from './features/exams/exam-review/exam-review.component';
import { AiGenerateComponent } from './features/ai/ai-generate/ai-generate.component';
import { AiReviewQueueComponent } from './features/ai/ai-review-queue/ai-review-queue.component';
import { TenantSettingsComponent } from './features/tenant-settings/tenant-settings.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'forbidden', component: ForbiddenComponent },
  {
    path: 'app',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: DashboardComponent },
      { path: 'bank', component: BankListComponent },
      { path: 'bank/upload', component: BankUploadComponent },
      { path: 'bank/new', component: BankNewComponent },
      { path: 'exams', component: ExamListComponent },
      { path: 'exams/new', component: ExamBuilderComponent },
      { path: 'exams/:examId', component: ExamReviewComponent },
      { path: 'exams/:examId/versions', component: ExamVersionsPanelComponent },
      { path: 'ai/generate', component: AiGenerateComponent },
      { path: 'ai/review', component: AiReviewQueueComponent },
      {
        path: 'settings',
        component: TenantSettingsComponent,
        canActivate: [roleGuard(Role.SchoolAdmin)],
      },
    ],
  },
  { path: '', pathMatch: 'full', redirectTo: 'app' },
  { path: '**', redirectTo: 'login' },
];
```

In `apps/web/src/app/features/shell/shell.component.ts`, add "Dashboard" as the first item:

```ts
const PRINCIPAL_GROUP: NavGroup = {
  title: 'Principal',
  items: [
    { label: 'Dashboard', route: '/app/dashboard' },
    { label: 'Banco de preguntas', route: '/app/bank' },
    { label: 'Mis exámenes', route: '/app/exams' },
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/app.routes.ts apps/web/src/app/app.routes.spec.ts apps/web/src/app/features/shell/shell.component.ts apps/web/src/app/features/shell/shell.component.spec.ts
git commit -m "feat(web): wire /app/dashboard as the app index and add its nav item"
```

---

### Task 10: Frontend — shell restyle (sidebar/topbar Tailwind classes)

**Files:**
- Modify: `apps/web/src/app/ui/sidebar/sidebar.component.ts` (row height/gap classes only, lines 17-48)
- Modify: `apps/web/src/app/ui/topbar/topbar.component.ts` (add a decorative search field, lines 15-36)
- Modify: `apps/web/src/app/ui/topbar/topbar.component.spec.ts` (icon `.pick()` needs `Search` too, plus a new assertion)
- Modify: `apps/web/src/app/features/shell/shell.component.html` (sidebar width `w-64`→`w-60`, avatar `h-9 w-9`→`h-8 w-8`, lines 2, 13, 25)

**Interfaces:** none — pure Tailwind class changes, no new `@Input`/`@Output`, no new files (per design doc §3). The width (240px) and avatar-size (32px) classes actually live in `shell.component.html`, not in the two `ui/*` primitives themselves — `SidebarComponent`'s `<nav>` has no width class of its own (it fills its parent `<aside>`), and the avatar button is projected into `TopbarComponent`'s `[actions]` slot from `shell.component.html`, not rendered by `TopbarComponent`. Touching `shell.component.html` is therefore required to satisfy the design doc's literal "240px"/"32px" asks, even though §3's prose names only the two `ui/*` files.

- [ ] **Step 1: Write the failing regression/assertion tests**

Modify `apps/web/src/app/ui/topbar/topbar.component.spec.ts` — add `Search` to the icon pick, and one new test:

```ts
import { Component, importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { LucideAngularModule, Menu, Search } from 'lucide-angular';
import { TopbarComponent } from './topbar.component';

@Component({
  standalone: true,
  imports: [TopbarComponent],
  template: `
    <ui-topbar title="Exámenes" (menuToggle)="toggled = true">
      <button actions data-testid="topbar-action">Nueva pregunta</button>
    </ui-topbar>
  `,
})
class HostComponent {
  toggled = false;
}

function setup() {
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [importProvidersFrom(LucideAngularModule.pick({ Menu, Search }))],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('TopbarComponent', () => {
  it('renders the title', () => {
    const { compiled } = setup();

    expect(compiled.textContent).toContain('Exámenes');
  });

  it('renders projected [actions] content', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="topbar-action"]')).toBeTruthy();
  });

  it('emits menuToggle when the menu button is clicked', () => {
    const { fixture, compiled } = setup();

    compiled.querySelector<HTMLButtonElement>('[data-testid="topbar-menu-button"]')!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.toggled).toBe(true);
  });

  it('renders a lucide menu icon (no emoji) inside the menu button', () => {
    const { compiled } = setup();
    const button = compiled.querySelector('[data-testid="topbar-menu-button"]')!;
    expect(button.querySelector('lucide-angular,i-lucide')).toBeTruthy();
    expect(button.textContent).not.toContain('☰');
  });

  it('renders a decorative search field matching the Figma reference (no wired output)', () => {
    const { compiled } = setup();
    const search = compiled.querySelector<HTMLInputElement>('[data-testid="topbar-search"]');
    expect(search).toBeTruthy();
    expect(search?.className).toContain('bg-n50');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — either `topbar-search` element not found, or (if `Search` icon isn't yet registered) an "icon has not been provided" runtime error once the template is updated first. Confirm the new assertion fails before touching the template.

- [ ] **Step 3: Write minimal implementation**

Modify `apps/web/src/app/ui/sidebar/sidebar.component.ts` (row height + group gap only — `bg-tint-activo`/`text-tint-texto`, `data-testid="nav-item"`, `data-testid="nav-item-badge"` are all preserved verbatim):

```ts
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavGroup } from '../ui.types';

/**
 * Design-system sidebar primitive (DECISION FE-4, DS-R6). Renders the
 * groups passed in as DATA (role-based visibility is computed by the
 * shell container, not here). The active route is driven by
 * `RouterLinkActive` and carries the "tint activo" background token.
 */
@Component({
  selector: 'ui-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="flex h-full flex-col gap-8 bg-primary-900 p-4 text-primary-100">
      @for (group of groups(); track group.title) {
        <div>
          <p class="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-primary-300">
            {{ group.title }}
          </p>
          <ul class="flex flex-col gap-1">
            @for (item of group.items; track item.route) {
              <li>
                <a
                  data-testid="nav-item"
                  [routerLink]="item.route"
                  routerLinkActive="bg-tint-activo text-tint-texto"
                  [routerLinkActiveOptions]="{ exact: false }"
                  (click)="navigate.emit(item.route)"
                  class="flex h-[42px] items-center justify-between gap-2 rounded-field px-3 text-sm text-primary-100 hover:bg-primary-800"
                >
                  <span>{{ item.label }}</span>
                  @if (item.badge !== undefined) {
                    <span
                      data-testid="nav-item-badge"
                      class="rounded-full bg-primary-500 px-2 py-0.5 text-xs font-semibold text-white"
                      >{{ item.badge }}</span
                    >
                  }
                </a>
              </li>
            }
          </ul>
        </div>
      }
    </nav>
  `,
})
export class SidebarComponent {
  readonly groups = input.required<readonly NavGroup[]>();
  readonly navigate = output<string>();
}
```

Modify `apps/web/src/app/ui/topbar/topbar.component.ts` (add the decorative search field between the title block and the `[actions]` slot):

```ts
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

/**
 * Design-system topbar primitive (DECISION FE-4). `menuToggle` drives the
 * shell's mobile drawer; `[actions]` is a projection slot for screen-level
 * buttons (e.g. "Nueva pregunta"). Icons are lucide-angular only (no emojis
 * in UI — see docs/superpowers/specs/2026-07-18-ui-redesign-screens-design.md).
 * The search field (design doc §3, dashboard-layout-migration) is
 * deliberately NOT wired to any `input()`/`output()` yet — it's a visual
 * match for the Figma reference only; no search behavior is in scope here.
 */
@Component({
  selector: 'ui-topbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <header class="flex items-center justify-between gap-4 border-b border-n200 bg-white px-4 py-3">
      <div class="flex items-center gap-3">
        <button
          data-testid="topbar-menu-button"
          type="button"
          class="rounded-field p-2 hover:bg-n100 md:hidden"
          (click)="menuToggle.emit()"
          aria-label="Abrir menú"
        >
          <lucide-angular name="menu" class="h-5 w-5"></lucide-angular>
        </button>
        @if (title()) {
          <h1 class="text-base font-semibold text-n900">{{ title() }}</h1>
        }
      </div>
      <div class="hidden min-w-0 flex-1 justify-center px-6 md:flex">
        <div class="relative w-full max-w-sm">
          <lucide-angular
            name="search"
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-n400"
          ></lucide-angular>
          <input
            data-testid="topbar-search"
            type="search"
            placeholder="Buscar..."
            class="h-8 w-full rounded-field border-none bg-n50 pl-9 pr-3 text-sm text-n900 placeholder:text-n400 focus:outline-none focus:ring-2 focus:ring-primary-300"
          />
        </div>
      </div>
      <div class="flex items-center gap-2">
        <ng-content select="[actions]"></ng-content>
      </div>
    </header>
  `,
})
export class TopbarComponent {
  readonly title = input<string>();
  readonly menuToggle = output<void>();
}
```

Modify `apps/web/src/app/features/shell/shell.component.html` (3 class-only edits — desktop sidebar width, mobile drawer width, avatar size):

```html
<div class="flex h-screen bg-n50">
  <aside data-testid="shell-sidebar-desktop" class="hidden w-60 shrink-0 md:block">
    <ui-sidebar [groups]="navGroups()"></ui-sidebar>
  </aside>

  @if (mobileOpen()) {
    <div data-testid="shell-mobile-drawer" class="fixed inset-0 z-40 md:hidden">
      <div
        data-testid="shell-mobile-backdrop"
        class="absolute inset-0 bg-primary-900/40"
        (click)="closeMobileMenu()"
      ></div>
      <div class="relative h-full w-60">
        <ui-sidebar [groups]="navGroups()"></ui-sidebar>
      </div>
    </div>
  }

  <div class="flex flex-1 flex-col overflow-hidden">
    <ui-topbar [title]="schoolName()" (menuToggle)="toggleMobileMenu()">
      <div actions class="relative">
        <button
          type="button"
          data-testid="user-menu-button"
          class="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 hover:bg-primary-200"
          (click)="toggleUserMenu()"
          aria-label="Menú de usuario"
        >
          <lucide-angular name="user" class="h-5 w-5"></lucide-angular>
        </button>
        @if (userMenuOpen()) {
          <div class="absolute right-0 z-50 mt-2 w-48 rounded-card border border-n200 bg-white py-1 shadow-lg">
            <button
              type="button"
              data-testid="logout-button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-n800 hover:bg-n50"
              (click)="logout()"
            >
              <lucide-angular name="log-out" class="h-4 w-4"></lucide-angular>
              Cerrar sesión
            </button>
          </div>
        }
      </div>
    </ui-topbar>
    <main class="flex-1 overflow-auto p-4">
      <router-outlet></router-outlet>
    </main>
  </div>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS — including `sidebar.component.spec.ts`, `shell.component.spec.ts` (both use the `Search` icon transitively through the real `TopbarComponent`, so double-check `shell.component.spec.ts`'s own icon `.pick()` list, which already includes `Search` — see the file's existing imports) and the updated `topbar.component.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/ui/sidebar/sidebar.component.ts apps/web/src/app/ui/topbar/topbar.component.ts apps/web/src/app/ui/topbar/topbar.component.spec.ts apps/web/src/app/features/shell/shell.component.html
git commit -m "style(web): migrate sidebar/topbar to the Figma-reference layout"
```
