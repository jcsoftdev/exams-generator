import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { EMPTY, Subject, catchError, debounceTime, groupBy, map, mergeMap, switchMap } from 'rxjs';
import { Difficulty } from '@exams-generator/shared';
import {
  LucideAngularModule,
  Sparkles,
  TriangleAlert,
  Lock,
  Inbox,
  ChevronDown,
  ChevronRight,
  Check,
} from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { CardComponent } from '../../../ui/card/card.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { InputComponent } from '../../../ui/input/input.component';
import { ProgressComponent } from '../../../ui/progress/progress.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { TableComponent } from '../../../ui/table/table.component';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { DEFAULT_VERSION_COUNT, VERSION_COUNT_OPTIONS } from '../../exam-versions/exam-versions.models';
import { ExamsService } from '../exams.service';
import {
  CreateExamBlueprintRow,
  ExamType,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
  GradeLevel,
  ResolveBlueprintPayload,
  ResolvedBlueprintRow,
  StockBatchCellPayload,
  Track,
  University,
} from '../exams.models';
import {
  CellKey,
  CellStatus,
  ContentRow,
  ExamBuilderStore,
  ResolvedTemplateRow,
  buildCellKey,
} from './exam-builder.store';
import { RowGroup, groupRowsByCourse } from './group-rows-by-course';
import { GridCellContentComponent } from './grid-cell-content.component';

/**
 * Fallback title when the teacher leaves the name field empty — the exact
 * string this screen has always generated. It stays the DEFAULT, never the
 * only option: two exams of the same grade on the same day used to end up
 * with byte-identical names in a list you search by title, and no endpoint
 * exists to rename one afterwards (audit 2026-08-15).
 */
function defaultExamTitle(gradeLevel: GradeLevel): string {
  return `Examen ${GRADE_LEVEL_LABELS[gradeLevel]} — ${new Date().toLocaleDateString('es-PE')}`;
}

/**
 * Quiet window before a cell's edit becomes a `POST /exams/preview`.
 *
 * Audit 2026-08-15: every keystroke fired its own request (`ui-input` emits on
 * `input`), so typing "100" was 3 calls against a 100 req/min global
 * ThrottlerGuard — AND the responses raced: typing "12" left the cell showing
 * the single id from the "1" request, because it landed last and
 * `mergePreview` writes whatever arrives. Same 300ms the exam-list search box
 * already uses. Exported so the spec flushes the exact window instead of
 * hardcoding a number that can drift.
 */
export const PREVIEW_DEBOUNCE_MS = 300;

/**
 * `sessionStorage` key holding the in-progress exam.
 *
 * `ExamBuilderStore` is component-scoped ON PURPOSE (DECISION FE-5: state
 * resets on navigation), which is right for the store and wrong for the
 * teacher: the audit reproduced 20 minutes of grid work vanishing because a
 * shortage cell's "Generar N con IA" button navigates away. Persisting here —
 * outside the component — keeps that decision intact while making the work
 * survive navigation, Atrás, and a reload. `sessionStorage`, not `local`, so
 * it dies with the tab instead of resurrecting a stale exam next week.
 *
 * Versioned key: a shape change should ignore old payloads, never crash on
 * them.
 */
export const BUILDER_STATE_KEY = 'exam-builder-state-v1';

/** Everything needed to put the builder back exactly where the teacher left it. */
interface PersistedBuilderState {
  readonly examTypeCode: string;
  readonly gradeLevel: GradeLevel | null;
  readonly universityId: string | null;
  readonly trackId: string | null;
  readonly selectedCourseIds: readonly string[];
  readonly totalQuestions: string;
  readonly title: string;
  readonly versionCount: number;
  /** `requested` as entries — a Map doesn't survive `JSON.stringify`. */
  readonly requested: readonly (readonly [CellKey, number])[];
}

/** One pending cell preview — the payload `previewRequests` carries. */
interface PreviewRequest {
  readonly key: CellKey;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly count: number;
  readonly gradeLevel: GradeLevel;
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};

/**
 * Grade level used to fetch `templateCourses()` — the course catalog behind
 * BOTH the "Cargar plantilla" course-name lookup (`courseNameFor`, any
 * non-manual exam type) and the `courseScope: 'selected'` checkbox list
 * (`fastest`). Every university/track template in this feature only ever
 * references `stage: 'preuniversitario'` courses (design doc + seed data) —
 * `'pre'` is the corresponding `GradeLevel` (see `stageForGrade` in
 * `exams.models.ts`). Fetching unfiltered (`getCourses()` with no args) pulls
 * every stage's catalog at once — primaria/colegio/preuniversitario course
 * names duplicated three times over.
 */
const TEMPLATE_GRADE_LEVEL: GradeLevel = 'pre';

function parseCellKey(key: CellKey): { courseId: string; topicId: string; difficulty: Difficulty } {
  const [courseId, topicId, difficulty] = key.split(':') as [string, string, Difficulty];
  return { courseId, topicId, difficulty };
}

/**
 * Converts a `ContentRow`/`CellKey`'s sentinel whole-course `topicId` (the
 * empty string `''` — see `WHOLE_COURSE_TOPIC_ID` in `exam-builder.store.ts`)
 * into the value the API expects for "match the whole course": an OMITTED
 * field, i.e. `undefined`, never a literal empty string. `blueprint-selector.ts`
 * on the backend treats `topicId !== undefined` as "match this exact topic",
 * so `topicId: ''` would try to match a topic literally named `""` and
 * silently select/count nothing — the same is true of `POST
 * /exams/stock/batch`'s `countStock()` (`cell.topicId === undefined` is what
 * triggers "sum across every topic of the course").
 *
 * ONE shared helper for BOTH places in this component that turn a store-shaped
 * (sentinel-using) `topicId` into an API-shaped one — `toCreateExamBlueprintRow`
 * (below) and `loadStock()` — so they can't drift apart again.
 */
