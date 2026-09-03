import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { Difficulty } from '@exams-generator/shared';
import { BankService } from './bank.service';
import { CreateImageQuestionPayload } from './bank.models';
import { CropSlot } from './crop-review/crop-review.component';
import { dataUrlToFile } from './data-url-to-file';
import { correctAnswerLetterToIndex } from './taxonomy-matcher';

/**
 * Extracted from `bank-new.component.ts` (Line G split, audit M10) — the
 * "save the structured question" chain: `createStructuredQuestion` →
 * `replaceQuestionImage` + `setAlternativeImages` (in parallel, via
 * `forkJoin`), the `sCreatedQuestionId` resume-after-partial-failure latch,
 * and the alternative-crop re-resolution (Critical Finding 1). Provided by
 * `BankNewComponent` itself (component-scoped, not root) — one instance per
 * "Nueva pregunta" page visit, matching the original private-field's
 * lifetime.
 *
 * `submitPhoto`'s plain `uploadImageQuestion` call has no chain of its own
 * (a single multipart request, nothing to resume) but is exposed here too
 * so `BankNewComponent` never talks to `BankService` directly.
 */

/** What failed, so the caller can pick the right error message — a `create` failure carries the server's response; an `attach` failure never leaves a duplicate question behind to retry on resubmit. */
export type SubmitStructuredError =
  | { readonly stage: 'create'; readonly httpError: HttpErrorResponse }
  | { readonly stage: 'attach' };

export interface SubmitStructuredParams {
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  /** Letter form (a-e) — converted to the wire's 0-based index right before the create call. */
  readonly correctAnswer: string;
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  /** Optional complement image (chart/diagram/passage scan) — never required. */
  readonly image: File | null;
  readonly cropSlots: readonly CropSlot[];
  /**
   * The alternative TEXT captured at extraction time, indexed the same way
   * `AiAlternativeCrop.alternativeIndex` is — see `reresolveAlternativeIndex`
   * below. Owned by `BankNewExtractionService`; the component passes its
   * current snapshot through on every submit.
   */
  readonly extractedAlternatives: readonly string[];
  /**
   * Tenant folder the question is filed under, or `null` for unfiled.
   * REQUIRED, not optional: a caller that simply forgot to pass it would
   * silently file every question at the root, and the compiler is the only
   * thing that can tell "no folder chosen" apart from "forgot the field".
   */
  readonly folderId: string | null;
}

@Injectable()
export class QuestionSaveChainService {
  private readonly bankService = inject(BankService);

  /**
   * Set once `createStructuredQuestion` succeeds — if the follow-up
   * `replaceQuestionImage`/`setAlternativeImages` step then fails, a
   * resubmit must only retry attaching the image, never call
   * `createStructuredQuestion` again (which would silently create a
   * duplicate question).
   */
  private createdQuestionId: string | null = null;

  uploadImage(payload: CreateImageQuestionPayload): Observable<{ id: string }> {
    return this.bankService.uploadImageQuestion(payload);
  }

  /**
   * Runs (or resumes) the structured-question save chain. Emits `{ id }` on
   * success; errors with a `SubmitStructuredError` that tells the caller
   * whether the question itself was ever created.
   */
  submitStructured(params: SubmitStructuredParams): Observable<{ id: string }> {
    const existingId = this.createdQuestionId;
    if (existingId) {
      return this.attachAndFinish(existingId, params);
    }

    return this.bankService
      .createStructuredQuestion({
        courseId: params.courseId,
        topicId: params.topicId,
        difficulty: params.difficulty,
        gradeLevel: params.gradeLevel,
        correctAnswer: correctAnswerLetterToIndex(params.correctAnswer),
        bodyTypst: params.bodyTypst,
        alternatives: params.alternatives as string[],
        folderId: params.folderId,
      })
      .pipe(
        catchError((httpError: HttpErrorResponse) =>
          throwError(() => ({ stage: 'create', httpError }) satisfies SubmitStructuredError),
        ),
        switchMap(({ id }) => {
          this.createdQuestionId = id;
          return this.attachAndFinish(id, params);
        }),
      );
  }

  /**
   * L7: uploads the complement image and the alternative crops IN PARALLEL
   * via `forkJoin` — they only ever depend on the just-created `id`, never
   * on each other. Whichever half has nothing to upload is represented by
   * `of(null)` so `forkJoin` still completes without a real request for it.
   * `forkJoin`'s own semantics — ANY source erroring fails the whole join
   * immediately — are exactly the `stage: 'attach'` behavior a resubmit
   * relies on: a failure in EITHER upload must leave `createdQuestionId`
   * set so a resubmit retries (both of) them, never re-running
   * `createStructuredQuestion` and duplicating the question itself.
   */
  private attachAndFinish(id: string, params: SubmitStructuredParams): Observable<{ id: string }> {
    const imageUpload$ = params.image
      ? this.bankService.replaceQuestionImage(id, params.image)
      : of(null);

    const crops = this.resolveAlternativeCropsToUpload(params);
    const alternativesUpload$ =
      crops.length > 0 ? this.bankService.setAlternativeImages(id, crops) : of(null);

    return forkJoin([imageUpload$, alternativesUpload$]).pipe(
      map(() => ({ id })),
      // `createdQuestionId` is intentionally left SET here (both on the
      // happy path and on this error path) — a failure in EITHER upload
      // must leave it in place so a resubmit's `submitStructured` finds it
      // and retries only the attach step, never re-running
      // `createStructuredQuestion` and duplicating the question itself.
      catchError(() => throwError(() => ({ stage: 'attach' }) satisfies SubmitStructuredError)),
    );
  }

