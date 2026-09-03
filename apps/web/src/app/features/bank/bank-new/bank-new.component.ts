import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Difficulty, NormalizedBoxDto, UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { LucideAngularModule, Check, ChevronDown, Sparkles } from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { InputComponent } from '../../../ui/input/input.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { TabsComponent, TabItem } from '../../../ui/tabs/tabs.component';
import { FileUploadComponent } from '../../../ui/file-upload/file-upload.component';
import { FolderTreeComponent } from '../../../ui/folder-tree/folder-tree.component';
import { BankFoldersStore } from '../folders/bank-folders.store';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from '../bank.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { extractErrorMessage } from '../../ai/extract-error-message';
import { LiveAnnouncerService } from '../../../ui/live-region/live-announcer.service';
import { CropReviewComponent, CropTarget } from '../crop-review/crop-review.component';
import { dataUrlToFile } from '../data-url-to-file';
import { indexToCorrectAnswerLetter } from '../taxonomy-matcher';
import { BankNewExtractionService } from '../bank-new-extraction.service';
import { QuestionSaveChainService } from '../question-save-chain.service';

type Tab = 'photo' | 'structured';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};

const CORRECT_ANSWER_LETTERS = ['a', 'b', 'c', 'd', 'e'];

/** Survives a reload of `/app/bank/new` within the same tab — long enough to upload a batch, gone when the tab closes. */
const LAST_FOLDER_STORAGE_KEY = 'bank-new:last-folder-id';

function toOptions(items: readonly { id: string; name: string }[]): SelectOption<string>[] {
  return items.map((item) => ({ value: item.id, label: item.name }));
}

/**
 * Task 6: "Nueva pregunta" creator with two tabs — "Foto de la pregunta"
 * (`POST /bank/questions/image` multipart upload) and "Escribir pregunta"
 * (`POST /bank/questions/structured` JSON payload). Route `/app/bank/new`.
 * Curso/Tema are dependent `ui-select` dropdowns sourced from
 * `TaxonomyService` (never raw UUID text inputs).
 *
 * Line G (audit M10) split the original single 1264-line file into three:
 * the AI-extraction request lifecycle now lives in
 * `BankNewExtractionService`, the "save the structured question" chain in
 * `QuestionSaveChainService` (both provided here, component-scoped — one
 * instance per "Nueva pregunta" visit, same lifetime as the private fields
 * they replace), and the pure course/topic/letter-index matching helpers in
 * `taxonomy-matcher.ts`. This component keeps everything only it can know:
 * tab state, both tabs' form signals, the taxonomy select effects (with
 * their staleness guards), form validity/missing-fields, the leave guard
 * hooks, focus management, and navigation.
 */