export function toApiTopicId(topicId: string): string | undefined {
  return topicId ? topicId : undefined;
}

/**
 * Converts one grid cell into a `POST /exams` blueprint row.
 *
 * **Sentinel round-trip (design doc §3.11)**: `ExamBuilderStore.bulkLoadFromBlueprint`
 * represents a resolved whole-course row (no `topicId` — e.g. every UNCP row,
 * which has no syllabus/week data) as a `ContentRow` with the sentinel
 * `topicId: ''`, so `parseCellKey` yields `topicId === ''` for that row's
 * cells. That sentinel must NEVER reach the API as a literal empty string —
 * see `toApiTopicId`. Omitting `topicId` entirely is what already means
 * "match the whole course" for a manually-built whole-course row today
 * (`CreateExamBlueprintRow.topicId` is optional) — this is the existing
 * case, not a new one.
 *
 * Exported so the round-trip can be unit-tested directly, independent of the
 * "Generar versiones" stock-satisfiability gate (a freshly-merged template
 * row has no stock-batch result yet, so it can't be driven through that full
 * DOM flow — see exam-builder.component.spec.ts).
 */
export function toCreateExamBlueprintRow(key: CellKey, count: number): CreateExamBlueprintRow {
  const { courseId, topicId, difficulty } = parseCellKey(key);
  const apiTopicId = toApiTopicId(topicId);
  return {
    courseId,
    ...(apiTopicId !== undefined ? { topicId: apiTopicId } : {}),
    difficulty,
    count,
  };
}

