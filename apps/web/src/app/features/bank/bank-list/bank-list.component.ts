import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, forkJoin, map, switchMap } from 'rxjs';
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
  Sparkles,
  Upload,
} from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { ModalComponent } from '../../../ui/modal/modal.component';
import { InputComponent } from '../../../ui/input/input.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { MathTextComponent } from '../../../ui/math-text/math-text.component';
import { truncateTypst, typstToPlainText } from '../../../shared/typst/typst-to-latex';
import { TagVariant } from '../../../ui/ui.types';
import { BankService } from '../bank.service';
import { BankQuestion, GRADE_LEVELS, GRADE_LEVEL_LABELS, UpdateQuestionPayload } from '../bank.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { AiService } from '../../ai/ai.service';
import { extractErrorMessage } from '../../ai/extract-error-message';
import { buildQuestionTree, filterQuestionTree, QuestionTreeCourseNode, QuestionTreeTopicNode } from './bank-question-tree';
import { QuestionTaxonomyFieldsComponent } from '../question-edit/question-taxonomy-fields.component';
import { QuestionContentFieldsComponent } from '../question-edit/question-content-fields.component';
import { AiReviseBoxComponent } from '../question-edit/ai-revise-box.component';
import { parseAlternativesList } from '../question-edit/parse-alternatives.util';

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
 * fetches all courses' topics in a single batched
 * `TaxonomyService.getTopicsForCourses()` call instead of one `getTopics`
 * request per course (fixes the N+1 fan-out that used to trip the global
 * ThrottlerGuard).
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
 *
 * Task 9: the edit form (structured questions only) also has an "Editar con
 * IA" box (`aiInstruction`/`ai-revise`) that calls
 * `AiService.reviseQuestion(selected().id, instruction)` and, on success,
 * POPULATES `editBody`/`editAlternatives`/`editCorrectAnswer` — it never
 * calls `saveEdit` itself, so the AI never auto-saves; the teacher still
 * reviews the suggestion in the form and clicks Guardar.
 * `AiRevisedQuestion.correctAnswer` is already a 0-based index — same
 * canonical format `editCorrectAnswer` uses everywhere else — so
 * `reviseWithAi` populates it directly, no conversion. See
 * `normalizeCorrectAnswer` for why the edit form standardizes on index
 * instead of the legacy letter format.
 *
 * Task 10: the same edit form also has an OCR box (`ocr-upload`/`ocr-run`)
 * that reads a photographed question via
 * `AiService.extractQuestionFromImage(file)` and POPULATES the same
 * structured signals `reviseWithAi` does, the same way (including
 * `correctAnswer` as a direct index, no conversion) — it's the sibling
 * entry point into the same review-before-save flow, and shares `aiError`/
 * `ai-error` for failures.
 */
@Component({
  selector: 'app-bank-list',
  standalone: true,
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    ModalComponent,
    InputComponent,
    SelectComponent,
    TagComponent,
    MathTextComponent,
    QuestionTaxonomyFieldsComponent,
    QuestionContentFieldsComponent,
    AiReviseBoxComponent,
    LucideAngularModule,
  ],
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
      Sparkles,
      Upload,
    }).providers ?? [],
  ],
  templateUrl: './bank-list.component.html',
})
export class BankListComponent {
  private readonly bankService = inject(BankService);
  private readonly taxonomyService = inject(TaxonomyService);
  private readonly aiService = inject(AiService);
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
  protected readonly pendingDelete = signal<BankQuestion | null>(null);
  protected readonly pendingArchive = signal<BankQuestion | null>(null);

