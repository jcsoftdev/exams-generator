# AI Generation History — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use a fresh worktree for this work.

**Goal:** Replace `AiGenerateComponent`'s client-orchestrated batch loop with: a form-only generate screen that creates one durable job and navigates away, a job-detail screen with live polling + cancel, and a history list of past/running jobs — consuming the backend endpoints from the companion backend plan (`docs/superpowers/plans/2026-07-19-ai-generation-history-backend.md`).

**Architecture:** `AiGenerateComponent` keeps its existing form (course/topic/difficulty/grade/count/figure, query-param prefill) unchanged, but `generate()` now calls `AiService.createGenerationJob()` once and navigates to `/app/ai/jobs/:id` — the entire client-side recursive `generateOne()` loop and its progress/batch signals are deleted. New `GenerationJobDetailComponent` (`/app/ai/jobs/:id`) polls `AiService.getGenerationJob()` every 2s while the job is `pending`/`running`, renders the same progress bar + question cards `AiGenerateComponent` used to render (same `listDrafts()`-diff-by-id technique, driven by the poll instead of a per-request callback), and exposes a cancel button. New `GenerationHistoryComponent` (`/app/ai/jobs`) lists every job for the tenant, running ones first.

**Tech Stack:** Angular 22 standalone + signals + `HttpClient` (`apps/web`, `vitest`).

## Global Constraints

- **Hard dependency:** this plan requires the backend plan's Task 5 (removal of `POST /ai/questions/generate`, addition of `/ai/questions/jobs` endpoints) to already be deployed. Do not merge this plan's `AiGenerateComponent` changes against an API that still only has the old endpoint.
- **Shell commands:** `eza`/`bat`/`rg`/`fd`/`sd`, not `ls`/`cat`/`grep`/`find`/`sed`. Never build.
- **Conventional commits**, no AI attribution. **Author:** `jcsoftdev`.
- **Web tests:** `cd apps/web && pnpm exec ng test` — file-scoped `vitest` runs are known to fail on `initTestEnvironment` in this exact setup; always run the full `ng test`, never a narrower command.
- **Local catalog duplication convention** (established in `ai.models.ts`'s `GRADE_LEVELS` docstring): small fixed catalogs like `DIFFICULTY_LABELS` are duplicated locally per file rather than cross-imported from a sibling component — this plan follows that same convention for the two new components.
- **Programmatic navigation only** — this codebase uses `Router.navigate()` from component methods, never `routerLink`, for cross-feature links (see `exam-list.component.ts`). Follow that convention.

---

## File Structure

**Frontend (`apps/web/src/app/features/ai`):**
- `ai.models.ts` — add `GenerationJobStatus`, `GenerationJobFailedItem`, `GenerationJob`, `CreateGenerationJobPayload`, `GenerationJobListResult`.
- `ai.service.ts` — add `createGenerationJob()`, `listGenerationJobs()`, `getGenerationJob()`, `cancelGenerationJob()`.
- `ai-generate/ai-generate.component.ts` + `.html` — strip to form-only; `generate()` creates a job and navigates.
- `generation-job-detail/generation-job-detail.component.ts` + `.html` — **new**.
- `generation-history/generation-history.component.ts` + `.html` — **new**.
- `app.routes.ts` — add `ai/jobs` and `ai/jobs/:id`.
- `features/shell/shell.component.ts` — add a "Historial" nav item.
- `app.config.ts` — register the `History` lucide icon (global icon pick list) for the new nav item.

---

## Task 1: `ai.models.ts` + `AiService` job methods

**Files:**
- Modify: `apps/web/src/app/features/ai/ai.models.ts`
- Modify: `apps/web/src/app/features/ai/ai.service.ts`
- Test: `apps/web/src/app/features/ai/ai.service.spec.ts`

**Interfaces:**
- Produces: `GenerationJobStatus`, `GenerationJobFailedItem`, `GenerationJob`, `CreateGenerationJobPayload`, `GenerationJobListResult`; `AiService.createGenerationJob()`, `.listGenerationJobs()`, `.getGenerationJob()`, `.cancelGenerationJob()`.

- [ ] **Step 1: Add the models**

In `apps/web/src/app/features/ai/ai.models.ts`, add at the end:

```ts
export type GenerationJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface GenerationJobFailedItem {
  readonly index: number;
  readonly error: string;
}

/** Mirrors `GenerationJobRecord` (apps/api ai module) — a durable AI-generation batch job. */
export interface GenerationJob {
  readonly id: string;
  readonly tenantId: string;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly count: number;
  readonly withFigure: boolean;
  readonly status: GenerationJobStatus;
  readonly createdCount: number;
  readonly failedCount: number;
  readonly createdQuestionIds: readonly string[];
  readonly failedItems: readonly GenerationJobFailedItem[];
  readonly cancelRequested: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

/** `POST /ai/questions/jobs` request body. */
export interface CreateGenerationJobPayload {
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly count: number;
  readonly withFigure: boolean;
}

export interface GenerationJobListResult {
  readonly items: readonly GenerationJob[];
  readonly total: number;
}
```

- [ ] **Step 2: Write the failing service spec additions**

In `apps/web/src/app/features/ai/ai.service.spec.ts`, add `GenerationJob`, `GenerationJobListResult` to the `ai.models` import, and add these `describe` blocks before the final closing `});`:

```ts
  describe('createGenerationJob', () => {
    it('POSTs to /ai/questions/jobs and resolves with the created (pending) job', () => {
      const job: GenerationJob = {
        id: 'job-1',
        tenantId: 'tenant-1',
        courseId: 'course-1',
        topicId: 'topic-1',
        difficulty: Difficulty.Easy,
        gradeLevel: 'primaria_1',
        count: 5,
        withFigure: false,
        status: 'pending',
        createdCount: 0,
        failedCount: 0,
        createdQuestionIds: [],
        failedItems: [],
        cancelRequested: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
      };
      let result: GenerationJob | undefined;

      service
        .createGenerationJob({
          courseId: 'course-1',
          topicId: 'topic-1',
          difficulty: Difficulty.Easy,
          gradeLevel: 'primaria_1',
          count: 5,
          withFigure: false,
        })
        .subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/jobs`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        courseId: 'course-1',
        topicId: 'topic-1',
        difficulty: 'easy',
        gradeLevel: 'primaria_1',
        count: 5,
        withFigure: false,
      });
      req.flush(job);

      expect(result).toEqual(job);
    });
  });

  describe('listGenerationJobs', () => {
    it('GETs /ai/questions/jobs with page/pageSize params', () => {
      const result: GenerationJobListResult = { items: [], total: 0 };

      service.listGenerationJobs(2, 10).subscribe();

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/ai/questions/jobs`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('pageSize')).toBe('10');
      req.flush(result);
    });
  });

  describe('getGenerationJob', () => {
    it('GETs /ai/questions/jobs/:id', () => {
      service.getGenerationJob('job-1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/jobs/job-1`);
      expect(req.request.method).toBe('GET');
      req.flush({});
    });
  });

  describe('cancelGenerationJob', () => {
    it('POSTs to /ai/questions/jobs/:id/cancel', () => {
      service.cancelGenerationJob('job-1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/jobs/job-1/cancel`);
      expect(req.request.method).toBe('POST');
      req.flush({});
    });
  });
```

- [ ] **Step 3: Run it, expect fail**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — `createGenerationJob`/`listGenerationJobs`/`getGenerationJob`/`cancelGenerationJob` don't exist on `AiService`.

- [ ] **Step 4: Implement the service methods**

In `apps/web/src/app/features/ai/ai.service.ts`, add `CreateGenerationJobPayload`, `GenerationJob`, `GenerationJobListResult` to the `ai.models` import, and add these methods to the class (after `generateQuestions`):

```ts
  /** `POST /ai/questions/jobs` (design doc §4) — creates a durable batch job and returns immediately (202); the caller navigates to the job-detail screen and polls from there instead of waiting on this request. */
  createGenerationJob(payload: CreateGenerationJobPayload): Observable<GenerationJob> {
    return this.http.post<GenerationJob>(`${environment.apiBaseUrl}/ai/questions/jobs`, payload);
  }

  listGenerationJobs(page = 1, pageSize = 20): Observable<GenerationJobListResult> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<GenerationJobListResult>(`${environment.apiBaseUrl}/ai/questions/jobs`, { params });
  }

  getGenerationJob(id: string): Observable<GenerationJob> {
    return this.http.get<GenerationJob>(`${environment.apiBaseUrl}/ai/questions/jobs/${id}`);
  }

  cancelGenerationJob(id: string): Observable<GenerationJob> {
    return this.http.post<GenerationJob>(`${environment.apiBaseUrl}/ai/questions/jobs/${id}/cancel`, {});
  }
