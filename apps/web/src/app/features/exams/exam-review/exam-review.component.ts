import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Difficulty } from '@exams-generator/shared';
import { LucideAngularModule, Shuffle, Check, Lock, ArrowRight, ChevronDown } from 'lucide-angular';
import { MathTextComponent } from '../../../ui/math-text/math-text.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { BannerComponent } from '../../../ui/banner/banner.component';
import { ButtonComponent } from '../../../ui/button/button.component';
import { TagVariant } from '../../../ui/ui.types';
import { extractErrorMessage } from '../../ai/extract-error-message';
import { ExamVersionsService } from '../../exam-versions/exam-versions.service';
import { DEFAULT_VERSION_COUNT, VERSION_COUNT_OPTIONS } from '../../exam-versions/exam-versions.models';
import { ExamsService } from '../exams.service';
import { ExamDetailQuestion, ExamStatus } from '../exams.models';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};

const DIFFICULTY_TAG_VARIANT: Record<Difficulty, TagVariant> = {
  [Difficulty.Easy]: 'easy',
  [Difficulty.Medium]: 'medium',
  [Difficulty.Hard]: 'hard',
};

/**
 * Review + replace + confirm (design doc §5.3 steps 4-5). Reads the exam id
 * from the `:examId` route param (see app.routes.ts) and loads the full
 * exam detail via `GET /exams/:examId` (`ExamsService.getExam`) — this makes
 * the review screen deep-linkable and reload-safe (state used to live only
 * in an `[exam]` input signal held by `ExamCreateComponent`, which was lost
 * on refresh; see git history for that GAP note).
 */
