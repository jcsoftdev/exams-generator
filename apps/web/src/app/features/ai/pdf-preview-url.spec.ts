import { describe, it, expect, vi } from 'vitest';
import type { DomSanitizer } from '@angular/platform-browser';
import { toPdfPreviewUrl } from './pdf-preview-url';

/**
 * `toPdfPreviewUrl` is the shared helper behind the chrome-less PDF preview
 * used by both `AiReviewQueueComponent` and `GenerationJobDetailComponent`
 * (audit finding L6 — the fragment + bypass call was duplicated verbatim in
 * both). It appends the toolbar/navpanes/scrollbar-hiding fragment and hands
 * the result to `DomSanitizer.bypassSecurityTrustResourceUrl` — safe here
 * only because callers always pass a blob URL this app created itself via
 * `URL.createObjectURL`, never anything server- or user-supplied.
 */
describe('toPdfPreviewUrl', () => {
  it('appends the chrome-less viewer fragment before sanitizing', () => {
    const sanitizer = {
      bypassSecurityTrustResourceUrl: vi.fn((value: string) => `safe(${value})`),
    } as unknown as DomSanitizer;

    const result = toPdfPreviewUrl(sanitizer, 'blob:http://localhost/abc-123');

    expect(sanitizer.bypassSecurityTrustResourceUrl).toHaveBeenCalledWith(
      'blob:http://localhost/abc-123#toolbar=0&navpanes=0&scrollbar=0',
    );
    expect(result).toBe('safe(blob:http://localhost/abc-123#toolbar=0&navpanes=0&scrollbar=0)');
  });

  it('delegates to the sanitizer instance passed in rather than a global one', () => {
    const sanitizerA = {
      bypassSecurityTrustResourceUrl: vi.fn(() => 'A'),
    } as unknown as DomSanitizer;
    const sanitizerB = {
      bypassSecurityTrustResourceUrl: vi.fn(() => 'B'),
    } as unknown as DomSanitizer;

    toPdfPreviewUrl(sanitizerA, 'blob:x');

    expect(sanitizerA.bypassSecurityTrustResourceUrl).toHaveBeenCalledTimes(1);
    expect(sanitizerB.bypassSecurityTrustResourceUrl).not.toHaveBeenCalled();
  });
});
