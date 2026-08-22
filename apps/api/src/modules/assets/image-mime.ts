import { BadRequestException } from "@nestjs/common";

/**
 * The only image types this product stores and renders — mirrors the
 * `MIME_EXTENSIONS` table in `exam-generation.service.ts`. Anything outside
 * this set served inline is either junk or an attack: an `image/svg+xml` or
 * `text/html` payload rendered in a victim's tab is stored XSS.
 */
export const SAFE_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export type SafeImageMime = (typeof SAFE_IMAGE_MIMES)[number];

/** True only for a MIME the browser is safe to render inline. */
export function isSafeImageMime(mime: string | null | undefined): mime is SafeImageMime {
  return typeof mime === "string" && (SAFE_IMAGE_MIMES as readonly string[]).includes(mime);
}

/**
 * Sniffs a buffer's real type from its magic bytes and returns the canonical
 * MIME, or `null` if it is not one of the formats we accept. The point is to
 * never trust `file.mimetype`: multer copies it straight from the client's
 * `Content-Type` header, so an executable or an HTML payload labelled
 * `image/png` sails through the size limit untouched.
 */
export function sniffImageMime(buffer: Buffer): SafeImageMime | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // RIFF....WEBP — bytes 0-3 spell "RIFF", bytes 8-11 spell "WEBP".
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Ingest guard for the upload paths: sniffs the buffer and returns the
 * canonical MIME to store, or throws 400 if the bytes are not a real image.
 * Callers persist THIS value, never `file.mimetype` — so the stored record is
 * trustworthy end-to-end instead of only sanitized at read time.
 */
export function requireImageMime(file: { readonly buffer: Buffer }): SafeImageMime {
  const mime = sniffImageMime(file.buffer);
  if (!mime) {
    throw new BadRequestException("Uploaded file is not a valid image (expected PNG, JPEG or WEBP).");
  }
  return mime;
}
