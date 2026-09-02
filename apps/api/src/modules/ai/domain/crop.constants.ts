/**
 * Cropping constants shared across the crop-producing services
 * (`ExtractQuestionService` now; `RecropQuestionService` in Task 6). Kept
 * under `domain/` rather than in either service file — a service importing a
 * constant from a sibling service would invert the dependency direction this
 * module keeps, where domain values live under `domain/` and services import
 * from there, never from each other.
 */

/** Wide enough to review on screen and to print; small enough to ship in JSON. */
export const CROP_MAX_WIDTH_PX = 1200;

/** Breathing room left around the ink so a stroke never touches the crop edge. */
export const CROP_INK_PADDING_PX = 8;

/**
 * Width the photo is downscaled to BEFORE figure detection analyses it.
 *
 * `MAX_IMAGE_UPLOAD_BYTES` admits roughly a 24 MP JPEG, and detection is the
 * memory-hungriest thing this module does per request: `raster()` decodes at
 * full resolution, then `findFigureRegions` allocates an erased copy of the
 * greyscale plane AND a `seen` plane the same size, plus a flood-fill stack
 * that reaches one entry per pixel on a single-component page. At 24 MP that
 * is ~72 MB of typed arrays per concurrent extraction; at this width it is
 * ~9 MB. Cropping is unaffected: `crop()` re-derives its pixels from the
 * ORIGINAL image, and a normalized 0..1 box means the same thing at any
 * scale (see `ImageCropperPort.downscale`).
 *
 * 2000 is chosen for the OCR, not for the memory. Tesseract wants roughly
 * 300 DPI-equivalent text and degrades badly below ~200; a Letter/A4 sheet
 * is ~8.3in wide, so 2000px across it is ~240 DPI — enough for the printed
 * body text, and comfortably enough for the `A)`–`E)` markers, which at
 * 10-12pt land around 33-40px tall. Those markers are what
 * `attributeFigureToAlternative` cuts its bands with, so a more aggressive
 * downscale would not just blur text, it would silently stop attributing
 * figures to their alternatives.
 *
 * Deliberately NOT reused from `CACHE_MAX_WIDTH_PX`, which happens to hold
 * the same number today: that one bounds Redis memory, this one preserves
 * OCR legibility. Tuning the cache cap down for memory reasons must not
 * quietly degrade marker detection.
 */
export const ANALYSIS_MAX_WIDTH_PX = 2000;

/**
 * Cap for the photo `ExtractionCachePort` holds for re-cropping (Important
 * Finding 5). The teacher's photo can be up to 5 MB and the cache lives in
 * the same Redis keyspace BullMQ's queues use — at ~30 extractions/min and a
 * 30-minute TTL, uncapped photos could reach ~4.5 GB resident.
 *
 * Comfortably above `CROP_MAX_WIDTH_PX` (1200), but that does NOT make
 * re-crop output quality unaffected across the board — only for crops wide
 * enough that `crop()`'s own 1200px cap would have kicked in against the
 * ORIGINAL photo too (box width ≥ ~60% of the photo's width, since
 * `0.6 * 2000 ≈ 1200`). A crop narrower than that now caps out lower than it
 * would have from the uncapped original — e.g. a 20%-wide crop from a
 * 4000px photo drops from 800px (20% of 4000) to 400px (20% of this
 * 2000px cache) — a real, accepted trade for bounding cache memory, not a
 * quality-neutral one.
 */
export const CACHE_MAX_WIDTH_PX = 2000;
