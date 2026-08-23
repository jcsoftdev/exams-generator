import { NotFoundException } from "@nestjs/common";
import { Role } from "@exams-generator/shared";
import { AuthTokenPayload } from "../auth/token.service";
import { StorageObjectNotFoundError } from "../exams/domain/ports/storage.port";
import { AssetRecord, AssetsRepository } from "./assets.repository";
import { AssetsService } from "./assets.service";

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

  const service = new AssetsService(repository, storage);
  return { service, repository, storage };
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
