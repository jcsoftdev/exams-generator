# Exam Builder Template Auto-Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-load the exam template (`resolveBlueprint`) in `ExamBuilderComponent` as soon as the selection is resolvable, instead of requiring a manual "Cargar plantilla" click.

**Architecture:** Three imperative trigger points added to existing signal-setter methods in `exam-builder.component.ts` — no new files, no new state, no backend changes. Each trigger calls the existing `loadTemplate()` method unchanged.

**Tech Stack:** Angular 22 standalone component, signals, RxJS, Vitest (via `@angular/build:unit-test`).

## Global Constraints

- The "Cargar plantilla" button stays — it remains the manual re-load path (spec §2).
- `loadTemplate()`'s body does not change — its 404/400 error handling is reused as-is for auto-triggered calls (spec §3).
- No debounce on any trigger — each call is synchronous and immediate, same as a button click (spec §2.3).
- Clearing a track (`trackId === null`) must NOT auto-load (spec §2.2).
- Zero changes to `ResolveBlueprintPayload`, `resolveBlueprint()`, or any backend endpoint.

Design doc: `docs/superpowers/specs/2026-07-30-exam-builder-template-autoload-design.md`.

Run tests for this file from `apps/web/`:

```bash
npx ng test --include='**/exam-builder.component.spec.ts' --watch=false
```

---

### Task 1: Auto-load when the selected university has no tracks

**Files:**

- Modify: `apps/web/src/app/features/exams/exam-builder/exam-builder.component.ts:297-308` (`onUniversityChange`)
- Test: `apps/web/src/app/features/exams/exam-builder/exam-builder.component.spec.ts` (new `it` inside the existing `describe('tipo de examen — cargar plantilla', ...)` block, which starts at line 844 and closes at line 977)

**Interfaces:**

- Consumes: existing `protected loadTemplate(): void` (component.ts:338), existing `ExamsService.getUniversityTracks(universityId): Observable<Track[]>`.
- Produces: no new public members — `onUniversityChange` keeps its existing signature `(universityId: string | null): void`.

- [ ] **Step 1: Write the failing test**

Insert this `it` right before the closing `});` of `describe('tipo de examen — cargar plantilla', ...)` (currently line 977, i.e. right after the test ending at line 976):

```typescript
it("auto-loads the template when the selected university has no tracks, without clicking the button", () => {
  const resolveBlueprint = vi.fn(() =>
    of<ResolveBlueprintResult>({
      blueprint: [{ courseId: "c1", topicId: "t1", count: 9, difficulty: Difficulty.Hard }],
      weekNumber: null,
      templateId: "tpl-1",
    }),
  );
  const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

  selectGradeLevel(compiled, fixture, "pre");
  selectFromUiSelect(compiled, fixture, "exam-type-select", "ETA");
  selectFromUiSelect(compiled, fixture, "university-select", "UNI");

  expect(resolveBlueprint).toHaveBeenCalledWith({ examTypeCode: "eta", universityId: "u1" });
  const input = compiled.querySelector<HTMLInputElement>('input[name="requested-c1:t1:hard"]');
  expect(input?.value).toBe("9");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web/`): `npx ng test --include='**/exam-builder.component.spec.ts' --watch=false`
Expected: FAIL — `resolveBlueprint` was not called (no "Cargar plantilla" click happened).

- [ ] **Step 3: Write minimal implementation**

Replace `onUniversityChange` (component.ts:297-308) with:

```typescript
  protected onUniversityChange(universityId: string | null): void {
    this.selectedUniversityId.set(universityId);
    this.selectedTrackId.set(null);
    this.tracks.set([]);
    if (!universityId) {
      return;
    }
    this.examsService.getUniversityTracks(universityId).subscribe({
      next: (list) => {
        this.tracks.set(list);
        // No track step for this university — selection is already
        // complete, so load the template right away instead of waiting
        // for a manual "Cargar plantilla" click.
        if (list.length === 0) {
          this.loadTemplate();
        }
      },
      error: () => this.templateError.set('No se pudieron cargar los tracks.'),
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web/`): `npx ng test --include='**/exam-builder.component.spec.ts' --watch=false`
Expected: PASS — all tests in the file green (this file has 52 tests before this task; it should show 53 after).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/exams/exam-builder/exam-builder.component.ts apps/web/src/app/features/exams/exam-builder/exam-builder.component.spec.ts
GIT_COMMIT_SKILL=1 git commit -m "feat(web): auto-load exam template when university has no tracks"
```

---

### Task 2: Auto-load when a track is selected

**Files:**

- Modify: `apps/web/src/app/features/exams/exam-builder/exam-builder.component.ts:310-312` (`onTrackChange`)
- Test: `apps/web/src/app/features/exams/exam-builder/exam-builder.component.spec.ts` (new `it`, same describe block as Task 1, inserted after Task 1's new test)

**Interfaces:**

- Consumes: existing `protected loadTemplate(): void` (component.ts:338).
- Produces: no new public members — `onTrackChange` keeps its existing signature `(trackId: string | null): void`.

- [ ] **Step 1: Write the failing test**

Insert this `it` directly after Task 1's test, still inside `describe('tipo de examen — cargar plantilla', ...)`:

```typescript
it("auto-loads the template when a track is selected, without clicking the button", () => {
  const resolveBlueprint = vi.fn(() =>
    of<ResolveBlueprintResult>({
      blueprint: [{ courseId: "c1", topicId: "t1", count: 7, difficulty: Difficulty.Easy }],
      weekNumber: null,
      templateId: "tpl-2",
    }),
  );
  const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of(TRACKS) });

  selectGradeLevel(compiled, fixture, "pre");
  selectFromUiSelect(compiled, fixture, "exam-type-select", "ETA");
  selectFromUiSelect(compiled, fixture, "university-select", "UNI");
  selectFromUiSelect(compiled, fixture, "track-select", "Preuniversitario");

  expect(resolveBlueprint).toHaveBeenCalledWith({
    examTypeCode: "eta",
    universityId: "u1",
    trackId: "trk1",
  });
  const input = compiled.querySelector<HTMLInputElement>('input[name="requested-c1:t1:easy"]');
  expect(input?.value).toBe("7");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web/`): `npx ng test --include='**/exam-builder.component.spec.ts' --watch=false`
Expected: FAIL — `resolveBlueprint` was not called with `trackId: 'trk1'` (no click happened, and selecting the university alone does not auto-load here because `TRACKS` is non-empty).

- [ ] **Step 3: Write minimal implementation**

Replace `onTrackChange` (component.ts:310-312) with:

```typescript
  protected onTrackChange(trackId: string | null): void {
    this.selectedTrackId.set(trackId);
    // Clearing the track (trackId === null) leaves the selection
    // incomplete for a university that has tracks — only an actual
    // pick auto-loads.
    if (trackId) {
      this.loadTemplate();
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web/`): `npx ng test --include='**/exam-builder.component.spec.ts' --watch=false`
Expected: PASS — all tests green (54 tests total).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/exams/exam-builder/exam-builder.component.ts apps/web/src/app/features/exams/exam-builder/exam-builder.component.spec.ts
GIT_COMMIT_SKILL=1 git commit -m "feat(web): auto-load exam template when a track is selected"
```

---

### Task 3: Auto-load scoped to checked courses when a course checkbox is toggled

**Files:**

- Modify: `apps/web/src/app/features/exams/exam-builder/exam-builder.component.ts:318-320` (`toggleCourseSelection`)
- Test: `apps/web/src/app/features/exams/exam-builder/exam-builder.component.spec.ts` (new `it`, same describe block, inserted after Task 2's new test)

**Interfaces:**

- Consumes: existing `protected loadTemplate(): void` (component.ts:338), existing `protected readonly canLoadTemplate = computed<boolean>(...)` (component.ts:236).
- Produces: no new public members — `toggleCourseSelection` keeps its existing signature `(courseId: string): void`.

- [ ] **Step 1: Write the failing test**

Insert this `it` directly after Task 2's test, still inside `describe('tipo de examen — cargar plantilla', ...)`:

```typescript
it("auto-loads the template scoped to the checked course when a course checkbox is toggled, without clicking the button", () => {
  const resolveBlueprint = vi.fn(() =>
    of<ResolveBlueprintResult>({
      blueprint: [{ courseId: "c1", count: 5, difficulty: Difficulty.Medium }],
      weekNumber: null,
      templateId: "tpl-3",
    }),
  );
  const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

  selectGradeLevel(compiled, fixture, "pre");
  selectFromUiSelect(compiled, fixture, "exam-type-select", "Fastest");
  selectFromUiSelect(compiled, fixture, "university-select", "UNI");

  resolveBlueprint.mockClear();
  (compiled.querySelector('[data-testid="course-checkbox-c1"]') as HTMLInputElement).click();
  fixture.detectChanges();

  expect(resolveBlueprint).toHaveBeenCalledWith({
    examTypeCode: "fastest",
    universityId: "u1",
    selectedCourseIds: ["c1"],
  });
  const input = compiled.querySelector<HTMLInputElement>('input[name="requested-c1::medium"]');
  expect(input?.value).toBe("5");
});
```

Note: `resolveBlueprint.mockClear()` runs after selecting the university — for a track-less university (`getUniversityTracks` returns `[]`), Task 1's change already auto-loads once at that point (with an empty `selectedCourseIds`). Clearing the mock isolates the assertion to the call made by the checkbox toggle itself.

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web/`): `npx ng test --include='**/exam-builder.component.spec.ts' --watch=false`
Expected: FAIL — after `mockClear()`, `resolveBlueprint` is never called again by the checkbox click.

- [ ] **Step 3: Write minimal implementation**

Replace `toggleCourseSelection` (component.ts:318-320) with:

```typescript
  protected toggleCourseSelection(courseId: string): void {
    this.selectedCourseIds.update((current) => toggleInSet(current, courseId));
    if (this.canLoadTemplate()) {
      this.loadTemplate();
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web/`): `npx ng test --include='**/exam-builder.component.spec.ts' --watch=false`
Expected: PASS — all tests green (55 tests total).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/exams/exam-builder/exam-builder.component.ts apps/web/src/app/features/exams/exam-builder/exam-builder.component.spec.ts
GIT_COMMIT_SKILL=1 git commit -m "feat(web): auto-load exam template when a course checkbox is toggled"
```

---

### Task 4: Full regression pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full web test suite**

Run (from `apps/web/`): `npx ng test --watch=false`
Expected: PASS — every existing test in the project still passes (confirms no test asserting "resolveBlueprint was not called before the click" broke, per design doc §5).

- [ ] **Step 2: Manual smoke check**

Start the app (`pnpm dev` from repo root or `apps/web/`), open "Generador de exámenes", pick a non-manual "Tipo de examen", pick a university, and (if shown) a track — confirm the grid's Fácil/Media/Difícil inputs populate without ever clicking "Cargar plantilla". For a `courseScope: 'selected'` type (e.g. "Fastest"), confirm checking a course checkbox populates the grid for that course without a click either.

No commit for this task — it's a verification checkpoint, not a code change.
