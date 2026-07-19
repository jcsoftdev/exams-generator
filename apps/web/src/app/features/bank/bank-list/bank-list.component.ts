import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, forkJoin, map, of, switchMap } from 'rxjs';
import {
  LucideAngularModule,
  Search,
  ChevronDown,
  ChevronRight,
  Lock,
  Pencil,
  Archive,
  Trash2,
  Image,
  FileText,
  Expand,
  Minimize2,
  Check,
} from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { InputComponent } from '../../../ui/input/input.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { TagVariant } from '../../../ui/ui.types';
import { BankService } from '../bank.service';
import { BankQuestion, GRADE_LEVELS, GRADE_LEVEL_LABELS, UpdateQuestionPayload } from '../bank.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { buildQuestionTree, filterQuestionTree, QuestionTreeCourseNode, QuestionTreeTopicNode } from './bank-question-tree';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};

/** Maps bank difficulty values to the design-system tag's semantic variants (QB-R1). */
const DIFFICULTY_TAG_VARIANT: Record<Difficulty, TagVariant> = {
  [Difficulty.Easy]: 'easy',
  [Difficulty.Medium]: 'medium',
  [Difficulty.Hard]: 'hard',
};

const ERROR_MESSAGE = 'No se pudieron cargar las preguntas. Inténtalo de nuevo.';

/**
 * Question-bank screen, tree redesign: a two-column split where the left
 * column is a collapsible Curso -> Tema -> preguntas tree (replacing the
 * flat paginated list + raw UUID subtitles) and the right column is the
 * unchanged `bank-panel` detail view.
 *
 * Grouping/name-resolution is a pure transform (`buildQuestionTree`) fed by
 * the flat `GET /bank/questions` array (`BankService.listQuestions` — no
 * pagination needed, ~71 rows) plus id->name maps resolved once from
 * `TaxonomyService.getCourses()` + one `getTopics(courseId)` call per course
 * (the Angular `TaxonomyService` wrapper requires a `courseId`, so this
 * fetches all courses' topics via `forkJoin` instead of a single unscoped
 * call — see apply-progress deviations).
 *
 * Courses AND topics default COLLAPSED on every fetch (progressive
 * disclosure — avoids dumping every topic of every course on load, which
 * for a bank of ~19 courses/40+ topics per course was an unscannable wall).
 * Expanding a course reveals only its topic list (still collapsed);
 * expanding a topic reveals its leaf questions. Search force-expands
 * matching branches (`isFiltering()`), and "Expandir todo" still opens
 * everything at once. Only branches with at least one question render
 * (empty branches never appear).
 *
 * Distinguishes TWO empty states (QB-R2): "banco vacío" (the tenant's bank
 * has zero questions at all, regardless of filters) vs "sin resultados"
 * (the bank has questions, but the current filters match none). Tracked via
 * `bankHasAnyQuestions`, set `true` the first time ANY response (filtered or
 * not) returns at least one question.
 *
 * Thumbnails are fetched as authenticated blobs (see `loadImages` —
 * `/assets/:id` is Bearer-JWT protected, a raw `<img src>` never sends that
 * header), lazily: only for topics that are actually expanded/visible
 * (`visibleExpandedTopics` + an `effect` that fires `loadImages` once per
 * newly-visible topic) — avoids up to 71 parallel fetches on initial load.
 * Structured questions (no `imageAssetId`) and image questions with no
 * asset yet get a neutral lucide placeholder icon instead of a blank box.
 *
 * The free-text search box (`filterQuery`) filters the tree live via the
 * pure `filterQuestionTree` transform (clave/course/topic substring match);
 * while a query is active, every surviving branch renders force-expanded
 * (`isFiltering()` short-circuits `isCourseExpanded`/`isTopicExpanded`) so
 * matches are always visible without extra clicks. Expand-all/collapse-all
 * operate on the underlying expand-state signals directly.
 *
 * Action gating (`canArchive`/`canDelete`/`isCentral`) mirrors the backend's
 * own rules (Lane D4: S4 archives only `approved`, S5 deletes only own
 * `draft`; `origin === 'central'`/`tenantId === null` is always read-only) —
 * this is UX gating only, the backend is still the source of truth and
 * re-validates on every call.
 *
 * Task 8: the "Editar" action no longer navigates to the `bank-new` stub —
 * it flips the detail panel into an inline edit form (`editing` signal).
 * Curso/tema reuse the SAME full taxonomy already loaded for the tree
 * (`courses`/`topics`, fetched once in `fetchTaxonomy`) instead of issuing
 * new HTTP calls, so changing curso in the form just re-filters the local
 * `topics` array by `courseId` (`editTopicOptions`). `saveEdit()` never
 * sends `courseId` (backend contract: course moves via `topicId` only) and
 * only includes `bodyTypst`/`alternatives` for `type: 'structured'`
 * questions. A new image file (if picked) is uploaded via
 * `replaceQuestionImage` AFTER `updateQuestion` succeeds, then the tree +
 * selected detail are both reloaded and the panel exits edit mode.
 */