@Component({
  selector: 'app-bank-new',
  standalone: true,
  imports: [
    ButtonComponent,
    InputComponent,
    SelectComponent,
    TabsComponent,
    LucideAngularModule,
    CropReviewComponent,
    FileUploadComponent,
    FolderTreeComponent,
  ],
  // `ui-select` (Grado/Curso/Tema/Nivel, both tabs) needs Check + ChevronDown —
  // this component-level `.pick()` shadows the root `app.config.ts` registration
  // for its own subtree, so the nested `ui-select` instances can't fall back to it.
  // L5: Upload/Image moved out with the upload control itself — `ui-file-upload`
  // now registers those two icons for its OWN subtree.
  providers: [
    LucideAngularModule.pick({ Check, ChevronDown, Sparkles }).providers ?? [],
    BankNewExtractionService,
    QuestionSaveChainService,
  ],
  templateUrl: './bank-new.component.html',
})
export class BankNewComponent {
  private readonly taxonomyService = inject(TaxonomyService);
  private readonly foldersStore = inject(BankFoldersStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly liveAnnouncer = inject(LiveAnnouncerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly extraction = inject(BankNewExtractionService);
  private readonly saveChain = inject(QuestionSaveChainService);

  /**
   * Used only to move focus after a successful extraction (B1/B7).
   * `viewChild` (signal form) since the structured panel is behind an
   * `@if`, so the ref only resolves once that branch is rendered.
   */
  protected readonly structuredBodyTextarea =
    viewChild<ElementRef<HTMLTextAreaElement>>('bodyTextarea');
  protected readonly structuredAlternativesTextarea =
    viewChild<ElementRef<HTMLTextAreaElement>>('alternativesTextarea');

  protected readonly gradeLevelOptions = GRADE_LEVELS.map((g) => ({
    value: g,
    label: GRADE_LEVEL_LABELS[g],
  }));
  protected readonly difficultyOptions = Object.values(Difficulty).map((d) => ({
    value: d,
    label: DIFFICULTY_LABELS[d],
  }));

  protected readonly tab = signal<Tab>('photo');
  protected readonly tabItems: readonly TabItem<Tab>[] = [
    { value: 'photo', label: 'Foto de la pregunta', testId: 'tab-photo' },
    { value: 'structured', label: 'Escribir pregunta', testId: 'tab-structured' },
  ];
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  /**
   * B4/M7: flips true right before `navigateToBank` fires — the leave guard
   * checks this FIRST so a successful save never prompts "¿Salir sin
   * guardar?" for a page the teacher just finished with.
   */
  private savedSuccessfully = false;

  // Owned by `BankNewExtractionService` — aliased under their original
  // names (same `WritableSignal` instances, not copies) so the template and
  // `bank-new.component.spec.ts` keep reading/writing them unchanged.
  protected readonly extracting = this.extraction.extracting;
  protected readonly extractError = this.extraction.extractError;
  protected readonly extractNoAlternatives = this.extraction.extractNoAlternatives;
  protected readonly extractReviewNotice = this.extraction.extractReviewNotice;
  protected readonly aiTaxonomyHint = this.extraction.aiTaxonomyHint;
  protected readonly cropSlots = this.extraction.cropSlots;

  /** Visibility is live, not frozen at extraction time — hides the instant BOTH selects end up with a value, whether that came from the suggestion, the photo tab, or the teacher picking manually. */
  protected readonly showAiTaxonomyHint = computed(
    () => !!this.aiTaxonomyHint() && (!this.sCourseId() || !this.sTopicId()),
  );

  // Carpeta — one value shared by both tabs' fields (`pFolderId`/`sFolderId`
  // are kept in step by `applyFolderSelection` and by the photo->structured
  // hand-off in `extractWithAi`), because a teacher who filed the photo and
  // then let the AI move her to the structured tab must not pick it twice.
  protected readonly folderTree = this.foldersStore.tree;
  protected readonly pFolderId = signal<string | null>(null);
  protected readonly sFolderId = signal<string | null>(null);
  /** Which tab's picker popover is open, if any — only ever one at a time. */
  protected readonly folderPickerFor = signal<Tab | null>(null);
  /** Every topic in the catalog, loaded once — the folder field needs `topicId -> courseId` to prefill Curso. */
  private readonly allTopics = signal<readonly Topic[]>([]);
  /** Flips once `getAllTopics` has SETTLED (next OR error) — see the restore effect in the constructor. */
  private readonly taxonomyReady = signal(false);

  /**
   * Relay for the folder-driven topic preselect, mirroring
   * `BankNewExtractionService`'s pending mechanism: setting `pCourseId` fires
   * the course->topics effect, which BLANKS `pTopicId` before the new topics
   * land. Stashing the id here lets `loadTopicsFor` restore it on the way
   * through instead of racing the effect.
   */
  private pendingFolderTopicId: Partial<Record<Tab, string>> = {};

  // Foto
  protected readonly pCourses = signal<Course[]>([]);
  protected readonly pCourseOptions = computed(() => toOptions(this.pCourses()));
  protected readonly pCourseId = signal('');
  protected readonly pTopicId = signal('');
  protected readonly pTopics = signal<Topic[]>([]);
  protected readonly pTopicOptions = computed(() => toOptions(this.pTopics()));
  protected readonly pDifficulty = signal<Difficulty | null>(null);
  protected readonly pGradeLevel = signal<string | null>(null);
  protected readonly pCorrectAnswer = signal('');
  protected readonly pImage = signal<File | null>(null);
  protected readonly pImagePreviewUrl = signal<string | null>(null);

  // Estructurada
  protected readonly sCourses = signal<Course[]>([]);
  protected readonly sCourseOptions = computed(() => toOptions(this.sCourses()));
  protected readonly sCourseId = signal('');
  protected readonly sTopicId = signal('');
  protected readonly sTopics = signal<Topic[]>([]);
  protected readonly sTopicOptions = computed(() => toOptions(this.sTopics()));
  protected readonly sDifficulty = signal<Difficulty | null>(null);
  protected readonly sGradeLevel = signal<string | null>(null);
  protected readonly sBody = signal('');
  protected readonly sAlternatives = signal('');
  protected readonly sCorrectAnswer = signal('');
  /** Optional complement image (chart/diagram/passage scan) — never required, `structuredValid()` doesn't check it. */
  protected readonly sImage = signal<File | null>(null);
  protected readonly sImagePreviewUrl = signal<string | null>(null);

  /**
   * True while `sImage` holds a crop cut from the CURRENT extraction rather
   * than a file the teacher picked manually. `setImage` (photo tab) uses
   * this to decide whether swapping the photo should also clear `sImage` —
   * a manually picked complement image must survive a photo change.
   */
  private sImageFromCrop = false;

  /** The photo the crops were cut from — feeds `<app-crop-review>`'s background. */
  protected readonly cropPhotoUrl = computed(() => this.pImagePreviewUrl());

  constructor() {
    // Courses load per selected grade (the catalog is divided by
    // educational stage — loading it up front would repeat shared names
    // once per stage). Photo/structured tabs each have their OWN grade
    // field, so each loads/resets its own course list independently.
    // `loadCoursesFor`/`loadTopicsFor` hold the M9 staleness guard shared
    // by all four effects; each effect still reads its OWN signals
    // directly so Angular tracks the right dependencies.
    effect(() => this.loadCoursesFor('photo', this.pGradeLevel()));
    effect(() => this.loadCoursesFor('structured', this.sGradeLevel()));
    // Dependent Tema dropdown: reloads whenever the course changes, resets
    // the previously selected topic so it never leaks across courses.
    effect(() => this.loadTopicsFor('photo', this.pCourseId()));
    effect(() => this.loadTopicsFor('structured', this.sCourseId()));

    // B8: a stale extraction/recrop error must clear the moment the
    // teacher touches enunciado, alternativas, or clave. Tracks the
    // signals directly (rather than wrapping each template handler) so
    // this fires the same way regardless of how the field changed.
    effect(() => {
      this.sBody();
      this.sAlternatives();
      this.sCorrectAnswer();
      this.extractError.set(null);
    });

    // B1's "no alternatives" notice is its own effect (not folded into the
    // one above) since it must clear ONLY when alternativas gains content.
    effect(() => {
      if (this.sAlternatives().trim().length > 0) {
        this.extractNoAlternatives.set(false);
      }
    });

    this.foldersStore.load();
    this.taxonomyService.getAllTopics().subscribe({
      next: (topics) => {
        this.allTopics.set(topics);
        this.taxonomyReady.set(true);
      },
      error: () => {
        // A missing catalog only costs the Curso/Tema PREFILL — filing the
        // question under the folder still works, so this is not a save error.
        this.allTopics.set([]);
        this.taxonomyReady.set(true);
      },
    });

    /**
     * Restores the remembered folder the first time BOTH the tree has content
     * and the topic catalog has settled — both load asynchronously, so this
     * cannot run inline in the constructor, and restoring before the catalog
     * arrived would drop the Curso/Tema prefill on the floor. Guarded so it
     * fires once and never fights a folder the teacher just picked.
     */
    let restored = false;
    effect(() => {
      if (!restored && this.folderTree().length > 0 && this.taxonomyReady()) {
        restored = true;
        this.restoreRememberedFolder();
      }
    });

    // M8: `setImage`/`setStructuredImage` only revoke the PREVIOUS object
    // URL when a new one replaces it — whichever is still live at teardown
    // never gets revoked otherwise.
    this.destroyRef.onDestroy(() => {
      const photoUrl = this.pImagePreviewUrl();
      if (photoUrl) {
        URL.revokeObjectURL(photoUrl);
      }
      const structuredUrl = this.sImagePreviewUrl();
      if (structuredUrl) {
        URL.revokeObjectURL(structuredUrl);
      }
    });
  }

  /**
   * Shared body for the photo/structured "load courses for this grade"
   * effects. M9: a SLOWER response for a grade the teacher has already
   * moved past must not clobber a NEWER request's result — comparing the
   * captured `gradeLevel` against the CURRENT signal at response time is
   * what tells the two apart.
   */
  private loadCoursesFor(tab: Tab, gradeLevel: string | null): void {
    if (tab === 'photo') {
      this.pCourseId.set('');
      this.pCourses.set([]);
    } else {
      this.sCourseId.set(this.extraction.consumePendingCourseId());
      this.sCourses.set([]);
    }
    if (!gradeLevel) return;
    this.taxonomyService.getCourses(gradeLevel).subscribe({
      next: (courses) => {
        if ((tab === 'photo' ? this.pGradeLevel() : this.sGradeLevel()) !== gradeLevel) return;
        (tab === 'photo' ? this.pCourses : this.sCourses).set(courses);
      },
      error: () => {
        if ((tab === 'photo' ? this.pGradeLevel() : this.sGradeLevel()) !== gradeLevel) return;
        this.saveError.set('No se pudieron cargar los cursos. Recarga la página.');
      },
    });
  }

  /** Shared body for the "load topics for this course" effects — same M9 guard, keyed on the course. */
  private loadTopicsFor(tab: Tab, courseId: string): void {
    if (tab === 'photo') {
      this.pTopicId.set(this.consumePendingFolderTopicId('photo'));
      this.pTopics.set([]);
    } else {
      // An extraction's own preselect wins over the folder's: the AI read
      // THIS photo, the folder is just where the batch is being filed.
      this.sTopicId.set(
        this.extraction.consumePendingTopicId() || this.consumePendingFolderTopicId('structured'),
      );
      this.sTopics.set([]);
    }
    if (!courseId) return;
    const gradeLevel = (tab === 'photo' ? this.pGradeLevel() : this.sGradeLevel()) ?? undefined;
    this.taxonomyService.getTopics(courseId, gradeLevel).subscribe({
      next: (topics) => {
        if ((tab === 'photo' ? this.pCourseId() : this.sCourseId()) !== courseId) return;
        (tab === 'photo' ? this.pTopics : this.sTopics).set(topics);
      },
      error: () => {
        if ((tab === 'photo' ? this.pCourseId() : this.sCourseId()) !== courseId) return;
        this.saveError.set('No se pudieron cargar los temas. Inténtalo de nuevo.');
      },
    });
  }

  protected folderName(tab: Tab): string {
    const id = tab === 'photo' ? this.pFolderId() : this.sFolderId();
    return (id && this.foldersStore.folderName(id)) ?? 'Sin carpeta';
  }

  /**
   * True when the folder is linked to a topic AND the teacher picked a
   * different one. NOT an error: a folder can legitimately hold mixed
   * topics, so the folder stays and the hint just says the two disagree.
   */
  protected folderTopicMismatch(tab: Tab): boolean {
    const folderId = tab === 'photo' ? this.pFolderId() : this.sFolderId();
    if (!folderId) {
      return false;
    }
    const folderTopicId = this.foldersStore.folderTopicId(folderId);
    const topicId = tab === 'photo' ? this.pTopicId() : this.sTopicId();
    return !!folderTopicId && !!topicId && folderTopicId !== topicId;
  }

  protected openFolderPicker(tab: Tab): void {
    this.folderPickerFor.set(this.folderPickerFor() === tab ? null : tab);
  }

  protected onFolderPicked(tab: Tab, folderId: string): void {
    this.folderPickerFor.set(null);
    // The tree's virtual "Sin carpeta" node means "file it nowhere", which
    // on the wire is `null` — never that literal id.
    this.applyFolderSelection(tab, folderId === UNFILED_FOLDER_ID ? null : folderId);
  }

  /**
   * Escape on the popover: close it AND return focus to the trigger that
   * opened it. The CDK tree owns focus while the popover is open (arrow-key
   * navigation via `TreeKeyManager`); nothing else puts it back on dismiss.
   * Same reasoning as `QuestionFolderPickerComponent.closeFromEscape`.
   */
  protected closeFolderPickerFromEscape(tab: Tab): void {
    this.folderPickerFor.set(null);
    this.elementRef.nativeElement
      .querySelector<HTMLButtonElement>(`[data-testid="folder-field-${tab}"] button`)
      ?.focus();
  }

  /**
   * Applies a folder choice: remembers it, and — when the folder is linked to
   * a topic — preselects Curso and Tema from it. The teacher can still change
   * either by hand; the folder does not follow (`folderTopicMismatch` just
   * says so), because one folder grouping several topics is a legitimate way
   * to file.
   */
  private applyFolderSelection(tab: Tab, folderId: string | null): void {
    (tab === 'photo' ? this.pFolderId : this.sFolderId).set(folderId);
    this.rememberFolder(folderId);

    const topicId = folderId ? this.foldersStore.folderTopicId(folderId) : null;
    if (!topicId) {
      return;
    }
    const topic = this.allTopics().find((candidate) => candidate.id === topicId);
    if (!topic) {
      return;
    }

    const courseSignal = tab === 'photo' ? this.pCourseId : this.sCourseId;
    const topicSignal = tab === 'photo' ? this.pTopicId : this.sTopicId;

    this.pendingFolderTopicId[tab] = topic.id;
    const courseChanged = courseSignal() !== topic.courseId;
    courseSignal.set(topic.courseId);
    if (!courseChanged) {
      // Same course -> the course->topics effect was a no-op and never
      // consumed the relay. Apply it directly, exactly as
      // `resolveStructuredTaxonomy` does one level up.
      delete this.pendingFolderTopicId[tab];
      topicSignal.set(topic.id);
    }
  }

  private consumePendingFolderTopicId(tab: Tab): string {
    const id = this.pendingFolderTopicId[tab] ?? '';
    delete this.pendingFolderTopicId[tab];
    return id;
  }

  private rememberFolder(folderId: string | null): void {
    try {
      if (folderId) {
        sessionStorage.setItem(LAST_FOLDER_STORAGE_KEY, folderId);
      } else {
        sessionStorage.removeItem(LAST_FOLDER_STORAGE_KEY);
      }
    } catch {
      // Private mode / storage disabled: remembering the folder is a
      // convenience, never a requirement. Losing it must not break the upload.
    }
  }

  /** Restores the remembered folder ONCE the tree is loaded — a folder deleted meanwhile is dropped silently. */
  private restoreRememberedFolder(): void {
    let remembered: string | null = null;
    try {
      remembered = sessionStorage.getItem(LAST_FOLDER_STORAGE_KEY);
    } catch {
      return;
    }
    if (!remembered || !this.foldersStore.folderName(remembered)) {
      return;
    }
    this.applyFolderSelection('photo', remembered);
    this.applyFolderSelection('structured', remembered);
  }

  protected setTab(t: Tab): void {
    this.tab.set(t);
    this.saveError.set(null);
    this.extractError.set(null);
  }

  /** B4/M7: called by the router-facing leave guard (`bank-new-leave.guard.ts`) — only the component knows its own dirty state. */
  canDeactivate(): boolean {
    if (this.savedSuccessfully || !this.hasUnsavedWork()) {
      return true;
    }
    return confirm('Tienes una pregunta a medio revisar. ¿Salir sin guardar?');
  }

  /**
   * True while there is AI/crop work in flight or unreviewed, or a
   * question started (on EITHER tab) but not saved. `sBody` alone is
   * enough of a signal for the structured tab (an enunciado with content
   * is the first thing typed); the photo tab has no such shortcut, so
   * `photoTabHasContent` checks all of it directly.
   */
  private hasUnsavedWork(): boolean {
    return (
      this.cropSlots().length > 0 ||
      this.extracting() ||
      this.saving() ||
      this.sBody().trim().length > 0 ||
      this.sAlternatives().trim().length > 0 ||
      !!this.sCorrectAnswer() ||
      !!this.sImage() ||
      this.photoTabHasContent()
    );
  }

  /** Any photo-tab field with a value — the tab this guard used to ignore entirely. */
  private photoTabHasContent(): boolean {
    return (
      !!this.pImage() ||
      !!this.pGradeLevel() ||
      !!this.pCourseId() ||
      !!this.pTopicId() ||
      !!this.pDifficulty() ||
      !!this.pCorrectAnswer()
    );
  }

  /** Same condition as `canDeactivate`, for the browser-level (tab close/refresh) case Angular's router never sees. */
  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.savedSuccessfully || !this.hasUnsavedWork()) {
      return;
    }
    event.preventDefault();
    // `preventDefault()` alone doesn't trigger the browser's confirmation
    // dialog in every implementation — the legacy API also reads the
    // string set here (any non-undefined value shows the prompt).
    event.returnValue = '';
  }

