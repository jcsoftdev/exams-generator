import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { EMPTY, Observable, catchError, forkJoin, from, map, mergeMap } from 'rxjs';
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
  MoreHorizontal,
  X,
  Check,
  Sparkles,
  Upload,
} from 'lucide-angular';
import { Difficulty, UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { ButtonComponent } from '../../../ui/button/button.component';
import { BannerComponent } from '../../../ui/banner/banner.component';
import { ModalComponent } from '../../../ui/modal/modal.component';
import { InputComponent } from '../../../ui/input/input.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { MathTextComponent } from '../../../ui/math-text/math-text.component';
import { LiveAnnouncerService } from '../../../ui/live-region/live-announcer.service';
import { FolderTreeComponent } from '../../../ui/folder-tree/folder-tree.component';
import {
  FolderCreateEvent,
  FolderInlineError,
  FolderRenameEvent,
  FolderTreeNode,
} from '../../../ui/folder-tree/folder-tree.types';
import { truncateTypst, typstToPlainText } from '../../../shared/typst/typst-to-latex';
import { TagVariant } from '../../../ui/ui.types';
import { BankService } from '../bank.service';
import {
  BankQuestion,
  BankQuestionFilters,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
  UpdateQuestionPayload,
  questionOrigin,
  QuestionOrigin,
} from '../bank.models';
import { correctAnswerLabel, examCountLabel, gradeLevelLabel } from '../question-display.util';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { courseLabels } from '../../taxonomy/course-label';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { AiService } from '../../ai/ai.service';
import { extractErrorMessage } from '../../ai/extract-error-message';
import { BankFoldersStore } from '../folders/bank-folders.store';
import { filterFolderTree } from '../folders/folder-tree.model';
import { QuestionTaxonomyFieldsComponent } from '../question-edit/question-taxonomy-fields.component';
import { QuestionContentFieldsComponent } from '../question-edit/question-content-fields.component';
import { AiReviseBoxComponent } from '../question-edit/ai-revise-box.component';
import { QuestionFolderPickerComponent } from './question-folder-picker.component';
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

/**
 * Shown when the TAXONOMY fetch fails — the only thing left gating the whole
 * screen. It used to say "no se pudieron cargar las preguntas", which after the
 * folder redesign named the one thing this branch is never about: the question
 * list has its own inline error, and so does the folder tree.
 */
const ERROR_MESSAGE = 'No se pudo cargar el banco. Inténtalo de nuevo.';
const FOLDER_QUESTIONS_ERROR_MESSAGE = 'No se pudieron cargar las preguntas de esta carpeta.';

/**
 * How many questions one "page" of a folder holds. The API clamps `pageSize`
 * at 100 (`clampPagination`), and a folder seeded from a topic inherits that
 * topic's whole central-bank branch (~230 questions on average) — so a folder
 * genuinely can need more than one page, which is what the "Ver más"
 * affordance is for. 50 keeps the first paint of an opened folder small (it's
 * also 50 thumbnail fetches at worst).
 */
const FOLDER_PAGE_SIZE = 50;

/**
 * How many thumbnail requests may be in flight at once.
 *
 * Six mirrors the classic per-origin connection limit, and stays a sane cap
 * even over HTTP/2 where the browser would happily open all fifty: the ceiling
 * that matters is the single API replica buffering each asset in memory, not
 * the socket count.
 */
const IMAGE_FETCH_CONCURRENCY = 6;

/**
 * D1 (audit M1): how long a just-created question's row stays flagged
 * `data-highlight="true"` after the tree reveals it. Long enough to find on
 * screen, short enough that it reads as "this one" rather than a permanent
 * marker.
 */
const HIGHLIGHT_DURATION_MS = 4000;

/**
 * Question-bank screen: a two-column split where the left column is the
 * tenant's own FOLDER tree plus the selected folder's questions, and the
 * right column is the unchanged `bank-panel` detail view.
 *
 * FOLDERS REPLACED CURSO -> TEMA. The old left column was a Curso -> Tema
 * tree built from `GET /bank/questions/summary`: a taxonomy the school never
 * chose, imposed on a bank the school owns. It is gone, and with it the
 * summary request, the per-topic page cache, the expand-state signals and
 * "Expandir cursos". The taxonomy itself is NOT gone — the edit form still
 * moves a question between cursos/temas — it just stopped being how a
 * teacher navigates her own bank.
 *
 * The tree comes from `BankFoldersStore` (`GET /bank/folders`): one cheap
 * request that carries every folder with its direct own/central counts, and
 * no question payload at all. `toFolderTreeNodes` rolls those into the
 * cumulative `totalCount` each row shows and appends the virtual "Sin
 * carpeta" node when there is anything in it.
 *
 * LAZY BY FOLDER (the load-bearing decision — see the P0 in
 * `docs/audit-2026-08-14.md`). Nothing lists questions until a folder is
 * SELECTED; then exactly that folder is listed, paginated `FOLDER_PAGE_SIZE`
 * at a time via `listQuestionsPaged({ folderId })`. With nothing selected the
 * screen prompts for a folder rather than issuing an unfiltered
 * `GET /bank/questions` over the 64,257-row central bank — which is the
 * request this screen exists to avoid.
 *
 * A folder is ONE list, not a cache per branch: selecting a folder (or
 * pressing Buscar under new filters) starts over at page 1. The previous
 * design cached a page per topic and then had to invalidate all of them on
 * every filter change; with a single selection there is nothing to
 * invalidate.
 *
 * WRITES GO THROUGH THE STORE, which applies them optimistically and rolls
 * back (plus reloads) on failure. This component only decides what the
 * teacher SEES on a rejection: `folder_name_taken` and friends surface the
 * server's own Spanish message inline (`folderError`); a 404 means another
 * tab already deleted the folder, so the message says the tree was refreshed
 * — the store's rollback already did the refreshing, this must not reload a
 * second time.
 *
 * REMOVAL IS ALWAYS CONFIRMED. `ui-folder-tree` only ASKS (it emits
 * `remove`); this opens a modal naming the folder and counting its questions,
 * and only the modal's "Quitar carpeta" calls the API. Afterwards a banner
 * says how many questions landed in "Sin carpeta" — and only when that number
 * is > 0, because with nothing unfiled there is no "where did my questions
 * go?" to answer.
 *
 * Thumbnails are fetched as authenticated blobs (see `loadImages` —
 * `/assets/:id` is Bearer-JWT protected, a raw `<img src>` never sends that
 * header), for the page just loaded and nothing else: at worst one page
 * (`FOLDER_PAGE_SIZE`) of thumbnails per opened folder. Structured questions
 * (no `imageAssetId`) and image questions with no asset yet get a neutral
 * lucide placeholder icon instead of a blank box.
 *
 * The free-text search box (`filterQuery`) filters the tree live via the pure
 * `filterFolderTree` transform. Its scope is FOLDER NAMES ONLY — the
 * questions of an unopened folder are not in the browser, so matching them
 * here would silently mean "the part you already opened". See
 * `filterFolderTree`'s doc.
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
    BannerComponent,
    ModalComponent,
    InputComponent,
    SelectComponent,
    TagComponent,
    MathTextComponent,
    FolderTreeComponent,
    QuestionTaxonomyFieldsComponent,
    QuestionContentFieldsComponent,
    AiReviseBoxComponent,
    QuestionFolderPickerComponent,
    LucideAngularModule,
  ],
  // Local (component-scoped) icon pick — Angular's Lucide icon token is NOT a multi-provider, so a
  // local `pick()` SHADOWS (does not merge with) the app-level one in app.config.ts. This must list
  // every icon the template uses AND every icon the CHILD components rendered inside it use, since
  // they resolve the token through this element injector: `ui-folder-tree`'s chevrons and
  // `more-horizontal`, and `ui-banner`'s `x` dismiss. Missing one 404s at runtime ("icon has not
  // been provided").
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
      MoreHorizontal,
      X,
      Check,
      Sparkles,
      Upload,
    }).providers ?? [],
  ],
  templateUrl: './bank-list.component.html',
})
export class BankListComponent {
  private readonly bankService = inject(BankService);
  private readonly foldersStore = inject(BankFoldersStore);
  private readonly taxonomyService = inject(TaxonomyService);
  private readonly aiService = inject(AiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly liveAnnouncer = inject(LiveAnnouncerService);

  protected readonly difficulties = Object.values(Difficulty);
  protected readonly difficultyLabels = DIFFICULTY_LABELS;
  /** Audit 2026-08-20 (M1/L3): storage conventions (0-based index, raw grade code) never reach the teacher's eyes. */
  protected readonly correctAnswerLabel = correctAnswerLabel;
  protected readonly gradeLevelLabel = gradeLevelLabel;

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

  // --- the folder tree ----------------------------------------------------
  /** The folder tree, already rolled-up and with the virtual "Sin carpeta" node. */
  protected readonly folderTree = this.foldersStore.tree;
  protected readonly foldersLoading = this.foldersStore.loading;
  protected readonly foldersError = this.foldersStore.error;

  protected readonly selectedFolderId = signal<string | null>(null);
  /** The folder awaiting confirmation in the removal modal — the node, so the copy can name it and count it. */
  protected readonly pendingFolderDelete = signal<FolderTreeNode | null>(null);
  /** Post-delete banner text, cleared by its own dismiss button. */
  protected readonly folderRemovedNotice = signal<string | null>(null);
  /** Screen-level message for a rejected write that names no input (404, 422 depth, network). */
  protected readonly folderError = signal<string | null>(null);
  /**
   * A rejected write that IS about the name the teacher typed — handed back to
   * `ui-folder-tree` so it re-opens that editor and marks the input, instead of
   * a paragraph above six folders that never says which one.
   */
  protected readonly folderInlineError = signal<FolderInlineError | null>(null);

  // --- the selected folder's questions -------------------------------------
  /** The pages loaded so far for the CURRENT selection, flat. A folder is one list; there is no cache per branch to invalidate. */
  protected readonly folderQuestions = signal<readonly BankQuestion[]>([]);
  /** What the server says the folder holds in total — drives "Ver más". */
  private readonly folderQuestionsTotal = signal(0);
  /**
   * Highest page already fetched. Tracked explicitly rather than derived from
   * `folderQuestions().length / FOLDER_PAGE_SIZE`: that division silently
   * assumes every page came back full, which stops being true the moment the
   * server trims a page (deleted rows, a smaller server-side cap) and would
   * then re-request the page just loaded, forever.
   */
  private readonly folderPage = signal(0);
  /** Monotonic id of the newest question request — see `loadQuestionsForFolder`; anything older is a stale answer. */
  private questionRequestId = 0;
  protected readonly folderQuestionsLoading = signal(false);
  /** Last page request failed — renders an inline retry under the tree, never blanking the tree itself. */
  protected readonly folderQuestionsFailed = signal(false);

  private readonly courseNames = signal<ReadonlyMap<string, string>>(new Map());
  /** Full taxonomy (every course/topic, unscoped by grade) loaded once in `fetchTaxonomy` — reused by the edit form's curso/tema selects instead of new HTTP calls. */
  private readonly courses = signal<readonly Course[]>([]);
  private readonly topics = signal<readonly Topic[]>([]);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

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
    this.courses().map((course) => ({
      value: course.id,
      label: this.courseNames().get(course.id) ?? course.name,
    })),
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
  /** Every `setTimeout` handle still pending, cleared on destroy (audit #11) — see `scheduleTimeout`. */
  private readonly pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

  /** `setTimeout` that self-unregisters on fire AND is cleared if the component is destroyed first (audit #11). */
  private scheduleTimeout(fn: () => void, ms: number): void {
    const handle = setTimeout(() => {
      this.pendingTimeouts.delete(handle);
      fn();
    }, ms);
    this.pendingTimeouts.add(handle);
  }
  /**
   * Asset ids currently being fetched. `imageUrls` alone cannot stand in for
   * this: it is only populated when a response ARRIVES, so a second
   * `loadImages` for the same topic (re-expand, or the visibility effect
   * firing again) would re-request everything still in flight.
   */
  private readonly imagesInFlight = new Set<string>();
  /** Asset ids already upgraded from thumbnail to original — see `loadFullImage`. */
  private readonly fullImagesLoaded = new Set<string>();

  /** Free-text search box value — filters the folder tree live by NAME (see `filterFolderTree`). */
  protected readonly filterQuery = signal('');

  // --- D1: highlight the question just created (bank-new -> here) --------------
  /** `router.getCurrentNavigation()?.extras.state['createdQuestionId']`, falling back to `history.state` — captured once, in the constructor, before Angular clears the current navigation. */
  private readonly pendingCreatedQuestionId: string | null;
  /** Dismissible "Pregunta guardada." banner — shown once the created question has been located and revealed. */
  protected readonly createdBanner = signal(false);
  /** The just-created question's id while its row should render `data-highlight="true"`; cleared after `HIGHLIGHT_DURATION_MS`. */
  protected readonly highlightedQuestionId = signal<string | null>(null);

  /** Client-side name filter over the folder tree — see `filterFolderTree` for the honest scope. */
  protected readonly filteredFolderTree = computed(() =>
    filterFolderTree(this.folderTree(), this.filterQuery()),
  );

  /** How many more questions the folder holds beyond the pages already fetched — "Ver más" renders only while this is > 0. */
  protected readonly remainingInFolder = computed(() =>
    Math.max(0, this.folderQuestionsTotal() - this.folderQuestions().length),
  );

  constructor() {
    // Read BEFORE `loadInitial()`: `getCurrentNavigation()` is only non-null
    // while the navigation that landed on this component is still current —
    // capturing it here (constructor, synchronous) is the one place that's
    // guaranteed true. `history.state` is the fallback for whenever Angular's
    // navigation object isn't available (e.g. a page reload that replays the
    // same history entry).
    this.pendingCreatedQuestionId = this.readCreatedQuestionId();
    this.loadInitial();
    this.destroyRef.onDestroy(() => {
      for (const url of this.objectUrls) {
        URL.revokeObjectURL(url);
      }
      // audit #11: both `setTimeout`s in `revealCreatedQuestion` outlived the
      // component otherwise — a fast navigation away right after creating a
      // question left a stray timer trying to mutate a destroyed
      // component's signals (or `document.querySelector` a row that's about
      // to belong to a different screen entirely).
      for (const handle of this.pendingTimeouts) {
        clearTimeout(handle);
      }
      this.pendingTimeouts.clear();
    });
  }

  /**
   * The tree and the taxonomy load INDEPENDENTLY and in parallel: the folder
   * tree is what the screen is for, while the taxonomy only feeds the edit
   * form's curso/tema selects. A failed `GET /bank/folders` therefore shows
   * its message inside the tree column (`foldersError`) instead of blanking
   * the screen, and vice versa.
   */
  private loadInitial(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.foldersStore.load();

    this.fetchTaxonomy().subscribe({
      next: (taxonomy) => {
        this.courseNames.set(taxonomy.courseNames);
        this.courses.set(taxonomy.courses);
        this.topics.set(taxonomy.topics);
        this.loading.set(false);
        if (this.pendingCreatedQuestionId) {
          this.revealCreatedQuestion(this.pendingCreatedQuestionId);
        }
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set(ERROR_MESSAGE);
      },
    });
  }

  /** D1 helper — see `pendingCreatedQuestionId`'s doc for why this reads the navigation state in the constructor. */
  private readCreatedQuestionId(): string | null {
    const navigationState = this.router.getCurrentNavigation?.()?.extras?.state as
      Record<string, unknown> | undefined;
    const fromNavigation = navigationState?.['createdQuestionId'];
    if (typeof fromNavigation === 'string' && fromNavigation) {
      return fromNavigation;
    }
    const fromHistory = (history.state as Record<string, unknown> | undefined)?.[
      'createdQuestionId'
    ];
    if (typeof fromHistory === 'string' && fromHistory) {
      // Consume it (audit #10). Unlike the one-shot navigation extras above,
      // `history.state` survives a reload or a back/forward navigation back
      // to this same entry — left unconsumed, the SAME question would get
      // "revealed" (expanded, selected, highlighted, announced) again on
      // every future visit to this history entry, not just this one.
      history.replaceState({ ...history.state, createdQuestionId: null }, '');
      return fromHistory;
    }
    return null;
  }

  /**
   * D1 (audit M1): "Guardar no da ningún feedback de éxito" — the teacher
   * saved a question in `bank-new` and landed back on a screen with nothing
   * selected. Fetches the full question, SELECTS ITS FOLDER (falling back to
   * the virtual "Sin carpeta" bucket when the question has none) and lists
   * it, selects the question so the detail panel shows it, and flags its row
   * `data-highlight` for `HIGHLIGHT_DURATION_MS`. Also announces it through
   * `LiveAnnouncerService` (D3) — the visible banner alone is silent to a
   * screen reader. A failed lookup (question deleted/archived between save
   * and this fetch) is a silent no-op: no banner, no crash.
   */
  private revealCreatedQuestion(id: string): void {
    this.bankService.getQuestion(id).subscribe({
      next: (question) => {
        const folderId = question.folderId ?? UNFILED_FOLDER_ID;
        this.selectedFolderId.set(folderId);
        // `question` here is already the FULL record this same `getQuestion`
        // call just fetched — apply it directly instead of through
        // `select()`, which would issue a second, redundant `getQuestion`
        // for the exact same id right after this one (audit #12).
        this.applySelectedQuestion(question);
        this.createdBanner.set(true);
        this.liveAnnouncer.announce('Pregunta guardada.');
        // The highlight's `HIGHLIGHT_DURATION_MS` window starts once the
        // folder's page has actually resolved and the row exists to carry it
        // — starting the clear-timer immediately (audit #13) could burn
        // part, or on a slow/failed request all, of the window before the
        // row — and the highlight on it — was ever rendered.
        this.loadQuestionsForFolder(folderId, 1, () => {
          this.highlightedQuestionId.set(id);
          this.scheduleTimeout(() => this.highlightedQuestionId.set(null), HIGHLIGHT_DURATION_MS);
        });
        // Best-effort: scroll the row into view once the topic's page has
        // rendered. `scrollIntoView` doesn't exist in every test environment
        // (jsdom), hence the optional call — this is UX polish, not behavior
        // a test should depend on.
        this.scheduleTimeout(() => {
          document
            .querySelector(`[data-testid="bank-question"][data-question-id="${id}"]`)
            ?.scrollIntoView?.({ block: 'center' });
        }, 0);
      },
      error: () => {},
    });
  }

  protected dismissCreatedBanner(): void {
    this.createdBanner.set(false);
  }

  /**
   * "Buscar": re-lists the SELECTED folder from page 1 under the current
   * filters. With no folder selected this is deliberately a no-op — there is
   * no such thing as "the whole bank" on this screen any more.
   */
  protected search(): void {
    const folderId = this.selectedFolderId();
    if (folderId === null) {
      return;
    }
    this.loadQuestionsForFolder(folderId, 1);
  }

  protected retry(): void {
    this.loadInitial();
  }

  /** The active filter set, shared by every page request of the selected folder. */
  private currentFilters(): BankQuestionFilters {
    return {
      difficulty: this.difficulty() ?? undefined,
      gradeLevel: this.gradeLevel() ?? undefined,
    };
  }

  /**
   * Resolves id->name maps for every course/topic.
   *
   * The two requests run CONCURRENTLY. They used to be chained with
   * `switchMap` — fetch the courses, then hand their ids straight back as a
   * `getTopicsForCourses` filter. But the tree spans every course, so that
   * filter excluded nothing: the second call was waiting on the first purely
   * to reconstruct "all of them". Against an origin ~620ms away that ordering
   * cost a full extra round-trip before the tree could paint, for an identical
   * result (docs/audit-2026-08-26-prod-latency.md §2).
   *
   * (The earlier fix in this spot removed a different problem — one request
   * PER COURSE. Batching them into one was right; leaving it chained behind
   * `getCourses()` was the leftover.)
   */
  private fetchTaxonomy(): Observable<{
    courseNames: ReadonlyMap<string, string>;
    courses: readonly Course[];
    topics: readonly Topic[];
  }> {
    return forkJoin({
      courses: this.taxonomyService.getCourses(),
      topics: this.taxonomyService.getAllTopics(),
    }).pipe(
      map(({ courses, topics }) => ({
        // Labels, not raw names: same-named courses from different stages
        // are indistinguishable otherwise (audit 2026-08-20, M2).
        courseNames: courseLabels(courses),
        courses,
        topics,
      })),
    );
  }

  protected readonly folderQuestionsErrorMessage = FOLDER_QUESTIONS_ERROR_MESSAGE;

  /**
   * Selecting a folder is what drives the question list now. `null` (nothing
   * selected) shows the bank's own prompt rather than an unscoped list — an
   * unfiltered `GET /bank/questions` over the 64k central bank is exactly the
   * request this screen exists to avoid.
   */
  protected onFolderSelect(folderId: string): void {
    this.selectedFolderId.set(folderId);
    this.clearFolderErrors();
    this.loadQuestionsForFolder(folderId, 1);
  }

  protected onFolderCreate(event: FolderCreateEvent): void {
    this.clearFolderErrors();
    this.foldersStore.create(event.parentId, event.name).subscribe({
      error: (error: HttpErrorResponse) => this.handleFolderWriteError(error, event.parentId),
    });
  }

  protected onFolderRename(event: FolderRenameEvent): void {
    this.clearFolderErrors();
    this.foldersStore.rename(event.id, event.name).subscribe({
      error: (error: HttpErrorResponse) => this.handleFolderWriteError(error, event.id),
    });
  }

  /** Every write starts from a clean slate — that is also what "the teacher edited again" means here. */
  private clearFolderErrors(): void {
    this.folderError.set(null);
    this.folderInlineError.set(null);
  }

  /** Removal is ALWAYS confirmed — the tree only asks; this opens the modal. */
  protected onFolderRemoveRequested(folderId: string): void {
    this.pendingFolderDelete.set(findTreeNode(this.folderTree(), folderId));
  }

  protected cancelFolderDelete(): void {
    this.pendingFolderDelete.set(null);
  }

  protected confirmFolderDelete(): void {
    const folder = this.pendingFolderDelete();
    if (!folder) {
      return;
    }
    this.pendingFolderDelete.set(null);
    this.foldersStore.remove(folder.id).subscribe({
      next: (result) => {
        // A removal takes the whole SUBTREE with it, so the open folder can
        // disappear WITHOUT being the one addressed — comparing ids against
        // `folder.id` misses every descendant and leaves the list showing rows
        // of a folder that no longer exists. Ask the tree instead.
        const selected = this.selectedFolderId();
        if (selected !== null && findTreeNode(this.folderTree(), selected) === null) {
          this.selectedFolderId.set(null);
          this.clearFolderQuestions();
        }
        // The banner exists to answer "where did my questions go?". With
        // nothing unfiled there is no question to answer, so no banner.
        const notice =
          result.unfiledQuestions > 0
            ? `Carpeta quitada. ${result.unfiledQuestions} preguntas quedaron en Sin carpeta.`
            : null;
        this.folderRemovedNotice.set(notice);
        // The SAME words, not a shorter summary: the second sentence is where
        // the questions went, and a screen-reader user has no banner to read it
        // off later.
        this.liveAnnouncer.announce(notice ?? 'Carpeta quitada.');
      },
      error: (error: HttpErrorResponse) => this.handleFolderWriteError(error, folder.id),
    });
  }

  /** Jumps to the virtual "Sin carpeta" node from the post-delete banner. */
  protected goToUnfiled(): void {
    this.folderRemovedNotice.set(null);
    this.onFolderSelect(UNFILED_FOLDER_ID);
  }

  /**
   * Where a rejected write is SHOWN depends on what it is about.
   *
   * `folder_name_taken` is about the name the teacher just typed, so it goes
   * back down to that input (`folderInlineError`) — the tree re-opens the
   * editor with her text intact and marks it invalid. Anything else names no
   * input: a 404 means another tab already deleted the folder (no message
   * about the name would be actionable — say the tree was refreshed, and do
   * NOT reload, because `BankFoldersStore.rollback` already restores the
   * snapshot AND re-loads on every failed write); everything else gets the
   * server's own Spanish message as a paragraph above the tree.
   */
  private handleFolderWriteError(error: HttpErrorResponse, nodeId: string | null): void {
    if (folderErrorCode(error) === 'folder_name_taken' && nodeId !== null) {
      this.folderInlineError.set({
        id: nodeId,
        message: extractErrorMessage(error, 'Ya existe una carpeta con ese nombre.'),
      });
      return;
    }
    if (error.status === 404) {
      this.folderError.set('Esa carpeta ya no existe. Actualizamos el árbol.');
      return;
    }
    this.folderError.set(
      extractErrorMessage(error, 'No se pudo actualizar la carpeta. Inténtalo de nuevo.'),
    );
  }

  private clearFolderQuestions(): void {
    this.folderQuestions.set([]);
    this.folderQuestionsTotal.set(0);
    this.folderPage.set(0);
    this.folderQuestionsFailed.set(false);
  }

  /**
   * Fetches ONE page of the selected folder's questions. Page 1 REPLACES the
   * list (a new selection, or Buscar under new filters — the loaded rows came
   * from a query that no longer applies); any later page appends.
   *
   * EVERY call fires its request; only the NEWEST one is allowed to write to
   * the screen. A global "is something in flight?" guard was tried first and
   * is worse than the race it patched: clicking folder B while A was still
   * travelling silently dropped B's request, so A's rows rendered under B's
   * highlighted row and nothing short of re-clicking recovered. Sequencing the
   * responses instead means both folders are asked for, and whichever the
   * teacher is actually looking at wins regardless of which answer the network
   * hands back first.
   *
   * `onSettled`, when given, fires exactly once — once this call's request
   * finishes, success, error, or superseded — so a caller can know when the
   * rendered rows reflect it (audit #13).
   */
  private loadQuestionsForFolder(folderId: string, page: number, onSettled?: () => void): void {
    const requestId = ++this.questionRequestId;
    if (page === 1) {
      this.clearFolderQuestions();
    }
    this.folderQuestionsLoading.set(true);
    this.folderQuestionsFailed.set(false);

    /** A superseded request must not touch a single signal — not even the spinner the newer one owns. */
    const isStale = (): boolean =>
      requestId !== this.questionRequestId || folderId !== this.selectedFolderId();

    this.bankService
      .listQuestionsPaged({ ...this.currentFilters(), folderId }, page, FOLDER_PAGE_SIZE)
      .subscribe({
        next: (paged) => {
          if (isStale()) {
            onSettled?.();
            return;
          }
          this.folderQuestions.update((current) =>
            page === 1 ? [...paged.items] : [...current, ...paged.items],
          );
          this.folderQuestionsTotal.set(paged.total);
          this.folderPage.set(page);
          this.folderQuestionsLoading.set(false);
          // Bounded by construction: at most one page of thumbnails per call.
          this.loadImages(paged.items);
          onSettled?.();
        },
        error: () => {
          if (isStale()) {
            onSettled?.();
            return;
          }
          this.folderQuestionsLoading.set(false);
          this.folderQuestionsFailed.set(true);
          onSettled?.();
        },
      });
  }

  /**
   * Both "Ver más" and the inline retry ask for the same thing: the page after
   * the last one that LANDED. `folderPage` only advances on a successful
   * response, so after a failure `folderPage() + 1` is the page that failed —
   * a retry, not a skip — and after a success it is the next one.
   */
  protected loadNextFolderPage(): void {
    const folderId = this.selectedFolderId();
    if (folderId !== null) {
      this.loadQuestionsForFolder(folderId, this.folderPage() + 1);
    }
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
   * `null` for a question with no statement text: a STRUCTURED question with
   * a genuinely empty body (leaf falls back to the answer key), or an IMAGE
   * question is never `null` — see the `'Pregunta con imagen'` floor below,
   * gated on `type === 'image'` (audit bank-list #14) so a structured
   * question with an empty body can never render that copy — it has no
   * image at all, that string would be a lie.
   */
  protected questionSnippet(question: BankQuestion): string | null {
    const text = typstToPlainText(question.bodyTypst ?? '');
    if (text) {
      return truncateTypst(text, 70);
    }
    if (question.type !== 'image') {
      return null;
    }
    // An image question has no statement, so the row would say only "Clave: c".
    // Its provenance names the exam and the question number, which is what
    // tells one of ~1500 harvested image questions from the next. The trailing
    // "(clave E)" the harvest writes is dropped: the row prints the key already.
    // The file extension a WEB UPLOAD writes into sourceName ("1d.PNG") is
    // dropped too — it's not provenance, just noise (audit 2026-09-02, D2a).
    const source = (question.sourceName ?? '')
      .replace(/\s*\(clave\s+[a-eA-E]\)\s*$/, '')
      .replace(/\.(png|jpe?g|gif|webp|bmp|heic|heif|tiff?)$/i, '')
      .trim();
    if (source) {
      return truncateTypst(source, 70);
    }
    // No statement AND no source: a question created straight in the web UI
    // from a bare image, with nothing else to identify it by. The row used to
    // fall through to `null` here and render only "Clave: d" (audit 2026-09-02,
    // L1) — this is the honest floor: it IS a question, it DOES have an image.
    return 'Pregunta con imagen';
  }

  /** Alternatives of a structured question, lettered a/b/c…, with the `correctAnswer` one flagged. Empty for image questions. */
  protected alternativeRows(
    question: BankQuestion,
  ): { letter: string; text: string; correct: boolean }[] {
    const alternatives = question.alternatives ?? [];
    const correctIndex = normalizeCorrectAnswer(question.correctAnswer);
    return alternatives.map((text, index) => {
      const letter = String.fromCharCode(97 + index);
      return { letter, text, correct: String(index) === correctIndex };
    });
  }

  protected select(question: BankQuestion): void {
    this.applySelectedQuestion(question);
    // `question` here is typically the tree-leaf/summary shape, missing
    // fields the detail panel needs — re-fetch the full record. (Not needed
    // by `revealCreatedQuestion`, which already has the full one — see
    // `applySelectedQuestion`'s doc, audit #12.)
    this.bankService.getQuestion(question.id).subscribe({
      next: (full) => this.selected.set(full),
      error: () => {},
    });
  }

  /** Shared by `select()` and `revealCreatedQuestion()` — see `select`'s doc (audit #12). */
  private applySelectedQuestion(question: BankQuestion): void {
    this.actionError.set(null);
    this.cancelEdit();
    this.selected.set(question);
    this.loadFullImage(question);
  }

  /**
   * Replaces a question's thumbnail with the original once it is selected.
   *
   * The detail panel renders `max-h-64 w-full` and the edit preview `h-28
   * w-28` — both read from the same `imageUrls` map the 40px leaf row does, and
   * both are views where the statement has to be legible. So the map holds the
   * thumbnail until a question is opened and the full image from then on: the
   * panel paints instantly with the bytes already in hand and sharpens when
   * the original lands, instead of showing nothing while it travels.
   *
   * Only ever ONE image at a time — this is the selected question — which is
   * why it does not go through `IMAGE_FETCH_CONCURRENCY`.
   */
  private loadFullImage(question: BankQuestion): void {
    const assetId = question.imageAssetId;
    if (!assetId || this.fullImagesLoaded.has(assetId)) {
      return;
    }
    this.fullImagesLoaded.add(assetId);

    this.bankService.fetchQuestionImage(assetId).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        const previous = this.imageUrls()[assetId];
        this.imageUrls.update((current) => ({ ...current, [assetId]: url }));
        // The thumbnail this replaces is dead the moment nothing renders it.
        // `ngOnDestroy` would get to it eventually via `objectUrls`, but a long
        // session opening question after question would hold every one of them
        // until then.
        if (previous) {
          URL.revokeObjectURL(previous);
        }
      },
      // A failed upgrade leaves the thumbnail in place — a soft image rather
      // than an empty panel. Cleared from the guard so re-selecting retries.
      error: () => this.fullImagesLoaded.delete(assetId),
    });
  }

  /** Template helper — see `examCountLabel`: the plural used to be hardcoded. */
  protected readonly examCountLabel = examCountLabel;

  protected isCentral(question: BankQuestion): boolean {
    return questionOrigin(question) === 'central';
  }

  /**
   * Exposed for the template's "IA" / "Colegio" chip. It used to read a
   * `q.origin` field the API never sent, so the AI branch could not render
   * (audit 2026-08-21, M13).
   */
  protected originOf(question: BankQuestion): QuestionOrigin {
    return questionOrigin(question);
  }

  protected canArchive(question: BankQuestion): boolean {
    return !this.isCentral(question) && question.status === 'approved';
  }

  protected canDelete(question: BankQuestion): boolean {
    return !this.isCentral(question) && question.status === 'draft';
  }

  /**
   * `app-question-folder-picker`'s `moved` output — fires on every
   * successful folder PATCH, even one for a question that isn't SELECTED any
   * more by the time the response lands (see that component's doc). This is
   * the "still reload the tree/list either way" half of that contract: the
   * child already decided (by matching `updated.id` against its own input)
   * whether ITS state should reflect the response; here we decide the same
   * thing for `selected`, independently, and always refresh the tree +
   * currently open folder regardless of which question the response was for.
   */
  protected onQuestionMoved(updated: BankQuestion): void {
    if (this.selected()?.id === updated.id) {
      this.selected.set(updated);
    }
    this.foldersStore.load();
    this.search();
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
        // Both, and in this order: the open folder's list no longer holds the
        // row, and every ancestor's count in the tree is one lower.
        this.search();
        this.foldersStore.load();
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
        this.foldersStore.load();
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
      question.type === 'structured'
        ? normalizeCorrectAnswer(question.correctAnswer)
        : question.correctAnswer,
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
   * match `editAlternativesList`'s parsing, and `AiExtractedQuestion.correctAnswer`
   * is already a 0-based INDEX (same canonical format as `editCorrectAnswer`
   * everywhere else) — populated DIRECTLY, no letter conversion. It is now
   * `string | null` (extraction never invents a key the photo didn't show);
   * `null` clears the field to `''`. Failures reuse `aiError`/`ai-error`
   * from Task 9.
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
        // `extracted.correctAnswer` is `string | null` now — extraction
        // never invents a key the photo didn't show. `null` clears the
        // field so the teacher has to pick one by hand instead of saving a
        // fabricated key.
        this.editCorrectAnswer.set(extracted.correctAnswer ?? '');
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
   * Either way, on success the folder's list + selected detail are reloaded
   * and edit mode exits.
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
    const pending = questions
      .map((question) => question.imageAssetId)
      .filter((assetId): assetId is string => Boolean(assetId))
      .filter((assetId) => !this.imageUrls()[assetId] && !this.imagesInFlight.has(assetId));

    if (pending.length === 0) {
      return;
    }

    for (const assetId of pending) {
      this.imagesInFlight.add(assetId);
    }

    // `IMAGE_FETCH_CONCURRENCY` at a time, not all of them. Expanding a topic
    // used to fire one XHR per question — up to `TOPIC_PAGE_SIZE` (50) at once,
    // each a full-size scan. Bounding it matters for two separate reasons:
    // the browser's own per-origin limit made most of them queue anyway, and
    // the API buffers every asset whole in memory on a single replica
    // (`replicas: 1`), so fifty concurrent reads is fifty live buffers there.
    from(pending)
      .pipe(
        mergeMap(
          (assetId) =>
            this.bankService.fetchQuestionThumbnail(assetId).pipe(
              map((blob) => ({ assetId, blob })),
              // One unreadable asset must not cancel the other forty-nine —
              // `mergeMap` would propagate the error and tear down the whole
              // stream. The tile simply stays imageless.
              catchError(() => EMPTY),
            ),
          IMAGE_FETCH_CONCURRENCY,
        ),
      )
      .subscribe({
        next: ({ assetId, blob }) => {
          const url = URL.createObjectURL(blob);
          this.objectUrls.push(url);
          this.imagesInFlight.delete(assetId);
          this.imageUrls.update((current) => ({ ...current, [assetId]: url }));
        },
        complete: () => {
          for (const assetId of pending) {
            this.imagesInFlight.delete(assetId);
          }
        },
      });
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

/**
 * The STABLE `code` of a folder error body (`{ statusCode, code, message }` —
 * see `bank-folder.dto.ts`). Discriminating on the code rather than on the
 * status is what lets 409-the-name-is-taken behave differently from any other
 * rejection without string-matching a Spanish message.
 */
function folderErrorCode(error: HttpErrorResponse): string | null {
  const body = error.error as unknown;
  if (body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string') {
    return (body as { code: string }).code;
  }
  return null;
}

/** Depth-first lookup over the RENDER tree — the modal needs the node's name and cumulative count. */
function findTreeNode(nodes: readonly FolderTreeNode[], id: string): FolderTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = findTreeNode(node.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}
