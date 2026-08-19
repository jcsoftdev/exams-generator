/**
 * Test-only image byte fixtures. Upload paths now sniff magic bytes and reject
 * anything that is not a real PNG/JPEG/WEBP (see `assets/image-mime.ts`), so a
 * spec can no longer hand them a `Buffer.from("fake-png-bytes")` string. These
 * carry the correct signature followed by a recognizable tag, so they pass the
 * sniff while staying obviously fake in a hex dump.
 */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

/** A buffer that sniffs as image/png, tagged so distinct assets stay distinct. */
export function fakePng(tag = "fake-png-bytes"): Buffer {
  return Buffer.concat([Buffer.from(PNG_MAGIC), Buffer.from(tag)]);
}

export function fakeJpeg(tag = "fake-jpeg-bytes"): Buffer {
  return Buffer.concat([Buffer.from(JPEG_MAGIC), Buffer.from(tag)]);
}

export function fakeWebp(tag = "fake-webp-bytes"): Buffer {
  return Buffer.concat([Buffer.from(WEBP_HEAD), Buffer.from(tag)]);
}

/** Ready-made PNG bytes for the common case where distinctness does not matter. */
export const FAKE_PNG = fakePng();
