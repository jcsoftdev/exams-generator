import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { GeneratedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import { ImageCropperPort } from "./domain/ports/image-cropper.port";
import { ExtractionCachePort } from "./domain/ports/extraction-cache.port";
import { ExtractQuestionService } from "./extract-question.service";
import { fakePng } from "../../test-support/image-fixtures";

const USER = { sub: "user-1", tenantId: "tenant-1" } as unknown as AuthTokenPayload;

const EXTRACTED_QUESTION: GeneratedQuestion = {
  bodyTypst: "¿Cuánto es $2 + 2$?",
  alternatives: ["3", "4", "5", "6", "7"],
  // LETTER (QuestionGeneratorPort contract) — "b" is index 1.
  correctAnswer: "b",
};

function buildDeps() {
  const generator: jest.Mocked<QuestionGeneratorPort> = {
    generate: jest.fn(),
    reviseQuestion: jest.fn(),
    extractFromImage: jest.fn().mockResolvedValue(EXTRACTED_QUESTION),
  };

  const cropper: jest.Mocked<ImageCropperPort> = {
    // 4x1 all-white raster: `snapBoxToInk` finds no contrast and leaves every
    // box exactly as the model reported it, so these tests assert the
    // service's plumbing, not the snapping algorithm (covered in its own spec).
    raster: jest.fn().mockResolvedValue({ gray: new Uint8Array(4).fill(255), width: 4, height: 1 }),
    crop: jest.fn().mockResolvedValue(Buffer.from("cropped-png-bytes")),
  };

  const cache: jest.Mocked<ExtractionCachePort> = {
    put: jest.fn(),
    get: jest.fn(),
  };

  const service = new ExtractQuestionService(generator, cropper, cache);
  return { service, generator, cropper, cache };
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
  const FIGURE_BOX = { x: 0.1, y: 0.2, w: 0.5, h: 0.3 };
  const ALT_BOX = { x: 0.1, y: 0.7, w: 0.2, h: 0.1 };

  it("does not touch the cropper when the model reported no boxes", async () => {
    const { service, cropper } = buildDeps();

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(cropper.raster).not.toHaveBeenCalled();
    expect(cropper.crop).not.toHaveBeenCalled();
    expect(result.figureCrop).toBeUndefined();
    expect(result.alternativeCrops).toBeUndefined();
  });

  it("crops the figure box and returns it as a data URL", async () => {
    const { service, generator, cropper } = buildDeps();
    generator.extractFromImage.mockResolvedValue({ ...EXTRACTED_QUESTION, figureBox: FIGURE_BOX });

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(cropper.crop).toHaveBeenCalledTimes(1);
    expect(result.figureCrop!.box).toEqual(FIGURE_BOX);
    expect(result.figureCrop!.dataUrl).toBe(
      `data:image/png;base64,${Buffer.from("cropped-png-bytes").toString("base64")}`,
    );
  });

  it("returns one crop per graphic alternative, carrying its index, and skips the text ones", async () => {
    const { service, generator } = buildDeps();
    generator.extractFromImage.mockResolvedValue({
      ...EXTRACTED_QUESTION,
      alternativeBoxes: [ALT_BOX, null, ALT_BOX, null, null],
    });

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(result.alternativeCrops!.map((crop) => crop.alternativeIndex)).toEqual([0, 2]);
    expect(result.alternativeCrops![0]!.box).toEqual(ALT_BOX);
  });

  it("still returns the transcribed question when cropping blows up", async () => {
    const { service, generator, cropper } = buildDeps();
    generator.extractFromImage.mockResolvedValue({ ...EXTRACTED_QUESTION, figureBox: FIGURE_BOX });
    cropper.raster.mockRejectedValue(new Error("unsupported image format"));

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(result.figureCrop).toBeUndefined();
    expect(result.bodyTypst).toBe(EXTRACTED_QUESTION.bodyTypst);
    expect(result.correctAnswer).toBe("1");
  });

  it("never leaks the raw boxes from the generator contract into the HTTP response", async () => {
    const { service, generator } = buildDeps();
    generator.extractFromImage.mockResolvedValue({ ...EXTRACTED_QUESTION, figureBox: FIGURE_BOX });

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(result).not.toHaveProperty("figureBox");
    expect(result).not.toHaveProperty("alternativeBoxes");
    // Companion assertion: without this, an empty `{}` response would also
    // satisfy the two checks above — proving `figureCrop` really is present
    // rules that out and confirms the boxes were converted, not just dropped.
    expect(result.figureCrop).toBeDefined();
  });

  it("caches the photo and returns an extractionId only when there is something to re-crop", async () => {
    const { service, generator, cache } = buildDeps();
    generator.extractFromImage.mockResolvedValue({ ...EXTRACTED_QUESTION, figureBox: FIGURE_BOX });
    const file = { buffer: fakePng(), mimetype: "image/png" };

    const withCrop = await service.extract(USER, file);
    expect(withCrop.extractionId).toEqual(expect.any(String));
    expect(cache.put).toHaveBeenCalledWith(withCrop.extractionId, {
      userId: USER.sub,
      image: file.buffer,
      mimeType: "image/png",
    });

    generator.extractFromImage.mockResolvedValue(EXTRACTED_QUESTION);
    cache.put.mockClear();
    const withoutCrop = await service.extract(USER, file);
    expect(withoutCrop.extractionId).toBeUndefined();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("still returns the transcription and its crops when the cache write fails", async () => {
    const { service, generator, cache } = buildDeps();
    generator.extractFromImage.mockResolvedValue({ ...EXTRACTED_QUESTION, figureBox: FIGURE_BOX });
    cache.put.mockRejectedValue(new Error("ECONNREFUSED"));
    const file = { buffer: fakePng(), mimetype: "image/png" };

    const result = await service.extract(USER, file);

    expect(result.bodyTypst).toBe(EXTRACTED_QUESTION.bodyTypst);
    expect(result.figureCrop).toBeDefined();
    expect(result.extractionId).toBeUndefined();
  });
});
