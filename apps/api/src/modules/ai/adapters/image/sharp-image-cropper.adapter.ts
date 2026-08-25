import sharp from "sharp";
import { NormalizedBox, toPixelRect } from "../../domain/normalized-box";
import { ImageCropperPort, ImageRaster } from "../../domain/ports/image-cropper.port";

/** The only `ImageCropperPort` implementation — see the port's docstring. */
export class SharpImageCropperAdapter implements ImageCropperPort {
  async raster(image: Buffer, _mimeType: string): Promise<ImageRaster> {
    const { data, info } = await sharp(image)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return { gray: new Uint8Array(data), width: info.width, height: info.height };
  }

  async crop(
    image: Buffer,
    _mimeType: string,
    box: NormalizedBox,
    maxWidthPx: number,
  ): Promise<Buffer> {
    const metadata = await sharp(image).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width === 0 || height === 0) {
      throw new Error("Image has no readable dimensions");
    }

    const rect = toPixelRect(box, width, height);
    let pipeline = sharp(image).extract(rect);
    if (rect.width > maxWidthPx) {
      pipeline = pipeline.resize({ width: maxWidthPx });
    }
    return pipeline.png().toBuffer();
  }

  async downscale(
    image: Buffer,
    mimeType: string,
    maxWidthPx: number,
  ): Promise<{ image: Buffer; mimeType: string }> {
    const metadata = await sharp(image).metadata();
    const width = metadata.width ?? 0;
    if (width === 0) {
      throw new Error("Image has no readable dimensions");
    }
    // Already within budget — return the SAME buffer untouched rather than
    // round-tripping through sharp for nothing.
    if (width <= maxWidthPx) {
      return { image, mimeType };
    }
    // No `.png()`/`.toFormat()` call: `resize` alone preserves the source
    // format, so `mimeType` (passed straight through) stays accurate.
    const resized = await sharp(image).resize({ width: maxWidthPx }).toBuffer();
    return { image: resized, mimeType };
  }
}
