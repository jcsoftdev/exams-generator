# Review Queue Draft Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the inert "Editar" button in `ai-review-queue.component` so a teacher can edit any field of an AI-generated draft (taxonomy, enunciado, alternatives, clave, figureCode) before approving, with an "Editar con IA" assist box — mirroring `bank-list.component`'s already-shipped edit form.

**Architecture:** Frontend-only. Backend already supports everything needed (`PATCH /bank/questions/:id` accepts `draft` status and `figureCode`; `POST /ai/questions/:id/revise` already returns `figureCode`) — verified directly in the spec (`docs/superpowers/specs/2026-07-20-review-queue-editing-design.md`). Work is: (1) two one-line TypeScript model extensions the frontend never typed, (2) an inline edit-mode form in `ai-review-queue.component` that replaces the preview panel while editing, reusing `ui-select`/`ui-input`/`ui-button` and the exact signal-naming convention `bank-list.component` established.

**Tech Stack:** Angular (standalone components, signals), vitest (`ng test`), RxJS.

## Global Constraints

- `DraftQuestion` is ALWAYS `type: 'structured'` (design doc §5.2 — AI never generates image questions) — no image/OCR branch needed anywhere in this plan, unlike `bank-list`'s edit form.
- `UpdateQuestionPayload` never carries `courseId` — the backend derives course from `topicId` server-side. `editCourseId` is a client-only signal that filters the tema dropdown; never sent in the PATCH body.
- The AI-revise box NEVER calls `saveEdit()` itself — it only populates the edit-form signals. The teacher must explicitly press Guardar. This is the same "AI never publishes directly" guarantee as every other AI-assist flow in this codebase — do not weaken it.
- `correctAnswer` is a 0-based INDEX string ("0"-"4") everywhere in this flow (edit form, `UpdateQuestionPayload`, `AiRevisedQuestion`) — never a letter. `ai-review-queue.component.ts` already has `letterFor()` for DISPLAY-only conversion in read mode; the edit form works in raw index strings, matching `bank-list`'s `editCorrectAnswer` convention exactly.
- Run `ng test` from `apps/web/` for every verification step in this plan (not raw `vitest run` — the project's Angular test environment setup only loads through the `ng test` builder, confirmed during this session: raw `vitest run --include=...` failed with `TestBed.initTestEnvironment()` errors).

---

### Task 1: Extend frontend models + cache full taxonomy for the edit form's selects

**Files:**
- Modify: `apps/web/src/app/features/bank/bank.models.ts:126-133` (`UpdateQuestionPayload`)
- Modify: `apps/web/src/app/features/ai/ai.models.ts:135-139` (`AiRevisedQuestion`)
- Modify: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.ts`
- Test: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts`

**Interfaces:**
- Produces: `UpdateQuestionPayload.figureCode?: string`, `AiRevisedQuestion.figureCode?: string | null`, `AiReviewQueueComponent.courseOptions: Signal<SelectOption<string>[]>`, `AiReviewQueueComponent.editTopicOptions: Signal<SelectOption<string>[]>`, `AiReviewQueueComponent.difficultyOptions: SelectOption<Difficulty>[]`, `AiReviewQueueComponent.gradeLevelOptions: SelectOption<string>[]` — Task 2 consumes all four directly in the template.

- [ ] **Step 1: Extend `UpdateQuestionPayload` with `figureCode`**

In `apps/web/src/app/features/bank/bank.models.ts`, find:

```ts
export interface UpdateQuestionPayload {
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly gradeLevel?: string;
  readonly correctAnswer?: string;
  readonly bodyTypst?: string;
  readonly alternatives?: readonly string[];
}
```

Replace with:

```ts
export interface UpdateQuestionPayload {
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly gradeLevel?: string;
  readonly correctAnswer?: string;
  readonly bodyTypst?: string;
  readonly alternatives?: readonly string[];
  readonly figureCode?: string;
}
```

- [ ] **Step 2: Extend `AiRevisedQuestion` with `figureCode`**

In `apps/web/src/app/features/ai/ai.models.ts`, find:

```ts
export interface AiRevisedQuestion {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
}
```

Replace with:

```ts
export interface AiRevisedQuestion {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly figureCode?: string | null;
}
```

These are pure type additions (optional fields) — no existing code breaks, no test needed for the interfaces themselves. The behavior they enable is tested in Task 3/4.

- [ ] **Step 3: Write the failing test for cached full-taxonomy options**

In `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts`, add after the `'resolves course/topic names via TaxonomyService...'` test (currently ending around line 152):

```ts
  it('exposes the full taxonomy as select options for the edit form (no extra HTTP call beyond the initial load)', () => {
    const { fixture, getCourses } = setup();
    const component = fixture.componentInstance as unknown as {
      courseOptions: () => { value: string; label: string }[];
      editTopicOptions: () => { value: string; label: string }[];
      editCourseId: { set: (v: string) => void };
    };

    expect(component.courseOptions()).toEqual([{ value: 'c1', label: 'Biología' }]);

    component.editCourseId.set('c1');
    expect(component.editTopicOptions()).toEqual([{ value: 't1', label: 'Célula' }]);

    expect(getCourses).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd apps/web && ng test --watch=false`
Expected: FAIL — `courseOptions`/`editTopicOptions`/`editCourseId` don't exist on `AiReviewQueueComponent`.

- [ ] **Step 5: Add taxonomy caching + option computeds to the component**

In `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.ts`, update the imports at the top:

```ts
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { forkJoin, map, of, switchMap } from 'rxjs';
import { LucideAngularModule } from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { TagVariant } from '../../../ui/ui.types';
import { ModalComponent } from '../../../ui/modal/modal.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { InputComponent } from '../../../ui/input/input.component';
import { AiService } from '../ai.service';
import { DraftQuestion, GRADE_LEVELS, GRADE_LEVEL_LABELS, GradeLevel } from '../ai.models';
import { DraftCountService } from '../draft-count.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
```

**Do NOT add `BankService`/`UpdateQuestionPayload` imports or a `bankService` injection here.** They belong in Task 3 (where `saveEdit()` actually calls `bankService.updateQuestion(...)`), not this task. This repo's `tsconfig.base.json` has `noUnusedLocals: true`, which rejects (TS6133) a private field or import that's never read — adding the injection here, unused until Task 3, does not compile without an ugly suppression workaround. (Corrected after Task 1's first implementation attempt hit exactly this — see `.superpowers/sdd/progress.md`.)

Update the `@Component` decorator's `imports` array — find:

```ts
  imports: [ButtonComponent, EmptyStateComponent, TagComponent, ModalComponent, LucideAngularModule],
```

Replace with:

```ts
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    TagComponent,
    ModalComponent,
    SelectComponent,
    InputComponent,
    LucideAngularModule,
  ],
```

Add the `bankService` injection next to the existing ones — find:

```ts
  private readonly aiService = inject(AiService);
  private readonly taxonomyService = inject(TaxonomyService);
```

Replace with:

```ts
  private readonly aiService = inject(AiService);
  private readonly bankService = inject(BankService);
  private readonly taxonomyService = inject(TaxonomyService);
```

Add option lists and the raw taxonomy cache — find the existing:

```ts
  protected readonly courseNames = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly topicNames = signal<ReadonlyMap<string, string>>(new Map());
```

Replace with:

```ts
  protected readonly courseNames = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly topicNames = signal<ReadonlyMap<string, string>>(new Map());
  /** Full taxonomy (every course/topic), cached from the same `loadTaxonomy()` fetch already used for row labels — reused by the edit form's selects so opening the editor never triggers a new HTTP call (same pattern as bank-list.component). */
  private readonly courses = signal<readonly Course[]>([]);
  private readonly topics = signal<readonly Topic[]>([]);

  protected readonly gradeLevelOptions: SelectOption<string>[] = GRADE_LEVELS.map((gradeLevel) => ({
    value: gradeLevel,
    label: GRADE_LEVEL_LABELS[gradeLevel],
  }));
  protected readonly difficultyOptions: SelectOption<Difficulty>[] = Object.values(Difficulty).map(
    (difficulty) => ({ value: difficulty, label: DIFFICULTY_LABELS[difficulty] }),
  );

  protected readonly courseOptions = computed<SelectOption<string>[]>(() =>
    this.courses().map((course) => ({ value: course.id, label: course.name })),
  );
```

Add the edit-mode signals — insert right after the block above (still inside the class, before `constructor()`):

```ts
  // --- Draft editing ---------------------------------------------------------
  protected readonly editing = signal(false);
  protected readonly editSaving = signal(false);
  protected readonly editError = signal<string | null>(null);
  protected readonly editCourseId = signal('');
  protected readonly editTopicId = signal('');
  protected readonly editDifficulty = signal<Difficulty | null>(null);
  protected readonly editGradeLevel = signal<string | null>(null);
  /** 0-based INDEX string ("0"-"4") — same canonical format as `UpdateQuestionPayload.correctAnswer`, never a letter. See Global Constraints. */
  protected readonly editCorrectAnswer = signal('');
  protected readonly editBody = signal('');
  protected readonly editAlternatives = signal('');
  protected readonly editFigureCode = signal('');

  /** `topics()` (the full unscoped catalog) filtered live to the edit form's currently selected curso — no extra HTTP call on curso change (mirrors bank-list.component). */
  protected readonly editTopicOptions = computed<SelectOption<string>[]>(() =>
    this.topics()
      .filter((topic) => topic.courseId === this.editCourseId())
      .map((topic) => ({ value: topic.id, label: topic.name })),
  );
  protected readonly editCorrectAnswerOptions = computed<SelectOption<string>[]>(() =>
    this.editAlternativesList().map((text, index) => ({
      value: String(index),
      label: `${String.fromCharCode(97 + index)}) ${text}`,
    })),
  );

  // --- Editar con IA -----------------------------------------------------------
  protected readonly aiInstruction = signal('');
  protected readonly revising = signal(false);
  protected readonly aiError = signal<string | null>(null);
```

Add the top-level `DIFFICULTY_LABELS` re-use — this constant already exists at the top of the file (used by `difficultyLabel()`); no change needed there, `difficultyOptions` above reuses it directly since it's in the same module scope.

Finally, update `loadTaxonomy()` to ALSO cache the raw arrays — find:

```ts
  private loadTaxonomy(): void {
    this.taxonomyService
      .getCourses()
      .pipe(
        switchMap((courses) => {
          const topics$ = courses.length
            ? forkJoin(courses.map((course) => this.taxonomyService.getTopics(course.id)))
            : of([]);
          return topics$.pipe(
            map((topicsByCourse) => ({
              courseNames: new Map(courses.map((course) => [course.id, course.name])),
              topicNames: new Map(topicsByCourse.flat().map((topic) => [topic.id, topic.name])),
            })),
          );
        }),
      )
      .subscribe({
        next: ({ courseNames, topicNames }) => {
          this.courseNames.set(courseNames);
          this.topicNames.set(topicNames);
        },
        error: () => {
          /* rows fall back to raw ids — see courseTopicLabel() */
        },
      });
  }
```

Replace with:

```ts
  private loadTaxonomy(): void {
    this.taxonomyService
      .getCourses()
      .pipe(
        switchMap((courses) => {
          const topics$ = courses.length
            ? forkJoin(courses.map((course) => this.taxonomyService.getTopics(course.id)))
            : of([]);
          return topics$.pipe(
            map((topicsByCourse) => ({
              courses,
              topics: topicsByCourse.flat(),
              courseNames: new Map(courses.map((course) => [course.id, course.name])),
              topicNames: new Map(topicsByCourse.flat().map((topic) => [topic.id, topic.name])),
            })),
          );
        }),
      )
      .subscribe({
        next: ({ courses, topics, courseNames, topicNames }) => {
          this.courses.set(courses);
          this.topics.set(topics);
          this.courseNames.set(courseNames);
          this.topicNames.set(topicNames);
        },
        error: () => {
          /* rows fall back to raw ids — see courseTopicLabel() */
        },
      });
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/web && ng test --watch=false`
Expected: PASS — including the new test and all 16 previously-passing tests in this file.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/bank/bank.models.ts apps/web/src/app/features/ai/ai.models.ts apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.ts apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts
git commit -m "feat(web): cache full taxonomy and add figureCode to edit models for review-queue editing"
```

---

### Task 2: `startEdit`/`cancelEdit` + edit-mode template skeleton (taxonomy, enunciado, alternativas)

**Files:**
- Modify: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.ts`
- Modify: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.html`
- Test: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts`

**Interfaces:**
- Consumes: `courseOptions`, `editTopicOptions`, `difficultyOptions`, `gradeLevelOptions`, `editCorrectAnswerOptions` (Task 1); `DraftQuestion` (existing).
- Produces: `startEdit(draft: DraftQuestion): void`, `cancelEdit(): void`, `onEditCourseChange(courseId: string | null): void` — Task 3's `saveEdit()` and Task 4's `reviseWithAi()` both assume `editing()` is already `true` and every `edit*` signal is seeded.

- [ ] **Step 1: Write the failing tests**

In `ai-review-queue.component.spec.ts`, add:

```ts
  it('starts edit mode from the Editar button, seeding every field from the selected draft', () => {
    const { compiled, fixture } = setup();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeTruthy();
    const enunciado = compiled.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
    expect(enunciado.value).toBe('7. ¿Cuál organelo sintetiza proteínas?\na) Lisosoma b) Ribosoma');
    const alternatives = compiled.querySelector('[data-testid="edit-alternatives"]') as HTMLTextAreaElement;
    expect(alternatives.value).toBe('4\n3');
  });

  it('cancels edit mode without saving, restoring the read-only preview', () => {
    const { compiled, fixture } = setup();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit-cancel"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeFalsy();
    expect(compiled.querySelector('[data-testid="paper-preview"]')).toBeTruthy();
  });

  it('filters the tema dropdown to the edit form\'s selected curso, with no extra HTTP call', () => {
    const { compiled, fixture, getTopics } = setup();
    getTopics.mockClear();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      editTopicOptions: () => { value: string; label: string }[];
    };
    expect(component.editTopicOptions()).toEqual([{ value: 't1', label: 'Célula' }]);
    expect(getTopics).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && ng test --watch=false`
Expected: FAIL — `startEdit`/`cancelEdit` don't exist, `[data-testid="edit"]` has no click handler, `[data-testid="panel-edit-form"]` doesn't exist.

- [ ] **Step 3: Add `startEdit`/`cancelEdit`/`onEditCourseChange` to the component**

In `ai-review-queue.component.ts`, add these methods right after `letterFor()`:

```ts
  /** Flips the panel into edit mode, seeding every edit signal from the given draft. Course/topic options come from the already-cached full taxonomy (Task 1) — no HTTP call. */
  protected startEdit(draft: DraftQuestion): void {
    this.editError.set(null);
    this.editCourseId.set(draft.courseId);
    this.editTopicId.set(draft.topicId);
    this.editDifficulty.set(draft.difficulty);
    this.editGradeLevel.set(draft.gradeLevel);
    this.editCorrectAnswer.set(draft.correctAnswer);
    this.editBody.set(draft.bodyTypst ?? '');
    this.editAlternatives.set((draft.alternatives ?? []).join('\n'));
    this.editFigureCode.set(draft.figureCode ?? '');
    this.resetAiRevise();
    this.editing.set(true);
  }

  /** Curso changed in the edit form: tema is scoped to a course, so it's always reset — the user must re-pick it. */
  protected onEditCourseChange(courseId: string | null): void {
    this.editCourseId.set(courseId ?? '');
    this.editTopicId.set('');
  }

  protected cancelEdit(): void {
    this.editing.set(false);
    this.editError.set(null);
    this.resetAiRevise();
  }

  private resetAiRevise(): void {
    this.aiInstruction.set('');
    this.revising.set(false);
    this.aiError.set(null);
  }

  private editAlternativesList(): string[] {
    return this.editAlternatives()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
```

- [ ] **Step 4: Add the edit-mode template block**

In `ai-review-queue.component.html`, find the panel block:

```html
        <div class="mb-4">
          @if (previewLoading()) {
            <div data-testid="preview-loading" class="h-[32rem] animate-pulse rounded-card bg-n200"></div>
          } @else if (previewUrl()) {
            <div
              data-testid="paper-preview"
              class="rounded-card border border-paper-border bg-paper-bg p-3 shadow-inner"
            >
              <iframe
                data-testid="preview-frame"
                [src]="previewUrl()"
                class="h-[32rem] w-full rounded bg-white"
                title="Vista previa"
              ></iframe>
              <p class="mt-2 text-center text-xs text-n500">Vista previa real — así se imprimirá.</p>
            </div>
          } @else if (previewFailed()) {
            <div data-testid="preview-fallback" class="rounded-card bg-n100 p-3 text-sm text-n700">
              <p class="mb-2 text-xs text-warn-text">No se pudo generar la vista de impresión; mostramos el contenido.</p>
              <p class="font-medium text-n900">{{ d.bodyTypst }}</p>
              <ul class="mt-2 list-inside list-disc">
                @for (alt of d.alternatives ?? []; track alt) { <li>{{ alt }}</li> }
              </ul>
            </div>
          }
        </div>

        <div class="flex flex-wrap gap-2">
          <div data-testid="approve"><ui-button variant="primary" (clicked)="approve()"><span class="flex items-center gap-1"><lucide-angular name="check" class="h-4 w-4"></lucide-angular>Aprobar</span></ui-button></div>
          <div data-testid="edit"><ui-button variant="ghost"><span class="flex items-center gap-1"><lucide-angular name="pencil" class="h-4 w-4"></lucide-angular>Editar</span></ui-button></div>
          <div data-testid="reject"><ui-button variant="ghost" (clicked)="requestReject()"><span class="flex items-center gap-1 text-hard-text"><lucide-angular name="x" class="h-4 w-4"></lucide-angular>Rechazar</span></ui-button></div>
        </div>
```

Replace with:

```html
        @if (editing()) {
          <div data-testid="panel-edit-form" class="flex flex-col gap-3">
            <ui-select
              label="Curso"
              placeholder="Elige un curso"
              [options]="courseOptions()"
              [value]="editCourseId()"
              (valueChange)="onEditCourseChange($event)"
            ></ui-select>
            <ui-select
              label="Tema"
              placeholder="Elige un tema"
              [options]="editTopicOptions()"
              [value]="editTopicId()"
              (valueChange)="editTopicId.set($event ?? '')"
            ></ui-select>
            <ui-select
              label="Nivel"
              [options]="difficultyOptions"
              [value]="editDifficulty()"
              (valueChange)="editDifficulty.set($event)"
            ></ui-select>
            <ui-select
              label="Grado"
              [options]="gradeLevelOptions"
              [value]="editGradeLevel()"
              (valueChange)="editGradeLevel.set($event)"
            ></ui-select>

            <label class="text-sm text-n700">Enunciado
              <textarea
                data-testid="edit-enunciado"
                class="mt-1 block w-full rounded-field border border-n200 p-2 text-sm"
                rows="3"
                [value]="editBody()"
                (input)="editBody.set($any($event.target).value)"
              ></textarea>
            </label>
            <label class="text-sm text-n700">Alternativas (una por línea)
              <textarea
                data-testid="edit-alternatives"
                class="mt-1 block w-full rounded-field border border-n200 p-2 text-sm"
                rows="4"
                [value]="editAlternatives()"
                (input)="editAlternatives.set($any($event.target).value)"
              ></textarea>
            </label>
            <div data-testid="edit-correct-answer">
              <ui-select
                label="Clave (respuesta correcta)"
                placeholder="Elige la alternativa correcta"
                [options]="editCorrectAnswerOptions()"
                [value]="editCorrectAnswer()"
                (valueChange)="editCorrectAnswer.set($event ?? '')"
              ></ui-select>
            </div>

            @if (editError()) {
              <p class="rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text" role="alert">{{ editError() }}</p>
            }

            <div class="flex gap-2">
              <div data-testid="edit-save">
                <ui-button variant="primary" [disabled]="!editTopicId()" (clicked)="cancelEdit()">Guardar</ui-button>
              </div>
              <div data-testid="edit-cancel">
                <ui-button variant="ghost" (clicked)="cancelEdit()">Cancelar</ui-button>
              </div>
            </div>
          </div>
        } @else {
          <div class="mb-4">
            @if (previewLoading()) {
              <div data-testid="preview-loading" class="h-[32rem] animate-pulse rounded-card bg-n200"></div>
            } @else if (previewUrl()) {
              <div
                data-testid="paper-preview"
                class="rounded-card border border-paper-border bg-paper-bg p-3 shadow-inner"
              >
                <iframe
                  data-testid="preview-frame"
                  [src]="previewUrl()"
                  class="h-[32rem] w-full rounded bg-white"
                  title="Vista previa"
                ></iframe>
                <p class="mt-2 text-center text-xs text-n500">Vista previa real — así se imprimirá.</p>
              </div>
            } @else if (previewFailed()) {
              <div data-testid="preview-fallback" class="rounded-card bg-n100 p-3 text-sm text-n700">
                <p class="mb-2 text-xs text-warn-text">No se pudo generar la vista de impresión; mostramos el contenido.</p>
                <p class="font-medium text-n900">{{ d.bodyTypst }}</p>
                <ul class="mt-2 list-inside list-disc">
                  @for (alt of d.alternatives ?? []; track alt) { <li>{{ alt }}</li> }
                </ul>
              </div>
            }
          </div>

          <div class="flex flex-wrap gap-2">
            <div data-testid="approve"><ui-button variant="primary" (clicked)="approve()"><span class="flex items-center gap-1"><lucide-angular name="check" class="h-4 w-4"></lucide-angular>Aprobar</span></ui-button></div>
            <div data-testid="edit"><ui-button variant="ghost" (clicked)="startEdit(d)"><span class="flex items-center gap-1"><lucide-angular name="pencil" class="h-4 w-4"></lucide-angular>Editar</span></ui-button></div>
            <div data-testid="reject"><ui-button variant="ghost" (clicked)="requestReject()"><span class="flex items-center gap-1 text-hard-text"><lucide-angular name="x" class="h-4 w-4"></lucide-angular>Rechazar</span></ui-button></div>
          </div>
        }
```

Note: `edit-save`'s `(clicked)` is temporarily wired to `cancelEdit()` — Task 3 rewires it to the real `saveEdit()`. This keeps Task 2 independently testable (cancel works, form renders, taxonomy filters correctly) without a save path that doesn't exist yet.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/web && ng test --watch=false`
Expected: PASS — all tests including the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.ts apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.html apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts
git commit -m "feat(web): wire startEdit/cancelEdit and the edit-mode form skeleton in the review queue"
```

---

### Task 3: `saveEdit()` — PATCH via BankService, including figureCode

**Files:**
- Modify: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.ts`
- Modify: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.html`
- Test: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts`

**Interfaces:**
- Consumes: `BankService.updateQuestion(id: string, patch: UpdateQuestionPayload): Observable<BankQuestion>` (existing, unmodified); all `edit*` signals (Task 1/2).
- Produces: `saveEdit(): void` — no further tasks depend on it, this is the terminal save path.

- [ ] **Step 1: Write the failing tests**

In `ai-review-queue.component.spec.ts`, update the `setup()` helper to accept and provide a `BankService` mock. Find:

```ts
function setup(
  over: {
    listImpl?: () => unknown;
    previewImpl?: (id: string) => unknown;
    approveImpl?: () => unknown;
    getCoursesImpl?: () => unknown;
    getTopicsImpl?: (courseId: string) => unknown;
  } = {},
) {
  const listDrafts = vi.fn(over.listImpl ?? (() => of(DRAFTS)));
  const previewDraft = vi.fn(
    over.previewImpl ?? (() => of(new Blob(['%PDF'], { type: 'application/pdf' }))),
  );
  const approveQuestion = vi.fn(over.approveImpl ?? ((id: string) => of({ id })));
  const rejectQuestion = vi.fn((id: string) => of({ id }));
  const getCourses = vi.fn(over.getCoursesImpl ?? (() => of(COURSES)));
  const getTopics = vi.fn(over.getTopicsImpl ?? (() => of(TOPICS_C1)));
  const draftCountSet = vi.fn();
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:pdf-${n++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    imports: [AiReviewQueueComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Check, Pencil, X, Sparkles })),
      { provide: AiService, useValue: { listDrafts, previewDraft, approveQuestion, rejectQuestion } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: DraftCountService, useValue: { set: draftCountSet } },
    ],
  });
  const fixture = TestBed.createComponent(AiReviewQueueComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    listDrafts,
    previewDraft,
    approveQuestion,
    rejectQuestion,
    getCourses,
    getTopics,
    draftCountSet,
  };
}
```

Replace with:

```ts
function setup(
  over: {
    listImpl?: () => unknown;
    previewImpl?: (id: string) => unknown;
    approveImpl?: () => unknown;
    getCoursesImpl?: () => unknown;
    getTopicsImpl?: (courseId: string) => unknown;
    updateQuestionImpl?: (id: string, patch: unknown) => unknown;
    reviseQuestionImpl?: (id: string, instruction: string) => unknown;
  } = {},
) {
  const listDrafts = vi.fn(over.listImpl ?? (() => of(DRAFTS)));
  const previewDraft = vi.fn(
    over.previewImpl ?? (() => of(new Blob(['%PDF'], { type: 'application/pdf' }))),
  );
  const approveQuestion = vi.fn(over.approveImpl ?? ((id: string) => of({ id })));
  const rejectQuestion = vi.fn((id: string) => of({ id }));
  const reviseQuestion = vi.fn(
    over.reviseQuestionImpl ??
      ((id: string) =>
        of({ bodyTypst: 'revisado', alternatives: ['1', '2'], correctAnswer: '0', figureCode: null })),
  );
  const getCourses = vi.fn(over.getCoursesImpl ?? (() => of(COURSES)));
  const getTopics = vi.fn(over.getTopicsImpl ?? (() => of(TOPICS_C1)));
  const updateQuestion = vi.fn(
    over.updateQuestionImpl ?? ((id: string) => of({ id } as unknown)),
  );
  const draftCountSet = vi.fn();
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:pdf-${n++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    imports: [AiReviewQueueComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Check, Pencil, X, Sparkles })),
      {
        provide: AiService,
        useValue: { listDrafts, previewDraft, approveQuestion, rejectQuestion, reviseQuestion },
      },
      { provide: BankService, useValue: { updateQuestion } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: DraftCountService, useValue: { set: draftCountSet } },
    ],
  });
  const fixture = TestBed.createComponent(AiReviewQueueComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    listDrafts,
    previewDraft,
    approveQuestion,
    rejectQuestion,
    reviseQuestion,
    getCourses,
    getTopics,
    updateQuestion,
    draftCountSet,
  };
}
```

Add the import at the top of the spec file — find:

```ts
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
```

Replace with:

```ts
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { BankService } from '../../bank/bank.service';
```

Now add the tests, right after the `'filters the tema dropdown...'` test from Task 2:

```ts
  it('saves the edited draft via BankService.updateQuestion with the full payload including figureCode, then exits edit mode', () => {
    const { compiled, fixture, updateQuestion } = setup();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const enunciado = compiled.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
    enunciado.value = 'Enunciado corregido';
    enunciado.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(updateQuestion).toHaveBeenCalledWith('d1', {
      topicId: 't1',
      difficulty: Difficulty.Medium,
      gradeLevel: 'secundaria_3',
      correctAnswer: '0',
      bodyTypst: 'Enunciado corregido',
      alternatives: ['4', '3'],
      figureCode: undefined,
    });
    expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeFalsy();
  });

  it('sends figureCode in the save payload when the draft has one', () => {
    const { compiled, fixture, updateQuestion } = setup({
      listImpl: () => of([draft({ id: 'd1', figureCode: '#circle((0,0))' })]),
    });
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(updateQuestion).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ figureCode: '#circle((0,0))' }),
    );
  });

  it('shows an error and stays in edit mode when saving fails', () => {
    const { compiled, fixture } = setup({
      updateQuestionImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeTruthy();
    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent).toContain('No se pudo guardar');
  });

  it('reloads the queue and refreshes the preview EXACTLY ONCE after a successful save (reloadAfterSave, not load()+compilePreview double-firing)', () => {
    const { compiled, fixture, listDrafts, previewDraft } = setup();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    listDrafts.mockClear();
    previewDraft.mockClear();

    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(listDrafts).toHaveBeenCalledTimes(1);
    expect(previewDraft).toHaveBeenCalledTimes(1);
    expect(previewDraft).toHaveBeenCalledWith('d1');
  });

  it('keeps the edited draft selected after saving, even when it is not the first item in the queue', () => {
    const { compiled, fixture } = setup();
    const secondItem = compiled.querySelectorAll('[data-testid="review-item"]')[1] as HTMLButtonElement;
    secondItem.click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    // d1's distinctive body text must NOT reappear — a reset-to-first-item
    // regression would show it after the post-save reload.
    expect(compiled.textContent).not.toContain('¿Cuál organelo sintetiza proteínas?');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && ng test --watch=false`
Expected: FAIL — `saveEdit` isn't wired, `edit-save` still calls `cancelEdit()`, `BankService` provider mismatch (component doesn't inject it as a mock-driven dependency the way the test expects — it will actually already be injected from Task 1, so failures here should be purely behavioral: `updateQuestion` never called, no error rendering).

- [ ] **Step 3: Implement `saveEdit()`**

In `ai-review-queue.component.ts`, add the `BankService`/`UpdateQuestionPayload` imports (NOT added in Task 1 — deliberately deferred here, since this is the first step that actually reads them; adding an injected-but-unused field earlier fails to compile under this repo's `noUnusedLocals: true`). Find:

```ts
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
```

Replace with:

```ts
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { BankService } from '../../bank/bank.service';
import { UpdateQuestionPayload } from '../../bank/bank.models';
```

Add the injection next to `taxonomyService` — find:

```ts
  private readonly aiService = inject(AiService);
  private readonly taxonomyService = inject(TaxonomyService);
```

Replace with:

```ts
  private readonly aiService = inject(AiService);
  private readonly bankService = inject(BankService);
  private readonly taxonomyService = inject(TaxonomyService);
```

Then add after `cancelEdit()`:

```ts
  /**
   * Builds `UpdateQuestionPayload` — NEVER `courseId` (the backend derives
   * course from `topicId`, see UpdateQuestionPayload's doc) — and calls
   * `BankService.updateQuestion`. On success: exits edit mode and refreshes
   * the queue via `reloadAfterSave`, which keeps the just-edited draft
   * selected instead of resetting to the first item (see its doc).
   */
  protected saveEdit(): void {
    const draft = this.selected();
    if (!draft || this.editSaving() || !this.editTopicId()) {
      return;
    }
    this.editSaving.set(true);
    this.editError.set(null);

    const patch: UpdateQuestionPayload = {
      topicId: this.editTopicId(),
      difficulty: this.editDifficulty() ?? undefined,
      gradeLevel: this.editGradeLevel() ?? undefined,
      correctAnswer: this.editCorrectAnswer(),
      bodyTypst: this.editBody(),
      alternatives: this.editAlternativesList(),
      figureCode: this.editFigureCode() || undefined,
    };

    this.bankService.updateQuestion(draft.id, patch).subscribe({
      next: () => {
        this.editing.set(false);
        this.editSaving.set(false);
        this.reloadAfterSave(draft.id);
      },
      error: () => {
        this.editSaving.set(false);
        this.editError.set('No se pudo guardar la pregunta. Inténtalo de nuevo.');
      },
    });
  }

  /**
   * Refreshes the drafts list after a successful save WITHOUT resetting
   * selection to the first item — unlike `load()`, which is only correct
   * for the initial mount (`load()`'s `select(drafts[0])` would otherwise
   * both double-fetch the preview and silently snap the UI back to the
   * first draft when the edited one wasn't first in the queue — caught in
   * task review, see `.superpowers/sdd/progress.md`). Keeps the just-edited
   * draft selected (with its fresh saved content) and recompiles its
   * preview exactly once. Mirrors `bank-list.component.ts`'s
   * `finishSaveEdit()`, which solves the identical problem via `search()` +
   * a separate `getQuestion(id)` re-select.
   */
  private reloadAfterSave(savedId: string): void {
    this.aiService.listDrafts().subscribe({
      next: (drafts) => {
        this.drafts.set([...drafts]);
        this.draftCountService.set(drafts.length);
        const stillThere = drafts.find((d) => d.id === savedId);
        if (stillThere) {
          this.selected.set(stillThere);
          this.compilePreview(stillThere.id);
        } else {
          this.selected.set(null);
        }
      },
      error: () => {
        /* row list falls out of sync until the next natural reload — the save itself already succeeded, so this is non-fatal */
      },
    });
  }
```

Rewire the template's Guardar button — in `ai-review-queue.component.html`, find:

```html
              <div data-testid="edit-save">
                <ui-button variant="primary" [disabled]="!editTopicId()" (clicked)="cancelEdit()">Guardar</ui-button>
              </div>
```

Replace with:

```html
              <div data-testid="edit-save">
                <ui-button variant="primary" [loading]="editSaving()" [disabled]="editSaving() || !editTopicId()" (clicked)="saveEdit()">Guardar</ui-button>
              </div>
```

Also add the figura CeTZ textarea and the role="alert" attribute the tests expect — find:

```html
            <div data-testid="edit-correct-answer">
              <ui-select
                label="Clave (respuesta correcta)"
                placeholder="Elige la alternativa correcta"
                [options]="editCorrectAnswerOptions()"
                [value]="editCorrectAnswer()"
                (valueChange)="editCorrectAnswer.set($event ?? '')"
              ></ui-select>
            </div>

            @if (editError()) {
              <p class="rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text" role="alert">{{ editError() }}</p>
            }
```

Replace with:

```html
            <div data-testid="edit-correct-answer">
              <ui-select
                label="Clave (respuesta correcta)"
                placeholder="Elige la alternativa correcta"
                [options]="editCorrectAnswerOptions()"
                [value]="editCorrectAnswer()"
                (valueChange)="editCorrectAnswer.set($event ?? '')"
              ></ui-select>
            </div>
            <label class="text-sm text-n700">Figura (CeTZ) — opcional
              <textarea
                data-testid="edit-figure-code"
                class="mt-1 block w-full rounded-field border border-n200 p-2 font-mono text-xs"
                rows="4"
                [value]="editFigureCode()"
                (input)="editFigureCode.set($any($event.target).value)"
              ></textarea>
            </label>

            @if (editError()) {
              <p class="rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text" role="alert">{{ editError() }}</p>
            }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && ng test --watch=false`
Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.ts apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.html apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts
git commit -m "feat(web): save review-queue draft edits via BankService, including figureCode"
```

---

### Task 4: "Editar con IA" — `reviseWithAi()`

**Files:**
- Modify: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.ts`
- Modify: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.html`
- Test: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts`

**Interfaces:**
- Consumes: `AiService.reviseQuestion(id: string, instruction: string): Observable<AiRevisedQuestion>` (existing, unmodified — now typed with `figureCode` per Task 1).
- Produces: `reviseWithAi(): void` — terminal, no further tasks depend on it.

- [ ] **Step 1: Write the failing tests**

In `ai-review-queue.component.spec.ts`, add:

```ts
  it('revises the draft with AI, populating the edit form WITHOUT saving', () => {
    const { compiled, fixture, reviseQuestion, updateQuestion } = setup({
      reviseQuestionImpl: () =>
        of({
          bodyTypst: 'Enunciado revisado por IA',
          alternatives: ['10', '20', '30'],
          correctAnswer: '2',
          figureCode: '#import "@preview/cetz:0.5.2": canvas, draw',
        }),
    });
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const instructionInput = compiled.querySelector('[data-testid="ai-instruction"] input') as HTMLInputElement;
    instructionInput.value = 'hazla más difícil';
    instructionInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (compiled.querySelector('[data-testid="ai-revise"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(reviseQuestion).toHaveBeenCalledWith('d1', 'hazla más difícil');
    const enunciado = compiled.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
    expect(enunciado.value).toBe('Enunciado revisado por IA');
    const alternatives = compiled.querySelector('[data-testid="edit-alternatives"]') as HTMLTextAreaElement;
    expect(alternatives.value).toBe('10\n20\n30');
    const figureCode = compiled.querySelector('[data-testid="edit-figure-code"]') as HTMLTextAreaElement;
    expect(figureCode.value).toBe('#import "@preview/cetz:0.5.2": canvas, draw');
    expect(updateQuestion).not.toHaveBeenCalled();
  });

  it('shows an error when AI revision fails, without touching the current form values', () => {
    const { compiled, fixture } = setup({
      reviseQuestionImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="ai-revise"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const error = compiled.querySelector('[data-testid="ai-error"]');
    expect(error?.textContent).toContain('No se pudo revisar');
    const enunciado = compiled.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
    expect(enunciado.value).toBe('7. ¿Cuál organelo sintetiza proteínas?\na) Lisosoma b) Ribosoma');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && ng test --watch=false`
Expected: FAIL — no `ai-instruction`/`ai-revise` elements in the template, `reviseWithAi` doesn't exist.

- [ ] **Step 3: Implement `reviseWithAi()`**

In `ai-review-queue.component.ts`, add after `saveEdit()`:

```ts
  /**
   * AI-assisted revision of the draft currently being edited. Populates the
   * edit-form signals (editBody/editAlternatives/editCorrectAnswer/
   * editFigureCode) the same way `startEdit` seeds them — NEVER calls
   * `saveEdit()` itself, so the teacher always reviews the AI's suggestion
   * before it's persisted (same guarantee as bank-list.component's
   * reviseWithAi — see Global Constraints).
   */
  protected reviseWithAi(): void {
    const draft = this.selected();
    if (!draft || this.revising()) {
      return;
    }
    this.revising.set(true);
    this.aiError.set(null);

    this.aiService.reviseQuestion(draft.id, this.aiInstruction()).subscribe({
      next: (revised) => {
        this.editBody.set(revised.bodyTypst);
        this.editAlternatives.set(revised.alternatives.join('\n'));
        this.editCorrectAnswer.set(revised.correctAnswer);
        this.editFigureCode.set(revised.figureCode ?? '');
        this.revising.set(false);
      },
      error: () => {
        this.revising.set(false);
        this.aiError.set('No se pudo revisar la pregunta con IA. Inténtalo de nuevo.');
      },
    });
  }
```

Add the "Editar con IA" box to the template — in `ai-review-queue.component.html`, find:

```html
            <label class="text-sm text-n700">Figura (CeTZ) — opcional
              <textarea
                data-testid="edit-figure-code"
                class="mt-1 block w-full rounded-field border border-n200 p-2 font-mono text-xs"
                rows="4"
                [value]="editFigureCode()"
                (input)="editFigureCode.set($any($event.target).value)"
              ></textarea>
            </label>

            @if (editError()) {
```

Replace with:

```html
            <label class="text-sm text-n700">Figura (CeTZ) — opcional
              <textarea
                data-testid="edit-figure-code"
                class="mt-1 block w-full rounded-field border border-n200 p-2 font-mono text-xs"
                rows="4"
                [value]="editFigureCode()"
                (input)="editFigureCode.set($any($event.target).value)"
              ></textarea>
            </label>

            <div class="flex flex-col gap-2 rounded-field border border-dashed border-primary-300 bg-primary-50/40 p-3">
              <span class="flex items-center gap-1 text-xs font-medium text-primary-700">
                <lucide-angular name="sparkles" class="h-3.5 w-3.5"></lucide-angular>
                Editar con IA
              </span>
              <div data-testid="ai-instruction">
                <ui-input
                  placeholder="hazla más difícil, corrige la figura…"
                  [value]="aiInstruction()"
                  (valueChange)="aiInstruction.set($event)"
                ></ui-input>
              </div>
              <div data-testid="ai-revise" class="self-start">
                <ui-button variant="ghost" [loading]="revising()" [disabled]="revising()" (clicked)="reviseWithAi()">
                  <span class="flex items-center gap-1">
                    <lucide-angular name="sparkles" class="h-4 w-4"></lucide-angular>
                    Revisar con IA
                  </span>
                </ui-button>
              </div>
              @if (aiError()) {
                <p data-testid="ai-error" class="text-sm text-hard-text" role="alert">{{ aiError() }}</p>
              }
            </div>

            @if (editError()) {
```

Add the `Sparkles` icon to the module import used in the template's standalone `LucideAngularModule.pick(...)` — this component doesn't register icons itself (its host app module does), so no component-level change is needed beyond what's already imported; verify by grepping:

```bash
rg -n "Sparkles" apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts
```

The spec's `LucideAngularModule.pick({ Check, Pencil, X, Sparkles })` already includes `Sparkles` (confirmed in the existing spec import list) — no icon registration change needed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && ng test --watch=false`
Expected: PASS — all tests in this file and the full suite.

- [ ] **Step 5: Run the FULL web test suite**

Run: `cd apps/web && ng test --watch=false`
Expected: PASS — 0 failures across all spec files (confirms nothing in `bank-list`/other consumers of `UpdateQuestionPayload`/`AiRevisedQuestion` broke from the Task 1 type extensions).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.ts apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.html apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts
git commit -m "feat(web): add Editar con IA to the review-queue draft editor"
```

---

## Manual Verification (after all 4 tasks)

- [ ] Restart the dev stack (`lsof -nP -iTCP:3012 -sTCP:LISTEN -t | xargs -r kill`, then `pnpm dev` in background) if the API was touched — it wasn't in this plan, so only confirm the web dev server picked up the changes (Angular hot-reloads automatically).
- [ ] In the browser: open Cola de revisión, click Editar on a draft, change the enunciado, add a `figureCode`, click Guardar — confirm the preview updates with the new content.
- [ ] Click Editar again, type an instruction in "Editar con IA", click "Revisar con IA" — confirm the form fields update but nothing is saved until Guardar is pressed.
