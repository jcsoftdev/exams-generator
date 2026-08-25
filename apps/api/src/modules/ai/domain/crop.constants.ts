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
