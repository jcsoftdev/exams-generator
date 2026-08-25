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
}
