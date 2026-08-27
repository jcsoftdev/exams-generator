import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { StorageObjectNotFoundError, StoragePort } from "../exams/domain/ports/storage.port";
import { STORAGE_PORT } from "../bank/bank.constants";
import { AssetsRepository } from "./assets.repository";
import { THUMBNAIL_MIME, THUMBNAIL_WIDTH_PX, thumbnailStorageKey } from "./asset-thumbnail";
import { isSafeImageMime } from "./image-mime";
import { THUMBNAILER_PORT, ThumbnailerPort } from "./thumbnailer.port";

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
    @Inject(THUMBNAILER_PORT) private readonly thumbnailer: ThumbnailerPort,
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

  /**
   * The small form of an image asset, for the bank tree's 40px leaf row
   * (docs/audit-2026-08-26-prod-latency.md §3.2). Expanding a topic renders 50
   * of those at once; serving the full-resolution scan for each is where the
   * ~3MB per expansion came from.
   *
   * Generated LAZILY and cached in storage under a key derived from the
   * original (`thumbnailStorageKey`). That is what lets this ship with no
   * migration, no column and no backfill: the 64k images already in production
   * gain a thumbnail the first time anyone looks at them, and the warm path
   * costs exactly one storage read — the same as before.
   *
   * Two requests racing on the same missing thumbnail both generate it. That is
   * deliberate rather than locked: the key is deterministic and the output is a
   * pure function of the input, so both write identical bytes to the same
   * place. A lock would cost more than the duplicated resize it prevents.
   */
  async getThumbnailContent(user: AuthTokenPayload, id: string): Promise<AssetContent> {
    // Same visibility rule, resolved the same way and first — the thumbnail
    // route must not be a way around the boundary the original respects.
    const asset = await this.repository.findAssetById(id, user.tenantId);
    if (!asset) {
      throw new NotFoundException(`Asset not found: ${id}`);
    }

    // A thumbnail is an image concept. PDFs (exam versions come through the
    // same table) and anything whose mime is not a format we would render
    // inline have nothing to shrink.
    if (!isSafeImageMime(asset.mime)) {
      throw new NotFoundException(`Asset has no thumbnail: ${id}`);
    }

    const thumbKey = thumbnailStorageKey(asset.storageKey);
    try {
      return { buffer: await this.storage.get(thumbKey), mime: THUMBNAIL_MIME, storageKey: thumbKey };
    } catch (error) {
      if (!(error instanceof StorageObjectNotFoundError)) {
        throw error;
      }
    }

    const original = await this.getAssetContent(user, id);
    try {
      const thumbnail = await this.thumbnailer.toWebp(original.buffer, THUMBNAIL_WIDTH_PX);
      await this.storage.put(thumbKey, thumbnail, THUMBNAIL_MIME);
      return { buffer: thumbnail, mime: THUMBNAIL_MIME, storageKey: thumbKey };
    } catch {
      // Undecodable bytes, or a storage write that failed. Either way the
      // caller still gets a renderable image — heavier than it wanted, which
      // is a slow tile rather than a missing one. Nothing is persisted, so the
      // next request retries instead of caching the failure.
      return original;
    }
  }
}
