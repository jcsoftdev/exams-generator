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
 * Cap for the photo `ExtractionCachePort` holds for re-cropping (Important
 * Finding 5). The teacher's photo can be up to 5 MB and the cache lives in
 * the same Redis keyspace BullMQ's queues use — at ~30 extractions/min and a
 * 30-minute TTL, uncapped photos could reach ~4.5 GB resident. Comfortably
 * above `CROP_MAX_WIDTH_PX` (1200) so re-crop output quality is unaffected —
 * `crop()` downscales further from this cached copy exactly as it would
 * from the original.
 */
export const CACHE_MAX_WIDTH_PX = 2000;