/** Toggle a course id's membership in the collapsed set (immutable copy — signal-friendly). */
function toggleInSet(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/**
 * Master "tabla + preview vivo" exam-builder screen (design doc §5,
 * DECISION FE-5). Replaces `ExamCreateComponent` at `/app/exams`.
 *
 * The content grid auto-populates from the tenant's full course x topic
 * catalog (`TaxonomyService`) for the selected grade level — no manual
 * "add row" step, matching the design doc's fixed matrix. `ExamBuilderStore`
 * is provided HERE (component-scoped, not root) so state resets whenever
 * the user navigates away and back (DECISION FE-5).
 */
@Component({
  selector: 'app-exam-builder',
  standalone: true,
  // `<lucide-icon>` is used directly in this component's own template
  // (sparkles/triangle-alert/lock) AND inside the nested `ui-empty-state`
  // (inbox), so the bare module goes in `imports` (selector resolution) and
  // the icon providers go in `providers` — `.pick()`'s `ModuleWithProviders`
  // cannot go in `imports` (NG2012).
  imports: [
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    InputComponent,
    LucideAngularModule,
    ProgressComponent,
    SelectComponent,
    TableComponent,
    GridCellContentComponent,
  ],
  providers: [
    ExamBuilderStore,
    // `ui-select` (Grado) needs Check too — this component-level `.pick()`
    // shadows the root `app.config.ts` registration for its own subtree.
    LucideAngularModule.pick({ Sparkles, TriangleAlert, Lock, Inbox, ChevronDown, ChevronRight, Check })
      .providers ?? [],
  ],
  templateUrl: './exam-builder.component.html',
})
export class ExamBuilderComponent implements OnInit {
  private readonly taxonomyService = inject(TaxonomyService);
  private readonly examsService = inject(ExamsService);
  private readonly router = inject(Router);

  protected readonly store = inject(ExamBuilderStore);

  protected readonly difficulties: readonly Difficulty[] = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];
  protected readonly difficultyLabels = DIFFICULTY_LABELS;
  protected readonly gradeLevelOptions = GRADE_LEVELS.map((gradeLevel) => ({
    value: gradeLevel,
    label: GRADE_LEVEL_LABELS[gradeLevel],
  }));
  /** Label shown by the read-only derived-grade indicator (template) for every non-manual exam type — see `TEMPLATE_GRADE_LEVEL`. */
  protected readonly templateGradeLevelLabel = GRADE_LEVEL_LABELS[TEMPLATE_GRADE_LEVEL];

  protected readonly selectedGradeLevel = signal<GradeLevel | null>(null);
  private readonly courses = signal<Course[]>([]);

  // --- "Tipo de examen" (design doc §3.11) ---------------------------------

  /** Defaults to `'manual'` — selecting/keeping it is the EB-T invariant: the grid below stays byte-identical to today. */
  protected readonly selectedExamTypeCode = signal<string>('manual');
  protected readonly examTypes = signal<readonly ExamType[]>([]);
  protected readonly universities = signal<readonly University[]>([]);
  protected readonly selectedUniversityId = signal<string | null>(null);
  protected readonly tracks = signal<readonly Track[]>([]);
  protected readonly selectedTrackId = signal<string | null>(null);
  /** Course catalog for the `courseScope === 'selected'` multi-select (`fastest`) — fetched separately from `courses` (which is grade-level-scoped and may not be loaded yet). */
  protected readonly templateCourses = signal<readonly Course[]>([]);
  protected readonly selectedCourseIds = signal<ReadonlySet<string>>(new Set());

  protected readonly loadingTemplate = signal(false);
  protected readonly templateError = signal<string | null>(null);
  /**
   * True after a successful `resolveBlueprint()` whose response reported
   * `usedCumulativeFallback` — "Rápido (semana actual)" got silently widened
   * to "everything seen so far" because the current week has no syllabus of
   * its own (P0 fix, docs/audit-2026-08-14.md). The reported bug was an
   * empty exam with NO explanation; this is the explanation for its fix's
   * own side effect — the teacher asked for one week's worth and is getting
   * more, so the grid must say so instead of looking like a normal load.
   */
  protected readonly templateCumulativeFallback = signal(false);
  /**
   * Refinement on top of the P0 fix above (docs/audit-2026-08-14.md, same
   * item): the last week `resolveBlueprint()` reported syllabus content for
   * (`effectiveWeekNumber`) — named in the hint so the teacher sees exactly
   * where "acumulativo" stops, not just that it happened.
   */
  protected readonly templateFallbackWeek = signal<number | null>(null);
  /** Raw text of the optional "Cantidad total de preguntas" field — only needed when a university (e.g. UNI) publishes point totals but no per-course question count (`totalQuestionsOverride`). */
  protected readonly templateTotalQuestions = signal<string>('');
  /**
   * Monotonic token guarding `loadTemplate()` against out-of-order
   * responses. The 3 auto-load triggers bypass the "Cargar plantilla"
   * button's `loading`-gated click suppression, so multiple
   * `resolveBlueprint` calls can now be in flight at once — a response
   * only applies if it's still from the most recently issued request.
   */
  private templateRequestId = 0;

  protected readonly examTypeOptions = computed(() =>
    this.examTypes().map((type) => ({ value: type.code, label: type.label })),
  );
  protected readonly universityOptions = computed(() =>
    this.universities().map((university) => ({ value: university.id, label: university.name })),
  );
  /**
   * `kind: 'area'` tracks (UNCP's I-V) show "Área {code} — {name}" — docentes
   * y personal del sector reconocen el área por su número romano antes que
   * por el nombre largo. `kind: 'cycle_track'` (UNI's Básico/Preuniversitario/
   * Intensivo) has no such convention, so its `name` renders as-is.
   */
  protected readonly trackOptions = computed(() =>
    this.tracks().map((track) => ({
      value: track.id,
      label: track.kind === 'area' ? `Área ${track.code} — ${track.name}` : track.name,
    })),
  );

  protected readonly selectedExamType = computed<ExamType | null>(
    () => this.examTypes().find((type) => type.code === this.selectedExamTypeCode()) ?? null,
  );
  protected readonly isManual = computed(() => this.selectedExamTypeCode() === 'manual');
  protected readonly showCourseMultiSelect = computed(() => this.selectedExamType()?.courseScope === 'selected');

  /**
   * The reported bug: "Cargar plantilla" used to be a dead, mute control —
   * `[disabled]` was already bound to real validity (`canLoadTemplate`), but
   * nothing on screen said WHICH precondition was still missing. This
   * computes that explanation, checked in the same order a user fills the
   * section top-to-bottom (universidad -> track, when the university has
   * one -> al menos un curso, only for `courseScope: 'selected'` types like
   * `fastest`). Returns `null` once every precondition for the currently
   * selected exam type is satisfied (or the type is `manual`, where the
   * section isn't even rendered).
   */
  protected readonly loadTemplateBlockedReason = computed<string | null>(() => {
    if (this.isManual()) {
      return null;
    }
    if (this.selectedUniversityId() === null) {
      return 'Selecciona una universidad para poder cargar la plantilla.';
    }
    if (this.tracks().length > 0 && this.selectedTrackId() === null) {
      return 'Selecciona un track para poder cargar la plantilla.';
    }
    if (this.showCourseMultiSelect() && this.selectedCourseIds().size === 0) {
      return 'Selecciona al menos un curso para poder cargar la plantilla.';
    }
    return null;
  });

  protected readonly canLoadTemplate = computed(() => !this.isManual() && this.loadTemplateBlockedReason() === null);

  ngOnInit(): void {
    this.examsService.getExamTypes().subscribe({
      next: (types) => this.examTypes.set(types),
      error: () => this.templateError.set('No se pudieron cargar los tipos de examen.'),
    });
    this.restoreState();
  }

  /**
   * Rebuilds the screen from `sessionStorage` (see `BUILDER_STATE_KEY`).
   *
   * Order matters: the requested counts go in FIRST, before `buildGrid()`
   * fetches anything. Counts live in a `CellKey`-addressed map, not on the
   * rows, so a cell renders its restored value the moment its row arrives —
   * no second pass, and no window where the grid shows zeros over real data.
   *
   * A non-manual exam type also re-runs `loadTemplate()`: the template's rows
   * (including whole-course sentinel rows) are server-resolved, so they can't
   * be reconstructed from the persisted counts alone.
   */
  private restoreState(): void {
    const state = this.readState();
    if (!state) {
      return;
    }

    this.selectedExamTypeCode.set(state.examTypeCode);
    this.selectedUniversityId.set(state.universityId);
    this.selectedTrackId.set(state.trackId);
    this.selectedCourseIds.set(new Set(state.selectedCourseIds));
    this.templateTotalQuestions.set(state.totalQuestions);
    // `??` (not `||`) so an older payload without these keys falls back to the
    // defaults instead of writing `undefined` into the signals.
    this.examTitle.set(state.title ?? '');
    this.versionCount.set(state.versionCount ?? DEFAULT_VERSION_COUNT);
    for (const [key, count] of state.requested) {
      this.store.setRequested(key, count);
    }

    if (state.gradeLevel) {
      this.selectedGradeLevel.set(state.gradeLevel);
      this.buildGrid(state.gradeLevel);
    }

    if (state.examTypeCode === 'manual') {
      return;
    }

    // Refill the catalogs the template selects render their labels from, then
    // re-resolve the template itself.
    this.taxonomyService.getCourses(TEMPLATE_GRADE_LEVEL).subscribe({
      next: (list) => this.templateCourses.set(list),
      error: () => this.templateError.set('No se pudieron cargar los cursos.'),
    });
    this.examsService.getUniversities().subscribe({
      next: (list) => this.universities.set(list),
      error: () => this.templateError.set('No se pudieron cargar las universidades.'),
    });
    if (state.universityId) {
      this.examsService.getUniversityTracks(state.universityId).subscribe({
        next: (list) => {
          this.tracks.set(list);
          if (this.canLoadTemplate()) {
            this.loadTemplate();
          }
        },
        error: () => this.templateError.set('No se pudieron cargar los tracks.'),
      });
    }
  }

  private readState(): PersistedBuilderState | null {
    const raw = sessionStorage.getItem(BUILDER_STATE_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as PersistedBuilderState;
    } catch {
      // A corrupt/partial payload must never brick the screen — drop it and
      // start clean, exactly as if nothing had been saved.
      sessionStorage.removeItem(BUILDER_STATE_KEY);
      return null;
    }
  }

  /**
   * Drops the saved draft AND stops the persisting effect from writing it back
   * — without the flag, the effect's next run (the navigation itself touches
   * signals) would restore the entry we just deleted.
   */
  private clearPersistedState(): void {
    this.persistenceDisabled = true;
    sessionStorage.removeItem(BUILDER_STATE_KEY);
  }

  private persistenceDisabled = false;

  private persistState(): void {
    if (this.persistenceDisabled) {
      return;
    }
    const requested = Array.from(this.store.requested().entries()).filter(([, count]) => count > 0);
    if (requested.length === 0 && this.selectedGradeLevel() === null) {
      sessionStorage.removeItem(BUILDER_STATE_KEY);
      return;
    }
    const state: PersistedBuilderState = {
      examTypeCode: this.selectedExamTypeCode(),
      gradeLevel: this.selectedGradeLevel(),
      universityId: this.selectedUniversityId(),
      trackId: this.selectedTrackId(),
      selectedCourseIds: Array.from(this.selectedCourseIds()),
      totalQuestions: this.templateTotalQuestions(),
      title: this.examTitle(),
      versionCount: this.versionCount(),
      requested,
    };
    sessionStorage.setItem(BUILDER_STATE_KEY, JSON.stringify(state));
  }

  protected onExamTypeChange(code: string | null): void {
    this.selectedExamTypeCode.set(code ?? 'manual');
    this.selectedUniversityId.set(null);
    this.selectedTrackId.set(null);
    this.tracks.set([]);
    this.selectedCourseIds.set(new Set());
    this.templateError.set(null);
    this.templateCumulativeFallback.set(false);
    this.templateFallbackWeek.set(null);
    this.templateTotalQuestions.set('');

    if (!code || code === 'manual') {
      // EB-T invariant: manual starts fresh every time — grade level goes
      // back to being the user's own manual choice, not the derived 'pre' a
      // non-manual exam type may have left behind.
      this.selectedGradeLevel.set(null);
      return;
    }

    // Grade level is DERIVED for every non-manual exam type, never an
    // independent choice — every university/track template in this feature
    // (UNI, UNCP) is seeded under stage: 'preuniversitario' only, so there is
    // no other grade a template-driven exam could ever apply to (see
    // `TEMPLATE_GRADE_LEVEL`). Reuses `onGradeLevelChange` itself (not a
    // duplicate of its logic) so this pre-warms the preuniversitario
    // catalog+stock grid immediately — ready by the time the user picks a
    // university/track and clicks "Cargar plantilla". Guarded to skip when
    // already at `TEMPLATE_GRADE_LEVEL` (e.g. switching between two
    // non-manual exam types) so it never uselessly rebuilds the grid.
    if (this.selectedGradeLevel() !== TEMPLATE_GRADE_LEVEL) {
      this.onGradeLevelChange(TEMPLATE_GRADE_LEVEL);
    }

    if (this.universities().length === 0) {
      this.examsService.getUniversities().subscribe({
        next: (list) => this.universities.set(list),
        error: () => this.templateError.set('No se pudieron cargar las universidades.'),
      });
    }
    // Fetched for EVERY non-manual exam type, regardless of `courseScope` —
    // `courseNameFor()` needs it as a name-lookup fallback for `courseScope:
    // 'all'` types too (eta/eta_by_week), not just to populate the
    // `courseScope: 'selected'` checkbox list (Bug 1). The checkbox UI
    // itself stays gated to `courseScope === 'selected'` via
    // `showCourseMultiSelect()` in the template — only this catalog fetch is
    // unconditional.
    if (this.templateCourses().length === 0) {
      this.taxonomyService.getCourses(TEMPLATE_GRADE_LEVEL).subscribe({
        next: (list) => this.templateCourses.set(list),
        error: () => this.templateError.set('No se pudieron cargar los cursos.'),
      });
    }
  }

  protected onUniversityChange(universityId: string | null): void {
    this.selectedUniversityId.set(universityId);
    this.selectedTrackId.set(null);
    this.tracks.set([]);
    if (!universityId) {
      return;
    }
    this.examsService.getUniversityTracks(universityId).subscribe({
      next: (list) => {
        // Guard against stale responses: only apply this response if it
        // still corresponds to the currently-selected university — a late
        // response for a university the user already left must not
        // clobber the track list or auto-load with mismatched state.
        if (this.selectedUniversityId() !== universityId) {
          return;
        }
        this.tracks.set(list);
        // No track step for this university — selection is already
        // complete, so load the template right away instead of waiting
        // for a manual "Cargar plantilla" click.
        if (list.length === 0) {
          this.loadTemplate();
        }
      },
      error: () => {
        if (this.selectedUniversityId() !== universityId) {
          return;
        }
        this.templateError.set('No se pudieron cargar los tracks.');
      },
    });
  }

  protected onTrackChange(trackId: string | null): void {
    this.selectedTrackId.set(trackId);
    // Clearing the track (trackId === null) leaves the selection
    // incomplete for a university that has tracks — only an actual
    // pick auto-loads.
    if (trackId) {
      this.loadTemplate();
    }
  }

  protected isCourseSelected(courseId: string): boolean {
    return this.selectedCourseIds().has(courseId);
  }

  protected toggleCourseSelection(courseId: string): void {
    this.selectedCourseIds.update((current) => toggleInSet(current, courseId));
    if (this.canLoadTemplate()) {
      this.loadTemplate();
    }
  }

  protected onTemplateTotalQuestionsChange(value: string): void {
    this.templateTotalQuestions.set(value);
  }

  /**
   * `POST /exams/blueprint/resolve` (design doc §3.11) — on success, merges
   * the returned rows into `ExamBuilderStore` as a starting point the user
   * can still edit (never locks the grid). On a 404 (no template/cycle
   * configured for this university/track yet) shows a clear inline message
   * instead of crashing or leaving the grid silently empty with no
   * explanation. On a 400 (a UNI-style template whose rows have no
   * per-course `questionCount` — only point totals — and no
   * `totalQuestionsOverride` was supplied) shows a message distinct from the
   * 404 one, guiding the user to fill in the "Cantidad total de preguntas"
   * field above.
   */
  protected loadTemplate(): void {
    const examType = this.selectedExamType();
    const universityId = this.selectedUniversityId();
    if (!examType || examType.code === 'manual' || !universityId) {
      return;
    }

    this.loadingTemplate.set(true);
    this.templateError.set(null);
    this.templateCumulativeFallback.set(false);
    this.templateFallbackWeek.set(null);

    const trackId = this.selectedTrackId();
    const totalQuestionsRaw = this.templateTotalQuestions().trim();
    const payload: ResolveBlueprintPayload = {
      examTypeCode: examType.code,
      universityId,
      ...(trackId ? { trackId } : {}),
      ...(examType.courseScope === 'selected' ? { selectedCourseIds: Array.from(this.selectedCourseIds()) } : {}),
      ...(totalQuestionsRaw ? { totalQuestionsOverride: Number(totalQuestionsRaw) } : {}),
    };

    const requestId = ++this.templateRequestId;

    this.examsService.resolveBlueprint(payload).subscribe({
      next: (result) => {
        if (requestId !== this.templateRequestId) {
          return;
        }
        this.loadingTemplate.set(false);
        this.templateCumulativeFallback.set(result.usedCumulativeFallback ?? false);
        this.templateFallbackWeek.set(result.effectiveWeekNumber ?? null);
        this.mergeResolvedBlueprint(result.blueprint);
      },
      error: (error: HttpErrorResponse) => {
        if (requestId !== this.templateRequestId) {
          return;
        }
        this.loadingTemplate.set(false);
        this.templateError.set(
          error.status === 404
            ? 'No hay una plantilla configurada para esta universidad/track todavía.'
            : error.status === 400
              ? ((error.error?.message as string | undefined) ??
                'Esta plantilla requiere que indiques la cantidad total de preguntas — complétala e intenta de nuevo.')
              : 'No se pudo cargar la plantilla. Inténtalo de nuevo.',
        );
      },
    });
  }

  /**
   * Resolves display names for each `BlueprintRow` (the resolve endpoint
   * only returns ids) before handing them to `store.bulkLoadFromBlueprint` —
   * the store never fetches taxonomy data itself, same separation the
   * manual grid already keeps (`loadTopicsAndStock` resolves names in the
   * component, `addRow` just stores them). Looks first at the loaded
   * grade-level course catalog, then the course multi-select catalog, then
   * any row already in the grid, and falls back to the raw id as a last
   * resort (only reachable if a template references a course none of those
   * catalogs have loaded yet).
   */
  private mergeResolvedBlueprint(rows: readonly ResolvedBlueprintRow[]): void {
    const resolved: ResolvedTemplateRow[] = rows.map((row) => ({
      courseId: row.courseId,
      courseName: this.courseNameFor(row.courseId),
      topicId: row.topicId,
      topicName: row.topicId ? this.topicNameFor(row.courseId, row.topicId) : undefined,
      count: row.count,
      difficulty: row.difficulty,
    }));
    this.store.bulkLoadFromBlueprint(resolved);

    // Bug 3(b): if a grade level was already selected (its own `buildGrid()`
    // -> `loadStock()` chain already ran), newly-merged template rows have
    // no stock fetched yet — nothing else triggers one for them. Re-run
    // `loadStock()`; it iterates `this.store.rows()` fresh each call, so it
    // naturally covers every row (old and newly-merged) without duplicating
    // rows or requested counts.
    const gradeLevel = this.selectedGradeLevel();
    if (gradeLevel) {
      this.loadStock(gradeLevel);
    }
  }

  private courseNameFor(courseId: string): string {
    return (
      this.courses().find((course) => course.id === courseId)?.name ??
      this.templateCourses().find((course) => course.id === courseId)?.name ??
      this.store.rows().find((row) => row.courseId === courseId)?.courseName ??
      courseId
    );
  }

  private topicNameFor(courseId: string, topicId: string): string {
    return (
      this.store.rows().find((row) => row.courseId === courseId && row.topicId === topicId)?.topicName ?? topicId
    );
  }

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly emptyBank = signal(false);

  protected readonly loadingPreview = signal(false);
  protected readonly previewError = signal<string | null>(null);

  /** Cell edits waiting to become a preview call — drained by the constructor's pipeline. */
  private readonly previewRequests = new Subject<PreviewRequest>();

  constructor() {
    // `groupBy(key)` FIRST, so both operators below are scoped to ONE cell:
    //  - `debounceTime` collapses a typed number ("1", "12", "120") into a
    //    single call, without ever swallowing a different cell's edit — a
    //    debounce on the shared stream would drop cell A entirely when the
    //    teacher moves to cell B within the window.
    //  - `switchMap` cancels that cell's own in-flight request, which is what
    //    makes a late response for an older count unable to overwrite a newer
    //    one (the reproduced bug: "12" ended up showing the "1" result).
    // An error is reported and swallowed (`EMPTY` inside the inner pipe) so a
    // single failed cell never tears down the pipeline for the whole grid.
    this.previewRequests
      .pipe(
        groupBy((request) => request.key),
        mergeMap((cell) =>
          cell.pipe(
            debounceTime(PREVIEW_DEBOUNCE_MS),
            switchMap((request) =>
              this.examsService
                .previewExam({
                  gradeLevel: request.gradeLevel,
                  blueprint: [
                    {
                      courseId: request.courseId,
                      topicId: request.topicId,
                      difficulty: request.difficulty,
                      count: request.count,
                    },
                  ],
                })
                .pipe(
                  map((result) => ({ key: request.key, questionIds: result.selections[0]?.questionIds ?? [] })),
                  catchError(() => {
                    this.loadingPreview.set(false);
                    this.previewError.set('No se pudo cargar la vista previa. Inténtalo de nuevo.');
                    return EMPTY;
                  }),
                ),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ key, questionIds }) => {
        this.loadingPreview.set(false);
        this.store.mergePreview(key, questionIds);
      });

    // One effect instead of a `persistState()` call sprinkled over the eight
    // mutating methods — a new one can't forget to save. Every signal the
    // snapshot contains is read here so all of them are tracked dependencies.
    effect(() => {
      this.store.requested();
      this.selectedGradeLevel();
      this.selectedExamTypeCode();
      this.selectedUniversityId();
      this.selectedTrackId();
      this.selectedCourseIds();
      this.templateTotalQuestions();
      this.examTitle();
      this.versionCount();
      this.persistState();
    });
  }

  protected readonly generating = signal(false);
  protected readonly generateError = signal<string | null>(null);

  /**
   * Optional name for the exam about to be created. Empty means "use the
   * generated one" (`defaultExamTitle`) — the novice who ignores the field
   * gets exactly today's behaviour, and nobody is forced to name anything
   * before they can generate.
   */
  protected readonly examTitle = signal('');
  /** How many forms to compile on the FIRST generation — no longer hardcoded to 2. */
  protected readonly versionCount = signal(DEFAULT_VERSION_COUNT);
  protected readonly versionCountOptions: readonly SelectOption<number>[] = VERSION_COUNT_OPTIONS.map((count) => ({
    value: count,
    label: String(count),
  }));

  /** Placeholder doubles as a preview of the name the exam will get if the field stays empty. */
  protected titlePlaceholder(): string {
    const gradeLevel = this.selectedGradeLevel();
    return gradeLevel ? defaultExamTitle(gradeLevel) : 'Nombre del examen';
  }

  protected onExamTitleChange(value: string): void {
    this.examTitle.set(value);
  }

  protected onVersionCountChange(value: number | null): void {
    this.versionCount.set(value ?? DEFAULT_VERSION_COUNT);
  }

  /**
   * "Ver solo lo pedido" — hides every row the teacher hasn't asked anything
   * for.
   *
   * Audit 2026-08-15: a UNCP Área II template loads a correct 80-question
   * exam whose 11 filled rows sit scattered inside 287 rows / 23,335 px of
   * scroll (~42 screens). The result was right and unverifiable; this makes
   * it one screen. Off by default — the grid is still a fill-in matrix.
   */
  protected readonly onlyRequested = signal(false);

  protected toggleOnlyRequested(): void {
    this.onlyRequested.update((only) => !only);
  }

  /** Rows grouped by course, for the "read like the tree" course subheading (design doc §5.1). */
  protected readonly groupedRows = computed<readonly RowGroup[]>(() => {
    const groups = groupRowsByCourse(this.store.rows());
    if (!this.onlyRequested()) {
      return groups;
    }
    const requested = this.store.requested();
    const hasCount = (row: ContentRow) =>
      this.difficulties.some((difficulty) => (requested.get(this.cellKey(row, difficulty)) ?? 0) > 0);
    // A course whose every row is filtered out drops with them — an empty
    // group header would be noise in a view whose whole point is "only what
    // I asked for".
    return groups
      .map((group) => ({ ...group, rows: group.rows.filter(hasCount) }))
      .filter((group) => group.rows.length > 0);
  });

  /**
   * One-line receipt of what's currently requested — shown as soon as any
   * cell has a count, which is exactly when "Cargar plantilla" fills 11 rows
   * somewhere down a 42-screen grid. Counts CELLS (not rows) because that is
   * the unit the footer's progress bar and the lock reason already speak in.
   */
  protected readonly requestedSummary = computed<{ total: number; cells: number } | null>(() => {
    const cells = this.store.requestedCells();
    if (cells.length === 0) {
      return null;
    }
    return { total: this.store.grandTotal(), cells: cells.length };
  });

  /**
   * Courses the user has manually collapsed. Default-empty means every course
   * starts EXPANDED (the grid is a fill-in matrix — hiding rows by default would
   * bury the work). Collapse is opt-in, to fold away courses the teacher isn't
   * touching. Mirrors the bank tree's `expand/collapse` affordance (commit 50dcff5).
   */
  private readonly collapsedCourses = signal<ReadonlySet<string>>(new Set());

  protected toggleCourse(courseId: string): void {
    this.collapsedCourses.update((current) => toggleInSet(current, courseId));
  }

  protected isCourseExpanded(courseId: string): boolean {
    return !this.collapsedCourses().has(courseId);
  }

  protected expandAll(): void {
    this.collapsedCourses.set(new Set());
  }

  protected collapseAll(): void {
    this.collapsedCourses.set(new Set(this.groupedRows().map((group) => group.courseId)));
  }

  protected chevronFor(expanded: boolean): string {
    return expanded ? 'chevron-down' : 'chevron-right';
  }

  protected onGradeLevelChange(gradeLevel: GradeLevel | null): void {
    this.selectedGradeLevel.set(gradeLevel);
    if (!gradeLevel) {
      return;
    }
    this.buildGrid(gradeLevel);
  }

  protected retry(): void {
    const gradeLevel = this.selectedGradeLevel();
    if (gradeLevel) {
      this.buildGrid(gradeLevel);
    }
  }

  private buildGrid(gradeLevel: GradeLevel): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.emptyBank.set(false);
    this.store.setGradeLevel(gradeLevel);

    this.taxonomyService.getCourses(gradeLevel).subscribe({
      next: (courses) => {
        this.courses.set(courses);
        if (courses.length === 0) {
          this.loading.set(false);
          this.emptyBank.set(true);
          return;
        }
        this.loadTopicsAndStock(gradeLevel, courses);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('No se pudieron cargar las existencias. Inténtalo de nuevo.');
      },
    });
  }

  /**
   * Batched sibling of the per-course `forkJoin` fan-out this used to do —
   * fetches every course's topics in ONE `getTopicsForCourses()` request
   * (fixes the N+1 that used to trip the global ThrottlerGuard), then groups
   * the flat response back by `courseId` (preserving `courses`' original
   * order) so each row still gets added in the same course-then-topic order
   * as before.
   */
  private loadTopicsAndStock(gradeLevel: GradeLevel, courses: readonly Course[]): void {
    this.taxonomyService.getTopicsForCourses(courses.map((course) => course.id), gradeLevel).subscribe({
      next: (topics) => {
        if (topics.length === 0) {
          this.loading.set(false);
          this.emptyBank.set(true);
          return;
        }

        const topicsByCourseId = new Map<string, Topic[]>();
        for (const topic of topics) {
          const bucket = topicsByCourseId.get(topic.courseId);
          if (bucket) {
            bucket.push(topic);
          } else {
            topicsByCourseId.set(topic.courseId, [topic]);
          }
        }

        for (const course of courses) {
          for (const topic of topicsByCourseId.get(course.id) ?? []) {
            this.store.addRow({
              id: `${course.id}:${topic.id}`,
              courseId: course.id,
              courseName: course.name,
              topicId: topic.id,
              topicName: topic.name,
            });
          }
        }
        this.loadStock(gradeLevel);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('No se pudieron cargar las existencias. Inténtalo de nuevo.');
      },
    });
  }

  private loadStock(gradeLevel: GradeLevel): void {
    const cells: StockBatchCellPayload[] = [];
    for (const row of this.store.rows()) {
      for (const difficulty of this.difficulties) {
        // Bug 3(a): `row.topicId` is the store's sentinel `''` for a
        // whole-course row — translate it to an omitted field via
        // `toApiTopicId` (same helper `toCreateExamBlueprintRow` uses),
        // never send a literal empty string. `ExamBuilderStore.setStockResults`
        // does the matching reverse translation on the response.
        cells.push({ courseId: row.courseId, topicId: toApiTopicId(row.topicId), difficulty });
      }
    }

    this.examsService.stockBatch({ gradeLevel, cells }).subscribe({
      next: (result) => {
        this.store.setStockResults(result.results);
        this.loading.set(false);
        const total = result.results.reduce((sum, cell) => sum + cell.available, 0);
        this.emptyBank.set(total === 0);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('No se pudieron cargar las existencias. Inténtalo de nuevo.');
      },
    });
  }

  protected cellKey(row: ContentRow, difficulty: Difficulty): CellKey {
    return buildCellKey(row.courseId, row.topicId, difficulty);
  }

  protected stockFor(row: ContentRow, difficulty: Difficulty): number {
    return this.store.stock().get(this.cellKey(row, difficulty)) ?? 0;
  }

  protected requestedFor(row: ContentRow, difficulty: Difficulty): number {
    return this.store.requested().get(this.cellKey(row, difficulty)) ?? 0;
  }

  protected requestedStrFor(row: ContentRow, difficulty: Difficulty): string {
    const value = this.requestedFor(row, difficulty);
    return value > 0 ? String(value) : '';
  }

  protected previewFor(row: ContentRow, difficulty: Difficulty): readonly string[] {
    return this.store.previewCache().get(this.cellKey(row, difficulty)) ?? [];
  }

  protected statusFor(row: ContentRow, difficulty: Difficulty): CellStatus {
    return this.store.cellStatus(this.cellKey(row, difficulty));
  }

  /** Cell wrapper classes — shortage cells get an unmissable warning-stock tint + border (improvement 3). */
  protected cellClasses(row: ContentRow, difficulty: Difficulty): string {
    const base = 'px-3 py-2 align-top transition-colors';
    return this.statusFor(row, difficulty) === 'short'
      ? `${base} rounded-field border border-warn-text bg-warn-bg`
      : base;
  }

  /** Muted (not alarming) styling for an untouched zero-stock "de 0" label vs. the normal "de N" (improvement 4). */
  protected stockOkClasses(row: ContentRow, difficulty: Difficulty): string {
    return this.stockFor(row, difficulty) === 0 ? 'text-sm text-n400' : 'text-sm text-n600';
  }

  /** Per-difficulty column total for the totals row/footer (improvement 2). */
  protected totalFor(difficulty: Difficulty): number {
    return this.store.totalsByDifficulty().get(difficulty) ?? 0;
  }

  /** Grand total across every requested cell (improvement 2). */
  protected grandTotalValue(): number {
    return this.store.grandTotal();
  }

  /**
   * Edits are pushed into `previewRequests` instead of calling the API
   * directly — see the pipeline in the constructor for why (debounce + stale
   * response discard, both per cell).
   */
  protected onRequestedChange(row: ContentRow, difficulty: Difficulty, rawValue: string): void {
    const key = this.cellKey(row, difficulty);
    const count = Math.max(0, Number(rawValue) || 0);
    this.store.setRequested(key, count);
    if (count <= 0) {
      return;
    }

    const gradeLevel = this.selectedGradeLevel();
    if (!gradeLevel) {
      return;
    }

    this.loadingPreview.set(true);
    this.previewError.set(null);
    this.previewRequests.next({ key, courseId: row.courseId, topicId: row.topicId, difficulty, count, gradeLevel });
  }

  protected lowerToStock(row: ContentRow, difficulty: Difficulty): void {
    const stock = this.stockFor(row, difficulty);
    this.onRequestedChange(row, difficulty, String(stock));
  }

  protected goToUpload(): void {
    // The legacy raw-HTML /app/bank/upload screen was removed (audit P1) —
    // /app/bank/new is the only design-system question intake now.
    this.router.navigate(['/app/bank/new']);
  }

  /**
   * Bridge to the AI generator. When launched from a specific shortage cell we
   * carry its curso·tema·dificultad·grado as query params so the generator opens
   * pre-filled — the teacher shouldn't re-pick what they already chose here. From
   * the empty-state button (no row) we still carry the selected grade.
   */
  protected goToAiGenerate(row?: ContentRow, difficulty?: Difficulty): void {
    const gradeLevel = this.selectedGradeLevel();
    const queryParams = row
      ? { courseId: row.courseId, topicId: row.topicId, difficulty, gradeLevel }
      : gradeLevel
        ? { gradeLevel }
        : {};
    this.router.navigate(['/app/ai/generate'], { queryParams });
  }

  protected goToBank(): void {
    this.router.navigate(['/app/bank']);
  }

  /**
   * Why "Generar versiones" is locked, in the user's terms. Returns `null`
   * only when the button is actually enabled.
   *
   * Audit 2026-08-15: the empty-grid case (`total === 0`) used to render
   * NOTHING — a padlocked button with no tooltip and no text, on the very
   * first screen a teacher sees. The shortage case also just counted cells
   * ("faltan 1") without saying what to do about it.
   */
  protected lockReason(): string | null {
    const { current, total } = this.store.progress();
    if (total === 0) {
      return 'Escribe cuántas preguntas quieres en al menos una celda para poder generar el examen.';
    }
    const missing = total - current;
    if (missing <= 0) {
      return null;
    }
    return missing === 1
      ? 'Falta 1 celda con más preguntas pedidas que disponibles — baja la cantidad o agrega preguntas al banco.'
      : `Faltan ${missing} celdas con más preguntas pedidas que disponibles — baja la cantidad o agrega preguntas al banco.`;
  }

  protected onGenerateVersions(): void {
    if (!this.store.allSatisfiable() || this.generating()) {
      return;
    }

    const gradeLevel = this.selectedGradeLevel();
    if (!gradeLevel) {
      return;
    }

    this.generating.set(true);
    this.generateError.set(null);

    const blueprint: CreateExamBlueprintRow[] = this.store
      .requestedCells()
      .map((key) => toCreateExamBlueprintRow(key, this.store.requested().get(key) ?? 0));

    const title = this.examTitle().trim() || defaultExamTitle(gradeLevel);

    // Creates the exam as `draft` and STOPS there — generation moved to the
    // review screen (product decision 2026-08-17, option (a) of the
    // 2026-08-15 audit). This used to chain straight into
    // `generateVersions()`, and since the API auto-confirms a draft at
    // enqueue time, one click both created and SEALED an exam the teacher had
    // never read: back on the review screen every "Cambiar" was disabled and
    // no endpoint exists to reopen it. The chosen form count rides along as a
    // query param so the extra step costs the teacher no extra decision.
    this.examsService.createExam({ title, gradeLevel, blueprint }).subscribe({
      next: (created) => {
        this.generating.set(false);
        // The work is now a real exam on the server — keeping the draft
        // would re-open the builder pre-filled with an exam that already
        // exists. Cleared BEFORE navigating so the effect can't re-save it.
        this.clearPersistedState();
        this.router.navigate(['/app/exams', created.id], { queryParams: { formas: this.versionCount() } });
      },
      error: () => {
        this.generating.set(false);
        this.generateError.set('No se pudo crear el examen. Inténtalo de nuevo.');
      },
    });
  }
}