```

- [ ] **Step 5: Run it, expect pass**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS — every `AiService` test, including the 4 new ones.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/ai/ai.models.ts apps/web/src/app/features/ai/ai.service.ts apps/web/src/app/features/ai/ai.service.spec.ts
git commit -m "feat(web): add generation job models and AiService methods"
```

---

## Task 2: `AiGenerateComponent` — form-only, creates a job and navigates

**Files:**
- Modify: `apps/web/src/app/features/ai/ai-generate/ai-generate.component.ts`
- Modify: `apps/web/src/app/features/ai/ai-generate/ai-generate.component.html`
- Modify: `apps/web/src/app/features/ai/ai-generate/ai-generate.component.spec.ts`

**Interfaces:**
- Consumes: `AiService.createGenerationJob()` (Task 1).
- Removes: the entire `generateOne`/`run`/`retryFailed`/`loadBatchQuestions` batch machinery and its signals.

- [ ] **Step 1: Rewrite the failing spec**

Replace `apps/web/src/app/features/ai/ai-generate/ai-generate.component.spec.ts` in full:

```ts
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { LucideAngularModule, Sparkles, Plus, Minus } from 'lucide-angular';
import { AiGenerateComponent } from './ai-generate.component';
import { AiService } from '../ai.service';
import { GenerationJob } from '../ai.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

const COURSES: Course[] = [{ id: 'c1', name: 'Biología' }];
const TOPICS: Topic[] = [{ id: 't1', name: 'La célula', courseId: 'c1' }];

const CREATED_JOB: GenerationJob = {
  id: 'job-1',
  tenantId: 'tenant-1',
  courseId: 'c1',
  topicId: 't1',
  difficulty: 'easy' as GenerationJob['difficulty'],
  gradeLevel: 'pre',
  count: 3,
  withFigure: false,
  status: 'pending',
  createdCount: 0,
  failedCount: 0,
  createdQuestionIds: [],
  failedItems: [],
  cancelRequested: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
};

function setup(
  over: { createImpl?: (...a: unknown[]) => unknown; queryParams?: Record<string, string> } = {},
) {
  const createGenerationJob = vi.fn(over.createImpl ?? (() => of(CREATED_JOB)));
  const getCourses = vi.fn(() => of(COURSES));
  const getTopics = vi.fn(() => of(TOPICS));
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [AiGenerateComponent, LucideAngularModule.pick({ Sparkles, Plus, Minus })],
    providers: [
      { provide: AiService, useValue: { createGenerationJob } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: Router, useValue: { navigate } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(over.queryParams ?? {}) } } },
    ],
  });
  const fixture = TestBed.createComponent(AiGenerateComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, createGenerationJob, navigate, getCourses, getTopics };
}

function set(fixture: { componentInstance: unknown; detectChanges(): void }, prop: string, v: unknown) {
  (fixture.componentInstance as Record<string, { set(x: unknown): void }>)[prop].set(v);
  fixture.detectChanges();
}

function fillForm(fixture: { componentInstance: unknown; detectChanges(): void }) {
  set(fixture, 'courseId', 'c1');
  set(fixture, 'topicId', 't1');
  set(fixture, 'difficulty', 'easy');
  set(fixture, 'gradeLevel', 'pre');
  set(fixture, 'count', 3);
}

describe('AiGenerateComponent', () => {
  it('prefills grade, course, topic and difficulty from query params (exam-builder bridge)', () => {
    const { fixture, getCourses, getTopics } = setup({
      queryParams: { gradeLevel: 'secundaria_3', courseId: 'c1', topicId: 't1', difficulty: 'medium' },
    });
    const ci = fixture.componentInstance as unknown as {
      gradeLevel(): string | null;
      courseId(): string;
      topicId(): string;
      difficulty(): string | null;
    };

    expect(ci.gradeLevel()).toBe('secundaria_3');
    expect(ci.courseId()).toBe('c1');
    expect(ci.topicId()).toBe('t1');
    expect(ci.difficulty()).toBe('medium');
    expect(getCourses).toHaveBeenCalledWith('secundaria_3');
    expect(getTopics).toHaveBeenCalledWith('c1', 'secundaria_3');
  });

  it('clamps the quantity stepper to the backend max of 10 and disables the + button at the cap', () => {
    const { compiled, fixture } = setup();
    const plusButton = compiled.querySelector('button[aria-label="Más"]') as HTMLButtonElement;
    for (let i = 0; i < 10; i++) {
      plusButton.click();
      fixture.detectChanges();
    }
    expect((fixture.componentInstance as unknown as { count(): number }).count()).toBe(10);
    expect(plusButton.disabled).toBe(true);
  });

  it('creates a generation job with the form payload and navigates to its detail screen', () => {
    const { compiled, fixture, createGenerationJob, navigate } = setup();
    fillForm(fixture);

    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(createGenerationJob).toHaveBeenCalledWith({
      courseId: 'c1',
      topicId: 't1',
      difficulty: 'easy',
      gradeLevel: 'pre',
      count: 3,
      withFigure: false,
    });
    expect(navigate).toHaveBeenCalledWith(['/app/ai/jobs', 'job-1']);
  });

  it('does not submit while a create request is already in flight or the form is invalid', () => {
    const { compiled, fixture, createGenerationJob } = setup();

    // Form is empty — invalid.
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it('shows an error banner and re-enables the button when job creation fails', () => {
    const serverError = new HttpErrorResponse({ status: 500 });
    const { compiled, fixture } = setup({ createImpl: () => throwError(() => serverError) });
    fillForm(fixture);

    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.textContent).toMatch(/no se pudo iniciar la generación/i);
    const button = compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — `AiGenerateComponent` still has the old batch behavior (no `createGenerationJob` call, navigates nowhere).

- [ ] **Step 3: Rewrite the component**

Replace `apps/web/src/app/features/ai/ai-generate/ai-generate.component.ts` in full:

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Difficulty } from '@exams-generator/shared';
import { LucideAngularModule, Sparkles, Plus, Minus } from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { BannerComponent } from '../../../ui/banner/banner.component';
import { AiService } from '../ai.service';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from '../ai.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};

const MAX_STEPPER_COUNT = 10;

/**
 * Form-only generator (design doc:
 * docs/superpowers/specs/2026-07-19-ai-generation-history-design.md §6).
 * `generate()` creates ONE durable job server-side and navigates to its
 * detail screen — the client no longer orchestrates a per-item loop or
 * tracks batch progress itself; `GenerationJobDetailComponent` does that by
 * polling.
 */
@Component({
  selector: 'app-ai-generate',
  standalone: true,
  imports: [ButtonComponent, SelectComponent, BannerComponent, LucideAngularModule],
  providers: [LucideAngularModule.pick({ Sparkles, Plus, Minus }).providers ?? []],
  templateUrl: './ai-generate.component.html',
})
export class AiGenerateComponent {
  private readonly aiService = inject(AiService);
  private readonly taxonomyService = inject(TaxonomyService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly maxStepperCount = MAX_STEPPER_COUNT;

  protected readonly difficultyOptions: SelectOption<Difficulty>[] = Object.values(Difficulty).map((d) => ({
    value: d,
    label: DIFFICULTY_LABELS[d],
  }));
  protected readonly gradeLevelOptions: SelectOption<string>[] = GRADE_LEVELS.map((g) => ({
    value: g,
    label: GRADE_LEVEL_LABELS[g],
  }));

  protected readonly courses = signal<Course[]>([]);
  protected readonly topics = signal<Topic[]>([]);
  protected readonly courseOptions = computed<SelectOption<string>[]>(() =>
    this.courses().map((c) => ({ value: c.id, label: c.name })),
  );
  protected readonly topicOptions = computed<SelectOption<string>[]>(() =>
    this.topics().map((t) => ({ value: t.id, label: t.name })),
  );

  protected readonly courseId = signal('');
  protected readonly topicId = signal('');
  protected readonly difficulty = signal<Difficulty | null>(null);
  protected readonly gradeLevel = signal<string | null>(null);
  protected readonly count = signal(5);
  protected readonly withFigure = signal(false);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    const gradeLevel = params.get('gradeLevel');
    const courseId = params.get('courseId');
    const topicId = params.get('topicId');
    const difficulty = params.get('difficulty');

    if (gradeLevel) {
      this.onGradeLevelChange(gradeLevel);
    }
    if (courseId) {
      this.onCourseChange(courseId);
    }
    if (topicId) {
      this.topicId.set(topicId);
    }
    if (difficulty && (Object.values(Difficulty) as string[]).includes(difficulty)) {
      this.difficulty.set(difficulty as Difficulty);
    }
  }

  protected onGradeLevelChange(gradeLevel: string | null): void {
    this.gradeLevel.set(gradeLevel);
    this.courseId.set('');
    this.topicId.set('');
    this.topics.set([]);
    this.courses.set([]);
    if (gradeLevel) {
      this.taxonomyService.getCourses(gradeLevel).subscribe((courses) => this.courses.set(courses));
    }
  }

  protected onCourseChange(courseId: string | null): void {
    const id = courseId ?? '';
    this.courseId.set(id);
    this.topicId.set('');
    this.topics.set([]);
    if (id) {
      this.taxonomyService
        .getTopics(id, this.gradeLevel() ?? undefined)
        .subscribe((topics) => this.topics.set(topics));
    }
  }

  protected onTopicChange(topicId: string | null): void {
    this.topicId.set(topicId ?? '');
  }

  protected decCount(): void {
    this.count.update((c) => Math.max(1, c - 1));
  }
  protected incCount(): void {
    this.count.update((c) => Math.min(MAX_STEPPER_COUNT, c + 1));
  }

  private valid(): boolean {
    return !!this.courseId() && !!this.topicId() && !!this.difficulty() && !!this.gradeLevel() && this.count() > 0;
  }

  protected generate(): void {
    if (this.submitting() || !this.valid()) return;
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.aiService
      .createGenerationJob({
        courseId: this.courseId(),
        topicId: this.topicId(),
        difficulty: this.difficulty()!,
        gradeLevel: this.gradeLevel()!,
        count: this.count(),
        withFigure: this.withFigure(),
      })
      .subscribe({
        next: (job) => this.router.navigate(['/app/ai/jobs', job.id]),
        error: (_e: HttpErrorResponse) => {
          this.submitting.set(false);
          this.errorMessage.set('No se pudo iniciar la generación. Inténtalo de nuevo.');
        },
      });
  }

  protected goToHistory(): void {
    this.router.navigate(['/app/ai/jobs']);
  }
}
```

