import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { map, switchMap } from 'rxjs';
import { LucideAngularModule } from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { BannerComponent } from '../../../ui/banner/banner.component';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { TagVariant } from '../../../ui/ui.types';
import { ModalComponent } from '../../../ui/modal/modal.component';
import { MathTextComponent } from '../../../ui/math-text/math-text.component';
import { PaginationComponent } from '../../../ui/pagination/pagination.component';
import { truncateTypst, typstToPlainText } from '../../../shared/typst/typst-to-latex';
import { SelectOption } from '../../../ui/select/select.component';
import { AiService } from '../ai.service';
import { extractErrorMessage } from '../extract-error-message';
import { DraftQuestion, GRADE_LEVELS, GRADE_LEVEL_LABELS, GradeLevel } from '../ai.models';
import { DraftCountService } from '../draft-count.service';
import { toPdfPreviewUrl } from '../pdf-preview-url';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { BankService } from '../../bank/bank.service';
import { UpdateQuestionPayload } from '../../bank/bank.models';
import { QuestionTaxonomyFieldsComponent } from '../../bank/question-edit/question-taxonomy-fields.component';
import { QuestionContentFieldsComponent } from '../../bank/question-edit/question-content-fields.component';
import { AiReviseBoxComponent } from '../../bank/question-edit/ai-revise-box.component';
import { parseAlternativesList } from '../../bank/question-edit/parse-alternatives.util';

const ALTERNATIVE_LETTERS = ['a', 'b', 'c', 'd', 'e'];

/**
 * `sessionStorage` key for an in-progress edit of a draft (audit
 * 2026-08-18, "editar y navegar pierde todo sin aviso"). Same precedent as
 * `ExamBuilderComponent.BUILDER_STATE_KEY`: `sessionStorage` (not `local`)
 * so it dies with the tab, and a versioned key so a shape change ignores an
 * old payload instead of crashing on it.
 *
 * Unlike the builder (one exam draft per session), this screen can have many
 * drafts in the queue — so the payload itself carries `draftId` and every
 * restore is gated on an EXACT id match (see `tryRestoreEditDraft`). A
 * single shared key (not one key per draft) is enough because only one edit
 * can be open at a time; the `draftId` field is what "keys" the persisted
 * state to a specific draft, not the storage key itself.
 */
export const EDIT_STATE_KEY = 'ai-review-queue-edit-v1';

/** Everything needed to put the edit form back exactly where the teacher left it, for ONE specific draft. */
interface PersistedEditState {
  readonly draftId: string;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty | null;
  readonly gradeLevel: string | null;
  readonly correctAnswer: string;
  readonly body: string;
  readonly alternatives: string;
  readonly figureCode: string;
  readonly aiInstruction: string;
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};

/** Maps review-queue difficulty values to the design-system tag's semantic variants (same convention as bank-list). */
const DIFFICULTY_TAG_VARIANT: Record<Difficulty, TagVariant> = {
  [Difficulty.Easy]: 'easy',
  [Difficulty.Medium]: 'medium',
  [Difficulty.Hard]: 'hard',
};

/**
 * "Mesa de trabajo" review queue (design doc §5.2 steps 3-5, Task 10; audit
 * fixes for screens design doc §4 pantalla 4): two-column layout — a left
 * list of `status='draft'` structured questions and a right panel showing
 * the WYSIWYG PDF preview (S7 `GET /bank/questions/:id/preview`, embedded
 * via a `blob:` object URL, same authenticated-blob pattern as
 * `fetchQuestionImage`) styled as a printed "paper" (chrome-less viewer via
 * the `#toolbar=0&navpanes=0&scrollbar=0` fragment). The AI never publishes
 * directly to the bank — this screen IS the human curation gate.
 * Approve/Reject advance to the next draft automatically; Reject requires
 * confirmation via `ui-modal`.
 *
 * Course/topic names are resolved once via `TaxonomyService` (`getCourses`
 * + one batched `getTopicsForCourses()` call, same pattern as
 * `BankListComponent`) so rows/header never show raw UUIDs.
 *
 * The pending-drafts count is pushed to `DraftCountService.set()` whenever
 * the queue loads or a draft is approved/rejected, keeping the shell
 * sidebar's "Cola de revisión · N" badge in sync without it polling itself.
 *
 * S6-paginated (`AiService.listDraftsPaged`, `page`/`pageSize`,
 * `ui-pagination` — same shape as `exam-list`/`generation-history`,
 * docs/audit-2026-08-14.md "`GET /bank/questions` sin `page` sigue sin
 * tope"). `draftCountService` is always fed the server-returned `total`,
 * NEVER `drafts().length` / `items.length` — a page is not the whole queue.
 * Approving/rejecting the LAST draft on a page beyond page 1 refetches that
 * same page; if the server now reports it empty (the mutation just emptied
 * it) but the queue is not actually empty, `fetchPage()` steps back a page
 * and refetches instead of rendering the "no hay borradores" empty state —
 * that state is reserved for a genuinely empty queue (`total === 0`).
 */