@Component({
  selector: 'app-exam-review',
  imports: [
    LucideAngularModule,
    MathTextComponent,
    SelectComponent,
    TagComponent,
    BannerComponent,
    ButtonComponent,
  ],
  // `ChevronDown` is for the nested `ui-select` (Formas), not this template itself.
  providers: [LucideAngularModule.pick({ Shuffle, Check, Lock, ArrowRight, ChevronDown }).providers ?? []],
  templateUrl: './exam-review.component.html',
})
export class ExamReviewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly examsService = inject(ExamsService);
  private readonly examVersionsService = inject(ExamVersionsService);

  protected readonly examId = signal(this.route.snapshot.paramMap.get('examId') ?? '');

  /**
   * How many forms to compile. Seeded from `?formas=N`, which the builder
   * carries over so the extra review step costs the teacher no extra decision
   * (product decision 2026-08-17). Anything that isn't one of the offered
   * counts — a hand-edited URL, a stale link — falls back to the default
   * rather than sending `NaN` to the API. Still a select here: this is the
   * moment before the compile, so it's the right place to change your mind.
   */
  protected readonly versionCount = signal(this.readFormasParam());
  protected readonly versionCountOptions: readonly SelectOption<number>[] = VERSION_COUNT_OPTIONS.map((count) => ({
    value: count,
    label: String(count),
  }));

  private readFormasParam(): number {
    const raw = Number(this.route.snapshot.queryParamMap.get('formas'));
    return VERSION_COUNT_OPTIONS.includes(raw) ? raw : DEFAULT_VERSION_COUNT;
  }

  protected onVersionCountChange(value: number | null): void {
    this.versionCount.set(value ?? DEFAULT_VERSION_COUNT);
  }

  protected readonly generating = signal(false);
  protected readonly generateError = signal<string | null>(null);

  /**
   * Confirms and compiles in ONE action. `POST /exams/:id/versions`
   * auto-confirms a draft with a non-empty selection server-side
   * (`prepareGeneration`), so asking the teacher to press "Confirmar" first
   * and "Generar" second would be two clicks for one decision. That
   * auto-confirm is exactly what used to be dangerous when the BUILDER called
   * it — the exam got sealed unseen; called from here it seals what the
   * teacher just read.
   */
  protected generateVersions(): void {
    if (this.generating() || this.isReady()) {
      return;
    }
    this.generating.set(true);
    this.generateError.set(null);
    this.examVersionsService.generateVersions(this.examId(), this.versionCount()).subscribe({
      next: () => {
        this.generating.set(false);
        this.router.navigate(['/app/exams', this.examId(), 'versions']);
      },
      error: (error: HttpErrorResponse) => {
        this.generating.set(false);
        this.generateError.set(extractErrorMessage(error, 'No se pudo generar el examen. Inténtalo de nuevo.'));
      },
    });
  }
  protected readonly title = signal('');
  protected readonly questions = signal<readonly ExamDetailQuestion[]>([]);
  protected readonly status = signal<ExamStatus>('draft');
  protected readonly loading = signal(false);
  /** Load failures only — the ONE case where a "Reintentar" button is honest. */
  protected readonly errorMessage = signal<string | null>(null);
  /**
   * Failures of an action the teacher just took (reroll/replace). Separate from
   * `errorMessage` because they shared a banner whose "Reintentar" reloads the
   * exam — pressing it did nothing about the reemplazo that had just failed
   * (audit 2026-08-15).
   */
  protected readonly actionError = signal<string | null>(null);
  /**
   * Transient "eso que hiciste, funcionó" line. A successful reroll changed one
   * row silently — the teacher had no way to tell the click had done anything
   * (audit 2026-08-15). Cleared at the start of every action so it can never
   * describe a swap that isn't the last one.
   */
  protected readonly actionSuccess = signal<string | null>(null);
  /**
   * A replacement is in flight. Without it, two quick clicks on "Cambiar" sent
   * two `POST .../replace` calls and the second answer overwrote the first —
   * the teacher saw the question change twice for one click's worth of intent
   * (audit 2026-08-15). Cleared on BOTH outcomes: a row stuck disabled after an
   * error would be worse than the error itself.
   */
  protected readonly replacing = signal(false);
  protected readonly manualReplacementIds = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.loadExam();
  }

  protected retry(): void {
    this.loadExam();
  }

  private loadExam(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.examsService.getExam(this.examId()).subscribe({
      next: (exam) => {
        this.title.set(exam.title);
        this.status.set(exam.status);
        this.questions.set(exam.questions);
        this.loading.set(false);
      },
      error: (_error: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMessage.set('No se pudo cargar el examen. Inténtalo de nuevo.');
      },
    });
  }

  protected onManualReplacementInput(questionId: string, value: string): void {
    this.manualReplacementIds.update((current) => ({ ...current, [questionId]: value }));
  }

  protected reroll(questionId: string): void {
    this.replace(questionId, { mode: 'reroll' });
  }

  protected manualReplace(questionId: string): void {
    const replacementQuestionId = this.manualReplacementIds()[questionId];
    if (!replacementQuestionId) {
      return;
    }
    this.replace(questionId, { mode: 'manual', replacementQuestionId });
  }

  private replace(questionId: string, payload: { mode: 'reroll' } | { mode: 'manual'; replacementQuestionId: string }): void {
    if (this.status() === 'ready' || this.replacing()) {
      return;
    }

    this.replacing.set(true);

    this.actionError.set(null);
    this.actionSuccess.set(null);
    // Captured BEFORE the reload: after it, the list holds a different question
    // at this index and the position is what the teacher is looking at.
    const position = this.questions().findIndex((question) => question.id === questionId) + 1;

    this.examsService.replaceQuestion(this.examId(), questionId, payload).subscribe({
      next: () => {
        this.replacing.set(false);
        this.actionSuccess.set(`Cambiamos la pregunta ${position}.`);
        this.loadExam();
      },
      error: (error: HttpErrorResponse) => {
        this.replacing.set(false);
        // The API answers a bad/foreign replacement id with a 400 that SAYS
        // why. Swallowing it for a generic "inténtalo de nuevo" told the
        // teacher to retry the exact input that just failed (audit
        // 2026-08-15). `extractErrorMessage` already normalizes both 400 body
        // shapes this API produces and falls back to a generic line.
        this.actionError.set(extractErrorMessage(error, 'No se pudo reemplazar la pregunta.'));
      },
    });
  }

  protected confirm(): void {
    this.actionError.set(null);

    this.examsService.confirmExam(this.examId()).subscribe({
      next: (result) => {
        this.status.set(result.status);
      },
      error: (_error: HttpErrorResponse) => {
        this.errorMessage.set('No se pudo confirmar el examen. Inténtalo de nuevo.');
      },
    });
  }

  protected isReady(): boolean {
    return this.status() === 'ready';
  }

  /**
   * Where the "Ver / generar formas" CTA goes once the exam is confirmed. The
   * success banner promised the teacher they could generate the versions and
   * the screen had no control at all to do it (audit 2026-08-15) — the only
   * way out was guessing the path through "Mis exámenes". `navigate` rather
   * than a `routerLink`, matching every other navigation in this feature.
   */
  protected goToVersions(): void {
    this.router.navigate(['/app/exams', this.examId(), 'versions']);
  }

  /**
   * The intro line only makes sense while the exam can still change — with a
   * `ready` exam every "Cambiar" is disabled, so telling the teacher to swap
   * questions described an action the UI refuses.
   */
  protected introText(): string {
    return this.isReady()
      ? 'Este examen ya está confirmado. Estas son las preguntas que quedaron.'
      : 'Estas son las preguntas que sacamos de tu banco. Cámbialas si quieres y genera las formas cuando estés conforme.';
  }

  protected statusLabel(status: ExamStatus): string {
    return status === 'ready' ? 'Listo' : 'Borrador';
  }

  protected statusTag(status: ExamStatus): TagVariant {
    return status === 'ready' ? 'easy' : 'medium';
  }

  protected difficultyLabel(difficulty: Difficulty): string {
    return DIFFICULTY_LABELS[difficulty];
  }

  protected difficultyVariant(difficulty: Difficulty): TagVariant {
    return DIFFICULTY_TAG_VARIANT[difficulty];
  }

  /**
   * How the correct answer is spelled for a human.
   *
   * The two question types store it differently (see `version-shuffler.ts`):
   * `structured` keeps the 0-BASED INDEX into `alternatives`, `image` keeps
   * the letter itself (the alternatives are baked into the picture). The
   * screen used to print the raw value, so a structured question showed
   * "Respuesta correcta: 4" — a number that means nothing to a teacher
   * reading options A–E (audit 2026-08-15).
   */
  protected correctAnswerLabel(question: ExamDetailQuestion): string {
    if (question.type === 'image' || !question.alternatives) {
      return question.correctAnswer.toUpperCase();
    }
    const index = Number(question.correctAnswer);
    const text = question.alternatives[index];
    if (!Number.isInteger(index) || text === undefined) {
      // Never invent a letter for a value we can't place — show what's stored.
      return question.correctAnswer;
    }
    return `${String.fromCharCode(65 + index)}) ${text}`;
  }
}
