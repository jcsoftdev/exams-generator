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

  /**
   * Shrinks the WHOLE image to `maxWidthPx` when it is wider than that,
   * preserving aspect ratio and original format; returns the input
   * untouched (same `Buffer` instance, no re-encode) when it already fits.
   *
   * Exists for `ExtractionCachePort` (Important Finding 5): the extraction's
   * source photo can be up to 5 MB, and holding it uncompressed in the same
   * Redis keyspace BullMQ uses is a real memory risk. `crop`'s own
   * `maxWidthPx` cap only bounds ONE cut, never the cached original.
   *
   * Because normalized boxes (`NormalizedBox`) are 0..1 FRACTIONS of the
   * image's own width/height — not absolute pixels — a uniform downscale
   * never moves what a given box points at: `crop`'s `toPixelRect` re-derives
   * pixel coordinates from whatever width/height the image handed it
   * actually has. Re-cropping from a downscaled cache entry is therefore
   * exactly as correct as re-cropping from the original, just lower-resolution.
   *
   * @throws when the bytes are not a decodable image.
   */
  downscale(
    image: Buffer,
    mimeType: string,
    maxWidthPx: number,
  ): Promise<{ image: Buffer; mimeType: string }>;
}