@Component({
  selector: 'app-ai-review-queue',
  standalone: true,
  imports: [
    BannerComponent,
    ButtonComponent,
    EmptyStateComponent,
    TagComponent,
    ModalComponent,
    MathTextComponent,
    PaginationComponent,
    QuestionTaxonomyFieldsComponent,
    QuestionContentFieldsComponent,
    AiReviseBoxComponent,
    LucideAngularModule,
  ],
  templateUrl: './ai-review-queue.component.html',
})
export class AiReviewQueueComponent {
  private readonly aiService = inject(AiService);
  private readonly bankService = inject(BankService);
  private readonly taxonomyService = inject(TaxonomyService);
  private readonly draftCountService = inject(DraftCountService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly PAGE_SIZE = 20;
  protected readonly drafts = signal<DraftQuestion[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

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
  /** True only right after `tryRestoreEditDraft` spliced a persisted edit back in — drives the visible "recuperamos tu edición" notice. Never true for a fresh `startEdit()`. */
  protected readonly editRestored = signal(false);

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

  protected readonly selected = signal<DraftQuestion | null>(null);
  protected readonly previewUrl = signal<SafeResourceUrl | null>(null);
  protected readonly previewLoading = signal(false);
  protected readonly previewFailed = signal(false);
  protected readonly rejecting = signal(false);
  protected readonly actionError = signal<string | null>(null);
  /**
   * In-flight guards for the mutating actions on this panel (audit
   * 2026-08-18, P1). `rejecting` already means "confirmation modal is
   * open" — it flips false the instant `confirmReject()` runs, so it can't
   * also stand in for "the reject POST is in flight". Same
   * check-then-set/always-reset-on-both-outcomes shape as `editSaving()`,
   * `revising()`, and `ExamReviewComponent.replacing()`.
   */
  protected readonly approving = signal(false);
  protected readonly rejectSubmitting = signal(false);

  private readonly objectUrls: string[] = [];

  constructor() {
    this.loadTaxonomy();
    this.load();
    this.destroyRef.onDestroy(() => this.objectUrls.forEach((u) => URL.revokeObjectURL(u)));

    // One effect instead of a persist() call sprinkled over every edit-field
    // setter (same reasoning as ExamBuilderComponent's persistence effect) —
    // a newly added edit field can't forget to be saved. Every signal the
    // snapshot needs is read here so all of them are tracked dependencies.
    effect(() => {
      this.editing();
      this.editCourseId();
      this.editTopicId();
      this.editDifficulty();
      this.editGradeLevel();
      this.editCorrectAnswer();
      this.editBody();
      this.editAlternatives();
      this.editFigureCode();
      this.aiInstruction();
      this.persistEditState();
    });
  }

  /** Same id->name resolution pattern as `BankListComponent.fetchTaxonomy` — fetched independently of the drafts list so a slow taxonomy response never blocks the queue from rendering. */
  private loadTaxonomy(): void {
    this.taxonomyService
      .getCourses()
      .pipe(
        switchMap((courses) =>
          this.taxonomyService.getTopicsForCourses(courses.map((course) => course.id)).pipe(
            map((topics) => ({
              courses,
              topics,
              courseNames: new Map(courses.map((course) => [course.id, course.name])),
              topicNames: new Map(topics.map((topic) => [topic.id, topic.name])),
            })),
          ),
        ),
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

  protected retry(): void {
    this.load();
  }

  private load(): void {
    this.fetchPage({ showLoading: true });
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.fetchPage({ showLoading: true });
  }

  /**
   * The single fetch path behind `load()`, `onPageChange()`, and any
   * post-mutation reload (`reloadAfterSave`/`advanceAfter`) — always asks
   * the server for `page()`/PAGE_SIZE and always trusts its `total` for the
   * sidebar badge.
   *
   * `keepSelectedId`: after a plain edit-save, the just-saved draft is still
   * on the same page (its status never left `draft`) — pass its id to keep
   * it selected instead of jumping back to the page's first row.
   *
   * Page-underflow guard: if the response comes back with zero items on a
   * page beyond the first, that's NOT "the queue is empty" — it's "the
   * mutation that just ran (approve/reject) emptied exactly this page".
   * Steps back one page and refetches rather than rendering the empty
   * state, so approving/rejecting the last draft on the last page never
   * strands the reviewer on a page that no longer exists.
   */
  private fetchPage(
    opts: { showLoading?: boolean; keepSelectedId?: string; onError?: () => void } = {},
  ): void {
    if (opts.showLoading) {
      this.loading.set(true);
      this.errorMessage.set(null);
    }
    this.aiService.listDraftsPaged(this.page(), this.PAGE_SIZE).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.total.set(res.total);

        if (res.items.length === 0 && this.page() > 1) {
          this.page.update((p) => p - 1);
          this.fetchPage(opts);
          return;
        }

        this.drafts.set([...res.items]);
        this.draftCountService.set(res.total);

        const keep = opts.keepSelectedId
          ? res.items.find((d) => d.id === opts.keepSelectedId)
          : undefined;
        if (keep) {
          // A successful save implicitly resolves any stale approve/reject
          // error banner — `select()` used to clear this incidentally
          // before this reload path bypassed it.
          this.actionError.set(null);
          this.selected.set(keep);
          this.compilePreview(keep.id);
        } else if (res.items.length > 0) {
          this.select(res.items[0]);
        } else {
          this.selected.set(null);
        }
      },
      error: (_e: HttpErrorResponse) => {
        this.loading.set(false);
        if (opts.onError) {
          opts.onError();
        } else {
          this.errorMessage.set('No se pudo cargar la cola. Inténtalo de nuevo.');
        }
      },
    });
  }

  /** First line of the Typst body, truncated by CSS in the row — falls back to '' for a missing/empty body. */
  /**
   * One-line queue-row preview: PLAIN text, not typeset. The row is clipped by
   * `truncate`, and clipping through KaTeX output strands the glyphs of a
   * half-shown stretchy delimiter across it — see `questionSnippet` in
   * `bank-list.component.ts`. The draft's typeset statement is in the detail
   * pane next to it.
   */
  protected firstLine(body: string | null): string {
    // Split BEFORE flattening: `typstToPlainText` collapses newlines, so
    // flattening first would fold the alternatives into the row too.
    return truncateTypst(typstToPlainText((body ?? '').split('\n')[0] ?? ''), 70);
  }

  protected courseTopicLabel(draft: DraftQuestion): string {
    const course = this.courseNames().get(draft.courseId) ?? draft.courseId;
    const topic = this.topicNames().get(draft.topicId) ?? draft.topicId;
    return `${course} · ${topic}`;
  }

  protected difficultyLabel(difficulty: Difficulty): string {
    return DIFFICULTY_LABELS[difficulty];
  }

  protected tagVariantFor(difficulty: Difficulty): TagVariant {
    return DIFFICULTY_TAG_VARIANT[difficulty];
  }

  protected gradeLabel(gradeLevel: string): string {
    return GRADE_LEVEL_LABELS[gradeLevel as GradeLevel] ?? gradeLevel;
  }

  /**
   * `DraftQuestion.correctAnswer` is a 0-based INDEX string ("0"-"4"), not a
   * letter — the backend converts the AI's letter answer before storing
   * (see ai.models.ts). Same conversion as `GenerationJobDetailComponent.letterFor()`.
   */
  protected letterFor(draft: DraftQuestion): string {
    return ALTERNATIVE_LETTERS[Number(draft.correctAnswer)] ?? draft.correctAnswer;
  }

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
    // A fresh edit seeded from the SERVER's current values is never a
    // "restore" — only tryRestoreEditDraft() sets this true.
    this.editRestored.set(false);
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
    this.clearPersistedEditState();
  }