  // --- Task 8: inline edit mode -------------------------------------------------
  protected readonly editing = signal(false);
  protected readonly editSaving = signal(false);
  protected readonly editError = signal<string | null>(null);
  protected readonly editCourseId = signal('');
  protected readonly editTopicId = signal('');
  protected readonly editDifficulty = signal<Difficulty | null>(null);
  protected readonly editGradeLevel = signal<string | null>(null);
  /**
   * TYPE-DEPENDENT clave. For `structured` questions this is a 0-based INDEX
   * string ("0".."4") into `editAlternatives` — the backend's format, see
   * `normalizeCorrectAnswer`; `startEdit` normalizes legacy letter rows into
   * an index when seeding it, `reviseWithAi`/`extractFromImage` populate it
   * directly from the AI response (already an index). For `image` questions
   * this is the LETTER of the marked option (a/b/c/d) — image rows have no
   * `alternatives` to index into, so `startEdit` seeds (and `saveEdit` sends)
   * the letter verbatim, NEVER normalized to an index.
   */
  protected readonly editCorrectAnswer = signal('');
  protected readonly editBody = signal('');
  protected readonly editAlternatives = signal('');
  protected readonly editImageFile = signal<File | null>(null);
  protected readonly editImagePreviewUrl = signal<string | null>(null);

  // --- Task 9: AI instruction box inside the edit form ---------------------------
  /** Free-text instruction ("hazla más difícil…") sent verbatim to `AiService.reviseQuestion`. */
  protected readonly aiInstruction = signal('');
  protected readonly revising = signal(false);
  protected readonly aiError = signal<string | null>(null);

  // --- Task 10: OCR extraction inside the same edit form -------------------------
  /** The photographed-question file picked in `[data-testid="ocr-upload"]`, sent to `extractFromImage`. */
  protected readonly ocrFile = signal<File | null>(null);
  protected readonly extracting = signal(false);

