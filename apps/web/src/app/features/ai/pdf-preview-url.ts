import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/**
 * Chrome-less PDF viewer fragment — hides the native toolbar/thumbnails/scrollbar
 * so an embedded preview reads as a printed "paper", not a browser PDF viewer.
 * Was duplicated verbatim in `AiReviewQueueComponent` and
 * `GenerationJobDetailComponent` (audit finding L6) before being pulled out here.
 */
const PREVIEW_FRAGMENT = '#toolbar=0&navpanes=0&scrollbar=0';

/**
 * Wraps a PDF preview blob URL as a `SafeResourceUrl` an `<iframe>` can embed,
 * appending the chrome-less viewer fragment first.
 *
 * Bypassing Angular's sanitizer here is safe because the URL is always one
 * this app created itself — `URL.createObjectURL` on a PDF blob it just
 * downloaded via `AiService.previewDraft()` — never anything server- or
 * user-supplied, so there is no XSS surface to worry about.
 */
export function toPdfPreviewUrl(sanitizer: DomSanitizer, blobUrl: string): SafeResourceUrl {
  return sanitizer.bypassSecurityTrustResourceUrl(blobUrl + PREVIEW_FRAGMENT);
}
