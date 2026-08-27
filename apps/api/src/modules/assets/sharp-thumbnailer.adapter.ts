import sharp from "sharp";
import { ThumbnailerPort } from "./thumbnailer.port";

/** The only `ThumbnailerPort` implementation — see the port's docstring. */
export class SharpThumbnailerAdapter implements ThumbnailerPort {
  async toWebp(image: Buffer, widthPx: number): Promise<Buffer> {
    return (
      sharp(image)
        // `withoutEnlargement` is what keeps this from inflating an image that
        // is already smaller than the target: the point is fewer bytes, and
        // upscaling spends them for no added detail.
        .resize({ width: widthPx, withoutEnlargement: true })
        .webp()
        .toBuffer()
    );
  }
}
