import { THUMBNAIL_MIME, THUMBNAIL_WIDTH_PX, thumbnailStorageKey } from "./asset-thumbnail";

describe("thumbnailStorageKey", () => {
  it("derives the key from the original, so no column has to remember it", () => {
    expect(thumbnailStorageKey("bank/questions/abc-123")).toBe("bank/questions/abc-123.thumb-320.webp");
  });

  it("is stable — two calls agree, which is what makes a concurrent double-generate harmless", () => {
    const key = "bank/questions/abc-123";
    expect(thumbnailStorageKey(key)).toBe(thumbnailStorageKey(key));
  });

  it("stays unique per original", () => {
    expect(thumbnailStorageKey("a")).not.toBe(thumbnailStorageKey("b"));
  });

  it("encodes the width, so changing it retires the old objects instead of serving them", () => {
    // Bumping THUMBNAIL_WIDTH_PX must not leave every existing thumbnail
    // silently answering at the old size — the key changes with it and the
    // lazy path regenerates.
    expect(thumbnailStorageKey("x")).toContain(String(THUMBNAIL_WIDTH_PX));
  });

  it("never collides with the original it is derived from", () => {
    expect(thumbnailStorageKey("bank/questions/x")).not.toBe("bank/questions/x");
  });
});

describe("thumbnail constants", () => {
  it("is wide enough for the 40px leaf row at 3x DPR", () => {
    expect(THUMBNAIL_WIDTH_PX).toBeGreaterThanOrEqual(40 * 3);
  });

  it("emits webp", () => {
    expect(THUMBNAIL_MIME).toBe("image/webp");
  });
});
