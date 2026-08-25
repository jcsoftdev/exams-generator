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

  describe("downscale", () => {
    it("shrinks an image wider than maxWidthPx, preserving the aspect ratio", async () => {
      const adapter = new SharpImageCropperAdapter();
      const image = await pngWithBlackRect(4000, 2000, { left: 0, top: 0, width: 4000, height: 2000 });

      const { image: downscaled, mimeType } = await adapter.downscale(image, "image/png", 2000);
      const meta = await sharp(downscaled).metadata();

      expect(meta.width).toBe(2000);
      expect(meta.height).toBe(1000);
      expect(mimeType).toBe("image/png");
    });

    it("leaves an image narrower than maxWidthPx untouched — same bytes, not just same dimensions", async () => {
      const adapter = new SharpImageCropperAdapter();
      const image = await pngWithBlackRect(300, 200, { left: 0, top: 0, width: 300, height: 200 });

      const { image: result } = await adapter.downscale(image, "image/png", 2000);

      // Byte-identical, not merely same-size: re-encoding an image that
      // didn't need it would be wasted CPU on every extraction.
      expect(result).toBe(image);
    });

    it("keeps the crop box's normalized (0..1) coordinate space intact — a box read against the downscaled image lands on the same relative ink as against the original", async () => {
      const adapter = new SharpImageCropperAdapter();
      // A black rect covering the right half of a wide image.
      const image = await pngWithBlackRect(4000, 2000, {
        left: 2000,
        top: 0,
        width: 2000,
        height: 2000,
      });

      const { image: downscaled } = await adapter.downscale(image, "image/png", 2000);
      // Same normalized box against BOTH the original and the downscaled
      // image should extract the same (all-black) region — proving the
      // 0..1 box is resolution-independent across the downscale.
      const fromOriginal = await adapter.crop(image, "image/png", { x: 0.5, y: 0, w: 0.5, h: 1 }, 4000);
      const fromDownscaled = await adapter.crop(
        downscaled,
        "image/png",
        { x: 0.5, y: 0, w: 0.5, h: 1 },
        4000,
      );

      const originalMeta = await sharp(fromOriginal).stats();
      const downscaledMeta = await sharp(fromDownscaled).stats();
      // Both crops are pure black on their R/G/B channels (mean near 0) — if
      // the downscale had shifted the coordinate space, one of these would
      // pick up white background instead. Channel 3 (alpha, sharp's default
      // PNG output) is opaque (255) on both and is intentionally excluded.
      for (const channel of originalMeta.channels.slice(0, 3)) {
        expect(channel.mean).toBeLessThan(5);
      }
      for (const channel of downscaledMeta.channels.slice(0, 3)) {
        expect(channel.mean).toBeLessThan(5);
      }
    });

    it("rejects bytes that are not a decodable image", async () => {
      const adapter = new SharpImageCropperAdapter();

      await expect(adapter.downscale(Buffer.from("not-an-image"), "image/png", 2000)).rejects.toThrow();
    });
  });
});
