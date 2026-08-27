/** DI token for the `ThumbnailerPort` implementation the assets module uses. */
export const THUMBNAILER_PORT = Symbol("ThumbnailerPort");

/**
 * Shrinks image bytes — the module never talks to an image library directly
 * (mirrors `StoragePort` / `PdfCompilerPort` / `ImageCropperPort`).
 *
 * Same reasoning as `ImageCropperPort`: no in-memory fake ships here. `sharp`
 * is pure CPU with no network and no state, so unit tests inject an inline
 * mock and the e2e suite runs the real adapter against real PNG bytes. A
 * second implementation existing only for tests is code nothing ships and that
 * can drift from the one that does.
 */
export interface ThumbnailerPort {
  /**
   * Returns WebP bytes no wider than `widthPx`. An image already narrower than
   * that is re-encoded but never upscaled — enlarging a small image would cost
   * bytes to add no detail.
   *
   * @throws when the bytes are not a decodable image.
   */
  toWebp(image: Buffer, widthPx: number): Promise<Buffer>;
}