  protected readonly courseOptions = computed<SelectOption<string>[]>(() =>
    this.courses().map((course) => ({ value: course.id, label: course.name })),
  );
  /** `topics()` (the full unscoped catalog) filtered live to the edit form's currently selected curso — no extra HTTP call on curso change. */
  protected readonly editTopicOptions = computed<SelectOption<string>[]>(() =>
    this.topics()
      .filter((topic) => topic.courseId === this.editCourseId())
      .map((topic) => ({ value: topic.id, label: topic.name })),
  );
  /**
   * Clave (respuesta correcta) options for the structured edit form's
   * `<select>`: one option per line of `editAlternatives`, lettered a/b/c…
   * for the label but valued by 0-based INDEX (the canonical
   * `editCorrectAnswer` format — see `normalizeCorrectAnswer`).
   */
  protected readonly editCorrectAnswerOptions = computed<SelectOption<string>[]>(() =>
    this.editAlternativesList().map((text, index) => ({
      value: String(index),
      label: `${String.fromCharCode(97 + index)}) ${text}`,
    })),
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
   * Resolves id->name maps for every course/topic via a single batched
   * `getTopicsForCourses()` call (fixes the N+1 fan-out where this used to
   * issue one `getTopics(courseId)` request per course via `forkJoin` — see
   * class doc).
   */
  private fetchTaxonomy(): Observable<{
    courseNames: ReadonlyMap<string, string>;
    topicNames: ReadonlyMap<string, string>;
    courses: readonly Course[];
    topics: readonly Topic[];
  }> {
    return this.taxonomyService.getCourses().pipe(
      switchMap((courses) =>
        this.taxonomyService.getTopicsForCourses(courses.map((course) => course.id)).pipe(
          map((topics) => ({
            courseNames: new Map(courses.map((course) => [course.id, course.name])),
            topicNames: new Map(topics.map((topic) => [topic.id, topic.name])),
            courses,
            topics,
          })),
        ),
      ),
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
   * leaf — PLAIN TEXT, deliberately not typeset.
   *
   * The leaf is a one-line index clipped by the template's `truncate` class,
   * and typeset math cannot survive that: KaTeX lays stretchy delimiters out
   * as absolutely-positioned spans, so a row clipped mid-expression strands
   * their glyphs across it (`(. ( ) ) (`). Truncating the source first does
   * not fix it — 70 characters of Typst still typeset wider than the row. The
   * rendered statement lives in the detail panel, which has room for it.
   *
   * `null` for image questions (they have no statement text; the leaf falls
   * back to the answer key), so text questions stop rendering as blank cards.
   */
  protected questionSnippet(question: BankQuestion): string | null {
    const text = typstToPlainText(question.bodyTypst ?? '');
    return text ? truncateTypst(text, 70) : null;
  }

  /** Alternatives of a structured question, lettered a/b/c…, with the `correctAnswer` one flagged. Empty for image questions. */
  protected alternativeRows(question: BankQuestion): { letter: string; text: string; correct: boolean }[] {
    const alternatives = question.alternatives ?? [];
    const correctIndex = normalizeCorrectAnswer(question.correctAnswer);
    return alternatives.map((text, index) => {
      const letter = String.fromCharCode(97 + index);
      return { letter, text, correct: String(index) === correctIndex };
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

  protected requestArchive(question: BankQuestion): void {
    this.pendingArchive.set(question);
  }

  protected cancelArchive(): void {
    this.pendingArchive.set(null);
  }

  protected confirmArchive(): void {
    const question = this.pendingArchive();
    if (!question) return;
    this.pendingArchive.set(null);
    this.actionError.set(null);
    this.bankService.archiveQuestion(question.id).subscribe({
      next: () => {
        this.selected.set(null);
        this.search();
      },
      error: () => this.actionError.set('No se pudo archivar la pregunta. Inténtalo de nuevo.'),
    });
  }

  protected requestDelete(question: BankQuestion): void {
    this.pendingDelete.set(question);
  }

  protected cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  protected confirmDelete(): void {
    const question = this.pendingDelete();
    if (!question) return;
    this.pendingDelete.set(null);
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
    // correctAnswer format is TYPE-DEPENDENT: structured questions store a
    // 0-based INDEX into `alternatives` (normalized from any legacy letter),
    // but image questions store the LETTER of the marked option (a/b/c/d) and
    // have no `alternatives` to index into — so a letter is CORRECT there and
    // must NOT be normalized to an index (that would corrupt the clave).
    this.editCorrectAnswer.set(
      question.type === 'structured' ? normalizeCorrectAnswer(question.correctAnswer) : question.correctAnswer,
    );
    this.editBody.set(question.bodyTypst ?? '');
    this.editAlternatives.set((question.alternatives ?? []).join('\n'));
    this.discardEditImage();
    this.resetAiRevise();
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
    this.resetAiRevise();
  }

  /** Resets both AI-assist affordances in the edit form (Task 9's revise box AND Task 10's OCR box) — called on `startEdit`/`cancelEdit`. */
  private resetAiRevise(): void {
    this.aiInstruction.set('');
    this.revising.set(false);
    this.aiError.set(null);
    this.ocrFile.set(null);
    this.extracting.set(false);
  }

  private editAlternativesList(): string[] {
    return parseAlternativesList(this.editAlternatives());
  }

  /**
   * Task 9: AI-assisted revision of the question currently being edited.
   * Calls `AiService.reviseQuestion` with the free-text `aiInstruction` and,
   * on success, POPULATES the edit-form signals (`editBody`/`editAlternatives`/
   * `editCorrectAnswer`) the same way `startEdit` seeds them — it never calls
   * `saveEdit` itself, so the teacher always reviews the AI's suggestion
   * before it's persisted. `alternatives` is joined one-per-line to match
   * `editAlternativesList`'s parsing, and the response's 0-based INDEX
   * `correctAnswer` (see `AiRevisedQuestion`) is set DIRECTLY — it is already
   * the edit form's canonical INDEX format (structured stays index), no
   * letter conversion.
   */
  protected reviseWithAi(): void {
    const question = this.selected();
    if (!question || this.revising()) {
      return;
    }
    this.revising.set(true);
    this.aiError.set(null);

    this.aiService.reviseQuestion(question.id, this.aiInstruction()).subscribe({
      next: (revised) => {
        this.editBody.set(revised.bodyTypst);
        this.editAlternatives.set(revised.alternatives.join('\n'));
        this.editCorrectAnswer.set(revised.correctAnswer);
        this.revising.set(false);
      },
      error: () => {
        this.revising.set(false);
        this.aiError.set('No se pudo revisar la pregunta con IA. Inténtalo de nuevo.');
      },
    });
  }

  protected onOcrFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.ocrFile.set(input.files?.[0] ?? null);
  }

  /**
   * Task 10: OCR extraction of a structured question from a photographed
   * image — `AiService.extractQuestionFromImage`. POPULATES the SAME
   * edit-form signals `reviseWithAi` does (`editBody`/`editAlternatives`/
   * `editCorrectAnswer`), the same way: it never calls `saveEdit` itself, so
   * the teacher still reviews the extracted text/alternatives/clave in the
   * form before clicking Guardar. `alternatives` is joined one-per-line to
   * match `editAlternativesList`'s parsing, and `AiRevisedQuestion.correctAnswer`
   * is already a 0-based INDEX (same canonical format as `editCorrectAnswer`
   * everywhere else) — populated DIRECTLY, no letter conversion. Failures
   * reuse `aiError`/`ai-error` from Task 9.
   */
  protected extractFromImage(): void {
    const file = this.ocrFile();
    if (!file || this.extracting()) {
      return;
    }
    this.extracting.set(true);
    this.aiError.set(null);

    this.aiService.extractQuestionFromImage(file).subscribe({
      next: (extracted) => {
        this.editBody.set(extracted.bodyTypst);
        this.editAlternatives.set(extracted.alternatives.join('\n'));
        this.editCorrectAnswer.set(extracted.correctAnswer);
        this.extracting.set(false);
      },
      error: () => {
        this.extracting.set(false);
        this.aiError.set('No se pudo leer la pregunta desde la imagen. Inténtalo de nuevo.');
      },
    });
  }

  /**
   * Builds `UpdateQuestionPayload` (NEVER `courseId` — the backend moves a
   * question's course via `topicId`, see `UpdateQuestionPayload`'s doc) and
   * calls `updateQuestion`. The payload is TYPE-DEPENDENT:
   * - `structured`: taxonomy + `bodyTypst` + `alternatives` + an INDEX
   *   `correctAnswer` (no image).
   * - `image`: taxonomy + a LETTER `correctAnswer` ONLY (never
   *   `bodyTypst`/`alternatives`); and if the user picked a replacement file,
   *   `replaceQuestionImage` runs AFTER the patch succeeds so BOTH the
   *   taxonomy/clave edit and the image swap land.
   * Either way, on success the tree + selected detail are reloaded and edit
   * mode exits.
   */
  protected saveEdit(): void {
    const question = this.selected();
    // Guard the empty-topic dead-end: changing Curso resets `editTopicId` to
    // '' (tema is course-scoped), and a PATCH with `topicId: ''` 400s. The
    // save button is also `[disabled]` in this state — this is the belt to
    // that suspenders.
    if (!question || this.editSaving() || !this.editTopicId()) {
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
      error: (e: HttpErrorResponse) => {
        this.editSaving.set(false);
        // Surface the server's real reason (validation list / Typst compile
        // stderr) — the teacher can't fix what they can't see.
        this.editError.set(extractErrorMessage(e));
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

/**
 * Normalizes a stored `correctAnswer` to a 0-based index string. The backend
 * (`PATCH /bank/questions/:id`, `AiRevisedQuestion`) treats structured
 * `correctAnswer` as a 0-based INDEX into `alternatives` ("0".."4") and 400s
 * on anything else — but legacy rows (seeded/manually-created) store a
 * LETTER (a..e) instead. The frontend standardizes on INDEX everywhere
 * (`alternativeRows`, the edit form) and normalizes legacy letters
 * defensively here rather than migrating existing data. Non-letter values
 * (already an index, or free-text answers on image questions) pass through
 * unchanged.
 */
function normalizeCorrectAnswer(value: string): string {
  return /^[a-e]$/i.test(value) ? String(value.toLowerCase().charCodeAt(0) - 97) : value;
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