  /**
   * Moves focus to the structured tab's first field after a successful
   * extraction: enunciado normally (B7), alternativas when the extraction
   * came back with none (B1). `afterNextRender` because the structured
   * panel is behind an `@if` — it may not exist in the DOM yet.
   */
  private focusStructuredFirstField(hasAlternatives: boolean): void {
    afterNextRender(
      () => {
        const target = hasAlternatives
          ? this.structuredBodyTextarea()?.nativeElement
          : this.structuredAlternativesTextarea()?.nativeElement;
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  /** L5: `ui-file-upload`'s `fileSelected` output already hands over the `File | null` directly. */
  protected onImageSelected(file: File | null): void {
    const previous = this.pImagePreviewUrl();
    if (previous) {
      URL.revokeObjectURL(previous);
    }
    this.pImage.set(file);
    this.pImagePreviewUrl.set(file ? URL.createObjectURL(file) : null);

    // Crops, extraction notices, and the AI taxonomy hint all describe the
    // photo that was just replaced — none of it applies anymore.
    this.extraction.resetForNewPhoto();
    if (this.sImageFromCrop) {
      this.setStructuredImage(null);
      this.sImageFromCrop = false;
    }
  }

  /** L5: same as `onImageSelected` — `ui-file-upload` emits the `File | null` directly. */
  protected onStructuredImageSelected(file: File | null): void {
    this.setStructuredImage(file);
    // A manual pick from the structured tab's own file input always
    // supersedes anything AI-derived.
    this.sImageFromCrop = false;
  }

  private setStructuredImage(file: File | null): void {
    const previous = this.sImagePreviewUrl();
    if (previous) {
      URL.revokeObjectURL(previous);
    }
    this.sImage.set(file);
    this.sImagePreviewUrl.set(file ? URL.createObjectURL(file) : null);
  }

  protected photoValid(): boolean {
    return (
      !!this.pCourseId() &&
      !!this.pTopicId() &&
      !!this.pDifficulty() &&
      !!this.pGradeLevel() &&
      !!this.pCorrectAnswer() &&
      !!this.pImage()
    );
  }

  /** B8: names only the fields still missing, in the photo tab's visual order, instead of always listing all six. */
  protected photoMissingFields(): string {
    const missing: string[] = [];
    if (!this.pImage()) missing.push('imagen');
    if (!this.pGradeLevel()) missing.push('grado');
    if (!this.pCourseId()) missing.push('curso');
    if (!this.pTopicId()) missing.push('tema');
    if (!this.pDifficulty()) missing.push('nivel');
    if (!this.pCorrectAnswer()) missing.push('clave');
    return missing.join(', ');
  }

  /**
   * Gate for "Extraer con IA" — deliberately just Grado + imagen. Curso/Tema
   * are best-effort SUGGESTED by the AI (see `extractWithAi`); Nivel is
   * never touched by AI at all — a human always picks it.
   */
  protected photoTaxonomyValid(): boolean {
    return !!this.pGradeLevel() && !!this.pImage();
  }

  protected submitPhoto(): void {
    if (this.saving() || !this.photoValid()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.liveAnnouncer.announce('Guardando…');
    this.saveChain
      .uploadImage({
        courseId: this.pCourseId(),
        topicId: this.pTopicId(),
        difficulty: this.pDifficulty()!,
        gradeLevel: this.pGradeLevel()!,
        correctAnswer: this.pCorrectAnswer(),
        image: this.pImage()!,
        folderId: this.pFolderId(),
      })
      .subscribe({
        next: ({ id }) => {
          this.saving.set(false);
          this.navigateToBank(id);
        },
        error: (e: HttpErrorResponse) => {
          this.saving.set(false);
          this.saveError.set(this.saveErrorMessage(e));
        },
      });
  }

  /**
   * Navigates back to the bank list, passing the created question's id
   * through router state — `bank-list` reads
   * `history.state.createdQuestionId` to highlight the new row. Flips
   * `savedSuccessfully` BEFORE navigating (the leave guard runs
   * synchronously as part of the navigation) so it doesn't ask the teacher
   * to confirm leaving a page they just saved. `Router.navigate()` can
   * still say no — both failure shapes reset the flag back to `false` so a
   * navigation that never actually left isn't trusted.
   */
  private navigateToBank(id: string): void {
    this.savedSuccessfully = true;
    this.router.navigate(['/app/bank'], { state: { createdQuestionId: id } }).then(
      (navigated) => {
        if (!navigated) {
          this.savedSuccessfully = false;
        }
      },
      () => {
        this.savedSuccessfully = false;
      },
    );
  }

  protected extractWithAi(): void {
    const image = this.pImage();
    const gradeLevel = this.pGradeLevel();
    // Manual picks on the photo tab always win over an AI guess.
    const photoCourseId = this.pCourseId();
    const photoTopicId = this.pTopicId();
    if (!image || !gradeLevel || this.extracting()) return;

    this.extraction.extractWithAi({
      image,
      isCurrentImage: () => this.pImage() === image,
      onResult: ({ extracted, hasAlternatives }) => {
        this.sBody.set(extracted.bodyTypst);
        // Empty `alternatives` (B1): leave the textarea blank rather than
        // hide WHY with an equally-blank joined string.
        this.sAlternatives.set(hasAlternatives ? extracted.alternatives.join('\n') : '');
        // When `alternatives` is EMPTY (B1) any `correctAnswer` index is
        // meaningless, so the clave is forced blank regardless.
        this.sCorrectAnswer.set(
          hasAlternatives ? indexToCorrectAnswerLetter(extracted.correctAnswer) : '',
        );
        // sDifficulty is intentionally left untouched — a human always picks it.

        // Routed through `setStructuredImage` (not a raw `sImage.set`) so
        // the preview stays in sync and the previous object URL is revoked.
        this.setStructuredImage(
          extracted.figureCrop ? dataUrlToFile(extracted.figureCrop.dataUrl, 'figura.png') : null,
        );
        this.sImageFromCrop = !!extracted.figureCrop;

        // The folder the teacher chose on the photo tab follows the
        // extraction into the structured tab. Curso/Tema need no special
        // casing: they were already set from the folder, and
        // `resolveStructuredTaxonomy` treats a manual photo-tab pick as the
        // winner over the AI's suggestion.
        this.sFolderId.set(this.pFolderId());

        this.extraction.resolveStructuredTaxonomy({
          gradeLevel,
          photoCourseId,
          photoTopicId,
          suggestedCourseName: extracted.suggestedCourseName,
          suggestedTopicName: extracted.suggestedTopicName,
          pCourses: this.pCourses(),
          sGradeLevel: this.sGradeLevel,
          sCourseId: this.sCourseId,
          sTopicId: this.sTopicId,
        });

        this.setTab('structured');
        this.focusStructuredFirstField(hasAlternatives);
      },
    });
  }

  protected onRecrop(event: { target: CropTarget; box: NormalizedBoxDto }): void {
    this.extraction.onRecrop({
      target: event.target,
      box: event.box,
      onFigureRecropped: (file) => {
        // Routed through `setStructuredImage` so the preview stays in
        // sync and the previous object URL is revoked.
        this.setStructuredImage(file);
        this.sImageFromCrop = true;
      },
    });
  }

  protected onDiscard(target: CropTarget): void {
    this.extraction.onDiscard({
      target,
      onFigureDiscarded: () => {
        // Routed through `setStructuredImage` so the preview clears in sync.
        this.setStructuredImage(null);
        this.sImageFromCrop = false;
      },
    });
  }

  protected structuredValid(): boolean {
    return (
      !!this.sCourseId() &&
      !!this.sTopicId() &&
      !!this.sDifficulty() &&
      !!this.sGradeLevel() &&
      !!this.sBody().trim() &&
      this.alternativesList().length >= 2 &&
      !!this.sCorrectAnswer() &&
      this.correctAnswerInRange()
    );
  }

  /**
   * A letter that IS present but indexes past the current alternatives list
   * — e.g. clave "e" with only 2 alternatives — must be re-checked live:
   * `alternativesList()` can shrink after extraction (teacher edits).
   */
  private correctAnswerInRange(): boolean {
    const letter = this.sCorrectAnswer().trim().toLowerCase();
    const index = CORRECT_ANSWER_LETTERS.indexOf(letter);
    if (index === -1) {
      // Not a recognized a-e letter — a different, pre-existing concern,
      // not this range check's job.
      return true;
    }
    return index < this.alternativesList().length;
  }

  /** B8: names only the fields still missing, in the structured tab's visual order, instead of always listing all six. */
  protected structuredMissingFields(): string {
    const missing: string[] = [];
    if (!this.sGradeLevel()) missing.push('grado');
    if (!this.sCourseId()) missing.push('curso');
    if (!this.sTopicId()) missing.push('tema');
    if (!this.sDifficulty()) missing.push('nivel');
    if (!this.sBody().trim()) missing.push('enunciado');
    if (this.alternativesList().length < 2) missing.push('al menos 2 alternativas');
    if (!this.sCorrectAnswer()) {
      missing.push('clave');
    } else if (!this.correctAnswerInRange()) {
      missing.push('clave fuera de rango');
    }
    return missing.join(', ');
  }

  private alternativesList(): string[] {
    return this.sAlternatives()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  protected submitStructured(): void {
    if (this.saving() || !this.structuredValid()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.liveAnnouncer.announce('Guardando…');

    this.saveChain
      .submitStructured({
        courseId: this.sCourseId(),
        topicId: this.sTopicId(),
        difficulty: this.sDifficulty()!,
        gradeLevel: this.sGradeLevel()!,
        correctAnswer: this.sCorrectAnswer(),
        bodyTypst: this.sBody(),
        alternatives: this.alternativesList(),
        image: this.sImage(),
        cropSlots: this.cropSlots(),
        extractedAlternatives: this.extraction.lastExtractedAlternatives,
        folderId: this.sFolderId(),
      })
      .subscribe({
        next: ({ id }) => {
          this.saving.set(false);
          this.navigateToBank(id);
        },
        error: (error: { stage: 'create'; httpError: HttpErrorResponse } | { stage: 'attach' }) => {
          this.saving.set(false);
          this.saveError.set(
            error.stage === 'create'
              ? this.saveErrorMessage(error.httpError)
              : // The question is already created — a resubmit retries only
                // the image uploads, never deletes a good transcription.
                'La pregunta se guardó, pero no se pudieron adjuntar las imágenes. Edítala desde el banco para volver a intentarlo.',
          );
        },
      });
  }

  /**
   * Save-error message for both submit paths — 409 gets dedicated wording
   * since the API's own message is English and names an internal id; every
   * other 4xx is specific enough via `extractErrorMessage` to show verbatim.
   */
  private saveErrorMessage(error: HttpErrorResponse): string {
    if (error.status === 409) {
      return 'Ya existe una pregunta idéntica en el banco.';
    }
    return extractErrorMessage(
      error,
      'No se pudo guardar la pregunta. Revisa los datos e inténtalo de nuevo.',
    );
  }
}
