import { BadRequestException, GoneException, Inject, Injectable } from "@nestjs/common";
import { AiQuestionCrop } from "@exams-generator/shared";
import { AuthTokenPayload } from "../auth/token.service";
import { NormalizedBox, isValidNormalizedBox } from "./domain/normalized-box";
import { ExtractionCachePort } from "./domain/ports/extraction-cache.port";
import { ImageCropperPort } from "./domain/ports/image-cropper.port";
import { CROP_MAX_WIDTH_PX } from "./domain/crop.constants";
import { EXTRACTION_CACHE_PORT, IMAGE_CROPPER_PORT } from "./ai.constants";

/**
 * `POST /ai/questions/extract/:extractionId/crop` — re-cuts one crop from the
 * photo the extraction already cached, using a box the teacher drew by hand.
 *
 * The box is used VERBATIM: `snapBoxToInk` exists to correct the vision
 * model's loose aim, and applying it to a hand-drawn rectangle would move the
 * edges the human just placed on purpose.
 */
@Injectable()
export class RecropQuestionService {
  constructor(
    @Inject(EXTRACTION_CACHE_PORT) private readonly cache: ExtractionCachePort,
    @Inject(IMAGE_CROPPER_PORT) private readonly cropper: ImageCropperPort,
  ) {}

  async recrop(user: AuthTokenPayload, extractionId: string, box: NormalizedBox): Promise<AiQuestionCrop> {
    if (!isValidNormalizedBox(box)) {
      throw new BadRequestException("box must be inside the 0..1 canvas and have a positive size");
    }

    const cached = await this.cache.get(extractionId);
    // Same status AND message for "unknown/expired" and "exists but is not
    // yours" — deliberately not a distinct code (404, 403, ...) for the
    // second case: a distinct code IS the existence oracle a different
    // status would leak to whoever guessed this extractionId. The identical
    // "expired" wording reveals nothing to them either.
    const EXPIRED_MESSAGE = "This crop session expired — extract the question again";
    if (!cached || cached.userId !== user.sub) {
      throw new GoneException(EXPIRED_MESSAGE);
    }

    const bytes = await this.cropper.crop(cached.image, cached.mimeType, box, CROP_MAX_WIDTH_PX);
    // Rebuilt field-by-field rather than echoing `box` verbatim:
    // `isValidNormalizedBox` is a type guard, not a stripper, so any extra
    // properties on the client's JSON body would otherwise round-trip into a
    // value typed `AiQuestionCrop`.
    return {
      dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
      box: { x: box.x, y: box.y, w: box.w, h: box.h },
    };
  }
}