  /**
   * The alternative crops to upload, each re-derived against the CURRENT
   * alternatives list rather than trusting the index frozen at extraction
   * time.
   *
   * Each crop's `alternativeIndex` was frozen at extraction time
   * (`BankNewExtractionService.buildCropSlots`), but the alternatives
   * textarea is free text the teacher can freely edit, reorder, or blank
   * lines in before saving — and the caller's `alternatives` list already
   * filters out blank lines, so any edit before a crop's frozen index can
   * shift its true position. Re-deriving each crop's index against the
   * CURRENT list (via `reresolveAlternativeIndex`) instead of trusting the
   * frozen one is what closes Critical Finding 1.
   */
  private resolveAlternativeCropsToUpload(
    params: SubmitStructuredParams,
  ): { alternativeIndex: number; file: File }[] {
    const currentAlternatives = params.alternatives;
    // Each entry can be claimed by at most one crop — tracks which positions
    // are still available for matching so two crops whose ORIGINAL text
    // happened to be identical don't both claim the same occurrence.
    const available = currentAlternatives.map((text, index) => ({ text, index }));

    return params.cropSlots
      .filter(
        (slot): slot is CropSlot & { target: { kind: 'alternative'; alternativeIndex: number } } =>
          slot.target.kind === 'alternative',
      )
      .map((slot) => {
        const alternativeIndex = this.reresolveAlternativeIndex(
          slot.target.alternativeIndex,
          params.extractedAlternatives,
          available,
        );
        return alternativeIndex === null
          ? null
          : { alternativeIndex, file: dataUrlToFile(slot.dataUrl, 'alternativa.png') };
      })
      .filter((crop): crop is { alternativeIndex: number; file: File } => crop !== null);
  }

  /**
   * Re-derives where the alternative that had `originalIndex` at extraction
   * time now sits in the CURRENT alternatives list, since the teacher may
   * have edited/reordered/deleted lines in the free-text textarea since
   * (Critical Finding 1). Returns `null` when the crop cannot be safely
   * reattached — the caller drops it rather than guessing.
   *
   * Matching strategy: IDENTITY first, then a positional-shift fallback.
   * "Identity" means the current entry that still sits at `originalIndex`
   * AND still carries the original text — the common case where nothing (or
   * nothing relevant to this crop) was edited, verified without caring
   * whether that text is unique. Only when no entry still occupies its
   * original slot with its original text does this fall back to matching by
   * text alone, picking the first unclaimed occurrence — this is what
   * follows a crop's alternative when an EARLIER line was edited/deleted and
   * everything after it shifted.
   *
   * Text-only matching was tried first and reverted: it ignores
   * `originalIndex` entirely, so with duplicate alternative text (not exotic
   * in a maths bank — repeated numeric options happen) it can misattach a
   * crop with NO teacher edit at all. Example: extracted alternatives
   * `["2","4","2","8"]`, a crop frozen at index 2 — text-only matching
   * returns 0 (the FIRST "2"), moving the crop from C to A while nothing was
   * ever edited. The identity check catches this: index 2 still holds "2",
   * so it matches itself before the text-only fallback ever runs.
   *
   * `available` tracks which current positions are still unclaimed so two
   * crops whose original text happened to be identical don't both grab the
   * same occurrence — matched entries are removed from it as they're used,
   * via the SAME `available` list identity matching consults first.
   *
   * The one case this is EXPECTED to miss: a drawing alternative whose text
   * the teacher blanked, per the pdf-template convention ("an alternative
   * with its own image carries no text"). The current alternatives list
   * filters blank lines out entirely, so the blanked line simply isn't in
   * `available` to match against — the original (non-blank) text can never
   * be found there again, by identity or otherwise. That is the correct,
   * SAFE outcome: rather than guess a new position for an alternative that
   * no longer exists in the submitted array, the crop is dropped. Silently
   * misattaching it to whatever now occupies its old index would be worse —
   * that is exactly Critical Finding 1.
   *
   * The `originalText.length === 0` branch is a defensive fallback only, not
   * a supported path: `validateStructuredContent` (server-side) rejects any
   * extraction response with a blank alternative, so `extractedAlternatives`
   * can never actually hold one. If it somehow did, positional fallback is
   * the only signal left — it has NO way to detect an earlier
   * deletion/reorder and can misattach in that case. It still consumes its
   * slot from `available` (like every other branch) so a later crop can't
   * double-claim the same position; it exists only so this method has a
   * defined, non-throwing return, not because its result is trustworthy.
   */
  private reresolveAlternativeIndex(
    originalIndex: number,
    extractedAlternatives: readonly string[],
    available: { text: string; index: number }[],
  ): number | null {
    const originalText = (extractedAlternatives[originalIndex] ?? '').trim();
    if (originalText.length === 0) {
      const idx = available.findIndex((entry) => entry.index === originalIndex);
      if (idx === -1) {
        return null;
      }
      available.splice(idx, 1);
      return originalIndex;
    }
    const identityAt = available.findIndex(
      (entry) => entry.index === originalIndex && entry.text === originalText,
    );
    const matchAt =
      identityAt !== -1 ? identityAt : available.findIndex((entry) => entry.text === originalText);
    if (matchAt === -1) {
      return null;
    }
    const [match] = available.splice(matchAt, 1);
    return match.index;
  }
}
