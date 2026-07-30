import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { map, switchMap } from 'rxjs';
import { LucideAngularModule } from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { TagVariant } from '../../../ui/ui.types';
import { ModalComponent } from '../../../ui/modal/modal.component';
import { MathTextComponent } from '../../../ui/math-text/math-text.component';
import { truncateTypst, typstToPlainText } from '../../../shared/typst/typst-to-latex';
import { SelectOption } from '../../../ui/select/select.component';
import { AiService } from '../ai.service';
import { extractErrorMessage } from '../extract-error-message';
import { DraftQuestion, GRADE_LEVELS, GRADE_LEVEL_LABELS, GradeLevel } from '../ai.models';
import { DraftCountService } from '../draft-count.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { BankService } from '../../bank/bank.service';
import { UpdateQuestionPayload } from '../../bank/bank.models';
import { QuestionTaxonomyFieldsComponent } from '../../bank/question-edit/question-taxonomy-fields.component';
import { QuestionContentFieldsComponent } from '../../bank/question-edit/question-content-fields.component';
import { AiReviseBoxComponent } from '../../bank/question-edit/ai-revise-box.component';
import { parseAlternativesList } from '../../bank/question-edit/parse-alternatives.util';

/** Chrome-less PDF viewer fragment (S7 preview) — hides the native toolbar/thumbnails/scrollbar so it reads as a printed "paper", not a browser PDF viewer. */
const PREVIEW_FRAGMENT = '#toolbar=0&navpanes=0&scrollbar=0';

const ALTERNATIVE_LETTERS = ['a', 'b', 'c', 'd', 'e'];

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
 */
@Component({
  selector: 'app-ai-review-queue',
  standalone: true,
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    TagComponent,
    ModalComponent,
    MathTextComponent,
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

  protected readonly drafts = signal<DraftQuestion[]>([]);
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

  private readonly objectUrls: string[] = [];

  constructor() {
    this.loadTaxonomy();
    this.load();
    this.destroyRef.onDestroy(() => this.objectUrls.forEach((u) => URL.revokeObjectURL(u)));
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
    this.loading.set(true);
    this.errorMessage.set(null);
    this.aiService.listDrafts().subscribe({
      next: (drafts) => {
        this.loading.set(false);
        this.drafts.set([...drafts]);
        this.draftCountService.set(drafts.length);
        if (drafts.length > 0) this.select(drafts[0]);
        else this.selected.set(null);
      },
      error: (_e: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMessage.set('No se pudo cargar la cola. Inténtalo de nuevo.');
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
    this.aiService.listDrafts().subscribe({
      next: (drafts) => {
        this.drafts.set([...drafts]);
        this.draftCountService.set(drafts.length);
        const stillThere = drafts.find((d) => d.id === savedId);
        if (stillThere) {
          // A successful save implicitly resolves any stale
          // approve/reject error banner — `select()` used to clear this
          // incidentally before `reloadAfterSave` bypassed it.
          this.actionError.set(null);
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
        this.previewUrl.set(
          this.sanitizer.bypassSecurityTrustResourceUrl(url + PREVIEW_FRAGMENT),
        );
      },
      error: () => {
        this.previewLoading.set(false);
        this.previewFailed.set(true);
      },
    });
  }

  private advanceAfter(id: string): void {
    const remaining = this.drafts().filter((d) => d.id !== id);
    this.drafts.set(remaining);
    this.draftCountService.set(remaining.length);
    if (remaining.length > 0) this.select(remaining[0]);
    else this.selected.set(null);
  }

  protected approve(): void {
    const current = this.selected();
    if (!current) return;
    this.actionError.set(null);
    this.aiService.approveQuestion(current.id).subscribe({
      next: () => this.advanceAfter(current.id),
      error: () => this.actionError.set('No se pudo aprobar. Inténtalo de nuevo.'),
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
    this.rejecting.set(false);
    if (!current) return;
    this.actionError.set(null);
    this.aiService.rejectQuestion(current.id).subscribe({
      next: () => this.advanceAfter(current.id),
      error: () => this.actionError.set('No se pudo rechazar. Inténtalo de nuevo.'),
    });
  }
}
