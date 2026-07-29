import { Component, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Difficulty } from '@exams-generator/shared';
import { LucideAngularModule, Upload, Image as ImageIcon, Check, ChevronDown, Sparkles } from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { InputComponent } from '../../../ui/input/input.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { TabsComponent, TabItem } from '../../../ui/tabs/tabs.component';
import { BankService } from '../bank.service';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from '../bank.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { AiService } from '../../ai/ai.service';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};
type Tab = 'photo' | 'structured';

const CORRECT_ANSWER_LETTERS = ['a', 'b', 'c', 'd', 'e'];

/**
 * `ExtractQuestionService`/`ReviseQuestionService` return `correctAnswer` as
 * a 0-based INDEX (bank storage/PATCH convention) — but this UI's "Clave"
 * field is letter-labeled (a/b/c/d/e) and manual entry into it is also a
 * letter. Converting at this boundary keeps `sCorrectAnswer` ALWAYS a
 * letter, whether it got there by typing or by AI autofill.
 */
function indexToCorrectAnswerLetter(index: string): string {
  const letter = CORRECT_ANSWER_LETTERS[Number(index)];
  return letter ?? index;
}

/** Inverse of `indexToCorrectAnswerLetter` — used right before the wire call, which still expects the 0-based index. */
function correctAnswerLetterToIndex(letter: string): string {
  const index = CORRECT_ANSWER_LETTERS.indexOf(letter.trim().toLowerCase());
  return index === -1 ? letter : String(index);
}

/** Accent/case/whitespace-insensitive compare — the AI's course/topic guess won't always match the DB's exact casing. */
function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Course names are a small, standard catalog (Aritmética, Comunicación...) — an exact normalized match is reliable. */
function findCourseMatch(courses: readonly Course[], guess: string | undefined): Course | undefined {
  if (!guess) return undefined;
  const normalizedGuess = normalizeForMatch(guess);
  return courses.find((course) => normalizeForMatch(course.name) === normalizedGuess);
}

/** Topic names are long/compound (e.g. "sintaxis - complementos oracionales (complemento agente)") — substring containment either way is more forgiving than an exact match. */
function findTopicMatch(topics: readonly Topic[], guess: string | undefined): Topic | undefined {
  if (!guess) return undefined;
  const normalizedGuess = normalizeForMatch(guess);
  return topics.find((topic) => {
    const normalizedName = normalizeForMatch(topic.name);
    return (
      normalizedName === normalizedGuess ||
      normalizedName.includes(normalizedGuess) ||
      normalizedGuess.includes(normalizedName)
    );
  });
}

function toOptions(items: readonly { id: string; name: string }[]): SelectOption<string>[] {
  return items.map((item) => ({ value: item.id, label: item.name }));
}

/**
 * Task 6: "Nueva pregunta" creator with two tabs — "Foto de la pregunta"
 * (existing `POST /bank/questions/image` multipart upload) and "Escribir
 * pregunta" (new `POST /bank/questions/structured` JSON payload). Route
 * `/app/bank/new`, replaces the old single-form `bank-upload` screen as the
 * primary entry point (see Task 5's "nueva pregunta" nav target).
 *
 * UI redesign follow-up: Curso/Tema are dependent `ui-select` dropdowns
 * sourced from `TaxonomyService` (never raw UUID text inputs — submits the
 * selected ids). The photo tab's file input is a styled click/drag upload
 * control with filename + thumbnail preview instead of the native
 * "Choose File" button.
 */
@Component({
  selector: 'app-bank-new',
  standalone: true,
  imports: [ButtonComponent, InputComponent, SelectComponent, TabsComponent, LucideAngularModule],
  // `ui-select` (Grado/Curso/Tema/Nivel, both tabs) needs Check + ChevronDown —
  // this component-level `.pick()` shadows the root `app.config.ts` registration
  // for its own subtree, so the nested `ui-select` instances can't fall back to it.
  providers: [LucideAngularModule.pick({ Upload, Image: ImageIcon, Check, ChevronDown, Sparkles }).providers ?? []],
  templateUrl: './bank-new.component.html',
})
export class BankNewComponent {
  private readonly bankService = inject(BankService);
  private readonly taxonomyService = inject(TaxonomyService);
  private readonly aiService = inject(AiService);
  private readonly router = inject(Router);

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
  protected readonly extracting = signal(false);
  protected readonly extractError = signal<string | null>(null);

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
   * Consumed once by the `sGradeLevel`/`sCourseId` effects below — lets
   * `extractWithAi()` tell those effects which course/topic id to
   * preselect instead of blanking to `''` on the next reset. See design
   * doc `docs/superpowers/specs/2026-07-20-bank-new-photo-ai-extract-design.md`
   * §3.1-3.2 for why this can't be done by racing `.subscribe()` calls.
   */
  private pendingStructuredCourseId: string | null = null;
  private pendingStructuredTopicId: string | null = null;