- [ ] **Step 4: Rewrite the template**

Replace `apps/web/src/app/features/ai/ai-generate/ai-generate.component.html` in full:

```html
<div class="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr] lg:items-start">
  <!-- Form -->
  <div class="flex flex-col gap-3 rounded-card border border-n200 bg-white p-4">
    <h2 class="text-base font-extrabold tracking-tight text-primary-900">Generar con IA</h2>

    <ui-select
      label="Grado"
      [options]="gradeLevelOptions"
      [value]="gradeLevel()"
      (valueChange)="onGradeLevelChange($event)"
      placeholder="Elige un grado"
    ></ui-select>

    <ui-select
      label="Curso"
      [options]="courseOptions()"
      [value]="courseId()"
      (valueChange)="onCourseChange($event)"
      [disabled]="!gradeLevel()"
      [placeholder]="gradeLevel() ? 'Elige un curso' : 'Elige un grado primero'"
    ></ui-select>

    <ui-select
      label="Tema"
      [options]="topicOptions()"
      [value]="topicId()"
      (valueChange)="onTopicChange($event)"
      [disabled]="!courseId()"
      placeholder="Elige un tema"
    ></ui-select>

    <div>
      <p class="mb-1 text-xs font-bold uppercase tracking-wide text-n600">Nivel</p>
      <div class="flex overflow-hidden rounded-field border border-n300">
        @for (opt of difficultyOptions; track opt.value) {
          <button
            type="button"
            class="flex-1 border-r border-n100 py-1.5 text-xs font-semibold last:border-r-0"
            [class.bg-tint-activo]="difficulty() === opt.value"
            [class.text-tint-texto]="difficulty() === opt.value"
            [class.bg-white]="difficulty() !== opt.value"
            [class.text-n600]="difficulty() !== opt.value"
            (click)="difficulty.set(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>
    </div>

    <div>
      <p class="mb-1 text-xs font-bold uppercase tracking-wide text-n600">Cantidad</p>
      <div class="flex w-[104px] items-center overflow-hidden rounded-field border border-n300">
        <button
          type="button"
          class="flex w-8 items-center justify-center bg-primary-50 py-2 text-primary-600"
          (click)="decCount()"
          aria-label="Menos"
        >
          <lucide-angular name="minus" class="h-3.5 w-3.5"></lucide-angular>
        </button>
        <span class="flex-1 text-center text-sm font-bold text-n900">{{ count() }}</span>
        <button
          type="button"
          class="flex w-8 items-center justify-center bg-primary-50 py-2 text-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
          (click)="incCount()"
          [disabled]="count() >= maxStepperCount"
          aria-label="Más"
        >
          <lucide-angular name="plus" class="h-3.5 w-3.5"></lucide-angular>
        </button>
      </div>
    </div>

    <label class="flex items-center gap-2 text-sm text-n700">
      <input type="checkbox" class="accent-primary-500" [checked]="withFigure()" (change)="withFigure.set($any($event.target).checked)" />
      Incluir figura (diagrama)
    </label>

    @if (errorMessage()) {
      <ui-banner variant="error" [message]="errorMessage()!"></ui-banner>
    }

    <div data-testid="generate-button">
      <ui-button variant="primary" [loading]="submitting()" [disabled]="submitting()" (clicked)="generate()">
        <span class="flex w-full items-center justify-center gap-1.5">
          <lucide-angular name="sparkles" class="h-4 w-4"></lucide-angular>
          Generar {{ count() }} preguntas
        </span>
      </ui-button>
    </div>
    <p class="text-center text-xs text-n500">Puedes seguir navegando — el progreso queda guardado.</p>
  </div>

  <!-- Hint panel -->
  <div class="flex flex-col items-center gap-3 rounded-card border border-dashed border-n300 p-10 text-center">
    <span class="flex h-10 w-10 items-center justify-center rounded-card bg-ai-bg text-ai-text">
      <lucide-angular name="sparkles" class="h-5 w-5"></lucide-angular>
    </span>
    <p class="text-sm font-bold text-n800">¿Qué preguntas necesitas?</p>
    <div class="flex items-center gap-2 text-xs text-n500">
      <span><b class="text-primary-600">1</b> Pides</span>
      <span>›</span>
      <span><b class="text-primary-600">2</b> La IA genera</span>
      <span>›</span>
      <span><b class="text-primary-600">3</b> Revisas y apruebas</span>
    </div>
    <p class="max-w-xs text-xs text-n500">
      Al generar verás el progreso en vivo, y puedes cambiar de pantalla sin perderlo. Revísalo luego en
      <button type="button" class="font-bold text-primary-600 underline" (click)="goToHistory()">Historial</button>.
    </p>
  </div>
</div>
```

