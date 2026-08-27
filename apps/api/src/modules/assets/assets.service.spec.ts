import { NotFoundException } from "@nestjs/common";
import { Role } from "@exams-generator/shared";
import { AuthTokenPayload } from "../auth/token.service";
import { StorageObjectNotFoundError } from "../exams/domain/ports/storage.port";
import { AssetRecord, AssetsRepository } from "./assets.repository";
import { AssetsService } from "./assets.service";
import { thumbnailStorageKey } from "./asset-thumbnail";
import { ThumbnailerPort } from "./thumbnailer.port";

const TEACHER_USER: AuthTokenPayload = { sub: "teacher-1", tenantId: "tenant-1", role: Role.Teacher };

const CENTRAL_ASSET: AssetRecord = {
  id: "asset-1",
  tenantId: null,
  storageKey: "bank/questions/asset-1",
  mime: "image/png",
};

function buildDeps() {
  const repository = {
    findAssetById: jest.fn().mockResolvedValue(undefined as AssetRecord | undefined),
  } as unknown as jest.Mocked<AssetsRepository>;

  const storage = {
    put: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    ping: jest.fn(),
  };

  const thumbnailer = { toWebp: jest.fn() } as unknown as jest.Mocked<ThumbnailerPort>;

  const service = new AssetsService(repository, storage, thumbnailer);
  return { service, repository, storage, thumbnailer };
}

