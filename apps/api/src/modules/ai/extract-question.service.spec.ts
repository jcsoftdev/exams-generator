import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { GeneratedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import { ImageCropperPort } from "./domain/ports/image-cropper.port";
import { ExtractionCachePort } from "./domain/ports/extraction-cache.port";
import { TextRegionDetectorPort } from "./domain/ports/text-region-detector.port";
import { ExtractQuestionService } from "./extract-question.service";
import { fakePng } from "../../test-support/image-fixtures";

const USER = { sub: "user-1", tenantId: "tenant-1" } as unknown as AuthTokenPayload;

const EXTRACTED_QUESTION: GeneratedQuestion = {
  bodyTypst: "¿Cuánto es $2 + 2$?",
  alternatives: ["3", "4", "5", "6", "7"],
  // LETTER (QuestionGeneratorPort contract) — "b" is index 1.
  correctAnswer: "b",
};

/** A raster with a black block in its lower half and nothing else. */
const RASTER_WITH_FIGURE = {
  gray: (() => {
    const gray = new Uint8Array(20 * 20).fill(255);
    for (let y = 10; y < 18; y++) {
      gray.fill(0, y * 20 + 4, y * 20 + 16);
    }
    return gray;
  })(),
  width: 20,
  height: 20,
};

/**
 * A raster with two black blocks, one per alternative band, well clear (by
 * column) of every marker so erasing the markers never touches the ink.
 * Both blocks sit at columns 4-15; "b"'s is rows 8-9, "c"'s is rows 14-15 —
 * i.e. normalized boxes { x: 0.2, y: 0.4, w: 0.6, h: 0.1 } and
 * { x: 0.2, y: 0.7, w: 0.6, h: 0.1 } respectively.
 */
const RASTER_WITH_TWO_ALTERNATIVE_FIGURES = {
  gray: (() => {
    const width = 20;
    const height = 20;
    const gray = new Uint8Array(width * height).fill(255);
    const paintRow = (y: number) => gray.fill(0, y * width + 4, y * width + 16);
    paintRow(8);
    paintRow(9); // alternative "b"'s figure
    paintRow(14);
    paintRow(15); // alternative "c"'s figure
    return gray;
  })(),
  width: 20,
  height: 20,
};

/** `a)` right at the top (so no figure is ever above it), `b)` above the first block's band, `c)` above the second's. */
const ALTERNATIVE_MARKERS = [
  { text: "a)", box: { x: 0, y: 0, w: 0.05, h: 0.03 }, confidence: 90 },
  { text: "b)", box: { x: 0, y: 0.25, w: 0.05, h: 0.03 }, confidence: 90 },
  { text: "c)", box: { x: 0, y: 0.6, w: 0.05, h: 0.03 }, confidence: 90 },
];

function buildDeps() {
  const generator: jest.Mocked<QuestionGeneratorPort> = {
    generate: jest.fn(),
    reviseQuestion: jest.fn(),
    extractFromImage: jest.fn().mockResolvedValue(EXTRACTED_QUESTION),
  };

  const cropper: jest.Mocked<ImageCropperPort> = {
    // 4x1 all-white raster: no contrast anywhere, so by default there is no
    // ink for `findFigureRegions` to find and these tests assert the
    // service's plumbing, not the figure-detection algorithm (covered in its
    // own spec).
    raster: jest.fn().mockResolvedValue({ gray: new Uint8Array(4).fill(255), width: 4, height: 1 }),
    crop: jest.fn().mockResolvedValue(Buffer.from("cropped-png-bytes")),
    // Identity by default (mirrors a real image already under the cache's
    // width cap) — tests that care about actual downscaling override this.
    downscale: jest
      .fn()
      .mockImplementation((image: Buffer, mimeType: string) => Promise.resolve({ image, mimeType })),
  };

  const cache: jest.Mocked<ExtractionCachePort> = {
    put: jest.fn(),
    get: jest.fn(),
  };

  const detector: jest.Mocked<TextRegionDetectorPort> = {
    detect: jest.fn().mockResolvedValue([]),
  };

  const service = new ExtractQuestionService(generator, cropper, cache, detector);
  return { service, generator, cropper, cache, detector };
}

describe("ExtractQuestionService.extract", () => {
  it("returns the generator's validated, UNSAVED output with correctAnswer converted to an INDEX", async () => {
    const { service, generator } = buildDeps();
    const file = { buffer: fakePng(), mimetype: "image/png" };

    const result = await service.extract(USER, file);

    expect(generator.extractFromImage).toHaveBeenCalledWith({
      image: file.buffer,
      mimeType: file.mimetype,
    });
    // Generator returns LETTER "b"; bank storage/response convention expects INDEX "1".
    expect(result).toEqual({ ...EXTRACTED_QUESTION, correctAnswer: "1" });
  });

  it("converts the generator's LETTER correctAnswer to a 0-based INDEX before validating (Task 4 review fix, mirrored)", async () => {
    const { service, generator } = buildDeps();
    generator.extractFromImage.mockResolvedValue({
      bodyTypst: "¿Cuánto es $1+1$?",
      alternatives: ["1", "2", "3", "4", "5"],
      correctAnswer: "b",
    });
    const file = { buffer: fakePng(), mimetype: "image/png" };

    const result = await service.extract(USER, file);

    expect(result.correctAnswer).toBe("1");
  });

  it("throws UnprocessableEntityException when the AI output fails validateStructuredContent", async () => {
    const { service, generator } = buildDeps();
    generator.extractFromImage.mockResolvedValue({
      bodyTypst: "¿Cuánto es $2 + 2$?",
      // Only 1 alternative — fails validateStructuredContent's MIN_ALTERNATIVES=2 rule.
      alternatives: ["4"] as unknown as GeneratedQuestion["alternatives"],
      correctAnswer: "a",
    });
    const file = { buffer: fakePng(), mimetype: "image/png" };

    await expect(service.extract(USER, file)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("rejects a non-image buffer with 400 WITHOUT spending a vision call", async () => {
    const { service, generator } = buildDeps();
    const file = { buffer: Buffer.from("<svg><script/></svg>"), mimetype: "image/png" };

    await expect(service.extract(USER, file)).rejects.toBeInstanceOf(BadRequestException);
    expect(generator.extractFromImage).not.toHaveBeenCalled();
  });
});

describe("ExtractQuestionService.extract — crops", () => {
  it("does not call the cropper when there is no ink for the OCR to leave behind", async () => {
    const { service, cropper } = buildDeps();

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(cropper.crop).not.toHaveBeenCalled();
    expect(result.figureCrop).toBeUndefined();
    expect(result.alternativeCrops).toBeUndefined();
  });

  it("still returns the transcribed question when cropping blows up", async () => {
    const { service, cropper } = buildDeps();
    cropper.raster.mockRejectedValue(new Error("unsupported image format"));

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(result.figureCrop).toBeUndefined();
    expect(result.bodyTypst).toBe(EXTRACTED_QUESTION.bodyTypst);
    expect(result.correctAnswer).toBe("1");
  });

  it("returns one crop per figure the page's own alternative markers attribute to it", async () => {
    const { service, cropper, detector } = buildDeps();
    cropper.raster.mockResolvedValue(RASTER_WITH_TWO_ALTERNATIVE_FIGURES);
    detector.detect.mockResolvedValue(ALTERNATIVE_MARKERS);

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(result.figureCrop).toBeUndefined();
    expect(result.alternativeCrops?.map((crop) => crop.alternativeIndex)).toEqual([1, 2]);
    // "b"'s block: columns 4-15, rows 8-9 of the 20x20 fixture, normalized.
    expect(result.alternativeCrops![0]!.box).toEqual({ x: 0.2, y: 0.4, w: 0.6, h: 0.1 });
    expect(cropper.crop).toHaveBeenCalledTimes(2);
  });

  it("caches the photo and returns an extractionId only when there is something to re-crop", async () => {
    const { service, cropper, cache } = buildDeps();
    const file = { buffer: fakePng(), mimetype: "image/png" };

    cropper.raster.mockResolvedValue(RASTER_WITH_FIGURE);
    const withCrop = await service.extract(USER, file);
    expect(withCrop.extractionId).toEqual(expect.any(String));
    expect(cache.put).toHaveBeenCalledWith(withCrop.extractionId, {
      userId: USER.sub,
      image: file.buffer,
      mimeType: "image/png",
    });

    cropper.raster.mockResolvedValue({ gray: new Uint8Array(4).fill(255), width: 4, height: 1 });
    cache.put.mockClear();
    const withoutCrop = await service.extract(USER, file);
    expect(withoutCrop.extractionId).toBeUndefined();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("caches the DOWNSCALED photo, not the original bytes (Important Finding 5)", async () => {
    const { service, cache, cropper } = buildDeps();
    cropper.raster.mockResolvedValue(RASTER_WITH_FIGURE);
    const file = { buffer: fakePng(), mimetype: "image/png" };
    const downscaledBytes = Buffer.from("downscaled-png-bytes");
    cropper.downscale.mockResolvedValue({ image: downscaledBytes, mimeType: "image/png" });

    const result = await service.extract(USER, file);

    expect(cropper.downscale).toHaveBeenCalledWith(file.buffer, "image/png", expect.any(Number));
    expect(cache.put).toHaveBeenCalledWith(result.extractionId, {
      userId: USER.sub,
      image: downscaledBytes,
      mimeType: "image/png",
    });
  });

  it("still returns the transcription and its crops when the cache write fails", async () => {
    const { service, cache, cropper } = buildDeps();
    cropper.raster.mockResolvedValue(RASTER_WITH_FIGURE);
    cache.put.mockRejectedValue(new Error("ECONNREFUSED"));
    const file = { buffer: fakePng(), mimetype: "image/png" };

    const result = await service.extract(USER, file);

    expect(result.bodyTypst).toBe(EXTRACTED_QUESTION.bodyTypst);
    expect(result.figureCrop).toBeDefined();
    expect(result.extractionId).toBeUndefined();
  });
});

describe("ExtractQuestionService.extract — figures from OCR", () => {
  it("crops the ink the OCR did not mark as text", async () => {
    const { service, cropper, detector } = buildDeps();
    cropper.raster.mockResolvedValue(RASTER_WITH_FIGURE);
    detector.detect.mockResolvedValue([]);

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    // The 20x20 raster's black block is columns 4-15, rows 10-17 —
    // normalized that is exactly this box.
    expect(result.figureCrop!.box).toEqual({ x: 0.2, y: 0.5, w: 0.6, h: 0.4 });
    expect(result.figureCrop!.dataUrl).toBe(
      `data:image/png;base64,${Buffer.from("cropped-png-bytes").toString("base64")}`,
    );
    expect(cropper.crop).toHaveBeenCalledTimes(1);
  });

  it("MUST: finds nothing when the OCR covered every bit of ink", async () => {
    const { service, cropper, detector } = buildDeps();
    cropper.raster.mockResolvedValue(RASTER_WITH_FIGURE);
    // One word box over the whole black block.
    detector.detect.mockResolvedValue([
      { text: "texto", box: { x: 0.2, y: 0.5, w: 0.6, h: 0.4 }, confidence: 90 },
    ]);

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(result.figureCrop).toBeUndefined();
    expect(cropper.crop).not.toHaveBeenCalled();
  });

  it("MUST: still returns the transcription when the OCR blows up", async () => {
    const { service, detector } = buildDeps();
    detector.detect.mockRejectedValue(new Error("tesseract not found"));

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(result.bodyTypst).toBe(EXTRACTED_QUESTION.bodyTypst);
    expect(result.figureCrop).toBeUndefined();
  });

  it("no longer reads figureBox from the model, even when it sends one", async () => {
    const { service, generator, cropper, detector } = buildDeps();
    // A model that still reports a box must not influence anything.
    generator.extractFromImage.mockResolvedValue({
      ...EXTRACTED_QUESTION,
      figureBox: { x: 0, y: 0, w: 1, h: 1 },
    } as never);
    cropper.raster.mockResolvedValue({ gray: new Uint8Array(400).fill(255), width: 20, height: 20 });
    detector.detect.mockResolvedValue([]);

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    // Blank raster -> no ink -> no figure, regardless of what the model claimed.
    expect(result.figureCrop).toBeUndefined();
    expect(cropper.crop).not.toHaveBeenCalled();
  });
});