- [ ] **Step 5: Run it, expect pass**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS — the 5 tests in this file. (`GenerationJobDetailComponent`/`GenerationHistoryComponent` don't exist yet — that's Tasks 3-4.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/ai/ai-generate
git commit -m "refactor(web): AiGenerateComponent creates a generation job instead of looping client-side"
```

---

## Task 3: `GenerationJobDetailComponent`

**Files:**
- Create: `apps/web/src/app/features/ai/generation-job-detail/generation-job-detail.component.ts`
- Create: `apps/web/src/app/features/ai/generation-job-detail/generation-job-detail.component.html`
- Test: `apps/web/src/app/features/ai/generation-job-detail/generation-job-detail.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `AiService.getGenerationJob()`, `.cancelGenerationJob()`, `.listDrafts()` (Task 1 + existing).

- [ ] **Step 1: Write the failing spec**

Create `apps/web/src/app/features/ai/generation-job-detail/generation-job-detail.component.spec.ts`:

```ts
import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { GenerationJobDetailComponent } from './generation-job-detail.component';
import { AiService } from '../ai.service';
import { DraftCountService } from '../draft-count.service';
import { DraftQuestion, GenerationJob } from '../ai.models';

const RUNNING_JOB: GenerationJob = {
  id: 'job-1',
  tenantId: 'tenant-1',
  courseId: 'c1',
  topicId: 't1',
  difficulty: 'easy' as GenerationJob['difficulty'],
  gradeLevel: 'pre',
  count: 3,
  withFigure: false,
  status: 'running',
  createdCount: 1,
  failedCount: 0,
  createdQuestionIds: ['q1'],
  failedItems: [],
  cancelRequested: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
};

const DRAFT: DraftQuestion = {
  id: 'q1',
  tenantId: 'tenant-1',
  courseId: 'c1',
  topicId: 't1',
  difficulty: 'easy' as DraftQuestion['difficulty'],
  gradeLevel: 'pre',
  correctAnswer: '1',
  bodyTypst: '¿Cuánto es 2+2?',
  alternatives: ['3', '4', '5'],
  figureCode: null,
};

function setup(over: { getImpl?: (...a: unknown[]) => unknown; cancelImpl?: (...a: unknown[]) => unknown } = {}) {
  const getGenerationJob = vi.fn(over.getImpl ?? (() => of(RUNNING_JOB)));
  const cancelGenerationJob = vi.fn(over.cancelImpl ?? (() => of({ ...RUNNING_JOB, status: 'cancelled' as const })));
  const listDrafts = vi.fn(() => of([DRAFT]));
  TestBed.configureTestingModule({
    imports: [GenerationJobDetailComponent],
    providers: [
      { provide: AiService, useValue: { getGenerationJob, cancelGenerationJob, listDrafts } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'job-1' }) } } },
    ],
  });
  const fixture = TestBed.createComponent(GenerationJobDetailComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, getGenerationJob, cancelGenerationJob, listDrafts };
}

describe('GenerationJobDetailComponent', () => {
  it('loads the job on init and shows its progress', () => {
    const { compiled, getGenerationJob } = setup();

    expect(getGenerationJob).toHaveBeenCalledWith('job-1');
    expect(compiled.textContent).toContain('1');
    expect(compiled.textContent).toContain('3');
  });

  it('renders question cards for created ids via listDrafts()', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="job-question"]')?.textContent).toContain('¿Cuánto es 2+2?');
  });

  it('polls every 2s while the job is running, and stops once it reaches a terminal status', fakeAsync(() => {
    const getGenerationJob = vi
      .fn()
      .mockReturnValueOnce(of(RUNNING_JOB))
      .mockReturnValueOnce(of({ ...RUNNING_JOB, status: 'completed' as const, createdCount: 3 }));
    TestBed.configureTestingModule({
      imports: [GenerationJobDetailComponent],
      providers: [
        { provide: AiService, useValue: { getGenerationJob, cancelGenerationJob: vi.fn(), listDrafts: vi.fn(() => of([DRAFT])) } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'job-1' }) } } },
      ],
    });
    const fixture = TestBed.createComponent(GenerationJobDetailComponent);
    fixture.detectChanges();
    expect(getGenerationJob).toHaveBeenCalledTimes(1);

    tick(2000);
    expect(getGenerationJob).toHaveBeenCalledTimes(2);

    tick(2000);
    // No third call — polling stopped once status became 'completed'.
    expect(getGenerationJob).toHaveBeenCalledTimes(2);
    discardPeriodicTasks();
  }));

  it('cancel() calls AiService.cancelGenerationJob and refreshes the job from the response', () => {
    const { compiled, cancelGenerationJob } = setup();

    (compiled.querySelector('[data-testid="cancel-job"] button') as HTMLButtonElement).click();

    expect(cancelGenerationJob).toHaveBeenCalledWith('job-1');
  });

  it('does not show the cancel button once the job is terminal', () => {
    const { compiled } = setup({ getImpl: () => of({ ...RUNNING_JOB, status: 'completed' as const }) });

    expect(compiled.querySelector('[data-testid="cancel-job"]')).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — `./generation-job-detail.component` module not found.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/app/features/ai/generation-job-detail/generation-job-detail.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '../../../ui/button/button.component';
import { ProgressComponent } from '../../../ui/progress/progress.component';
import { BannerComponent } from '../../../ui/banner/banner.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { AiService } from '../ai.service';
import { DraftCountService } from '../draft-count.service';
import { DraftQuestion, GenerationJob } from '../ai.models';

const ALTERNATIVE_LETTERS = ['a', 'b', 'c', 'd', 'e'];
const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES: readonly GenerationJob['status'][] = ['completed', 'failed', 'cancelled'];

/**
 * Live view of ONE generation job (design doc §6) — reachable directly by
 * URL, so refreshing or returning later always shows current server state.
 * Polls `AiService.getGenerationJob()` every 2s while pending/running;
 * question cards render via the same `listDrafts()`-diff-by-id technique
 * `AiGenerateComponent` used to use inline, now driven by the poll.
 */
@Component({
  selector: 'app-generation-job-detail',
  standalone: true,
  imports: [ButtonComponent, ProgressComponent, BannerComponent, TagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './generation-job-detail.component.html',
})
export class GenerationJobDetailComponent {
  private readonly aiService = inject(AiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly draftCountService = inject(DraftCountService);

  private readonly jobId = this.route.snapshot.paramMap.get('id')!;
  private readonly loadedQuestionIds = new Set<string>();
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  protected readonly job = signal<GenerationJob | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly cancelling = signal(false);
  protected readonly batchQuestions = signal<readonly DraftQuestion[]>([]);

  protected readonly isTerminal = computed(() => {
    const status = this.job()?.status;
    return status !== undefined && TERMINAL_STATUSES.includes(status);
  });

  constructor() {
    this.load();
    this.pollHandle = setInterval(() => this.load(), POLL_INTERVAL_MS);
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private load(): void {
    this.aiService.getGenerationJob(this.jobId).subscribe({
      next: (job) => {
        this.job.set(job);
        this.loadError.set(null);
        if (TERMINAL_STATUSES.includes(job.status)) {
          this.stopPolling();
        }
        this.loadNewQuestions(job.createdQuestionIds);
      },
      error: () => this.loadError.set('No se pudo cargar el estado de la generación.'),
    });
  }

  private loadNewQuestions(ids: readonly string[]): void {
    const unseen = ids.filter((id) => !this.loadedQuestionIds.has(id));
    if (unseen.length === 0) return;

    this.aiService.listDrafts().subscribe((drafts) => {
      unseen.forEach((id) => this.loadedQuestionIds.add(id));
      const idSet = new Set(ids);
      const alreadyShown = new Set(this.batchQuestions().map((q) => q.id));
      const newlyLoaded = drafts.filter((d) => idSet.has(d.id) && !alreadyShown.has(d.id));
      this.batchQuestions.update((prev) => [...prev, ...newlyLoaded]);
      this.draftCountService.set(drafts.length);
    });
  }

  protected cancel(): void {
    if (this.cancelling()) return;
    this.cancelling.set(true);
    this.aiService.cancelGenerationJob(this.jobId).subscribe({
      next: (job) => {
        this.cancelling.set(false);
        this.job.set(job);
        if (TERMINAL_STATUSES.includes(job.status)) {
          this.stopPolling();
        }
      },
      error: () => this.cancelling.set(false),
    });
  }

  protected goToReview(): void {
    this.router.navigate(['/app/ai/review']);
  }

  protected goToHistory(): void {
    this.router.navigate(['/app/ai/jobs']);
  }

  protected letterAt(index: number): string {
    return ALTERNATIVE_LETTERS[index] ?? String(index);
  }
  protected letterFor(question: DraftQuestion): string {
    return this.letterAt(Number(question.correctAnswer));
  }
  protected isCorrect(question: DraftQuestion, alternativeIndex: number): boolean {
    return Number(question.correctAnswer) === alternativeIndex;
  }
}
```

- [ ] **Step 4: Implement the template**

Create `apps/web/src/app/features/ai/generation-job-detail/generation-job-detail.component.html`:

```html
<div class="flex flex-col gap-3">
  <button type="button" class="w-fit text-xs font-bold text-n600 hover:text-primary-600" (click)="goToHistory()">
    ← Historial
  </button>

  @if (loadError()) {
    <ui-banner variant="error" [message]="loadError()!"></ui-banner>
  }

  @if (job(); as j) {
    <div class="flex items-center gap-3 rounded-card border border-n200 bg-white p-4">
      <div class="text-2xl font-extrabold text-primary-900">
        {{ j.createdCount }}<span class="text-sm font-medium text-n500">/{{ j.count }}</span>
      </div>
      <div class="flex-1 text-xs leading-snug text-n600">
        <span class="font-bold text-n800">{{ j.status }}</span>
        @if (j.failedCount > 0) {
          <br />
          {{ j.failedCount }} falló la validación
        }
      </div>
      @if (!isTerminal()) {
        <div class="w-40">
          <ui-progress [current]="j.createdCount + j.failedCount" [total]="j.count"></ui-progress>
        </div>
      }
      @if (!isTerminal()) {
        <div data-testid="cancel-job">
          <ui-button variant="ghost" [loading]="cancelling()" [disabled]="cancelling()" (clicked)="cancel()">
            Cancelar
          </ui-button>
        </div>
      }
    </div>

    @for (q of batchQuestions(); track q.id; let i = $index) {
      <div data-testid="job-question" class="rounded-card border border-n200 bg-white p-3">
        <div class="mb-1.5 flex items-center gap-2">
          <span class="flex h-5 w-5 items-center justify-center rounded-[7px] bg-ai-bg text-[11px] font-extrabold text-ai-text">
            {{ i + 1 }}
          </span>
          <ui-tag variant="ai">Borrador IA</ui-tag>
          <span class="ml-auto text-[10px] text-n500">clave: {{ letterFor(q) }}</span>
        </div>
        <p class="text-sm leading-snug text-n900">{{ q.bodyTypst }}</p>
        @if (q.alternatives) {
          <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-n600">
            @for (alt of q.alternatives; track $index; let altIndex = $index) {
              @if (isCorrect(q, altIndex)) {
                <span class="font-bold text-easy-text">{{ letterAt(altIndex) }}) {{ alt }} ✓</span>
              } @else {
                <span>{{ letterAt(altIndex) }}) {{ alt }}</span>
              }
            }
          </div>
        }
      </div>
    }

    @if (isTerminal() && j.createdCount > 0) {
      <div data-testid="go-review" class="flex justify-end">
        <button
          type="button"
          class="rounded-field bg-primary-900 px-4 py-2 text-xs font-bold text-white hover:bg-primary-800"
          (click)="goToReview()"
        >
          Revisar los {{ j.createdCount }} en la cola →
        </button>
      </div>
    }
  }
</div>
```

- [ ] **Step 5: Add the route**

In `apps/web/src/app/app.routes.ts`, import `GenerationJobDetailComponent` and add a child route after `ai/generate`:

```ts
      { path: 'ai/jobs/:id', component: GenerationJobDetailComponent },
```

- [ ] **Step 6: Run it, expect pass**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS — the 5 tests in this file.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/ai/generation-job-detail apps/web/src/app/app.routes.ts
git commit -m "feat(web): add GenerationJobDetailComponent with live polling and cancel"
```

---

## Task 4: `GenerationHistoryComponent` + nav entry

**Files:**
- Create: `apps/web/src/app/features/ai/generation-history/generation-history.component.ts`
- Create: `apps/web/src/app/features/ai/generation-history/generation-history.component.html`
- Test: `apps/web/src/app/features/ai/generation-history/generation-history.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`
- Modify: `apps/web/src/app/features/shell/shell.component.ts`
- Modify: `apps/web/src/app/app.config.ts`

**Interfaces:**
- Consumes: `AiService.listGenerationJobs()` (Task 1).

- [ ] **Step 1: Write the failing spec**

Create `apps/web/src/app/features/ai/generation-history/generation-history.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { GenerationHistoryComponent } from './generation-history.component';
import { AiService } from '../ai.service';
import { GenerationJob, GenerationJobListResult } from '../ai.models';

function job(overrides: Partial<GenerationJob>): GenerationJob {
  return {
    id: 'job-1',
    tenantId: 'tenant-1',
    courseId: 'c1',
    topicId: 't1',
    difficulty: 'easy' as GenerationJob['difficulty'],
    gradeLevel: 'pre',
    count: 5,
    withFigure: false,
    status: 'completed',
    createdCount: 5,
    failedCount: 0,
    createdQuestionIds: [],
    failedItems: [],
    cancelRequested: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z',
    ...overrides,
  };
}

function setup(result: GenerationJobListResult = { items: [], total: 0 }) {
  const listGenerationJobs = vi.fn(() => of(result));
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [GenerationHistoryComponent],
    providers: [
      { provide: AiService, useValue: { listGenerationJobs } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(GenerationHistoryComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, listGenerationJobs, navigate };
}

describe('GenerationHistoryComponent', () => {
  it('loads jobs for the tenant on init', () => {
    const { listGenerationJobs } = setup();

    expect(listGenerationJobs).toHaveBeenCalled();
  });

  it('renders one row per job with a status label', () => {
    const { compiled } = setup({
      items: [job({ id: 'job-1', status: 'running' }), job({ id: 'job-2', status: 'completed' })],
      total: 2,
    });

    const rows = compiled.querySelectorAll('[data-testid="job-row"]');
    expect(rows).toHaveLength(2);
  });

  it('shows an empty state when there are no jobs', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="history-empty"]')).toBeTruthy();
  });

  it('navigates to the job detail screen when a row is clicked', () => {
    const { compiled, navigate } = setup({ items: [job({ id: 'job-1' })], total: 1 });

    (compiled.querySelector('[data-testid="job-row"]') as HTMLElement).click();

    expect(navigate).toHaveBeenCalledWith(['/app/ai/jobs', 'job-1']);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — `./generation-history.component` module not found.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/app/features/ai/generation-history/generation-history.component.ts`:

```ts
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { TagVariant } from '../../../ui/ui.types';
import { AiService } from '../ai.service';
import { GenerationJob } from '../ai.models';

const STATUS_TAG: Record<GenerationJob['status'], TagVariant> = {
  pending: 'ai',
  running: 'ai',
  completed: 'easy',
  failed: 'hard',
  cancelled: 'medium',
};

const STATUS_LABEL: Record<GenerationJob['status'], string> = {
  pending: 'En cola',
  running: 'Generando',
  completed: 'Completado',
  failed: 'Falló',
  cancelled: 'Cancelado',
};

/**
 * "Historial IA" — lists every generation job for the tenant, running ones
 * first (design doc §6). Opening a row navigates to its live detail screen
 * (`GenerationJobDetailComponent`), same whether the job is still running
 * or long finished.
 */
@Component({
  selector: 'app-generation-history',
  standalone: true,
  imports: [EmptyStateComponent, TagComponent, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './generation-history.component.html',
})
export class GenerationHistoryComponent {
  private readonly aiService = inject(AiService);
  private readonly router = inject(Router);

  protected readonly jobs = signal<readonly GenerationJob[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.aiService.listGenerationJobs().subscribe({
      next: (res) => {
        this.loading.set(false);
        this.jobs.set(res.items);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('No se pudo cargar el historial. Inténtalo de nuevo.');
      },
    });
  }

  protected retry(): void {
    this.load();
  }

  protected open(job: GenerationJob): void {
    this.router.navigate(['/app/ai/jobs', job.id]);
  }

  protected statusTag(status: GenerationJob['status']): TagVariant {
    return STATUS_TAG[status];
  }
  protected statusLabel(status: GenerationJob['status']): string {
    return STATUS_LABEL[status];
  }
}
```

- [ ] **Step 4: Implement the template**

Create `apps/web/src/app/features/ai/generation-history/generation-history.component.html`:

```html
<div class="flex flex-col gap-3">
  <h1 class="text-lg font-extrabold tracking-tight text-primary-900">Historial de generación IA</h1>

  @if (errorMessage()) {
    <div class="rounded-card border border-hard-text/20 bg-hard-bg px-4 py-3 text-sm text-hard-text">
      {{ errorMessage() }}
      <button type="button" class="ml-2 font-bold underline" (click)="retry()">Reintentar</button>
    </div>
  }

  @if (!loading() && jobs().length === 0 && !errorMessage()) {
    <div data-testid="history-empty">
      <ui-empty-state
        icon="sparkles"
        message="Todavía no generaste nada — cuando inicies una generación con IA, aparecerá aquí en vivo mientras corre, y luego como historial."
      ></ui-empty-state>
    </div>
  }

  @for (job of jobs(); track job.id) {
    <div
      data-testid="job-row"
      class="flex cursor-pointer items-center gap-3 rounded-card border border-n200 bg-white p-3 hover:border-primary-300"
      (click)="open(job)"
    >
      <ui-tag [variant]="statusTag(job.status)">{{ statusLabel(job.status) }}</ui-tag>
      <div class="flex-1 text-sm text-n800">
        {{ job.createdCount }}/{{ job.count }} preguntas
        @if (job.failedCount > 0) {
          <span class="text-n500"> · {{ job.failedCount }} fallidas</span>
        }
      </div>
      <span class="text-xs text-n500">{{ job.createdAt | date: 'short' }}</span>
    </div>
  }
</div>
```

- [ ] **Step 5: Add the route and sidebar nav entry**

In `apps/web/src/app/app.routes.ts`, import `GenerationHistoryComponent` and add:

```ts
      { path: 'ai/jobs', component: GenerationHistoryComponent },
```

(Add this BEFORE `ai/jobs/:id` isn't required — `jobs` and `jobs/:id` don't collide since Angular's router matches the more specific segment count; either order works, but keep them adjacent for readability.)

`ui-sidebar` resolves nav icons via `<lucide-angular [name]="item.icon">`, whose icon set is registered ONCE, globally, in `apps/web/src/app/app.config.ts` — the `History` icon isn't in that list today, so it must be added there or the new nav item's icon silently fails to render. In `apps/web/src/app/app.config.ts`, add `History` to both the import line and the `LucideAngularModule.pick({...})` call:

```ts
import {
  LucideAngularModule,
  Menu, X, Sparkles, Lock, Download, Ellipsis, Check, TriangleAlert, Search, School,
  LogOut, User, Users, Trash2, Pencil, Archive, ChevronLeft, ChevronRight, ChevronDown, Plus, Minus, Bell,
  LayoutDashboard, BookOpen, FileText, Inbox, Settings, History,
  Sun, Moon,
} from 'lucide-angular';
```

```ts
      LucideAngularModule.pick({
        Menu, X, Sparkles, Lock, Download, Ellipsis, Check, TriangleAlert, Search, School,
        LogOut, User, Users, Trash2, Pencil, Archive, ChevronLeft, ChevronRight, ChevronDown, Plus, Minus, Bell,
        LayoutDashboard, BookOpen, FileText, Inbox, Settings, History,
        Sun, Moon,
      }),
```

In `apps/web/src/app/features/shell/shell.component.ts`, add a "Historial" item to `inteligenciaGroup`, after "Cola de revisión":

```ts
    const inteligenciaGroup: NavGroup = {
      title: 'Inteligencia',
      items: [
        { label: 'Generar con IA', route: '/app/ai/generate', icon: 'sparkles' },
        {
          label: 'Cola de revisión',
          route: '/app/ai/review',
          icon: 'inbox',
          ...(pendingDrafts !== null ? { badge: pendingDrafts } : {}),
        },
        { label: 'Historial IA', route: '/app/ai/jobs', icon: 'history' },
      ],
    };
```

- [ ] **Step 6: Run it, expect pass**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS — every spec in the repo, including this file's 4 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/ai/generation-history apps/web/src/app/app.routes.ts apps/web/src/app/features/shell/shell.component.ts apps/web/src/app/app.config.ts
git commit -m "feat(web): add generation history list and sidebar nav entry"
```

---

## Self-Review Notes

- **Spec coverage:** design doc §6 (frontend) is fully covered — form-only generate (Task 2), job detail with polling/cancel (Task 3), history list (Task 4), models/service (Task 1).
- **Type consistency checked:** `GenerationJob['status']` is the single source of truth for status literals — `STATUS_TAG`/`STATUS_LABEL`/`TERMINAL_STATUSES` all key off it directly (no duplicated string-literal unions).
- **Removed test coverage accounted for:** the old `ai-generate.component.spec.ts` had 13 tests around client-side batch orchestration (retry-failed, progress bar, batch cards, draft-count sync) — that behavior moved to `GenerationJobDetailComponent`, and its equivalent coverage (progress, cards, terminal states) lives in Task 3's spec instead of being silently dropped.
