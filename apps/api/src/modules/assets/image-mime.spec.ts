import { BadRequestException } from "@nestjs/common";
import { SAFE_IMAGE_MIMES, isSafeImageMime, requireImageMime, sniffImageMime } from "./image-mime";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe("isSafeImageMime", () => {
  it.each(SAFE_IMAGE_MIMES)("accepts %s", (mime) => {
    expect(isSafeImageMime(mime)).toBe(true);
  });

  it.each(["image/svg+xml", "text/html", "application/octet-stream", "", null, undefined])(
    "rejects %s",
    (mime) => {
      expect(isSafeImageMime(mime)).toBe(false);
    },
  );
});

describe("sniffImageMime", () => {
  it("identifies a PNG by its 8-byte signature", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
  });

  it("identifies a JPEG by its SOI + marker", () => {
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
  });

  it("identifies a WEBP by the RIFF/WEBP container tags", () => {
    expect(sniffImageMime(WEBP)).toBe("image/webp");
  });

  it("returns null for an SVG — text that a client could label image/png", () => {
    expect(sniffImageMime(Buffer.from("<svg><script>alert(1)</script></svg>"))).toBeNull();
  });

  it("returns null for an HTML payload", () => {
    expect(sniffImageMime(Buffer.from("<!doctype html><script>steal()</script>"))).toBeNull();
  });

  it("returns null for a buffer too short to hold any signature", () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50]))).toBeNull();
  });

  it("does not mistake a RIFF that is not WEBP (e.g. a WAV) for an image", () => {
    const wav = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, // ...WAVE
    ]);
    expect(sniffImageMime(wav)).toBeNull();
  });
});

describe("requireImageMime", () => {
  it("returns the sniffed canonical mime for a real image", () => {
    expect(requireImageMime({ buffer: PNG })).toBe("image/png");
  });

  it("throws 400 for a non-image buffer regardless of its claimed type", () => {
    expect(() => requireImageMime({ buffer: Buffer.from("<svg><script/></svg>") })).toThrow(
      BadRequestException,
    );
  });
});
