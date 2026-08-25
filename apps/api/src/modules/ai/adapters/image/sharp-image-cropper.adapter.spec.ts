import sharp from "sharp";
import { SharpImageCropperAdapter } from "./sharp-image-cropper.adapter";

/**
 * Builds a white PNG of the given size with one black rectangle painted into
 * it, so each assertion can talk about ink in plain pixel coordinates.
 */
async function pngWithBlackRect(
  width: number,
  height: number,
  rect: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  const block = await sharp({
    create: { width: rect.width, height: rect.height, channels: 3, background: "#000000" },
  })
    .png()
    .toBuffer();

  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite([{ input: block, left: rect.left, top: rect.top }])
    .png()
    .toBuffer();
}

describe("SharpImageCropperAdapter", () => {
  describe("raster", () => {
    it("returns one luminance byte per pixel with the image's real dimensions", async () => {
      const adapter = new SharpImageCropperAdapter();
      const image = await pngWithBlackRect(40, 20, { left: 0, top: 0, width: 10, height: 10 });

      const raster = await adapter.raster(image, "image/png");

      expect(raster.width).toBe(40);
      expect(raster.height).toBe(20);
      expect(raster.gray.length).toBe(40 * 20);
    });

    it("reports ink where the black rectangle is and white elsewhere", async () => {
      const adapter = new SharpImageCropperAdapter();
      const image = await pngWithBlackRect(40, 20, { left: 10, top: 5, width: 8, height: 8 });

      const raster = await adapter.raster(image, "image/png");

      // Inside the black rect.
      expect(raster.gray[6 * 40 + 12]).toBeLessThan(40);
      // Outside it.
      expect(raster.gray[1 * 40 + 1]).toBeGreaterThan(200);
    });
  });

  describe("crop", () => {
    it("extracts exactly the pixel rect the normalized box points at", async () => {
      const adapter = new SharpImageCropperAdapter();
      const image = await pngWithBlackRect(100, 100, { left: 0, top: 0, width: 100, height: 100 });

      const cropped = await adapter.crop(image, "image/png", { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1200);
      const meta = await sharp(cropped).metadata();

      expect(meta.format).toBe("png");
      expect(meta.width).toBe(50);
      expect(meta.height).toBe(25);
    });

    it("downscales a crop wider than maxWidthPx, preserving the aspect ratio", async () => {
      const adapter = new SharpImageCropperAdapter();
      const image = await pngWithBlackRect(2000, 1000, { left: 0, top: 0, width: 2000, height: 1000 });

      const cropped = await adapter.crop(image, "image/png", { x: 0, y: 0, w: 1, h: 1 }, 1200);
      const meta = await sharp(cropped).metadata();

      expect(meta.width).toBe(1200);
      expect(meta.height).toBe(600);
    });

    it("leaves a crop narrower than maxWidthPx at its natural size", async () => {
      const adapter = new SharpImageCropperAdapter();
      const image = await pngWithBlackRect(300, 200, { left: 0, top: 0, width: 300, height: 200 });

      const cropped = await adapter.crop(image, "image/png", { x: 0, y: 0, w: 1, h: 1 }, 1200);
      const meta = await sharp(cropped).metadata();

      expect(meta.width).toBe(300);
    });

    it("rejects bytes that are not a decodable image", async () => {
      const adapter = new SharpImageCropperAdapter();

      await expect(
        adapter.crop(Buffer.from("not-an-image"), "image/png", { x: 0, y: 0, w: 1, h: 1 }, 1200),
      ).rejects.toThrow();
    });
  });
});