  constructor() {
    // Courses are loaded per selected grade — the catalog is divided by
    // educational stage, so loading it up front (no grade) would list every
    // stage's courses at once and repeat shared names (Matemática,
    // Comunicación…) once per stage (same fix as ai-generate.component.ts).
    // Photo and structured tabs each have their OWN grade field
    // (pGradeLevel/sGradeLevel), so each path loads and resets its own
    // course list independently — picking a grade on one tab never touches
    // the other tab's course selection.
    effect(() => {
      const gradeLevel = this.pGradeLevel();
      this.pCourseId.set('');
      this.pCourses.set([]);
      if (!gradeLevel) return;
      this.taxonomyService.getCourses(gradeLevel).subscribe({
        next: (courses) => this.pCourses.set(courses),
        error: () => this.saveError.set('No se pudieron cargar los cursos. Recarga la página.'),
      });
    });

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

    // Dependent Tema dropdown (photo tab): reloads whenever the course
    // changes, resets the previously selected topic so it never leaks
    // across courses.
    effect(() => {
      const courseId = this.pCourseId();
      this.pTopicId.set('');
      this.pTopics.set([]);
      if (!courseId) return;
      this.taxonomyService.getTopics(courseId, this.pGradeLevel() ?? undefined).subscribe({
        next: (topics) => this.pTopics.set(topics),
        error: () => this.saveError.set('No se pudieron cargar los temas. Inténtalo de nuevo.'),
      });
    });

    // Same dependent behavior for the structured tab.
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
  }

  protected setTab(t: Tab): void {
    this.tab.set(t);
    this.saveError.set(null);
    this.extractError.set(null);
  }

