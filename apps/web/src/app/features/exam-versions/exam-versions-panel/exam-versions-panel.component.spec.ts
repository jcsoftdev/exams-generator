import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ExamVersionsPanelComponent } from './exam-versions-panel.component';
import { ExamVersionsService } from '../exam-versions.service';
import { ExamVersion } from '../exam-versions.models';

const VERSIONS: ExamVersion[] = [
  { code: 'A', pdfUrl: '/assets/pdf-a', answerSheetUrl: '/assets/answer-a' },
  { code: 'B', pdfUrl: '/assets/pdf-b', answerSheetUrl: '/assets/answer-b' },
  { code: 'C', pdfUrl: '/assets/pdf-c', answerSheetUrl: '/assets/answer-c' },
];

function setup(overrides: {
  listVersionsImpl?: (...args: unknown[]) => unknown;
  downloadAssetImpl?: (assetUrl: string) => unknown;
}) {
  const listVersions = vi.fn(overrides.listVersionsImpl ?? (() => of(VERSIONS)));
  const downloadAsset = vi.fn(
    overrides.downloadAssetImpl ??
      ((assetUrl: string) => of(new Blob([`fake-bytes-${assetUrl}`], { type: 'application/pdf' }))),
  );

  let objectUrlCounter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-url-${objectUrlCounter++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  TestBed.configureTestingModule({
    imports: [ExamVersionsPanelComponent],
    providers: [
      { provide: ExamVersionsService, useValue: { listVersions, downloadAsset } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: new Map([['examId', 'exam-1']]) } },
      },
    ],
  });

  const fixture = TestBed.createComponent(ExamVersionsPanelComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, listVersions, downloadAsset };
}

describe('ExamVersionsPanelComponent', () => {
  describe('with-data', () => {
    it('calls listVersions(examId) with the route examId on init', () => {
      const { listVersions } = setup({});

      expect(listVersions).toHaveBeenCalledWith('exam-1');
    });

    it('renders 3 rows, each with 2 working (blob:) download links (VS-R1)', () => {
      const { compiled, downloadAsset } = setup({});

      const rows = compiled.querySelectorAll('[data-testid="version-row"]');
      expect(rows.length).toBe(3);
      expect(rows[0].textContent).toContain('A');

      expect(downloadAsset).toHaveBeenCalledWith('/assets/pdf-a');
      expect(downloadAsset).toHaveBeenCalledWith('/assets/answer-a');

      const pdfLinks = compiled.querySelectorAll<HTMLAnchorElement>('[data-testid="version-pdf-link"]');
      const answerLinks = compiled.querySelectorAll<HTMLAnchorElement>(
        '[data-testid="version-answer-link"]',
      );
      expect(pdfLinks.length).toBe(3);
      expect(answerLinks.length).toBe(3);
      expect(pdfLinks[0].getAttribute('href')).toMatch(/^blob:/);
      expect(answerLinks[0].getAttribute('href')).toMatch(/^blob:/);
    });

    it('renders a disabled "Descargar todo (ZIP)" placeholder button (N1 out of scope)', () => {
      const { compiled } = setup({});

      const zipButton = compiled.querySelector<HTMLButtonElement>('[data-testid="download-zip"] button');
      expect(zipButton).toBeTruthy();
      expect(zipButton?.disabled).toBe(true);
    });
  });

  describe('loading', () => {
    it('shows a loading indicator while the versions call is pending and renders no stale data', () => {
      const subject = new Subject<ExamVersion[]>();
      const { compiled, fixture } = setup({ listVersionsImpl: () => subject.asObservable() });

      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="version-row"]')).toBeFalsy();

      subject.next(VERSIONS);
      subject.complete();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeFalsy();
      expect(compiled.querySelectorAll('[data-testid="version-row"]').length).toBe(3);
    });
  });

  describe('empty', () => {
    it('renders the empty state (not an empty list) when the exam has zero generated versions (VS-R2)', () => {
      const { compiled } = setup({ listVersionsImpl: () => of([]) });

      expect(compiled.querySelector('[data-testid="version-row"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="empty-versions"]')).toBeTruthy();
    });
  });

  describe('not-found', () => {
    it('renders a distinct not-found state (not empty/loading) on a 404 (VS-R3)', () => {
      const { compiled } = setup({
        listVersionsImpl: () => throwError(() => new HttpErrorResponse({ status: 404 })),
      });

      expect(compiled.querySelector('[data-testid="not-found-state"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="empty-versions"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="version-row"]')).toBeFalsy();
    });

    it('renders a generic error state (distinguishable from not-found) on a non-404 failure', () => {
      const { compiled } = setup({
        listVersionsImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });

      expect(compiled.querySelector('[data-testid="error-state"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="not-found-state"]')).toBeFalsy();
    });
  });
});
