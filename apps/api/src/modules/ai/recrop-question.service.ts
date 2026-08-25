import {
  BadRequestException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
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

  async recrop(
    user: AuthTokenPayload,
    extractionId: string,
    box: NormalizedBox,
  ): Promise<AiQuestionCrop> {
    if (!isValidNormalizedBox(box)) {
      throw new BadRequestException("box must be inside the 0..1 canvas and have a positive size");
    }

    const cached = await this.cache.get(extractionId);
    if (!cached) {
      throw new GoneException("This crop session expired — extract the question again");
    }
    // 404 rather than 403: a 403 would confirm the id exists to whoever guessed it.
    if (cached.userId !== user.sub) {
      throw new NotFoundException(`Extraction not found: ${extractionId}`);
    }

    const bytes = await this.cropper.crop(cached.image, cached.mimeType, box, CROP_MAX_WIDTH_PX);
    return { dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, box };
  }
}
