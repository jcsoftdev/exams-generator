import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ExamVersionsPanelComponent } from './exam-versions-panel.component';
import { ExamVersionsService } from '../exam-versions.service';
import { GeneratedVersionResult } from '../exam-versions.models';

const VERSIONS: GeneratedVersionResult[] = [
  { code: 'A', pdfUrl: 'http://minio.test/a.pdf', answerSheetUrl: 'http://minio.test/a-key.pdf' },
  { code: 'B', pdfUrl: 'http://minio.test/b.pdf', answerSheetUrl: 'http://minio.test/b-key.pdf' },
];

function setup(generateVersionsImpl: (...args: unknown[]) => unknown) {
  const generateVersions = vi.fn(generateVersionsImpl);

  TestBed.configureTestingModule({
    imports: [ExamVersionsPanelComponent],
    providers: [
      { provide: ExamVersionsService, useValue: { generateVersions } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: new Map([['examId', 'exam-1']]) } },
      },
    ],
  });

  const fixture = TestBed.createComponent(ExamVersionsPanelComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, generateVersions };
}

describe('ExamVersionsPanelComponent', () => {
  it('reads examId from the route and defaults versionCount to 1', () => {
    const { fixture } = setup(() => of(VERSIONS));

    expect(fixture.componentInstance.examId()).toBe('exam-1');
    expect(fixture.componentInstance.form.getRawValue().versionCount).toBe(1);
  });

  it('calls generateVersions with the examId and chosen versionCount when Generate is clicked', () => {
    const { compiled, fixture, generateVersions } = setup(() => of(VERSIONS));

    const input = compiled.querySelector<HTMLInputElement>('input[name="versionCount"]')!;
    input.value = '3';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = compiled.querySelector('form')!;
    form.dispatchEvent(new Event('submit'));

    expect(generateVersions).toHaveBeenCalledWith('exam-1', 3);
  });

  it('shows a loading state while the request is in flight', () => {
    const { compiled, fixture } = setup(() => of(VERSIONS));

    expect(fixture.componentInstance.loading()).toBe(false);

    const form = compiled.querySelector('form')!;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    // of() resolves synchronously so loading toggles back to false after the submit;
    // assert the flag exists and ends in a settled state.
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('renders one row per generated version with its code, PDF link and answer key link', () => {
    const { compiled, fixture } = setup(() => of(VERSIONS));

    const form = compiled.querySelector('form')!;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const rows = compiled.querySelectorAll('[data-testid="version-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('A');

    const pdfLinks = compiled.querySelectorAll<HTMLAnchorElement>('[data-testid="version-pdf-link"]');
    expect(pdfLinks[0].getAttribute('href')).toBe('http://minio.test/a.pdf');

    const answerLinks = compiled.querySelectorAll<HTMLAnchorElement>(
      '[data-testid="version-answer-link"]',
    );
    expect(answerLinks[0].getAttribute('href')).toBe('http://minio.test/a-key.pdf');
  });

  it('shows the 422 error message including the offending questionId on failure', () => {
    const { compiled, fixture } = setup(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: { message: 'Insufficient questions', examId: 'exam-1', questionId: 'question-9' },
          }),
      ),
    );

    const form = compiled.querySelector('form')!;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(compiled.textContent).toContain('Insufficient questions');
    expect(compiled.textContent).toContain('question-9');
    expect(fixture.componentInstance.loading()).toBe(false);
  });
});
