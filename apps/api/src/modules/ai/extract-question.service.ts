import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import { AiAlternativeCrop, AiExtractedQuestion, AiQuestionCrop } from "@exams-generator/shared";
import { requireImageMime } from "../assets/image-mime";
import { validateStructuredContent } from "../bank/domain/validate-structured-content";
import { AuthTokenPayload } from "../auth/token.service";
import { GeneratedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import { ImageCropperPort } from "./domain/ports/image-cropper.port";
import { ExtractionCachePort } from "./domain/ports/extraction-cache.port";
import { NormalizedBox } from "./domain/normalized-box";
import { snapBoxToInk } from "./domain/snap-box-to-ink";
import { CROP_INK_PADDING_PX, CROP_MAX_WIDTH_PX } from "./domain/crop.constants";
import { EXTRACTION_CACHE_PORT, IMAGE_CROPPER_PORT, QUESTION_GENERATOR_PORT } from "./ai.constants";
import { correctAnswerLetterToIndex } from "./domain/correct-answer-letter-to-index";

/** Raw multipart file shape this service needs — decoupled from Express/Multer types. */
export interface ExtractQuestionFile {
  readonly buffer: Buffer;
  readonly mimetype: string;
}

/**
 * The `POST /ai/questions/extract` use case (question editing, Task 5): OCR/vision
 * extraction of a question from a photo via `QuestionGeneratorPort.extractFromImage`
 * and returns a VALIDATED draft — WITHOUT ever persisting it. Unlike
 * `ReviseQuestionService` there is no existing `:id`/DB read: this endpoint always
 * produces a brand-new, unsaved draft the caller may later persist via the existing
 * bank creation endpoints.
 *
 * `correctAnswer` is a LETTER ("a".."e") on the `QuestionGeneratorPort` contract but
 * a 0-based INDEX in bank storage/the PATCH edit contract — this service converts the
 * generator's LETTER output to an INDEX (`correctAnswerLetterToIndex`, mirroring
 * `ReviseQuestionService`/`GenerateQuestionsService`) BEFORE validating or returning
 * it, so neither `validateStructuredContent` nor the HTTP caller ever see the letter
 * representation.
 *
 * Task 5 also turns the model's reported figure/alternative boxes into actual
 * crops: the raw boxes are a generator-contract detail (they describe where
 * in the ORIGINAL photo the graphic sits) and never reach the HTTP response —
 * the response instead carries finished `data:` URL crops, snapped to the
 * real ink via `snapBoxToInk` and cut via `ImageCropperPort`. Nothing about
 * a crop is persisted here; a discarded draft leaves no orphan asset behind.
 *
 * Task 6: when there is at least one crop to adjust, the original photo is
 * also stashed in `ExtractionCachePort` under a fresh `extractionId`, so the
 * teacher can drag the rectangle and re-cut via `RecropQuestionService`
 * without re-uploading the photo. A text-only extraction skips the cache
 * entirely — there is no crop UI for it, so holding the photo for 30 minutes
 * would buy nothing.
 */
@Injectable()
export class ExtractQuestionService {
  private readonly logger = new Logger(ExtractQuestionService.name);

  constructor(
    @Inject(QUESTION_GENERATOR_PORT) private readonly generator: QuestionGeneratorPort,
    @Inject(IMAGE_CROPPER_PORT) private readonly cropper: ImageCropperPort,
    @Inject(EXTRACTION_CACHE_PORT) private readonly cache: ExtractionCachePort,
  ) {}

  async extract(user: AuthTokenPayload, file: ExtractQuestionFile): Promise<AiExtractedQuestion> {
    // Sniff before spending a vision-model call: `file.mimetype` is the
    // client's header, so a non-image (or a 5MB HTML blob) would otherwise be
    // shipped to OpenRouter and billed for nothing. Use the sniffed mime, not
    // the claimed one.
    const mimeType = requireImageMime(file);
    const extracted = await this.generator.extractFromImage({
      image: file.buffer,
      mimeType,
    });

    // The generator returns a LETTER; convert to the 0-based INDEX bank
    // storage/PATCH convention expects BEFORE validating or returning.
    const extractedWithIndex: GeneratedQuestion = {
      ...extracted,
      correctAnswer: correctAnswerLetterToIndex(extracted.correctAnswer),
    };

    const errors = validateStructuredContent({
      bodyTypst: extractedWithIndex.bodyTypst,
      alternatives: extractedWithIndex.alternatives,
      correctAnswer: extractedWithIndex.correctAnswer,
    });
    if (errors.length > 0) {
      throw new UnprocessableEntityException({ message: "AI produced invalid content", errors });
    }

    // The boxes are generator-contract detail; the HTTP response carries the
    // finished crops instead, so they are destructured out here and never
    // spread into the returned object.
    const { figureBox, alternativeBoxes, ...draft } = extractedWithIndex;
    const crops = await this.buildCrops(file.buffer, mimeType, figureBox, alternativeBoxes);

    const hasCrops = !!crops.figureCrop || (crops.alternativeCrops?.length ?? 0) > 0;
    if (!hasCrops) {
      return { ...draft, ...crops };
    }

    // Only cached when there is something to re-crop: a text-only question
    // has no crop UI, so holding its photo for 30 minutes buys nothing.
    //
    // Its own try/catch, deliberately OUTSIDE `buildCrops`'s: by this point the
    // vision call already succeeded and was billed, and the crops are already
    // built. A Redis hiccup here must not turn that into a 500 — same "the
    // transcription is the valuable half" argument `buildCrops` makes for
    // itself, just one step later. Losing only the ability to re-crop (no
    // `extractionId`, so the UI falls back to the text-only shape) is the
    // acceptable trade, not losing the whole response.
    try {
      const extractionId = randomUUID();
      await this.cache.put(extractionId, { userId: user.sub, image: file.buffer, mimeType });
      return { ...draft, ...crops, extractionId };
    } catch (error) {
      this.logger.warn(
        `Extraction cache write failed, returning crops without a re-crop handle: ${(error as Error).message}`,
      );
      return { ...draft, ...crops };
    }
  }

  /**
   * Turns the model's boxes into finished crops. Deliberately total: any
   * failure here (an image `sharp` cannot decode, a crop that throws) is
   * logged and swallowed, and the caller still gets the transcription. The
   * text is the valuable half of this endpoint — losing it because a crop
   * failed would be a bad trade.
   */
  private async buildCrops(
    image: Buffer,
    mimeType: string,
    figureBox: NormalizedBox | undefined,
    alternativeBoxes: readonly (NormalizedBox | null)[] | undefined,
  ): Promise<{ figureCrop?: AiQuestionCrop; alternativeCrops?: readonly AiAlternativeCrop[] }> {
    const hasAlternativeBox = (alternativeBoxes ?? []).some((box) => box !== null);
    if (!figureBox && !hasAlternativeBox) {
      return {};
    }

    try {
      const raster = await this.cropper.raster(image, mimeType);

      const cropAt = async (box: NormalizedBox): Promise<AiQuestionCrop> => {
        const snapped = snapBoxToInk(raster, box, CROP_INK_PADDING_PX);
        const bytes = await this.cropper.crop(image, mimeType, snapped, CROP_MAX_WIDTH_PX);
        return { dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, box: snapped };
      };

      const figureCrop = figureBox ? await cropAt(figureBox) : undefined;

      const alternativeCrops: AiAlternativeCrop[] = [];
      for (const [alternativeIndex, box] of (alternativeBoxes ?? []).entries()) {
        if (box) {
          alternativeCrops.push({ alternativeIndex, ...(await cropAt(box)) });
        }
      }

      return {
        ...(figureCrop ? { figureCrop } : {}),
        ...(alternativeCrops.length > 0 ? { alternativeCrops } : {}),
      };
    } catch (error) {
      this.logger.warn(
        `Crop step failed, returning the transcription without figures: ${(error as Error).message}`,
      );
      return {};
    }
  }
}