  protected onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setImage(input.files?.[0] ?? null);
  }

  private setImage(file: File | null): void {
    const previous = this.pImagePreviewUrl();
    if (previous) {
      URL.revokeObjectURL(previous);
    }
    this.pImage.set(file);
    this.pImagePreviewUrl.set(file ? URL.createObjectURL(file) : null);
  }

  protected onStructuredImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setStructuredImage(input.files?.[0] ?? null);
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

  /**
   * Gate for "Extraer con IA" — deliberately just Grado + imagen. Curso/Tema
   * are best-effort SUGGESTED by the AI and matched client-side (see
   * `extractWithAi`); Nivel is never touched by AI at all — same reason
   * `openrouter-difficulty-gate.ts` never trusts the model's own
   * self-reported difficulty on the generate path, a human always picks it.
   */
  protected photoTaxonomyValid(): boolean {
    return !!this.pGradeLevel() && !!this.pImage();
  }

  protected submitPhoto(): void {
    if (this.saving() || !this.photoValid()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.bankService
      .uploadImageQuestion({
        courseId: this.pCourseId(),
        topicId: this.pTopicId(),
        difficulty: this.pDifficulty()!,
        gradeLevel: this.pGradeLevel()!,
        correctAnswer: this.pCorrectAnswer(),
        image: this.pImage()!,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.router.navigate(['/app/bank']);
        },
        error: (_e: HttpErrorResponse) => {
          this.saving.set(false);
          this.saveError.set('No se pudo guardar la pregunta. Revisa los datos e inténtalo de nuevo.');
        },
      });
  }

  protected extractWithAi(): void {
    const image = this.pImage();
    const gradeLevel = this.pGradeLevel();
    // Manual picks on the photo tab (if the human made any) always win over
    // an AI guess — the guess only fills in what the human left blank.
    const photoCourseId = this.pCourseId();
    const photoTopicId = this.pTopicId();
    if (!image || !gradeLevel || this.extracting()) return;
    this.extracting.set(true);
    this.extractError.set(null);

    this.aiService.extractQuestionFromImage(image).subscribe({
      next: (extracted) => {
        this.sBody.set(extracted.bodyTypst);
        this.sAlternatives.set(extracted.alternatives.join('\n'));
        this.sCorrectAnswer.set(indexToCorrectAnswerLetter(extracted.correctAnswer));
        // sDifficulty is intentionally left untouched — Nivel is never
        // auto-filled from AI, the human always picks it.

        this.resolveStructuredTaxonomy({
          gradeLevel,
          photoCourseId,
          photoTopicId,
          suggestedCourseName: extracted.suggestedCourseName,
          suggestedTopicName: extracted.suggestedTopicName,
        });

        this.extracting.set(false);
        this.setTab('structured');
      },
      error: (error: HttpErrorResponse) => {
        this.extracting.set(false);
        this.extractError.set(
          error.status === 429
            ? 'La IA alcanzó su límite de uso gratuito. Espera unos minutos e inténtalo de nuevo.'
            : 'No se pudo leer la pregunta desde la imagen. Inténtalo de nuevo.',
        );
      },
    });
  }

  /**
   * Resolves Curso/Tema for the structured tab after extraction: a manual
   * pick on the photo tab always wins; otherwise best-effort matches the
   * AI's suggested names against the taxonomy already loaded for this grade
   * (`pCourses`) and, once a course is known, that course's topics. No
   * match at any step just means both stay blank — the human picks them,
   * same as before this feature existed.
   */
  private resolveStructuredTaxonomy(params: {
    gradeLevel: string;
    photoCourseId: string;
    photoTopicId: string;
    suggestedCourseName: string | undefined;
    suggestedTopicName: string | undefined;
  }): void {
    const { gradeLevel, photoCourseId, photoTopicId, suggestedCourseName, suggestedTopicName } = params;

    const applyPreselect = (courseId: string, topicId: string): void => {
      if (this.sGradeLevel() !== gradeLevel) {
        this.pendingStructuredCourseId = courseId;
        this.pendingStructuredTopicId = topicId;
      }
      this.sGradeLevel.set(gradeLevel);
    };

    const courseId = photoCourseId || findCourseMatch(this.pCourses(), suggestedCourseName)?.id || '';

    if (photoTopicId || !courseId || !suggestedTopicName) {
      applyPreselect(courseId, photoTopicId);
      return;
    }

    this.taxonomyService.getTopics(courseId, gradeLevel).subscribe({
      next: (topics) => applyPreselect(courseId, findTopicMatch(topics, suggestedTopicName)?.id ?? ''),
      error: () => applyPreselect(courseId, ''),
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
      !!this.sCorrectAnswer()
    );
  }

  private alternativesList(): string[] {
    return this.sAlternatives()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  /**
   * Set once `createStructuredQuestion` succeeds — if the follow-up
   * `replaceQuestionImage` step then fails, a resubmit must only retry
   * attaching the image, never call `createStructuredQuestion` again
   * (which would silently create a duplicate question).
   */
  private sCreatedQuestionId: string | null = null;

  protected submitStructured(): void {
    if (this.saving() || !this.structuredValid()) return;
    this.saving.set(true);
    this.saveError.set(null);

    const existingId = this.sCreatedQuestionId;
    if (existingId) {
      this.attachStructuredImageAndFinish(existingId);
      return;
    }

    this.bankService
      .createStructuredQuestion({
        courseId: this.sCourseId(),
        topicId: this.sTopicId(),
        difficulty: this.sDifficulty()!,
        gradeLevel: this.sGradeLevel()!,
        correctAnswer: correctAnswerLetterToIndex(this.sCorrectAnswer()),
        bodyTypst: this.sBody(),
        alternatives: this.alternativesList(),
      })
      .subscribe({
        next: ({ id }) => {
          this.sCreatedQuestionId = id;
          this.attachStructuredImageAndFinish(id);
        },
        error: (_e: HttpErrorResponse) => {
          this.saving.set(false);
          this.saveError.set('No se pudo guardar la pregunta. Revisa los datos e inténtalo de nuevo.');
        },
      });
  }

  private attachStructuredImageAndFinish(id: string): void {
    const image = this.sImage();
    if (!image) {
      this.saving.set(false);
      this.router.navigate(['/app/bank']);
      return;
    }
    this.bankService.replaceQuestionImage(id, image).subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigate(['/app/bank']);
      },
      error: () => {
        this.saving.set(false);
        this.saveError.set(
          'La pregunta se guardó, pero no se pudo adjuntar la imagen complementaria. Edítala desde el banco para volver a intentarlo.',
        );
      },
    });
  }
}
