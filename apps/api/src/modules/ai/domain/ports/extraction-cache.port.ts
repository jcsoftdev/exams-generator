/** The original photo of one extraction, held only long enough to re-crop it. */
export interface CachedExtraction {
  readonly userId: string;
  readonly image: Buffer;
  readonly mimeType: string;
}

/**
 * Short-lived storage for the photo between an extraction and the teacher's
 * manual crop adjustments. Deliberately NOT the asset store: this photo may
 * never become anything, and an asset that may never be referenced is an
 * orphan waiting to be cleaned up.
 */
export interface ExtractionCachePort {
  put(extractionId: string, entry: CachedExtraction): Promise<void>;
  get(extractionId: string): Promise<CachedExtraction | null>;
}
