# Dashboard Layout Migration — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

## 1. Goal

Migrate the app shell (sidebar + topbar) visual language to match the reference Figma layout (`Dashboard (Community)`, node `0:61`), and add a new Dashboard landing page reusing that card-grid structure — populated with real exams-generator data (question bank, exams, AI review queue) instead of the Figma's food-ordering placeholder content.

Color tokens are NOT touched. The existing Tailwind v4 `@theme` block in `apps/web/src/styles.css` (primary ramp, `n50`–`n900` neutrals, semantic bg/text pairs) already serves as the "UI template colors" system — this change only consumes those tokens, it doesn't add or restyle them.

## 2. Backend — `GET /dashboard/stats`

New `apps/api/src/modules/dashboard/` module, mirroring the shape of `apps/api/src/modules/ai/`:

- `dashboard.module.ts` — imports `BankModule`, `ExamsModule`; registers `DashboardController` + `DashboardStatsService`. Added to `AppModule.imports` in `app.module.ts`.
- `dashboard.controller.ts` — `@Controller('dashboard') @UseGuards(JwtAuthGuard)`, one handler `GET stats` taking `@CurrentUser() user: AuthTokenPayload`.
- `dashboard-stats.service.ts` — calls into `BankRepository` and `ExamsRepository` (new methods below), assembles the response.

Response shape:
```ts
interface DashboardStats {
  bank: {
    total: number;
    byDifficulty: Record<Difficulty, number>; // easy | medium | hard
    byStatus: Record<QuestionStatus, number>; // draft | approved | archived
  };
  exams: {
    total: number;
    byStatus: Record<ExamStatus, number>; // draft | ready
    recent: Array<{ id: string; title: string; status: ExamStatus; createdAt: string }>;
  };
  aiDrafts: { pending: number };
}
```

New repository methods, following the grouped-aggregate style already used in `exams.repository.ts:431` (`countStock`):
- `BankRepository.countByDifficultyAndStatus(tenantId)` — one `select({ difficulty, status, total: count() }).groupBy(difficulty, status)` query, tenant-scoped like `listQuestions`.
- `ExamsRepository.countByStatus(tenantId)` — same grouped-count pattern over `exams`, mirrors `listExams`'s `count()` usage (`exams.repository.ts:335`).
- `ExamsRepository.listRecent(tenantId, limit)` — reuses `listExams`'s query builder with `orderBy(desc(exams.createdAt))` and no filters.

`aiDrafts.pending` reuses the same query `DraftCountService` already triggers today (`bank status=draft` count) — implemented as `BankRepository.countByDifficultyAndStatus` already gives this for free (sum of `byStatus.draft`), so no separate query needed.

## 3. Frontend — shell restyle

`apps/web/src/app/ui/sidebar/sidebar.component.ts` and `.../topbar/topbar.component.ts`: Tailwind class changes only, no `@Input`/`@Output` (signal `input`/`output`) API changes, no new files.

- Sidebar: confirm 240px width (`w-[240px]` equivalent already close via `w-60`), section labels (`MENU`/`OTHERS`-style uppercase small caps — already present as group titles), active-item pill background using `--color-tint-activo`/`--color-tint-texto` (already defined, unused today — this migration is what puts them to use), icon+label row spacing/padding to match Figma's denser 42px row height.
- Topbar: search input already likely absent — confirm; add `bg-n50 rounded-field h-8` search field matching Figma's `Input Search`, keep existing `[actions]` projection slot (user menu) working as-is, align avatar to 32px circle.

No new components. No route changes to existing pages — this only touches the two shell primitives, so `bank`, `exams`, `ai/*`, `settings` inherit the restyle automatically since they're all rendered through `ShellComponent`.

## 4. Frontend — new Dashboard page

- Route: `apps/web/src/app/app.routes.ts` — add `{ path: 'dashboard', component: DashboardComponent }` as a child of the `app` route, and change the `app` route's own `path` behavior so `/app` redirects to `/app/dashboard` (`{ path: '', pathMatch: 'full', redirectTo: 'dashboard' }` as first child). Add "Dashboard" as the first item in `ShellComponent`'s `PRINCIPAL_GROUP`.
- `apps/web/src/app/features/dashboard/dashboard.component.ts` + `.html` — standalone, `OnPush`, signal-based, mirrors `bank-list.component.ts`'s shape (inject service, load in constructor/`effect`, render via `ui-card`).
- `apps/web/src/app/features/dashboard/dashboard.service.ts` — mirrors `bank.service.ts`: `inject(HttpClient)`, one `getStats(): Observable<DashboardStats>` hitting `GET ${apiBaseUrl}/dashboard/stats`.
- `apps/web/src/app/features/dashboard/dashboard.models.ts` — the `DashboardStats` interface (mirrors backend shape; shared via `@exams-generator/shared` only if the type is genuinely reused elsewhere — otherwise kept local, per YAGNI).

Cards (each a `ui-card`):
1. **Banco de preguntas** — total + bar chart (byDifficulty).
2. **Exámenes** — total + donut chart (byStatus) + `recent` list (title, status tag, date).
3. **Cola de revisión IA** — stat tile (`aiDrafts.pending`), links to `/app/ai/review`.

## 5. Charts

Add `chart.js` + `ng2-charts` (confirmed absent from `package.json`/lockfile today). Two new thin wrapper components, following the existing `ui/*` primitive pattern (standalone, inline template, signal inputs):
- `apps/web/src/app/ui/bar-chart/bar-chart.component.ts` — wraps `ng2-charts`' `BaseChartDirective`, `data = input.required<{label: string; value: number}[]>()`.
- `apps/web/src/app/ui/donut-chart/donut-chart.component.ts` — same shape, doughnut type.

Both read colors from the existing `@theme` tokens (resolved via `getComputedStyle` or hardcoded to the token's hex at build time — implementation detail for the plan) — no new palette introduced.

## 6. Testing

- Backend: `dashboard-stats.service.spec.ts` (unit, fake repositories) + `dashboard.e2e.spec.ts` (mirrors `ai.e2e.spec.ts`'s `buildApp`/migration/seed/supertest pattern).
- Frontend: `dashboard.component.spec.ts` (fake `DashboardService`, mirrors `bank-upload.component.spec.ts`'s `setup()` pattern). Chart wrapper components get a minimal render spec each (input → no throw, correct dataset length) — no visual/pixel testing.

## 7. Out of scope

- Any change to `@theme` color tokens.
- Restyling page *content* beyond the shell chrome (bank list, exam builder, etc. keep their current internal layout — only the surrounding sidebar/topbar changes).
- Literal recreation of Figma's food-domain content (revenue in IDR, "Most Ordered Food", ratings) — replaced by domain-appropriate equivalents per §4.
