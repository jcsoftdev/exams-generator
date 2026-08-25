import { BadRequestException, GoneException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { ImageCropperPort } from "./domain/ports/image-cropper.port";
import { ExtractionCachePort } from "./domain/ports/extraction-cache.port";
import { RecropQuestionService } from "./recrop-question.service";
import { fakePng } from "../../test-support/image-fixtures";

const USER = { sub: "user-1", tenantId: "tenant-1" } as unknown as AuthTokenPayload;
const OTHER_USER = { sub: "user-2", tenantId: "tenant-1" } as unknown as AuthTokenPayload;
const BOX = { x: 0.1, y: 0.2, w: 0.4, h: 0.3 };

function buildDeps() {
  const cache: jest.Mocked<ExtractionCachePort> = {
    put: jest.fn(),
    get: jest.fn().mockResolvedValue({ userId: "user-1", image: fakePng(), mimeType: "image/png" }),
  };
  const cropper: jest.Mocked<ImageCropperPort> = {
    raster: jest.fn(),
    crop: jest.fn().mockResolvedValue(Buffer.from("recropped-bytes")),
  };
  return { service: new RecropQuestionService(cache, cropper), cache, cropper };
}

describe("RecropQuestionService.recrop", () => {
  it("crops the exact box the human drew, without snapping it to ink", async () => {
    const { service, cropper } = buildDeps();

    const result = await service.recrop(USER, "extraction-1", BOX);

    // Third argument is the box: byte-for-byte what was asked for.
    expect(cropper.crop).toHaveBeenCalledWith(expect.any(Buffer), "image/png", BOX, 1200);
    expect(cropper.raster).not.toHaveBeenCalled();
    expect(result.box).toEqual(BOX);
    expect(result.dataUrl).toBe(
      `data:image/png;base64,${Buffer.from("recropped-bytes").toString("base64")}`,
    );
  });

  it("throws Gone when the cached photo has expired", async () => {
    const { service, cache } = buildDeps();
    cache.get.mockResolvedValue(null);

    await expect(service.recrop(USER, "extraction-1", BOX)).rejects.toBeInstanceOf(GoneException);
  });

  it("returns the same Gone as an unknown id for another account's extraction, so the response cannot confirm the id exists", async () => {
    const { service } = buildDeps();

    await expect(service.recrop(OTHER_USER, "extraction-1", BOX)).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it("rejects a box outside the 0..1 canvas", async () => {
    const { service } = buildDeps();

    await expect(
      service.recrop(USER, "extraction-1", { x: 0.9, y: 0.2, w: 0.4, h: 0.3 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
