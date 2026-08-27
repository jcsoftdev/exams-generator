import { assetCacheControl, assetETag, IMMUTABLE_CACHE_CONTROL, REVALIDATE_CACHE_CONTROL } from "./asset-cache";

describe("assetETag", () => {
  it("is stable for the same bytes", () => {
    const bytes = Buffer.from("some-png-bytes");
    expect(assetETag(bytes)).toBe(assetETag(Buffer.from("some-png-bytes")));
    expect(assetETag(bytes)).toBe(assetETag(bytes));
  });

  it("differs for different bytes", () => {
    expect(assetETag(Buffer.from("a"))).not.toBe(assetETag(Buffer.from("b")));
  });

  it("is a STRONG etag — quoted, no W/ prefix", () => {
    // Strong, not weak: the value is a hash of the exact bytes being sent, so
    // byte-equality is exactly what it asserts. A weak etag would also defeat
    // Range requests if streaming ever replaces the buffered send.
    const tag = assetETag(Buffer.from("x"));
    expect(tag).toMatch(/^"[0-9a-f]+"$/);
    expect(tag.startsWith("W/")).toBe(false);
  });

  it("distinguishes the empty buffer from a non-empty one", () => {
    expect(assetETag(Buffer.alloc(0))).not.toBe(assetETag(Buffer.from("x")));
  });
});

describe("assetCacheControl", () => {
  /**
   * The split this function exists for. Image assets are content-addressed by
   * construction — every write path mints `bank/questions/${randomUUID()}` and
   * inserts a NEW `assets` row (`bank.service.ts`, `replaceImageAsset`), and
   * nothing anywhere issues an `UPDATE` against `assets`. So the bytes behind
   * a given image id can never change, and `immutable` is a fact about the
   * schema rather than a bet.
   *
   * PDFs are NOT that. `exam-generation.service.ts` derives their storage key
   * DETERMINISTICALLY (`exams/${exam.id}/versions/${version.code}/exam.pdf`),
   * and B4-B idempotent regeneration wipes the prior version rows and
   * re-`put()`s the same keys. A regeneration therefore overwrites the object
   * an ALREADY-ISSUED asset id still points at — the id survives in a browser
   * cache or a copied link even though its version row is gone. Marking that
   * `immutable` would serve the previous exam's PDF, from cache, forever, with
   * no way to bust it.
   */
  it("marks images immutable for a year", () => {
    expect(assetCacheControl("image/png")).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(assetCacheControl("image/jpeg")).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(assetCacheControl("image/webp")).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  it("makes PDFs revalidate instead — their storage key is reused on regeneration", () => {
    expect(assetCacheControl("application/pdf")).toBe(REVALIDATE_CACHE_CONTROL);
  });

  it("treats an unknown/hostile mime as immutable — it is still a uuid-keyed upload", () => {
    // Collapsed to octet-stream by the controller, but the row is still one of
    // the random-uuid upload paths, so the same immutability argument holds.
    expect(assetCacheControl("image/svg+xml")).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(assetCacheControl("application/octet-stream")).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  it("keeps EVERY policy private — assets are tenant-scoped behind a bearer token", () => {
    // `public` here would let Cloudflare (or any corporate proxy on the path)
    // store one tenant's private question image and hand it to another
    // tenant's request for the same url. The whole route is bearer-gated and
    // tenant-scoped in `AssetsService`; a shared cache must never keep a copy.
    for (const mime of ["image/png", "application/pdf", "application/octet-stream"]) {
      expect(assetCacheControl(mime)).toMatch(/(^|,\s*)private(,|$)/);
      expect(assetCacheControl(mime)).not.toMatch(/(^|,\s*)public(,|$)/);
    }
  });
});
