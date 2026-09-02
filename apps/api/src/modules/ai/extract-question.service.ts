import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import { AiAlternativeCrop, AiExtractedQuestion, AiQuestionCrop } from "@exams-generator/shared";
import { requireImageMime } from "../assets/image-mime";
import { AuthTokenPayload } from "../auth/token.service";
import { ExtractedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import { ImageCropperPort } from "./domain/ports/image-cropper.port";
import { ExtractionCachePort } from "./domain/ports/extraction-cache.port";
import { TextRegionDetectorPort } from "./domain/ports/text-region-detector.port";
import { NormalizedBox } from "./domain/normalized-box";
import { findFigureRegions } from "./domain/find-figure-regions";
import { attributeFigureToAlternative } from "./domain/attribute-figure-to-alternative";
import { ANALYSIS_MAX_WIDTH_PX, CACHE_MAX_WIDTH_PX, CROP_MAX_WIDTH_PX } from "./domain/crop.constants";
import {
  EXTRACTION_CACHE_PORT,
  IMAGE_CROPPER_PORT,
  QUESTION_GENERATOR_PORT,
  TEXT_REGION_DETECTOR_PORT,
} from "./ai.constants";
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
 * `correctAnswer` is a LETTER ("a".."e", or `null` when the photo doesn't show/imply
 * a key — see `ExtractedQuestion`) on the `QuestionGeneratorPort` contract but a
 * 0-based INDEX (or still `null`) in the response/PATCH edit contract — this service
 * converts the generator's LETTER output to an INDEX (`correctAnswerLetterToIndex`,
 * mirroring `ReviseQuestionService`/`GenerateQuestionsService`, with its null-safe
 * overload passing a `null` key straight through) BEFORE returning it.
 *
 * Unlike `generate()`/`reviseQuestion()`, this endpoint does NOT run the bank's
 * `validateStructuredContent` (which requires >=2 alternatives and a non-null
 * `correctAnswer` — the rule a SAVEABLE question must satisfy). A photo may
 * legitimately show only a stem, or alternatives with no visible key, and
 * `extractFromImage` never invents either to force that shape (see
 * `ExtractedQuestion`'s docstring) — this response is a DRAFT the teacher may
 * still need to complete by hand before the bank creation endpoints (which DO
 * run `validateStructuredContent`) will accept it. Only `bodyTypst` is checked
 * here, since a blank transcription is never useful to return at all.
 *
 * The response also carries finished `data:` URL crops for the question's
 * figures — but their boxes never come from the model: `QuestionGeneratorPort`
 * no longer asks it for crop coordinates at all. Instead the crop geometry
 * comes from the page's own OCR: `TextRegionDetectorPort` locates every word,
 * `findFigureRegions` keeps whatever ink is left once the text is erased,
 * and `attributeFigureToAlternative` decides which alternative a figure
 * belongs to from the `A)`–`E)` marker bands (see `buildCrops`). Nothing
 * about a crop is persisted here; a discarded draft leaves no orphan asset
 * behind.
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
    @Inject(TEXT_REGION_DETECTOR_PORT) private readonly detector: TextRegionDetectorPort,
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

    // The generator returns a LETTER (or null); convert to the 0-based INDEX
    // response/PATCH convention expects BEFORE returning — the null-safe
    // overload passes a `null` key straight through unconverted.
    const extractedWithIndex: ExtractedQuestion = {
      ...extracted,
      correctAnswer: correctAnswerLetterToIndex(extracted.correctAnswer),
    };

    // Only bodyTypst is checked here — see this class's docstring for why
    // `validateStructuredContent`'s alternatives/correctAnswer rules
    // (>=2 alternatives, non-null key) do NOT apply to an extraction draft.
    if (!extractedWithIndex.bodyTypst || extractedWithIndex.bodyTypst.trim().length === 0) {
      throw new UnprocessableEntityException({
        message: "AI produced invalid content",
        errors: ["bodyTypst is required"],
      });
    }

    const crops = await this.buildCrops(file.buffer, mimeType);

    const hasCrops = !!crops.figureCrop || (crops.alternativeCrops?.length ?? 0) > 0;
    if (!hasCrops) {
      return { ...extractedWithIndex, ...crops };
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
      // Downscaled before caching (Important Finding 5): the extraction
      // cache lives in the same Redis keyspace BullMQ's queues use, and an
      // uncapped 5 MB photo per extraction is a real memory risk to that
      // keyspace. `downscale` is resolution-safe for re-cropping — normalized
      // boxes are 0..1 fractions of whatever width/height the cached image
      // reports, not absolute pixels, so a uniform downscale never moves
      // what a box points at.
      const cached = await this.cropper.downscale(file.buffer, mimeType, CACHE_MAX_WIDTH_PX);
      await this.cache.put(extractionId, {
        userId: user.sub,
        image: cached.image,
        mimeType: cached.mimeType,
      });
      return { ...extractedWithIndex, ...crops, extractionId };
    } catch (error) {
      this.logger.warn(
        `Extraction cache write failed, returning crops without a re-crop handle: ${(error as Error).message}`,
      );
      return { ...extractedWithIndex, ...crops };
    }
  }

  /**
   * Turns the photo into finished crops, with no help from the model: the OCR
   * marks the text, `findFigureRegions` keeps the ink that is left, and the
   * page's own alternative markers say which drawing belongs to which option.
   *
   * Deliberately total, exactly as before: any failure here — a missing
   * tesseract, an image sharp cannot decode, a downscale or a crop that
   * throws — is logged and swallowed, and the caller still gets the
   * transcription. The text is the valuable half of this endpoint.
   */
  private async buildCrops(
    image: Buffer,
    mimeType: string,
  ): Promise<{ figureCrop?: AiQuestionCrop; alternativeCrops?: readonly AiAlternativeCrop[] }> {
    try {
      // Detection runs on a BOUNDED raster, never on the raw upload. See
      // `ANALYSIS_MAX_WIDTH_PX`: `raster()` decodes at full resolution and
      // `findFigureRegions` then allocates two more planes of that size plus
      // a per-pixel flood-fill stack, which on a 24 MP photo is tens of MB
      // per concurrent request. The crops below are still cut from the
      // ORIGINAL `image` — a normalized box is a 0..1 fraction, so it points
      // at the same thing at either scale and `crop` re-derives full-
      // resolution pixels from it.
      const analysed = await this.cropper.downscale(image, mimeType, ANALYSIS_MAX_WIDTH_PX);
      const [raster, words] = await Promise.all([
        this.cropper.raster(analysed.image, analysed.mimeType),
        this.detector.detect(analysed.image, analysed.mimeType),
      ]);

      const figures = findFigureRegions(raster, words);
      if (figures.length === 0) {
        return {};
      }

      const attributed = attributeFigureToAlternative(figures, words);

      const cropAt = async (box: NormalizedBox): Promise<AiQuestionCrop> => {
        const bytes = await this.cropper.crop(image, mimeType, box, CROP_MAX_WIDTH_PX);
        return { dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, box };
      };

      const figureCrop = attributed.complement ? await cropAt(attributed.complement) : undefined;

      const alternativeCrops: AiAlternativeCrop[] = [];
      for (const entry of attributed.byAlternative) {
        alternativeCrops.push({ alternativeIndex: entry.alternativeIndex, ...(await cropAt(entry.box)) });
      }

      return {
        ...(figureCrop ? { figureCrop } : {}),
        ...(alternativeCrops.length > 0 ? { alternativeCrops } : {}),
      };
    } catch (error) {
      this.logger.warn(
        `Figure detection failed, returning the transcription without figures: ${(error as Error).message}`,
      );
      return {};
    }
  }
}
