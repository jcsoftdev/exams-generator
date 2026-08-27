/**
 * Thumbnails for the bank grid (docs/audit-2026-08-26-prod-latency.md §3.2).
 *
 * Scoped narrowly on purpose. These are IMAGE questions: the statement and the
 * alternatives are baked into the picture, so a teacher has to be able to READ
 * it. Downscaling the view they read would trade a latency problem for a
 * legibility one.
 *
 * Only one place renders at a size where that does not apply — the tree's leaf
 * row, `class="h-10 w-10"` in `bank-list.component.html`, which is a 40px
 * square rendered once per question for a whole page of 50. That row is where
 * the ~3MB per expanded topic comes from; the two readable views (the selected
 * question's `max-h-64` panel and the edit preview) render one image at a time
 * and keep the original.
 */

/**
 * 320px wide. Eight times the 40px the leaf row paints, which covers 3× DPR
 * with room over — and the ceiling is not sharpness, it is that this is the
 * size shown BEFORE the full image arrives for a selected question, so it
 * should not look like a broken placeholder while it stands in.
 */
export const THUMBNAIL_WIDTH_PX = 320;

/** WebP: the smallest of the formats every current browser decodes. */
export const THUMBNAIL_MIME = "image/webp";

/**
 * Where a thumbnail lives, derived from the original's key rather than stored
 * on the `assets` row.
 *
 * That is the whole reason this needs no migration, no backfill and no column:
 * the location is a pure function of the original, so "has this one been
 * generated?" is answered by asking storage, and an asset uploaded before
 * thumbnails existed heals itself the first time it is requested. The original
 * key is already unique (`bank/questions/${randomUUID()}`), so this is too.
 */
export function thumbnailStorageKey(originalStorageKey: string): string {
  return `${originalStorageKey}.thumb-${THUMBNAIL_WIDTH_PX}.webp`;
}