@Component({
  selector: 'app-bank-list',
  standalone: true,
  imports: [ButtonComponent, EmptyStateComponent, InputComponent, SelectComponent, TagComponent, LucideAngularModule],
  // Local (component-scoped) icon pick — Angular's Lucide icon token is NOT a multi-provider, so a
  // local `pick()` SHADOWS (does not merge with) the app-level one in app.config.ts. This must list
  // every icon the template uses, including ones the global config also registers (search,
  // chevron-down/right, lock, pencil, archive, trash-2), plus the new ones (image, file-text,
  // expand, minimize-2) — otherwise those would 404 at runtime ("icon has not been provided").
  providers: [
    LucideAngularModule.pick({
      Search,
      ChevronDown,
      ChevronRight,
      Lock,
      Pencil,
      Archive,
      Trash2,
      Image,
      FileText,
      Expand,
      Minimize2,
      Check,
    }).providers ?? [],
  ],
  templateUrl: './bank-list.component.html',
})
export class BankListComponent {
  private readonly bankService = inject(BankService);
  private readonly taxonomyService = inject(TaxonomyService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly difficulties = Object.values(Difficulty);
  protected readonly difficultyLabels = DIFFICULTY_LABELS;
  protected readonly gradeLevelOptions = GRADE_LEVELS.map((gradeLevel) => ({
    value: gradeLevel,
    label: GRADE_LEVEL_LABELS[gradeLevel],
  }));
  protected readonly difficultyOptions = this.difficulties.map((difficulty) => ({
    value: difficulty,
    label: DIFFICULTY_LABELS[difficulty],
  }));

  protected readonly difficulty = signal<Difficulty | null>(null);
  protected readonly gradeLevel = signal<string | null>(null);

  protected readonly questions = signal<BankQuestion[]>([]);
  private readonly courseNames = signal<ReadonlyMap<string, string>>(new Map());
  private readonly topicNames = signal<ReadonlyMap<string, string>>(new Map());
  /** Full taxonomy (every course/topic, unscoped by grade) loaded once in `fetchTaxonomy` — reused by the edit form's curso/tema selects instead of new HTTP calls. */
  private readonly courses = signal<readonly Course[]>([]);
  private readonly topics = signal<readonly Topic[]>([]);
  private readonly taxonomyLoaded = signal(false);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  /** Set true the first time ANY response (filtered or not) is non-empty — drives QB-R2's two-empty-states split. */
  protected readonly bankHasAnyQuestions = signal(false);

  protected readonly selected = signal<BankQuestion | null>(null);
  protected readonly actionError = signal<string | null>(null);

  // --- Task 8: inline edit mode -------------------------------------------------
  protected readonly editing = signal(false);
  protected readonly editSaving = signal(false);
  protected readonly editError = signal<string | null>(null);
  protected readonly editCourseId = signal('');
  protected readonly editTopicId = signal('');
  protected readonly editDifficulty = signal<Difficulty | null>(null);
  protected readonly editGradeLevel = signal<string | null>(null);
  protected readonly editCorrectAnswer = signal('');
  protected readonly editBody = signal('');
  protected readonly editAlternatives = signal('');
  protected readonly editImageFile = signal<File | null>(null);
  protected readonly editImagePreviewUrl = signal<string | null>(null);

  protected readonly courseOptions = computed<SelectOption<string>[]>(() =>
    this.courses().map((course) => ({ value: course.id, label: course.name })),
  );
  /** `topics()` (the full unscoped catalog) filtered live to the edit form's currently selected curso — no extra HTTP call on curso change. */
  protected readonly editTopicOptions = computed<SelectOption<string>[]>(() =>
    this.topics()
      .filter((topic) => topic.courseId === this.editCourseId())
      .map((topic) => ({ value: topic.id, label: topic.name })),
  );
  /** Amber used-in-exams warning (edit form only): only for an `approved` question already referenced by at least one exam. */
  protected readonly editShowUsedWarning = computed(() => {
    const question = this.selected();
    return !!question && question.status === 'approved' && (question.usedInExamCount ?? 0) > 0;
  });

  /** `imageAssetId` -> `blob:` object URL, populated lazily by `loadImages`. */
  protected readonly imageUrls = signal<Record<string, string>>({});
  /** Every object URL this component has ever created, revoked on destroy. */
  private readonly objectUrls: string[] = [];

  private readonly expandedCourses = signal<ReadonlySet<string>>(new Set());
  private readonly expandedTopics = signal<ReadonlySet<string>>(new Set());

  /** Free-text search box value — filters the tree live (clave, course name, or topic name). */
  protected readonly filterQuery = signal('');
  /** True while a non-blank search query is active — forces every surviving branch open. */
  protected readonly isFiltering = computed(() => this.filterQuery().trim().length > 0);

  /** Every `topicId` an image fetch has already been requested for — guards the lazy-load effect against duplicate HTTP calls. */
  private readonly requestedImageTopics = new Set<string>();

  /** Curso -> Tema -> preguntas, grouped/sorted/name-resolved from the flat question list (QB tree redesign). */
  protected readonly tree = computed<QuestionTreeCourseNode[]>(() =>
    buildQuestionTree(this.questions(), this.courseNames(), this.topicNames()),
  );

  /** `tree()` filtered live by `filterQuery()` — matching branches stay, non-matching hide. */
  protected readonly filteredTree = computed<QuestionTreeCourseNode[]>(() =>
    filterQuestionTree(this.tree(), this.filterQuery()),
  );

  /** Topics currently rendered AND expanded (manual toggle, or force-expanded while filtering) — drives lazy thumbnail loading. */
  private readonly visibleExpandedTopics = computed<readonly QuestionTreeTopicNode[]>(() => {
    const visible: QuestionTreeTopicNode[] = [];
    for (const course of this.filteredTree()) {
      if (!this.isCourseExpanded(course.courseId)) {
        continue;
      }
      for (const topic of course.topics) {
        if (this.isTopicExpanded(topic.topicId)) {
          visible.push(topic);
        }
      }
    }
    return visible;
  });

  constructor() {
    this.loadInitial();
    this.destroyRef.onDestroy(() => {
      for (const url of this.objectUrls) {
        URL.revokeObjectURL(url);
      }
    });
    // Lazy thumbnail loading: fetch a topic's images the first time it becomes visible+expanded
    // (manual toggle, "expand all", or auto-expand while filtering) — never all 71 up front.
    effect(() => {
      for (const topic of this.visibleExpandedTopics()) {
        if (!this.requestedImageTopics.has(topic.topicId)) {
          this.requestedImageTopics.add(topic.topicId);
          this.loadImages(topic.questions);
        }
      }
    });
  }

  private loadInitial(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    forkJoin({ taxonomy: this.fetchTaxonomy(), questions: this.fetchQuestions() }).subscribe({
      next: ({ taxonomy, questions }) => {
        this.courseNames.set(taxonomy.courseNames);
        this.topicNames.set(taxonomy.topicNames);
        this.courses.set(taxonomy.courses);
        this.topics.set(taxonomy.topics);
        this.taxonomyLoaded.set(true);
        this.applyQuestions(questions);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set(ERROR_MESSAGE);
      },
    });
  }

  protected search(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.fetchQuestions().subscribe({
      next: (questions) => {
        this.applyQuestions(questions);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set(ERROR_MESSAGE);
      },
    });
  }

  protected retry(): void {
    if (this.taxonomyLoaded()) {
      this.search();
    } else {
      this.loadInitial();
    }
  }

  private fetchQuestions(): Observable<BankQuestion[]> {
    return this.bankService.listQuestions({
      difficulty: this.difficulty() ?? undefined,
      gradeLevel: this.gradeLevel() ?? undefined,
    });
  }

  /**
   * Resolves id->name maps for every course/topic. The Angular
   * `TaxonomyService.getTopics()` wrapper requires a `courseId` (unlike the
   * raw `GET /topics` endpoint, which also accepts no filter), so this
   * fans out one `getTopics(courseId)` call per course via `forkJoin`
   * instead of a single unscoped request — see class doc + apply-progress.
   */
  private fetchTaxonomy(): Observable<{
    courseNames: ReadonlyMap<string, string>;
    topicNames: ReadonlyMap<string, string>;
    courses: readonly Course[];
    topics: readonly Topic[];
  }> {
    return this.taxonomyService.getCourses().pipe(
      switchMap((courses) => {
        const topics$ = courses.length
          ? forkJoin(courses.map((course) => this.taxonomyService.getTopics(course.id)))
          : of([]);
        return topics$.pipe(
          map((topicsByCourse) => {
            const topics = topicsByCourse.flat();
            return {
              courseNames: new Map(courses.map((course) => [course.id, course.name])),
              topicNames: new Map(topics.map((topic) => [topic.id, topic.name])),
              courses,
              topics,
            };
          }),
        );
      }),
    );
  }

  private applyQuestions(questions: readonly BankQuestion[]): void {
    this.questions.set([...questions]);
    if (questions.length > 0) {
      this.bankHasAnyQuestions.set(true);
    }
    // Courses AND topics reset to collapsed (progressive disclosure) on every fetch — see class doc.
    // Thumbnails are NOT loaded here — the `visibleExpandedTopics` effect lazy-loads a topic's
    // images the first time it actually becomes visible+expanded.
    this.expandedCourses.set(new Set());
    this.expandedTopics.set(new Set());
  }

  protected toggleCourse(courseId: string): void {
    this.expandedCourses.update((current) => toggleInSet(current, courseId));
  }

  protected toggleTopic(topicId: string): void {
    this.expandedTopics.update((current) => toggleInSet(current, topicId));
  }

  protected isCourseExpanded(courseId: string): boolean {
    return this.isFiltering() || this.expandedCourses().has(courseId);
  }

  protected isTopicExpanded(topicId: string): boolean {
    return this.isFiltering() || this.expandedTopics().has(topicId);
  }

  /** Expands every course and topic currently in the (unfiltered) tree. */
  protected expandAll(): void {
    this.expandedCourses.set(new Set(this.tree().map((course) => course.courseId)));
    this.expandedTopics.set(new Set(this.tree().flatMap((course) => course.topics.map((topic) => topic.topicId))));
  }

  /** Collapses every course and topic. */
  protected collapseAll(): void {
    this.expandedCourses.set(new Set());
    this.expandedTopics.set(new Set());
  }

  protected chevronFor(expanded: boolean): string {
    return expanded ? 'chevron-down' : 'chevron-right';
  }

  /** Neutral lucide placeholder for a leaf with no loaded thumbnail: `file-text` for structured questions (no image asset at all), `image` otherwise (image-type question, thumbnail pending or missing). */
  protected leafPlaceholderIcon(question: BankQuestion): string {
    return question.type === 'structured' ? 'file-text' : 'image';
  }

  /**
   * Short one-line preview of a structured question's statement for the tree
   * leaf — `bodyTypst` is raw Typst, so it's shown as-is (collapsed whitespace,
   * truncated). `null` for image questions (they have no statement text; the
   * leaf falls back to the answer key), so text questions stop rendering as
   * blank cards.
   */
  protected questionSnippet(question: BankQuestion): string | null {
    const raw = (question.bodyTypst ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) {
      return null;
    }
    return raw.length > 70 ? `${raw.slice(0, 70)}…` : raw;
  }

  /** Alternatives of a structured question, lettered a/b/c…, with the `correctAnswer` one flagged. Empty for image questions. */
  protected alternativeRows(question: BankQuestion): { letter: string; text: string; correct: boolean }[] {
    const alternatives = question.alternatives ?? [];
    return alternatives.map((text, index) => {
      const letter = String.fromCharCode(97 + index);
      return { letter, text, correct: letter === question.correctAnswer.toLowerCase() };
    });
  }

  protected select(question: BankQuestion): void {
    this.actionError.set(null);
    this.cancelEdit();
    this.selected.set(question);
    this.bankService.getQuestion(question.id).subscribe({
      next: (full) => this.selected.set(full),
      error: () => {},
    });
  }

  protected isCentral(question: BankQuestion): boolean {
    return question.origin === 'central' || question.tenantId === null;
  }

  protected canArchive(question: BankQuestion): boolean {
    return !this.isCentral(question) && question.status === 'approved';
  }

  protected canDelete(question: BankQuestion): boolean {
    return !this.isCentral(question) && question.status === 'draft';
  }

  protected archive(question: BankQuestion): void {
    this.actionError.set(null);
    this.bankService.archiveQuestion(question.id).subscribe({
      next: () => {
        this.selected.set(null);
        this.search();
      },
      error: () => this.actionError.set('No se pudo archivar la pregunta. Inténtalo de nuevo.'),
    });
  }

  protected remove(question: BankQuestion): void {
    this.actionError.set(null);
    this.bankService.deleteQuestion(question.id).subscribe({
      next: () => {
        this.selected.set(null);
        this.search();
      },
      error: () => this.actionError.set('No se pudo borrar la pregunta. Inténtalo de nuevo.'),
    });
  }

  /** Flips the detail panel into edit mode, seeding every edit signal from the currently selected (full-detail) question. */
  protected startEdit(question: BankQuestion): void {
    this.editError.set(null);
    this.editCourseId.set(question.courseId);
    this.editTopicId.set(question.topicId);
    this.editDifficulty.set(question.difficulty);
    this.editGradeLevel.set(question.gradeLevel);
    this.editCorrectAnswer.set(question.correctAnswer);
    this.editBody.set(question.bodyTypst ?? '');
    this.editAlternatives.set((question.alternatives ?? []).join('\n'));
    this.discardEditImage();
    this.editing.set(true);
  }

  /** Curso changed in the edit form: tema is scoped to a course, so it's always reset — the user must re-pick it. */
  protected onEditCourseChange(courseId: string | null): void {
    this.editCourseId.set(courseId ?? '');
    this.editTopicId.set('');
  }

  protected onEditImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    const previousPreview = this.editImagePreviewUrl();
    if (previousPreview) {
      URL.revokeObjectURL(previousPreview);
    }
    this.editImageFile.set(file);
    this.editImagePreviewUrl.set(file ? URL.createObjectURL(file) : null);
  }