describe("AssetsService.getAssetContent", () => {
  it("fetches the asset row (tenant-scoped), then streams the bytes via StoragePort.get(storageKey)", async () => {
    const { service, repository, storage } = buildDeps();
    repository.findAssetById.mockResolvedValue(CENTRAL_ASSET);
    storage.get.mockResolvedValue(Buffer.from("fake-png-bytes"));

    const result = await service.getAssetContent(TEACHER_USER, CENTRAL_ASSET.id);

    expect(repository.findAssetById).toHaveBeenCalledWith(CENTRAL_ASSET.id, TEACHER_USER.tenantId);
    expect(storage.get).toHaveBeenCalledWith(CENTRAL_ASSET.storageKey);
    expect(result).toEqual({
      buffer: Buffer.from("fake-png-bytes"),
      mime: "image/png",
      // Carried out of the service so the controller can name a PDF download
      // after it — see `pdfDownloadFilename`.
      storageKey: CENTRAL_ASSET.storageKey,
    });
  });

  it("throws NotFoundException when the repository finds no visible asset (missing or cross-tenant)", async () => {
    const { service, repository, storage } = buildDeps();
    repository.findAssetById.mockResolvedValue(undefined);

    await expect(service.getAssetContent(TEACHER_USER, "missing-id")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when the DB row exists but the object is missing from storage", async () => {
    const { service, repository, storage } = buildDeps();
    repository.findAssetById.mockResolvedValue(CENTRAL_ASSET);
    storage.get.mockRejectedValue(new StorageObjectNotFoundError(CENTRAL_ASSET.storageKey));

    await expect(service.getAssetContent(TEACHER_USER, CENTRAL_ASSET.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("rethrows unexpected storage errors as-is", async () => {
    const { service, repository, storage } = buildDeps();
    repository.findAssetById.mockResolvedValue(CENTRAL_ASSET);
    const boom = new Error("minio is down");
    storage.get.mockRejectedValue(boom);

    await expect(service.getAssetContent(TEACHER_USER, CENTRAL_ASSET.id)).rejects.toBe(boom);
  });
});


describe("AssetsService.getThumbnailContent", () => {
  const THUMB_KEY = thumbnailStorageKey(CENTRAL_ASSET.storageKey);

  it("serves the stored thumbnail with ONE storage read when it already exists", async () => {
    // The warm path, and the one that has to stay cheap: it must not read the
    // original just to discover a thumbnail is already there.
    const { service, repository, storage, thumbnailer } = buildDeps();
    repository.findAssetById.mockResolvedValue(CENTRAL_ASSET);
    storage.get.mockResolvedValue(Buffer.from("stored-webp"));

    const result = await service.getThumbnailContent(TEACHER_USER, CENTRAL_ASSET.id);

    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(storage.get).toHaveBeenCalledWith(THUMB_KEY);
    expect(thumbnailer.toWebp).not.toHaveBeenCalled();
    expect(result).toEqual({ buffer: Buffer.from("stored-webp"), mime: "image/webp", storageKey: THUMB_KEY });
  });

  it("generates, PERSISTS and returns the thumbnail on a miss — so it heals assets predating the feature", async () => {
    const { service, repository, storage, thumbnailer } = buildDeps();
    repository.findAssetById.mockResolvedValue(CENTRAL_ASSET);
    storage.get
      .mockRejectedValueOnce(new StorageObjectNotFoundError(THUMB_KEY))
      .mockResolvedValueOnce(Buffer.from("original-png"));
    thumbnailer.toWebp.mockResolvedValue(Buffer.from("fresh-webp"));

    const result = await service.getThumbnailContent(TEACHER_USER, CENTRAL_ASSET.id);

    expect(storage.get).toHaveBeenNthCalledWith(1, THUMB_KEY);
    expect(storage.get).toHaveBeenNthCalledWith(2, CENTRAL_ASSET.storageKey);
    expect(thumbnailer.toWebp).toHaveBeenCalledWith(Buffer.from("original-png"), 320);
    // Persisted, not just returned — otherwise every request pays the resize.
    expect(storage.put).toHaveBeenCalledWith(THUMB_KEY, Buffer.from("fresh-webp"), "image/webp");
    expect(result.mime).toBe("image/webp");
    expect(result.buffer).toEqual(Buffer.from("fresh-webp"));
  });

  it("falls back to the ORIGINAL when the image cannot be decoded", async () => {
    // A corrupt or exotic file must leave the grid working with a heavier
    // image, not punch a hole in it. Nothing is persisted on this path.
    const { service, repository, storage, thumbnailer } = buildDeps();
    repository.findAssetById.mockResolvedValue(CENTRAL_ASSET);
    storage.get
      .mockRejectedValueOnce(new StorageObjectNotFoundError(THUMB_KEY))
      .mockResolvedValueOnce(Buffer.from("not-really-an-image"));
    thumbnailer.toWebp.mockRejectedValue(new Error("Input buffer contains unsupported image format"));

    const result = await service.getThumbnailContent(TEACHER_USER, CENTRAL_ASSET.id);

    expect(result).toEqual({
      buffer: Buffer.from("not-really-an-image"),
      mime: "image/png",
      storageKey: CENTRAL_ASSET.storageKey,
    });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("404s for a non-image asset — a PDF has no thumbnail", async () => {
    const { service, repository, storage } = buildDeps();
    repository.findAssetById.mockResolvedValue({ ...CENTRAL_ASSET, mime: "application/pdf" });

    await expect(service.getThumbnailContent(TEACHER_USER, CENTRAL_ASSET.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("applies the SAME tenant visibility as getAssetContent", async () => {
    // The thumbnail route must not become a way around the boundary the
    // original respects.
    const { service, repository } = buildDeps();
    repository.findAssetById.mockResolvedValue(undefined);

    await expect(service.getThumbnailContent(TEACHER_USER, "someone-elses")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.findAssetById).toHaveBeenCalledWith("someone-elses", TEACHER_USER.tenantId);
  });

  it("404s when the ORIGINAL object is gone, same as getAssetContent", async () => {
    const { service, repository, storage } = buildDeps();
    repository.findAssetById.mockResolvedValue(CENTRAL_ASSET);
    storage.get
      .mockRejectedValueOnce(new StorageObjectNotFoundError(THUMB_KEY))
      .mockRejectedValueOnce(new StorageObjectNotFoundError(CENTRAL_ASSET.storageKey));

    await expect(service.getThumbnailContent(TEACHER_USER, CENTRAL_ASSET.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
