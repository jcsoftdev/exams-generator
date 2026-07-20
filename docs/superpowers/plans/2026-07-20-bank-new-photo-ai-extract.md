# Bank-New Photo AI-Extract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Extraer con IA" shortcut to the "Foto" tab of `bank-new.component.ts` ("Nueva pregunta") that runs the existing vision-model OCR extraction on the already-picked photo and precarga el tab "Estructurada", instead of forcing the two-step "save as raw image → edit → OCR" flow that exists today.

**Architecture:** Zero backend changes — reuses `POST /ai/questions/extract` via the existing `AiService.extractQuestionFromImage()` (already used by `bank-list.component.ts`'s edit form). All changes are in `bank-new.component.ts`/`.html`/`.spec.ts`.

**Tech Stack:** Angular 18 standalone components, signals + `effect()`, Vitest, RxJS (`of`/`throwError` test doubles), `lucide-angular` icons.

## Global Constraints

- The raw-image save path (`submitPhoto()` / `uploadImageQuestion`) does NOT change — "Extraer con IA" is an optional shortcut, never a replacement (design spec §2).
- No backend changes — `POST /ai/questions/extract`, `AiController`, `ExtractQuestionService` are untouched (design spec §7).
- No changes to `ai-review-queue.component.ts` — out of scope (design spec §7).
- Icon convention: `sparkles` for AI actions (matches `bank-list.component.html:259-272`'s "Editar con IA").
- Button state convention: `ui-button`'s `[loading]`/`[disabled]` inputs (matches `reviseWithAi`/`submitPhoto` — never a hand-rolled spinner).
- `pendingStructuredCourseId`/`pendingStructuredTopicId` mechanism (design spec §3.2) is REQUIRED — do not "simplify" by chaining `.subscribe()` calls after `sGradeLevel.set()` and assuming the last write wins; that races the existing `effect()`s and is proven incorrect for both sync test doubles and real async HTTP (see spec §3.1 for why).

---

## Task 1: Component logic — `extractWithAi()` + the pending-preselect fix to existing effects

**Files:**
- Modify: `apps/web/src/app/features/bank/bank-new/bank-new.component.ts`
- Test: `apps/web/src/app/features/bank/bank-new/bank-new.component.spec.ts`

**Interfaces:**
- Consumes: `AiService.extractQuestionFromImage(image: File): Observable<AiRevisedQuestion>` (`apps/web/src/app/features/ai/ai.service.ts`), `TaxonomyService.getCourses(gradeLevel: string): Observable<Course[]>` / `getTopics(courseId: string, gradeLevel?: string): Observable<Topic[]>` (already injected in this component).
- Produces: `protected extracting: WritableSignal<boolean>`, `protected extractError: WritableSignal<string | null>`, `protected extractWithAi(): void`, `private photoTaxonomyValid(): boolean` — Task 2's template binds directly to these.

- [ ] **Step 1: Add the `AiService` provider + `extractQuestionFromImage` mock to the test `setup()` helper**

In `apps/web/src/app/features/bank/bank-new/bank-new.component.spec.ts`, add the import and extend `setup()`:

```ts
import { AiService } from '../../ai/ai.service';
import { AiRevisedQuestion } from '../../ai/ai.models';
```

Replace the `setup()` function (lines 20-54) with:

```ts
function setup(
  over: {
    uploadImpl?: () => unknown;
    structuredImpl?: () => unknown;
    getCourses?: () => unknown;
    getTopics?: (courseId: string) => unknown;
    extractQuestionFromImageImpl?: (image: File) => unknown;
  } = {},
) {
  const uploadImageQuestion = vi.fn(over.uploadImpl ?? (() => of({ id: 'img-q' })));
  const createStructuredQuestion = vi.fn(over.structuredImpl ?? (() => of({ id: 'str-q' })));
  const getCourses = vi.fn(over.getCourses ?? (() => of(COURSES)));
  const getTopics = vi.fn(
    over.getTopics ?? ((courseId: string) => of(courseId === 'c1' ? TOPICS_C1 : TOPICS_C2)),
  );
  const extracted: AiRevisedQuestion = {
    bodyTypst: 'Enunciado desde imagen',
    alternatives: ['Alt A extraída', 'Alt B extraída'],
    correctAnswer: '1',
  };
  const extractQuestionFromImage = vi.fn(
    over.extractQuestionFromImageImpl ?? (() => of(extracted)),
  );
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [BankNewComponent],
    providers: [
      { provide: BankService, useValue: { uploadImageQuestion, createStructuredQuestion } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: AiService, useValue: { extractQuestionFromImage } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(BankNewComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    uploadImageQuestion,
    createStructuredQuestion,
    getCourses,
    getTopics,
    extractQuestionFromImage,
    navigate,
  };
}
```

- [ ] **Step 2: Write the failing tests for `extractWithAi()` (called directly on the component instance — no template button yet)**

Add these two MODULE-SCOPE helper functions to `bank-new.component.spec.ts`, right after the existing `selectOptionsOf()` function (line 87) and before `describe('BankNewComponent', ...)` — Task 2 reuses both, so they must not be nested inside this task's `describe` block:

```ts
function fillPhotoTaxonomy(fixture: { componentInstance: unknown; detectChanges(): void }) {
  set(fixture, 'pGradeLevel', 'pre');
  set(fixture, 'pCourseId', 'c1');
  set(fixture, 'pTopicId', 't1');
  set(fixture, 'pDifficulty', 'easy');
}

function pickImage(fixture: { detectChanges(): void }, compiled: HTMLElement): File {
  const file = new File(['bytes'], 'foto.png', { type: 'image/png' });
  const nativeFileInput = compiled.querySelector(
    '[data-testid="tab-photo-panel"] input[type="file"]',
  ) as HTMLInputElement;
  Object.defineProperty(nativeFileInput, 'files', { value: [file], configurable: true });
  nativeFileInput.dispatchEvent(new Event('change'));
  fixture.detectChanges();
  return file;
}
```

Append the following `describe` block inside `describe('BankNewComponent', ...)` in `bank-new.component.spec.ts`:

```ts
  describe('extractWithAi (photo tab AI shortcut)', () => {
    it('calls extractQuestionFromImage with the picked file when photo taxonomy + image are complete', () => {
      const { fixture, compiled, extractQuestionFromImage } = setup();
      fillPhotoTaxonomy(fixture);
      const file = pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();

      expect(extractQuestionFromImage).toHaveBeenCalledWith(file);
    });

    it('does nothing if photo taxonomy is incomplete (no image picked)', () => {
      const { fixture, extractQuestionFromImage } = setup();
      fillPhotoTaxonomy(fixture);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();

      expect(extractQuestionFromImage).not.toHaveBeenCalled();
    });

    it('on success: fills sBody/sAlternatives/sCorrectAnswer/sDifficulty, copies course/topic/grade from the photo tab, and switches to the structured tab', () => {
      const { fixture, compiled, getCourses, getTopics } = setup();
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        sBody: () => string;
        sAlternatives: () => string;
        sCorrectAnswer: () => string;
        sDifficulty: () => string;
        sGradeLevel: () => string | null;
        sCourseId: () => string;
        sTopicId: () => string;
        tab: () => string;
        extracting: () => boolean;
      };
      expect(instance.sBody()).toBe('Enunciado desde imagen');
      expect(instance.sAlternatives()).toBe('Alt A extraída\nAlt B extraída');
      expect(instance.sCorrectAnswer()).toBe('1');
      expect(instance.sDifficulty()).toBe('easy');
      expect(instance.sGradeLevel()).toBe('pre');
      expect(getCourses).toHaveBeenCalledWith('pre');
      expect(instance.sCourseId()).toBe('c1');
      expect(getTopics).toHaveBeenCalledWith('c1', 'pre');
      expect(instance.sTopicId()).toBe('t1');
      expect(instance.tab()).toBe('structured');
      expect(instance.extracting()).toBe(false);
    });

    it('on error: sets extractError, stays on the photo tab, and resets extracting()', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        extractError: () => string | null;
        tab: () => string;
        extracting: () => boolean;
      };
      expect(instance.extractError()).toBe('No se pudo leer la pregunta desde la imagen. Inténtalo de nuevo.');
      expect(instance.tab()).toBe('photo');
      expect(instance.extracting()).toBe(false);
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/web && pnpm exec vitest run src/app/features/bank/bank-new/bank-new.component.spec.ts`
Expected: FAIL — `extractWithAi` is not a function (method doesn't exist yet), plus the `AiService` provider being unused is harmless at this stage.

- [ ] **Step 4: Implement — inject `AiService`, add signals, add the pending-preselect fields, patch the two existing effects, add `photoTaxonomyValid()` + `extractWithAi()`**

In `apps/web/src/app/features/bank/bank-new/bank-new.component.ts`:

Add the import (alongside the existing `BankService`/`TaxonomyService` imports):

```ts
import { AiService } from '../../ai/ai.service';
```

Add the injected service (alongside `private readonly taxonomyService = inject(TaxonomyService);`):

```ts
  private readonly aiService = inject(AiService);
```

Add two new signals right after `protected readonly saveError = signal<string | null>(null);`:

```ts
  protected readonly extracting = signal(false);
  protected readonly extractError = signal<string | null>(null);
```

Add two new private fields (not signals) near the other `p*`/`s*` state, e.g. right before the `constructor()`:

```ts
  /**
   * Consumed once by the `sGradeLevel`/`sCourseId` effects below — lets
   * `extractWithAi()` tell those effects which course/topic id to
   * preselect instead of blanking to `''` on the next reset. See design
   * doc `docs/superpowers/specs/2026-07-20-bank-new-photo-ai-extract-design.md`
   * §3.1-3.2 for why this can't be done by racing `.subscribe()` calls.
   */
  private pendingStructuredCourseId: string | null = null;
  private pendingStructuredTopicId: string | null = null;
```

Replace the structured-tab course-loading effect (currently):

```ts
    effect(() => {
      const gradeLevel = this.sGradeLevel();
      this.sCourseId.set('');
      this.sCourses.set([]);
      if (!gradeLevel) return;
      this.taxonomyService.getCourses(gradeLevel).subscribe({
        next: (courses) => this.sCourses.set(courses),
        error: () => this.saveError.set('No se pudieron cargar los cursos. Recarga la página.'),
      });
    });
```

with:

```ts
    effect(() => {
      const gradeLevel = this.sGradeLevel();
      const preselectCourseId = this.pendingStructuredCourseId ?? '';
      this.pendingStructuredCourseId = null;
      this.sCourseId.set(preselectCourseId);
      this.sCourses.set([]);
      if (!gradeLevel) return;
      this.taxonomyService.getCourses(gradeLevel).subscribe({
        next: (courses) => this.sCourses.set(courses),
        error: () => this.saveError.set('No se pudieron cargar los cursos. Recarga la página.'),
      });
    });
```

Replace the structured-tab topic-loading effect (currently):

```ts
    effect(() => {
      const courseId = this.sCourseId();
      this.sTopicId.set('');
      this.sTopics.set([]);
      if (!courseId) return;
      this.taxonomyService.getTopics(courseId, this.sGradeLevel() ?? undefined).subscribe({
        next: (topics) => this.sTopics.set(topics),
        error: () => this.saveError.set('No se pudieron cargar los temas. Inténtalo de nuevo.'),
      });
    });
```

with:

```ts
    effect(() => {
      const courseId = this.sCourseId();
      const preselectTopicId = this.pendingStructuredTopicId ?? '';
      this.pendingStructuredTopicId = null;
      this.sTopicId.set(preselectTopicId);
      this.sTopics.set([]);
      if (!courseId) return;
      this.taxonomyService.getTopics(courseId, this.sGradeLevel() ?? undefined).subscribe({
        next: (topics) => this.sTopics.set(topics),
        error: () => this.saveError.set('No se pudieron cargar los temas. Inténtalo de nuevo.'),
      });
    });
```

Add `photoTaxonomyValid()` right after the existing `photoValid()` method:

```ts
  private photoTaxonomyValid(): boolean {
    return (
      !!this.pCourseId() &&
      !!this.pTopicId() &&
      !!this.pDifficulty() &&
      !!this.pGradeLevel() &&
      !!this.pImage()
    );
  }
```

Add `extractWithAi()` right after `submitPhoto()`:

```ts
  protected extractWithAi(): void {
    const image = this.pImage();
    const gradeLevel = this.pGradeLevel();
    const courseId = this.pCourseId();
    const topicId = this.pTopicId();
    if (!image || this.extracting() || !this.photoTaxonomyValid()) return;
    this.extracting.set(true);
    this.extractError.set(null);

    this.aiService.extractQuestionFromImage(image).subscribe({
      next: (extracted) => {
        this.sDifficulty.set(this.pDifficulty());
        this.sBody.set(extracted.bodyTypst);
        this.sAlternatives.set(extracted.alternatives.join('\n'));
        this.sCorrectAnswer.set(extracted.correctAnswer);

        this.pendingStructuredCourseId = courseId;
        this.pendingStructuredTopicId = topicId;
        this.sGradeLevel.set(gradeLevel);

        this.extracting.set(false);
        this.setTab('structured');
      },
      error: () => {
        this.extracting.set(false);
        this.extractError.set('No se pudo leer la pregunta desde la imagen. Inténtalo de nuevo.');
      },
    });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/web && pnpm exec vitest run src/app/features/bank/bank-new/bank-new.component.spec.ts`
Expected: PASS — all tests in `extractWithAi (photo tab AI shortcut)` plus every pre-existing test in the file (the two modified effects must not regress `it('reloads courses and resets the selected course when the grade level changes (structured tab)', ...)` / `it('reloads topics and resets the selected topic when the course changes (structured tab)', ...)` — those exercise the plain reset-to-`''` path, which still works since `pendingStructuredCourseId`/`pendingStructuredTopicId` are `null` outside of `extractWithAi()`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/bank/bank-new/bank-new.component.ts apps/web/src/app/features/bank/bank-new/bank-new.component.spec.ts
GIT_COMMIT_SKILL=1 git commit -m "feat(web): extract question from photo with AI in nueva pregunta"
```

---

## Task 2: Template — "Extraer con IA" button in the Foto tab

**Files:**
- Modify: `apps/web/src/app/features/bank/bank-new/bank-new.component.html`
- Test: `apps/web/src/app/features/bank/bank-new/bank-new.component.spec.ts`

**Interfaces:**
- Consumes: `extracting()`, `extractError()`, `extractWithAi()` from Task 1 (already on the component).
- Produces: nothing new for later tasks — this is the final task in the plan.

- [ ] **Step 1: Register the `sparkles` icon for this component**

`bank-new.component.ts`'s `@Component` decorator currently does:

```ts
  providers: [LucideAngularModule.pick({ Upload, Image: ImageIcon, Check, ChevronDown }).providers ?? []],
```

Update the import line to add `Sparkles`:

```ts
import { LucideAngularModule, Upload, Image as ImageIcon, Check, ChevronDown, Sparkles } from 'lucide-angular';
```

And the `providers` line to register it:

```ts
  providers: [LucideAngularModule.pick({ Upload, Image: ImageIcon, Check, ChevronDown, Sparkles }).providers ?? []],
```

- [ ] **Step 2: Write the failing tests**

Append the following `describe` block inside `describe('BankNewComponent', ...)` in `bank-new.component.spec.ts`, reusing the module-scope `fillPhotoTaxonomy`/`pickImage` helpers added in Task 1 Step 2:

```ts
  describe('extract-with-ai button (photo tab)', () => {
    it('is disabled until photo taxonomy + image are complete, then enabled', () => {
      const { fixture, compiled } = setup();
      const button = compiled.querySelector('[data-testid="extract-with-ai"] button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);

      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      expect(button.disabled).toBe(false);
    });

    it('clicking it runs extractWithAi and lands on the structured tab with the extracted question', () => {
      const { fixture, compiled } = setup();
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (compiled.querySelector('[data-testid="extract-with-ai"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="tab-structured-panel"]')).toBeTruthy();
      const textarea = compiled.querySelector(
        '[data-testid="tab-structured-panel"] textarea',
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe('Enunciado desde imagen');
    });

    it('shows extract-error inline on failure, without leaving the photo tab', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (compiled.querySelector('[data-testid="extract-with-ai"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="extract-error"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="tab-photo-panel"]')).toBeTruthy();
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/web && pnpm exec vitest run src/app/features/bank/bank-new/bank-new.component.spec.ts`
Expected: FAIL — `[data-testid="extract-with-ai"]` doesn't exist in the template yet.

- [ ] **Step 4: Implement — add the button + error message to the Foto tab panel**

In `apps/web/src/app/features/bank/bank-new/bank-new.component.html`, replace:

```html
      <div data-testid="photo-submit"><ui-button variant="primary" [loading]="saving()" (clicked)="submitPhoto()">Guardar pregunta</ui-button></div>
```

with:

```html
      @if (extractError()) {
        <p data-testid="extract-error" class="rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text" role="alert">{{ extractError() }}</p>
      }
      <div class="flex flex-wrap gap-2">
        <div data-testid="photo-submit"><ui-button variant="primary" [loading]="saving()" (clicked)="submitPhoto()">Guardar pregunta</ui-button></div>
        <div data-testid="extract-with-ai">
          <ui-button variant="ghost" [loading]="extracting()" [disabled]="!photoTaxonomyValid() || extracting()" (clicked)="extractWithAi()">
            <span class="flex items-center gap-1">
              <lucide-angular name="sparkles" class="h-4 w-4"></lucide-angular>
              Extraer con IA
            </span>
          </ui-button>
        </div>
      </div>
```

`photoTaxonomyValid()` is currently `private` (Task 1) — templates can only bind to `protected`/`public` members, so change its visibility in `bank-new.component.ts`:

```ts
  protected photoTaxonomyValid(): boolean {
```

(was `private photoTaxonomyValid(): boolean {`)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/web && pnpm exec vitest run src/app/features/bank/bank-new/bank-new.component.spec.ts`
Expected: PASS — every test in the file, including Task 1's and Task 2's new `describe` blocks.

- [ ] **Step 6: Manual smoke check**

Run: `cd apps/web && pnpm start` (or the project's existing dev-server task), navigate to `/app/bank/new`, pick Grado/Curso/Tema/Nivel + a photo on the "Foto" tab, click "Extraer con IA", confirm it switches to "Escribir pregunta" with the fields filled and Curso/Tema preselected once their dropdowns finish loading.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/bank/bank-new/bank-new.component.ts apps/web/src/app/features/bank/bank-new/bank-new.component.html apps/web/src/app/features/bank/bank-new/bank-new.component.spec.ts
GIT_COMMIT_SKILL=1 git commit -m "feat(web): add Extraer con IA button to nueva pregunta photo tab"
```
