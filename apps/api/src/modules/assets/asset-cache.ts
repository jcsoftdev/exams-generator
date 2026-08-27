import { createHash } from "node:crypto";

/**
 * Caching policy for `GET /assets/:id`.
 *
 * Every value here is `private`. The route is bearer-gated and tenant-scoped
 * (`AssetsService` applies the same `tenant_id IS NULL OR = :current` rule the
 * bank module uses), so a SHARED cache — Cloudflare sits in front of this API
 * in production, and any corporate proxy might too — must never keep a copy it
 * could hand to a different tenant asking for the same url. `private` is the
 * only thing that says so.
 */

/**
 * Images and other uuid-keyed uploads.
 *
 * `immutable` is a statement about the schema, not an optimistic guess: every
 * write path mints a fresh `bank/questions/${randomUUID()}` key and INSERTS a
 * new `assets` row — including `replaceImageAsset`, which deliberately leaves
 * the old row in place and repoints the question at a new one — and no code
 * path anywhere issues an `UPDATE` against `assets`. The bytes behind a given
 * asset id therefore cannot change.
 */
export const IMMUTABLE_CACHE_CONTROL = "private, max-age=31536000, immutable";

/**
 * PDFs. Cached, but revalidated on every use.
 *
 * Unlike images, exam-version PDFs get a DETERMINISTIC storage key
 * (`exams/${exam.id}/versions/${version.code}/exam.pdf`, see
 * `exam-generation.service.ts`), and B4-B idempotent regeneration wipes the
 * prior version rows and re-`put()`s those same keys. The object an
 * already-issued asset id points at can therefore be overwritten — the id
 * outlives its version row in any browser cache or copied link. `no-cache`
 * (which means "store it, but revalidate before reuse", NOT "don't store it")
 * keeps the bandwidth win via `If-None-Match` while making it impossible to
 * serve a stale exam from cache.
 */
export const REVALIDATE_CACHE_CONTROL = "private, no-cache";

/** Which of the two policies applies to an asset, by its stored mime. */
export function assetCacheControl(mime: string): string {
  return mime === "application/pdf" ? REVALIDATE_CACHE_CONTROL : IMMUTABLE_CACHE_CONTROL;
}

/**
 * Strong `ETag` over the exact bytes being sent.
 *
 * Strong rather than weak (`W/"…"`) because the value IS a hash of the payload,
 * so byte-equality is precisely what it asserts — and a weak validator would
 * rule out Range requests if the buffered `res.send()` here is ever replaced by
 * a stream.
 *
 * Truncated to 32 hex chars: 128 bits of sha256 is far past any collision
 * concern for cache validation, and keeps the header small on a response that
 * may be one of fifty on a single page.
 */
export function assetETag(buffer: Buffer): string {
  return `"${createHash("sha256").update(buffer).digest("hex").slice(0, 32)}"`;
}