  private discardEditImage(): void {
    const previousPreview = this.editImagePreviewUrl();
    if (previousPreview) {
      URL.revokeObjectURL(previousPreview);
    }
    this.editImageFile.set(null);
    this.editImagePreviewUrl.set(null);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
    this.editError.set(null);
    this.discardEditImage();
  }

  private editAlternativesList(): string[] {
    return this.editAlternatives()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Builds `UpdateQuestionPayload` (NEVER `courseId` — the backend moves a
   * question's course via `topicId`, see `UpdateQuestionPayload`'s doc) and
   * calls `updateQuestion`; `bodyTypst`/`alternatives` are only included for
   * `type: 'structured'` questions. If the user picked a new image file,
   * `replaceQuestionImage` runs AFTER the patch succeeds. Either way, on
   * success the tree + selected detail are reloaded and edit mode exits.
   */
  protected saveEdit(): void {
    const question = this.selected();
    if (!question || this.editSaving()) {
      return;
    }
    this.editSaving.set(true);
    this.editError.set(null);

    const patch: UpdateQuestionPayload = {
      topicId: this.editTopicId(),
      difficulty: this.editDifficulty() ?? undefined,
      gradeLevel: this.editGradeLevel() ?? undefined,
      correctAnswer: this.editCorrectAnswer(),
      ...(question.type === 'structured'
        ? { bodyTypst: this.editBody(), alternatives: this.editAlternativesList() }
        : {}),
    };

    this.bankService.updateQuestion(question.id, patch).subscribe({
      next: () => {
        const file = this.editImageFile();
        if (!file) {
          this.finishSaveEdit(question.id);
          return;
        }
        this.bankService.replaceQuestionImage(question.id, file).subscribe({
          next: () => this.finishSaveEdit(question.id),
          error: () => {
            this.editSaving.set(false);
            this.editError.set(
              'Se guardaron los cambios, pero no se pudo reemplazar la imagen. Inténtalo de nuevo.',
            );
          },
        });
      },
      error: () => {
        this.editSaving.set(false);
        this.editError.set('No se pudo guardar la pregunta. Inténtalo de nuevo.');
      },
    });
  }

  private finishSaveEdit(id: string): void {
    this.editing.set(false);
    this.editSaving.set(false);
    this.discardEditImage();
    this.search();
    this.bankService.getQuestion(id).subscribe({
      next: (full) => this.selected.set(full),
      error: () => {},
    });
  }

  /**
   * `GET /assets/:id` is Bearer-JWT protected, and a plain `<img src>`
   * never sends the Authorization header — binding `buildImageAssetUrl()`
   * directly to `<img src>` would 401. Instead: fetch the bytes through
   * `HttpClient` (the `authInterceptor` attaches the header automatically,
   * same as every other request this app makes) and turn the response into
   * a `blob:` object URL, which `<img>` CAN load without any header.
   */
  private loadImages(questions: readonly BankQuestion[]): void {
    for (const question of questions) {
      const assetId = question.imageAssetId;
      if (!assetId || this.imageUrls()[assetId]) {
        continue;
      }
      this.bankService.fetchQuestionImage(assetId).subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        this.imageUrls.update((current) => ({ ...current, [assetId]: url }));
      });
    }
  }

  protected imageUrl(question: BankQuestion): string | null {
    return question.imageAssetId ? (this.imageUrls()[question.imageAssetId] ?? null) : null;
  }

  protected tagVariantFor(difficulty: Difficulty): TagVariant {
    return DIFFICULTY_TAG_VARIANT[difficulty];
  }

  protected difficultyLabel(difficulty: Difficulty): string {
    return DIFFICULTY_LABELS[difficulty];
  }

  protected goToNew(): void {
    this.router.navigate(['/app/bank/new']);
  }
}

function toggleInSet(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}
