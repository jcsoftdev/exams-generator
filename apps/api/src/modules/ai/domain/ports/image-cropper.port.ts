import { NormalizedBox } from "../normalized-box";
import { ImageRaster } from "../snap-box-to-ink";

export { ImageRaster };

/**
 * Decoding and cropping of a photo — the domain never talks to an image
 * library directly (mirrors `StoragePort` / `PdfCompilerPort`).
 *
 * There is deliberately NO in-memory fake for this port. `sharp` is pure CPU
 * with no network and no state, so unit tests use an inline
 * `jest.Mocked<ImageCropperPort>` and e2e runs the real adapter against real
 * PNGs. A second implementation existing only for tests would be code
 * nothing ships and that can silently drift from the real one.
 */
export interface ImageCropperPort {
  /** Decodes the image to greyscale for ink analysis. */
  raster(image: Buffer, mimeType: string): Promise<ImageRaster>;

  /**
   * Extracts the normalized box and returns PNG bytes, downscaled to
   * `maxWidthPx` when the crop is wider than that.
   *
   * @throws when the bytes are not a decodable image.
   */
  crop(image: Buffer, mimeType: string, box: NormalizedBox, maxWidthPx: number): Promise<Buffer>;
}