  /** Explicit clear — see `persistEditState()`'s doc for why this can't be inferred from `editing()` alone. */
  private clearPersistedEditState(): void {
    sessionStorage.removeItem(EDIT_STATE_KEY);
  }

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
      // Always the raw string, never `|| undefined`: the backend's PATCH
      // contract treats `undefined` as "leave unchanged" and `""` as
      // "explicitly clear the figure" (validate-update-structured-question.ts).
      // Coalescing an emptied textarea to `undefined` would silently keep a
      // bad figure the teacher just tried to remove.
      figureCode: this.editFigureCode(),
    };

    this.bankService.updateQuestion(draft.id, patch).subscribe({
      next: () => {
        this.editing.set(false);
        this.editSaving.set(false);
        this.clearPersistedEditState();
        this.reloadAfterSave(draft.id);
      },
      error: (e: HttpErrorResponse) => {
        this.editSaving.set(false);
        // Surface the server's real reason (validation list / Typst compile
        // stderr) — the teacher can't fix what they can't see.
        this.editError.set(extractErrorMessage(e));
      },
    });
  }

  /**
   * Refreshes the drafts list after a successful save WITHOUT resetting
   * selection to the first item — unlike `load()`, which is only correct
   * for the initial mount. Keeps the just-edited draft selected (with its
   * fresh saved content) and recompiles its preview exactly once.
   */
  private reloadAfterSave(savedId: string): void {
    this.fetchPage({
      keepSelectedId: savedId,
      onError: () => {
        /* row list falls out of sync until the next natural reload — the save itself already succeeded, so this is non-fatal */
      },
    });
  }

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

  private resetAiRevise(): void {
    this.aiInstruction.set('');
    this.revising.set(false);
    this.aiError.set(null);
  }

  /** Parses the newline-separated `editAlternatives` string into an array of trimmed strings. */
  private editAlternativesList(): string[] {
    return parseAlternativesList(this.editAlternatives());
  }

  protected select(draft: DraftQuestion): void {
    this.selected.set(draft);
    this.actionError.set(null);
    this.compilePreview(draft.id);
    this.tryRestoreEditDraft(draft);
  }

  /**
   * Splices a persisted unsaved edit back onto the panel — but ONLY when it
   * belongs to the draft that was just selected. Called for every selection,
   * including the initial auto-select in `fetchPage()`, so a persisted edit
   * for a draft further down the (possibly paginated) queue restores the
   * moment the teacher clicks that row, not just on the first page load.
   *
   * Gated on an exact `draftId` match — see `EDIT_STATE_KEY`'s doc for why
   * this is the "keying" mechanism instead of one storage key per draft. A
   * draft approved/rejected in another tab can never be selected again (it
   * left `status=draft` server-side, see `fetchPage`), so its persisted
   * entry simply never matches again — it sits inert in `sessionStorage`
   * until the tab closes, exactly like the exam builder's stale payloads.
   */
  private tryRestoreEditDraft(draft: DraftQuestion): void {
    this.editRestored.set(false);
    const state = this.readEditState();
    if (!state || state.draftId !== draft.id) {
      return;
    }
    this.editError.set(null);
    this.editCourseId.set(state.courseId);
    this.editTopicId.set(state.topicId);
    this.editDifficulty.set(state.difficulty);
    this.editGradeLevel.set(state.gradeLevel);
    this.editCorrectAnswer.set(state.correctAnswer);
    this.editBody.set(state.body);
    this.editAlternatives.set(state.alternatives);
    this.editFigureCode.set(state.figureCode);
    this.aiInstruction.set(state.aiInstruction);
    this.revising.set(false);
    this.aiError.set(null);
    this.editing.set(true);
    // Visibly announced (role="status" banner in the template) — the
    // teacher must never be shown edits indistinguishable from the server's
    // current values.
    this.editRestored.set(true);
  }

  private readEditState(): PersistedEditState | null {
    const raw = sessionStorage.getItem(EDIT_STATE_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as PersistedEditState;
    } catch {
      // A corrupt/partial payload must never brick the screen — drop it and
      // behave as if nothing had been saved.
      sessionStorage.removeItem(EDIT_STATE_KEY);
      return null;
    }
  }

  /**
   * Driven by the constructor's `effect()` — runs on every edit-field change
   * AND on `editing()` flipping either way. Deliberately WRITE-ONLY: it must
   * NEVER clear storage just because `editing()` is currently false, because
   * that's ALSO true right after mount, before `tryRestoreEditDraft()` has
   * had a chance to match a dormant entry against a draft the teacher
   * hasn't clicked yet — an auto-clear-on-false here raced that restore and
   * wiped the entry before it could ever be used. Clearing is instead an
   * explicit action taken by `cancelEdit()` and `saveEdit()`'s success path
   * (mirrors `ExamBuilderComponent.clearPersistedState()` being called
   * explicitly at specific mutation points rather than inferred from state).
   */
  private persistEditState(): void {
    const draft = this.selected();
    if (!this.editing() || !draft) {
      return;
    }
    const state: PersistedEditState = {
      draftId: draft.id,
      courseId: this.editCourseId(),
      topicId: this.editTopicId(),
      difficulty: this.editDifficulty(),
      gradeLevel: this.editGradeLevel(),
      correctAnswer: this.editCorrectAnswer(),
      body: this.editBody(),
      alternatives: this.editAlternatives(),
      figureCode: this.editFigureCode(),
      aiInstruction: this.aiInstruction(),
    };
    sessionStorage.setItem(EDIT_STATE_KEY, JSON.stringify(state));
  }

  private compilePreview(id: string): void {
    this.previewUrl.set(null);
    this.previewFailed.set(false);
    this.previewLoading.set(true);
    this.aiService.previewDraft(id).subscribe({
      next: (blob) => {
        this.previewLoading.set(false);
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        this.previewUrl.set(toPdfPreviewUrl(this.sanitizer, url));
      },
      error: () => {
        this.previewLoading.set(false);
        this.previewFailed.set(true);
      },
    });
  }

  /**
   * Refetches the current page after an approve/reject — the mutated draft
   * left `status=draft` server-side, so it's already gone from whatever
   * `fetchPage()` gets back; no local array filtering needed. Handles the
   * page-underflow edge case (last draft on a page beyond page 1) via
   * `fetchPage()`'s own guard — see its doc.
   */
  private advanceAfter(): void {
    this.fetchPage({
      onError: () => this.actionError.set('No se pudo actualizar la cola. Inténtalo de nuevo.'),
    });
  }

  protected approve(): void {
    const current = this.selected();
    // approving() is the in-flight guard: without it a double click fired
    // two `POST .../approve` for the same draft (audit 2026-08-18, P1).
    if (!current || this.approving()) return;
    this.approving.set(true);
    this.actionError.set(null);
    this.aiService.approveQuestion(current.id).subscribe({
      next: () => {
        this.approving.set(false);
        this.advanceAfter();
      },
      error: () => {
        // Released on BOTH outcomes — a row stuck disabled after an error
        // is worse than the error itself.
        this.approving.set(false);
        this.actionError.set('No se pudo aprobar. Inténtalo de nuevo.');
      },
    });
  }

  protected requestReject(): void {
    this.rejecting.set(true);
  }
  protected cancelReject(): void {
    this.rejecting.set(false);
  }
  protected confirmReject(): void {
    const current = this.selected();
    // rejectSubmitting() guards the POST itself — `rejecting()` only tracks
    // whether the confirmation modal is open and flips false the instant
    // this method runs, so it can't double as an in-flight flag too.
    if (!current || this.rejectSubmitting()) return;
    this.rejecting.set(false);
    this.rejectSubmitting.set(true);
    this.actionError.set(null);
    this.aiService.rejectQuestion(current.id).subscribe({
      next: () => {
        this.rejectSubmitting.set(false);
        this.advanceAfter();
      },
      error: () => {
        this.rejectSubmitting.set(false);
        this.actionError.set('No se pudo rechazar. Inténtalo de nuevo.');
      },
    });
  }
}
