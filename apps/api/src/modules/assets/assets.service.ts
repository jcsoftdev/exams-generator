import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { StorageObjectNotFoundError, StoragePort } from "../exams/domain/ports/storage.port";
import { STORAGE_PORT } from "../bank/bank.constants";
import { AssetsRepository } from "./assets.repository";

export interface AssetContent {
  readonly buffer: Buffer;
  readonly mime: string;
  /**
   * Carried through so the controller can derive a download filename —
   * `assets` has no display-name column, and the key's basename is the only
   * name a stored object has (`pdfDownloadFilename`).
   */
  readonly storageKey: string;
}

/**
 * Serves the raw bytes behind an `assets` row (design doc: `GET
 * /assets/:id`, the piece `bank.service.ts`'s `imageAssetId` needs to
 * actually be renderable on the web). Tenant-scoped with the SAME
 * visibility rule the bank module uses everywhere else — a question's
 * `imageAssetId` is only useful to callers who could already see the
 * question itself.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly repository: AssetsRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async getAssetContent(user: AuthTokenPayload, id: string): Promise<AssetContent> {
    const asset = await this.repository.findAssetById(id, user.tenantId);
    if (!asset) {
      throw new NotFoundException(`Asset not found: ${id}`);
    }

    try {
      const buffer = await this.storage.get(asset.storageKey);
      return { buffer, mime: asset.mime, storageKey: asset.storageKey };
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        // DB row survives but the underlying object was deleted/missing —
        // indistinguishable from "asset not found" to the caller.
        throw new NotFoundException(`Asset not found: ${id}`);
      }
      throw error;
    }
  }
}
