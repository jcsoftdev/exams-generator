import { Injectable, WritableSignal, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import { AiExtractedQuestion, NormalizedBoxDto } from '@exams-generator/shared';
import { AiService } from '../ai/ai.service';
import { AI_NOT_CONFIGURED_MESSAGE, extractErrorMessage } from '../ai/extract-error-message';
import { LiveAnnouncerService } from '../../ui/live-region/live-announcer.service';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { Course } from '../taxonomy/taxonomy.models';
import { CropSlot, CropTarget, sameTarget } from './crop-review/crop-review.component';
import { dataUrlToFile } from './data-url-to-file';
import { CORRECT_ANSWER_LETTERS, findCourseMatch, findTopicMatch } from './taxonomy-matcher';

/**
 * Extracted from `bank-new.component.ts` (Line G split, audit M10) — owns
 * the `extractWithAi` request lifecycle (stale-response guard, timeout/429
 * error mapping), the crop-review notices (`extracting`, `extractError`,
 * `extractNoAlternatives`, `extractReviewNotice`, `aiTaxonomyHint`), the
 * `cropSlots` themselves, and `onRecrop`/`onDiscard` with the
 * `extractionId` staleness guard. Provided by `BankNewComponent` itself
 * (component-scoped, not root) — one instance per "Nueva pregunta" page
 * visit, matching the original private-field's lifetime.
 *
 * The component still owns the structured-tab FORM fields (`sBody`,
 * `sAlternatives`, `sCorrectAnswer`, `sImage`) and the taxonomy select
 * effects — this service never writes to them directly. Instead
 * `extractWithAi`/`onRecrop`/`onDiscard` take small callbacks
 * (`onResult`/`onFigureRecropped`/`onFigureDiscarded`) so the component can
 * apply AI results to its own signals at the moment they're ready, exactly
 * where the original component code did.
 */

/** Turns the extraction response's crops into review slots, figure first. */
function buildCropSlots(extracted: AiExtractedQuestion): readonly CropSlot[] {
  const slots: CropSlot[] = [];
  if (extracted.figureCrop) {
    slots.push({
      target: { kind: 'figure' },
      label: 'Figura del enunciado',
      dataUrl: extracted.figureCrop.dataUrl,
      box: extracted.figureCrop.box,
      busy: false,
    });
  }
  for (const crop of extracted.alternativeCrops ?? []) {
    slots.push({
      target: { kind: 'alternative', alternativeIndex: crop.alternativeIndex },
      label: `Alternativa ${CORRECT_ANSWER_LETTERS[crop.alternativeIndex] ?? crop.alternativeIndex})`,
      dataUrl: crop.dataUrl,
      box: crop.box,
      busy: false,
    });
  }
  return slots;
}

export interface ExtractWithAiParams {
  readonly image: File;
  /**
   * Read at response time — `true` when the photo this request was sent for
   * is still the one selected. A slower response for a photo the teacher has
   * already replaced must not silently overwrite whatever the CURRENT
   * photo's own extraction produced (or is about to produce).
   */
  readonly isCurrentImage: () => boolean;
  readonly onResult: (result: { extracted: AiExtractedQuestion; hasAlternatives: boolean }) => void;
}

export interface OnRecropParams {
  readonly target: CropTarget;
  readonly box: NormalizedBoxDto;
  readonly onFigureRecropped: (file: File) => void;
}

export interface OnDiscardParams {
  readonly target: CropTarget;
  readonly onFigureDiscarded: () => void;
}

export interface ResolveStructuredTaxonomyParams {
  readonly gradeLevel: string;
  readonly photoCourseId: string;
  readonly photoTopicId: string;
  readonly suggestedCourseName: string | undefined;
  readonly suggestedTopicName: string | undefined;
  /** The photo tab's already-loaded course list — matched against `suggestedCourseName` client-side. */
  readonly pCourses: readonly Course[];
  /** The structured tab's own signals — written to directly, same objects the component template binds. */
  readonly sGradeLevel: WritableSignal<string | null>;
  readonly sCourseId: WritableSignal<string>;
  readonly sTopicId: WritableSignal<string>;
}

@Injectable()
export class BankNewExtractionService {
  private readonly aiService = inject(AiService);
  private readonly liveAnnouncer = inject(LiveAnnouncerService);
  private readonly taxonomyService = inject(TaxonomyService);

  readonly extracting: WritableSignal<boolean> = signal(false);
  readonly extractError: WritableSignal<string | null> = signal(null);
  /** True right after an extraction whose `alternatives` came back empty (B1). */
  readonly extractNoAlternatives: WritableSignal<boolean> = signal(false);
  /** True right after a successful extraction — B7's "revisa antes de guardar" notice at the top of the structured tab. */
  readonly extractReviewNotice: WritableSignal<boolean> = signal(false);
  /**
   * B5: the AI's raw course/topic guess, set whenever at least one of them
   * didn't match anything in the loaded taxonomy.
   */
  readonly aiTaxonomyHint: WritableSignal<string | null> = signal(null);
  readonly cropSlots: WritableSignal<readonly CropSlot[]> = signal([]);

  /** Handle for the re-crop endpoint; null when the extraction produced no crops. */
  private extractionId: string | null = null;

  /**
   * The alternative TEXT captured at extraction time, indexed the same way
   * `AiAlternativeCrop.alternativeIndex` is — see
   * `QuestionSaveChainService.reresolveAlternativeIndex`, the consumer of
   * this snapshot at save time (Critical Finding 1).
   */
  private extractedAlternatives: readonly string[] = [];

  /** Snapshot for `QuestionSaveChainService` to pass through on submit. */
  get lastExtractedAlternatives(): readonly string[] {
    return this.extractedAlternatives;
  }

  /**
   * Consumed once by the component's `sGradeLevel`/`sCourseId` effects —
   * lets `resolveStructuredTaxonomy` tell those effects which course/topic
   * id to preselect instead of blanking to `''` on the next reset. See
   * design doc `docs/superpowers/specs/2026-07-20-bank-new-photo-ai-extract-design.md`
   * §3.1-3.2 for why this can't be done by racing `.subscribe()` calls.
   */
  private pendingStructuredCourseId: string | null = null;
  private pendingStructuredTopicId: string | null = null;

  consumePendingCourseId(): string {
    const id = this.pendingStructuredCourseId ?? '';
    this.pendingStructuredCourseId = null;
    return id;
  }

  consumePendingTopicId(): string {
    const id = this.pendingStructuredTopicId ?? '';
    this.pendingStructuredTopicId = null;
    return id;
  }

  /**
   * Resolves Curso/Tema for the structured tab after extraction: a manual
   * pick on the photo tab always wins; otherwise best-effort matches the
   * AI's suggested names against the taxonomy already loaded for this grade
   * and, once a course is known, that course's topics. No match at any step
   * just means both stay blank — the human picks them — but B5 additionally
   * surfaces the AI's raw guess (`aiTaxonomyHint`) instead of dropping it
   * silently, since "Biología" not matching a school's "Ciencia y
   * Tecnología" is exactly the kind of near-miss a teacher can act on.
   */
  resolveStructuredTaxonomy(params: ResolveStructuredTaxonomyParams): void {
    const {
      gradeLevel,
      photoCourseId,
      photoTopicId,
      suggestedCourseName,
      suggestedTopicName,
      pCourses,
      sGradeLevel,
      sCourseId,
      sTopicId,
    } = params;

    /**
     * Always applies THIS extraction's resolved `courseId`/`topicId` —
     * never "stale", even on a second extraction at the same grade whose
     * suggestion differs from (or contradicts) the first's. The pending
     * mechanism above is only a relay for the component's chained effects
     * (`sGradeLevel`→`sCourseId`, `sCourseId`→`sTopicId`), and a signal
     * `.set()` to the SAME value it already holds never notifies — so a
     * genuine grade OR course change is applied by that effect chain, but a
     * same-grade (or same-course) extraction must be applied directly here
     * instead, or it would silently vanish along with whatever the
     * PREVIOUS extraction (or the teacher) had picked.
     */
    const applyPreselect = (courseId: string, topicId: string): void => {
      this.aiTaxonomyHint.set(
        (!!suggestedCourseName && !courseId) || (!!suggestedTopicName && !topicId)
          ? `La IA sugiere: ${suggestedCourseName ?? '—'} / ${suggestedTopicName ?? '—'}`
          : null,
      );

      const gradeChanged = sGradeLevel() !== gradeLevel;
      this.pendingStructuredCourseId = courseId;
      this.pendingStructuredTopicId = topicId;
      sGradeLevel.set(gradeLevel);
      if (gradeChanged) {
        return;
      }

      // Same grade as before — the grade→course effect was a no-op, so
      // `pendingStructuredCourseId` was never consumed. Apply it ourselves.
      this.pendingStructuredCourseId = null;
      const courseChanged = sCourseId() !== courseId;
      sCourseId.set(courseId);
      if (!courseChanged) {
        // Same course too — the course→topic effect is ALSO a no-op here,
        // one level down from the guard above. Apply the topic directly.
        this.pendingStructuredTopicId = null;
        sTopicId.set(topicId);
      }
    };

    const courseId = photoCourseId || findCourseMatch(pCourses, suggestedCourseName)?.id || '';

    if (photoTopicId || !courseId || !suggestedTopicName) {
      applyPreselect(courseId, photoTopicId);
      return;
    }

    this.taxonomyService.getTopics(courseId, gradeLevel).subscribe({
      next: (topics) =>
        applyPreselect(courseId, findTopicMatch(topics, suggestedTopicName)?.id ?? ''),
      error: () => applyPreselect(courseId, ''),
    });
  }

  /**
   * Clears every bit of AI/crop state tied to a photo that just changed (or
   * was cleared) — same reasoning as the original `setImage`: crops (and any
   * pending re-crop handle) are always cut FROM the photo that was just
   * replaced, so they describe a photo the teacher can no longer see. Left
   * uncleared, `onRecrop` would keep re-cutting against a stale
   * `extractionId` and `cropSlots` would keep showing (and uploading) crops
   * from it.
   */
  resetForNewPhoto(): void {
    this.extractError.set(null);
    this.extractNoAlternatives.set(false);
    this.extractReviewNotice.set(false);
    this.aiTaxonomyHint.set(null);
    this.extractionId = null;
    this.cropSlots.set([]);
    this.extractedAlternatives = [];
  }

  extractWithAi(params: ExtractWithAiParams): void {
    if (this.extracting()) return;
    this.extracting.set(true);
    this.extractError.set(null);
    // A NEW extraction run — on this same photo or a different one — starts
    // with a clean slate: leftover notices from a PREVIOUS extraction (no
    // alternatives, the review banner, a taxonomy hint) describe THAT run,
    // not this one.
    this.extractNoAlternatives.set(false);
    this.extractReviewNotice.set(false);
    this.aiTaxonomyHint.set(null);
    this.liveAnnouncer.announce('Leyendo la foto…');

    this.aiService.extractQuestionFromImage(params.image).subscribe({
      next: (extracted) => {
        if (!params.isCurrentImage()) {
          this.extracting.set(false);
          return;
        }
        const hasAlternatives = extracted.alternatives.length > 0;
        this.extractNoAlternatives.set(!hasAlternatives);
        this.extractionId = extracted.extractionId ?? null;
        this.cropSlots.set(buildCropSlots(extracted));
        this.extractedAlternatives = extracted.alternatives;
        this.extracting.set(false);
        this.extractReviewNotice.set(true);
        this.liveAnnouncer.announce(
          'La IA leyó la foto. Revisa el enunciado, las alternativas y la clave.',
        );
        params.onResult({ extracted, hasAlternatives });
      },
      error: (error: HttpErrorResponse | TimeoutError) => {
        this.extracting.set(false);
        // Same staleness guard as `next` above — a stale error must not
        // surface a message about a photo the teacher already replaced.
        if (!params.isCurrentImage()) {
          return;
        }
        // B2: the client-side watchdog (ai.service.ts) fires a TimeoutError,
        // not an HttpErrorResponse — it never reached the server at all, so
        // there is no status/body to read a message from.
        if (error instanceof TimeoutError) {
          this.extractError.set('La lectura de la foto tardó demasiado. Inténtalo de nuevo.');
          return;
        }
        const message = extractErrorMessage(
          error,
          'No se pudo leer la pregunta desde la imagen. Inténtalo de nuevo.',
        );
        this.extractError.set(
          error.status === 429
            ? 'La IA alcanzó su límite de uso gratuito. Espera unos minutos e inténtalo de nuevo.'
            : // B10: extractErrorMessage() only returns the neutral half —
              // this photo-specific sentence only makes sense here.
              message === AI_NOT_CONFIGURED_MESSAGE
              ? `${message} Escribe la pregunta o guarda la foto tal cual.`
              : message,
        );
      },
    });
  }

  onRecrop(params: OnRecropParams): void {
    const extractionId = this.extractionId;
    if (!extractionId) {
      // `extractionId` is null whenever the extraction's cache write failed
      // (the API still returns crops in that case) — the teacher would
      // otherwise drag the rectangle and see nothing happen. Same message as
      // the 410 branch below since both mean "there is no live session to
      // re-cut against."
      this.extractError.set(
        'La sesión de recorte expiró. Vuelve a extraer la pregunta desde la foto.',
      );
      return;
    }

    this.updateSlot(params.target, (slot) => ({ ...slot, busy: true }));
    this.aiService.recropExtraction(extractionId, params.box).subscribe({
      next: (crop) => {
        // B3: a stale response — the teacher picked a new photo (or
        // re-extracted) WHILE this recrop was in flight, which already reset
        // `this.extractionId` and wiped `cropSlots`. Compare against the
        // CAPTURED id, not a freshly-read `this.extractionId`, so this can
        // only ever be "the extraction changed since this request was sent".
        if (this.extractionId !== extractionId) {
          return;
        }
        this.updateSlot(params.target, (slot) => ({
          ...slot,
          dataUrl: crop.dataUrl,
          box: crop.box,
          busy: false,
        }));
        if (params.target.kind === 'figure') {
          params.onFigureRecropped(dataUrlToFile(crop.dataUrl, 'figura.png'));
        }
      },
      error: (error: HttpErrorResponse | TimeoutError) => {
        // B3: same staleness guard as `next` above.
        if (this.extractionId !== extractionId) {
          return;
        }
        this.updateSlot(params.target, (slot) => ({ ...slot, busy: false }));
        if (error instanceof TimeoutError) {
          this.extractError.set('El recorte tardó demasiado. Inténtalo de nuevo.');
          return;
        }
        // A 410 means the crop session expired, the id was never ours, or
        // it belongs to another account — the API deliberately returns the
        // SAME status for all three so the response can't confirm an id
        // exists. Any other status is a plain re-crop failure.
        this.extractError.set(
          error.status === 410
            ? 'La sesión de recorte expiró. Vuelve a extraer la pregunta desde la foto.'
            : 'No se pudo recortar. Inténtalo de nuevo.',
        );
      },
    });
  }

  onDiscard(params: OnDiscardParams): void {
    this.cropSlots.update((slots) =>
      slots.filter((slot) => !sameTarget(slot.target, params.target)),
    );
    if (params.target.kind === 'figure') {
      params.onFigureDiscarded();
    }
  }

  private updateSlot(target: CropTarget, patch: (slot: CropSlot) => CropSlot): void {
    this.cropSlots.update((slots) =>
      slots.map((slot) => (sameTarget(slot.target, target) ? patch(slot) : slot)),
    );
  }
}
