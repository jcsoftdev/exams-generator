import { TestBed } from '@angular/core/testing';
import { Difficulty } from '@exams-generator/shared';
import { ActivatedRoute, Router } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { Subject, TimeoutError, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ExamVersionsPanelComponent } from './exam-versions-panel.component';
import { ExamVersionsService } from '../exam-versions.service';
import { ExamVersion, ExamVersionJob } from '../exam-versions.models';
import { ExamsService } from '../../exams/exams.service';
import { ExamDetail } from '../../exams/exams.models';

const VERSIONS: ExamVersion[] = [
  { code: 'A', pdfUrl: '/assets/pdf-a', answerSheetUrl: '/assets/answer-a' },
  { code: 'B', pdfUrl: '/assets/pdf-b', answerSheetUrl: '/assets/answer-b' },
  { code: 'C', pdfUrl: '/assets/pdf-c', answerSheetUrl: '/assets/answer-c' },
];

const EXAM_DETAIL: ExamDetail = {
  id: 'exam-1',
  title: 'Examen de Biología',
  gradeLevel: 'secundaria_2',
  status: 'ready',
  questions: [
    {
      id: 'q1',
      position: 0,
      type: 'structured',
      courseId: 'c1',
      courseName: 'Biología',
      topicId: 't1',
      topicName: 'La célula',
      difficulty: Difficulty.Easy,
      correctAnswer: '0',
      imageAssetId: null,
      bodyTypst: '¿Cuál es la unidad básica de la vida?',
      alternatives: ['La célula', 'El átomo'],
      figureCode: null,
    },
    {
      id: 'q2',
      position: 1,
      type: 'image',
      courseId: 'c2',
      courseName: 'Química',
      topicId: 't2',
      topicName: 'Átomos',
      difficulty: Difficulty.Medium,
      correctAnswer: '1',
      imageAssetId: 'img-1',
      bodyTypst: null,
      alternatives: null,
      figureCode: null,
    },
  ],
};

function job(overrides: Partial<ExamVersionJob> = {}): ExamVersionJob {
  return {
    id: 'job-1',
    examId: 'exam-1',
    versionCount: 2,
    status: 'pending',
    completedCount: 0,
    failedReason: null,
    failedQuestionId: null,
    ...overrides,
  };
}

function setup(overrides: {
  listVersionsImpl?: (...args: unknown[]) => unknown;
  downloadAssetImpl?: (assetUrl: string) => unknown;
  downloadVersionsZipImpl?: (...args: unknown[]) => unknown;
  generateVersionsImpl?: (...args: unknown[]) => unknown;
  latestVersionJobImpl?: (...args: unknown[]) => unknown;
  streamVersionJobImpl?: (...args: unknown[]) => unknown;
  getExamImpl?: (...args: unknown[]) => unknown;
  duplicateExamImpl?: (...args: unknown[]) => unknown;
}) {
  const listVersions = vi.fn(overrides.listVersionsImpl ?? (() => of(VERSIONS)));
  const downloadAsset = vi.fn(
    overrides.downloadAssetImpl ??
      ((assetUrl: string) => of(new Blob([`fake-bytes-${assetUrl}`], { type: 'application/pdf' }))),
  );
  const downloadVersionsZip = vi.fn(
    overrides.downloadVersionsZipImpl ??
      (() => of(new Blob(['fake-zip-bytes'], { type: 'application/zip' }))),
  );
  const generateVersions = vi.fn(overrides.generateVersionsImpl ?? (() => of(job())));
  // Default: nothing in flight when the screen loads.
  const latestVersionJob = vi.fn(overrides.latestVersionJobImpl ?? (() => of(null)));
  const streamVersionJob = vi.fn(
    overrides.streamVersionJobImpl ?? (() => of(job({ status: 'completed', completedCount: 2 }))),
  );
  const getExam = vi.fn(overrides.getExamImpl ?? (() => of(EXAM_DETAIL)));
  const duplicateExam = vi.fn(
    overrides.duplicateExamImpl ??
      (() => of({ id: 'exam-copy', title: 'Copia de Examen de Biología', status: 'draft' })),
  );
  const navigate = vi.fn();

  let objectUrlCounter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-url-${objectUrlCounter++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  TestBed.configureTestingModule({
    imports: [ExamVersionsPanelComponent],
    providers: [
      {
        provide: ExamVersionsService,
        useValue: {
          listVersions,
          downloadAsset,
          downloadVersionsZip,
          generateVersions,
          latestVersionJob,
          streamVersionJob,
        },
      },
      { provide: ExamsService, useValue: { getExam, duplicateExam } },
      { provide: Router, useValue: { navigate } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: new Map([['examId', 'exam-1']]) } },
      },
    ],
  });

  const fixture = TestBed.createComponent(ExamVersionsPanelComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return {
    fixture,
    compiled,
    listVersions,
    downloadAsset,
    downloadVersionsZip,
    generateVersions,
    latestVersionJob,
    streamVersionJob,
    getExam,
    duplicateExam,
    navigate,
  };
}

function openGeneratePanel(compiled: HTMLElement, fixture: { detectChanges: () => void }): void {
  (
    compiled.querySelector('[data-testid="generate-more-versions"] button') as HTMLButtonElement
  ).click();
  fixture.detectChanges();
}

function selectVersionCount(
  compiled: HTMLElement,
  fixture: { detectChanges: () => void },
  label: string,
): void {
  const container = compiled.querySelector('[data-testid="version-count-select"]') as HTMLElement;
  if (!container) {
    throw new Error('version count select not found');
  }
  (container.querySelector('button[role="combobox"]') as HTMLButtonElement).click();
  fixture.detectChanges();
  const option = Array.from(container.querySelectorAll('[data-testid="select-option"]')).find(
    (li) => li.textContent?.trim() === label,
  ) as HTMLElement | undefined;
  if (!option) {
    throw new Error(`version count option "${label}" not found`);
  }
  option.click();
  fixture.detectChanges();
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

      const pdfLinks = compiled.querySelectorAll<HTMLAnchorElement>(
        '[data-testid="version-pdf-link"]',
      );
      const answerLinks = compiled.querySelectorAll<HTMLAnchorElement>(
        '[data-testid="version-answer-link"]',
      );
      expect(pdfLinks.length).toBe(3);
      expect(answerLinks.length).toBe(3);
      expect(pdfLinks[0].getAttribute('href')).toMatch(/^blob:/);
      expect(answerLinks[0].getAttribute('href')).toMatch(/^blob:/);
    });

    /**
     * Audit 2026-08-15: los links por forma tenían `download=""` sobre un
     * `blob:`, así que el archivo se guardaba con el UUID del blob
     * (`05ad20b5-….pdf`) — imposible saber cuál es cuál después de bajar dos
     * exámenes. Los nombres DENTRO del ZIP ya eran correctos; los de afuera no.
     */
    it('names each downloaded PDF after the exam and its forma, not the blob id', () => {
      const { compiled } = setup({});

      const pdfLink = compiled.querySelector<HTMLAnchorElement>(
        '[data-testid="version-pdf-link"]',
      )!;
      const answerLink = compiled.querySelector<HTMLAnchorElement>(
        '[data-testid="version-answer-link"]',
      )!;

      expect(pdfLink.getAttribute('download')).toBe('Examen de Biología — Forma A.pdf');
      expect(answerLink.getAttribute('download')).toBe('Examen de Biología — Claves A.pdf');
    });

    it('names the ZIP after the exam title', () => {
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      const downloadSpy = vi.spyOn(HTMLAnchorElement.prototype, 'download', 'set');
      const { compiled, fixture } = setup({});

      compiled.querySelector<HTMLButtonElement>('[data-testid="download-zip"] button')!.click();
      fixture.detectChanges();

      expect(downloadSpy).toHaveBeenCalledWith('Examen de Biología — formas.zip');
      clickSpy.mockRestore();
      downloadSpy.mockRestore();
    });

    it('downloads all versions as a ZIP via a blob: object URL when the button is clicked (N1)', () => {
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      const { compiled, fixture, downloadVersionsZip } = setup({});

      const zipButton = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="download-zip"] button',
      );
      expect(zipButton?.disabled).toBe(false);

      zipButton!.click();
      fixture.detectChanges();

      expect(downloadVersionsZip).toHaveBeenCalledWith('exam-1');
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
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

    /**
     * Audit finding P1: every other screen with an error state (Panel de
     * banco, Exámenes, Cola, Historial) offers "Reintentar" — this was the
     * only one without it, leaving a page reload as the sole recourse.
     */
    it('offers a "Reintentar" button on the generic error state that reloads the versions list', () => {
      let attempt = 0;
      const { compiled, fixture, listVersions } = setup({
        listVersionsImpl: () =>
          attempt++ === 0 ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(VERSIONS),
      });

      const retryButton = compiled.querySelector(
        '[data-testid="retry-button"] button',
      ) as HTMLButtonElement;
      expect(retryButton).toBeTruthy();

      retryButton.click();
      fixture.detectChanges();

      expect(listVersions).toHaveBeenCalledTimes(2);
      expect(compiled.querySelectorAll('[data-testid="version-row"]').length).toBe(3);
      expect(compiled.querySelector('[data-testid="error-state"]')).toBeFalsy();
    });
  });

  describe('header (F8)', () => {
    it('calls getExam(examId) and renders title, grade label and status tag', () => {
      const { compiled, getExam } = setup({});

      expect(getExam).toHaveBeenCalledWith('exam-1');
      expect(compiled.querySelector('[data-testid="exam-title"]')?.textContent).toContain(
        'Examen de Biología',
      );
      expect(compiled.querySelector('[data-testid="exam-grade"]')?.textContent).toContain(
        '2° secundaria',
      );
      expect(compiled.querySelector('[data-testid="exam-status-tag"]')?.textContent).toContain(
        'Generado',
      );
    });

    it('shows "Borrador" tag for a draft exam', () => {
      const { compiled } = setup({ getExamImpl: () => of({ ...EXAM_DETAIL, status: 'draft' }) });

      expect(compiled.querySelector('[data-testid="exam-status-tag"]')?.textContent).toContain(
        'Borrador',
      );
    });

    it('"Usar de plantilla" duplicates the exam and navigates to the copy\'s builder route', () => {
      const { compiled, duplicateExam, navigate } = setup({});

      (
        compiled.querySelector('[data-testid="use-as-template"] button') as HTMLButtonElement
      ).click();

      expect(duplicateExam).toHaveBeenCalledWith('exam-1');
      expect(navigate).toHaveBeenCalledWith(['/app/exams', 'exam-copy']);
    });

    it('shows an inline error if duplicating fails, without breaking the versions list', () => {
      const { compiled, fixture } = setup({
        duplicateExamImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });

      (
        compiled.querySelector('[data-testid="use-as-template"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="action-error"]')).toBeTruthy();
      expect(compiled.querySelectorAll('[data-testid="version-row"]').length).toBe(3);
    });
  });

  describe('generar más formas — regeneración inline (F8 fix)', () => {
    it('shows the inline "¿Cuántas formas?" selector (2/3/4/5) with a replace warning on click, without navigating anywhere', () => {
      const { compiled, fixture, navigate } = setup({});

      expect(compiled.querySelector('[data-testid="generate-count-panel"]')).toBeFalsy();

      openGeneratePanel(compiled, fixture);

      expect(navigate).not.toHaveBeenCalled();
      expect(compiled.querySelector('[data-testid="generate-count-panel"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="generate-warning"]')?.textContent).toContain(
        'Se reemplazarán las formas actuales',
      );

      const container = compiled.querySelector(
        '[data-testid="version-count-select"]',
      ) as HTMLElement;
      (container.querySelector('button[role="combobox"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      const labels = Array.from(container.querySelectorAll('[data-testid="select-option"]')).map(
        (o) => o.textContent?.trim(),
      );
      expect(labels).toEqual(['2', '3', '4', '5']);
    });

    it('clicking the toggle again hides the panel', () => {
      const { compiled, fixture } = setup({});

      openGeneratePanel(compiled, fixture);
      expect(compiled.querySelector('[data-testid="generate-count-panel"]')).toBeTruthy();

      openGeneratePanel(compiled, fixture);
      expect(compiled.querySelector('[data-testid="generate-count-panel"]')).toBeFalsy();
    });

    it('confirming asks for confirmation before replacing existing formas, then calls generateVersions(examId, n)', () => {
      const { compiled, fixture, generateVersions } = setup({});

      openGeneratePanel(compiled, fixture);
      selectVersionCount(compiled, fixture, '4');
      (
        compiled.querySelector(
          '[data-testid="confirm-generate-versions"] button',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(generateVersions).not.toHaveBeenCalled();
      (
        compiled.querySelector('[data-testid="generate-confirm-yes"] button') as HTMLButtonElement
      ).click();

      expect(generateVersions).toHaveBeenCalledWith('exam-1', 4);
    });

    it('streams live progress while the worker runs, then reloads listVersions and closes the panel when the job completes', () => {
      const stream = new Subject<ExamVersionJob>();
      const { compiled, fixture, listVersions } = setup({
        generateVersionsImpl: () => of(job({ versionCount: 3 })),
        streamVersionJobImpl: () => stream.asObservable(),
      });

      openGeneratePanel(compiled, fixture);
      (
        compiled.querySelector(
          '[data-testid="confirm-generate-versions"] button',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        compiled.querySelector('[data-testid="generate-confirm-yes"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      // The POST resolving means "queued", not "done" — the list must NOT be
      // reloaded yet, and the screen stays in its generating state.
      expect(listVersions).toHaveBeenCalledTimes(1);
      expect(compiled.querySelector('[data-testid="versions-skeleton"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="version-row"]')).toBeFalsy();

      stream.next(job({ versionCount: 3, status: 'running', completedCount: 1 }));
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="generate-progress"]')?.textContent).toContain(
        '1 de 3 formas',
      );
      expect(listVersions).toHaveBeenCalledTimes(1);

      stream.next(job({ versionCount: 3, status: 'completed', completedCount: 3 }));
      stream.complete();
      fixture.detectChanges();

      expect(listVersions).toHaveBeenCalledTimes(2);
      expect(compiled.querySelector('[data-testid="generate-count-panel"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="versions-skeleton"]')).toBeFalsy();
    });

    describe('aria-live progress announcements (audit P2 — a11y)', () => {
      it('announces the start of the job and the terminal success, without repeating on every SSE frame', () => {
        const stream = new Subject<ExamVersionJob>();
        const { compiled, fixture } = setup({
          generateVersionsImpl: () => of(job({ versionCount: 4 })),
          streamVersionJobImpl: () => stream.asObservable(),
        });

        openGeneratePanel(compiled, fixture);
        (
          compiled.querySelector(
            '[data-testid="confirm-generate-versions"] button',
          ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();
        (
          compiled.querySelector('[data-testid="generate-confirm-yes"] button') as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        const region = compiled.querySelector('[data-testid="version-job-live-region"]')!;
        expect(region.getAttribute('aria-live')).toBe('polite');
        expect(region.textContent).toContain('Generando 4 formas');

        // Same milestone bucket as the queued job (0/4) — must not re-announce.
        stream.next(job({ versionCount: 4, status: 'pending', completedCount: 0 }));
        fixture.detectChanges();
        expect(region.textContent).toContain('Generando 4 formas');

        stream.next(job({ versionCount: 4, status: 'completed', completedCount: 4 }));
        fixture.detectChanges();
        expect(region.textContent).toContain('4 de 4 formas');
        expect(region.textContent).not.toContain('Generando');
      });

      it('announces a total failure distinctly from a partial one', () => {
        const { compiled, fixture } = setup({
          generateVersionsImpl: () => of(job()),
          streamVersionJobImpl: () =>
            of(job({ status: 'failed', completedCount: 0, failedReason: 'Typst no compiló' })),
        });

        openGeneratePanel(compiled, fixture);
        (
          compiled.querySelector(
            '[data-testid="confirm-generate-versions"] button',
          ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();
        (
          compiled.querySelector('[data-testid="generate-confirm-yes"] button') as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        const region = compiled.querySelector('[data-testid="version-job-live-region"]')!;
        expect(region.textContent).toContain('No se pudo generar ninguna forma');
      });
    });

    it('reports a PARTIAL failure honestly — the forms that generated stay listed, not hidden behind a blanket error', () => {
      const { compiled, fixture, listVersions } = setup({
        generateVersionsImpl: () => of(job({ versionCount: 3 })),
        streamVersionJobImpl: () =>
          of(
            job({
              versionCount: 3,
              status: 'failed',
              completedCount: 2,
              failedReason: 'figura inválida',
            }),
          ),
      });

      openGeneratePanel(compiled, fixture);
      (
        compiled.querySelector(
          '[data-testid="confirm-generate-versions"] button',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        compiled.querySelector('[data-testid="generate-confirm-yes"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      const banner = compiled.querySelector('[data-testid="generate-partial-failure"]');
      expect(banner?.textContent).toContain('2 de 3 formas');
      expect(
        compiled.querySelector('[data-testid="generate-failure-reason"]')?.textContent,
      ).toContain('figura inválida');
      expect(compiled.querySelector('[data-testid="generate-total-failure"]')).toBeFalsy();
      // The list was still refreshed — those PDFs are downloadable.
      expect(listVersions).toHaveBeenCalledTimes(2);
    });

    it('reports a job that produced nothing as a total failure, with a retry', () => {
      const { compiled, fixture, generateVersions } = setup({
        generateVersionsImpl: () => of(job()),
        streamVersionJobImpl: () =>
          of(job({ status: 'failed', completedCount: 0, failedReason: 'Typst no compiló' })),
      });

      openGeneratePanel(compiled, fixture);
      (
        compiled.querySelector(
          '[data-testid="confirm-generate-versions"] button',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        compiled.querySelector('[data-testid="generate-confirm-yes"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="generate-total-failure"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="generate-partial-failure"]')).toBeFalsy();

      (compiled.querySelector('[data-testid="retry-generate-job"]') as HTMLButtonElement).click();
      expect(generateVersions).toHaveBeenCalledTimes(2);
    });

    describe('watchdog / silent connection drop (audit P0)', () => {
      it('shows a connection-lost banner (NOT a failed job) and keeps the last-known progress when the stream watchdog fires', () => {
        const stream = new Subject<ExamVersionJob>();
        // First call is the constructor's own reattach check (nothing in
        // flight yet, matching every other test's default); the SECOND call
        // is the watchdog's own settling GET, once generation is under way.
        let latestCalls = 0;
        const { compiled, fixture } = setup({
          generateVersionsImpl: () => of(job({ versionCount: 3 })),
          streamVersionJobImpl: () => stream.asObservable(),
          latestVersionJobImpl: () =>
            of(
              latestCalls++ === 0
                ? null
                : job({ versionCount: 3, status: 'running', completedCount: 1 }),
            ),
        });

        openGeneratePanel(compiled, fixture);
        (
          compiled.querySelector(
            '[data-testid="confirm-generate-versions"] button',
          ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();
        (
          compiled.querySelector('[data-testid="generate-confirm-yes"] button') as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        stream.next(job({ versionCount: 3, status: 'running', completedCount: 1 }));
        fixture.detectChanges();
        stream.error(new TimeoutError());
        fixture.detectChanges();

        expect(compiled.querySelector('[data-testid="connection-lost-banner"]')).toBeTruthy();
        // A dropped stream must NOT be reported as a failed job.
        expect(compiled.querySelector('[data-testid="generate-total-failure"]')).toBeFalsy();
        expect(compiled.querySelector('[data-testid="generate-partial-failure"]')).toBeFalsy();
        // Last known progress stays visible — not reset to zero.
        expect(compiled.querySelector('[data-testid="generate-progress"]')?.textContent).toContain(
          '1 de 3 formas',
        );
      });

      it('settles the connection-lost state and reloads the versions list once the recovery GET reports the job is terminal', () => {
        const stream = new Subject<ExamVersionJob>();
        let latestCalls = 0;
        const { compiled, fixture, listVersions } = setup({
          generateVersionsImpl: () => of(job({ versionCount: 3 })),
          streamVersionJobImpl: () => stream.asObservable(),
          latestVersionJobImpl: () =>
            of(
              latestCalls++ === 0
                ? null
                : job({ versionCount: 3, status: 'completed', completedCount: 3 }),
            ),
        });

        openGeneratePanel(compiled, fixture);
        (
          compiled.querySelector(
            '[data-testid="confirm-generate-versions"] button',
          ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();
        (
          compiled.querySelector('[data-testid="generate-confirm-yes"] button') as HTMLButtonElement
        ).click();
        fixture.detectChanges();
        listVersions.mockClear();

        stream.error(new TimeoutError());
        fixture.detectChanges();

        expect(compiled.querySelector('[data-testid="connection-lost-banner"]')).toBeFalsy();
        expect(listVersions).toHaveBeenCalledTimes(1);
      });

      it('reconnect() re-opens the version-job stream without resetting progress already on screen', () => {
        const stream = new Subject<ExamVersionJob>();
        let streamCalls = 0;
        let latestCalls = 0;
        const { compiled, fixture, streamVersionJob } = setup({
          generateVersionsImpl: () => of(job({ versionCount: 3 })),
          streamVersionJobImpl: () =>
            streamCalls++ === 0
              ? stream.asObservable()
              : of(job({ versionCount: 3, status: 'running', completedCount: 1 })),
          latestVersionJobImpl: () =>
            of(
              latestCalls++ === 0
                ? null
                : job({ versionCount: 3, status: 'running', completedCount: 1 }),
            ),
        });

        openGeneratePanel(compiled, fixture);
        (
          compiled.querySelector(
            '[data-testid="confirm-generate-versions"] button',
          ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();
        (
          compiled.querySelector('[data-testid="generate-confirm-yes"] button') as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        stream.next(job({ versionCount: 3, status: 'running', completedCount: 1 }));
        fixture.detectChanges();
        stream.error(new TimeoutError());
        fixture.detectChanges();

        expect(compiled.querySelector('[data-testid="connection-lost-banner"]')).toBeTruthy();
        expect(streamVersionJob).toHaveBeenCalledTimes(1);

        (
          compiled.querySelector('[data-testid="reconnect-button"] button') as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        expect(streamVersionJob).toHaveBeenCalledTimes(2);
        expect(compiled.querySelector('[data-testid="connection-lost-banner"]')).toBeFalsy();
        expect(compiled.querySelector('[data-testid="generate-progress"]')?.textContent).toContain(
          '1 de 3 formas',
        );
      });
    });

    it('re-attaches to a generation still running when the screen loads (e.g. started from the exam builder)', () => {
      const { compiled, streamVersionJob } = setup({
        latestVersionJobImpl: () =>
          of(job({ status: 'running', completedCount: 1, versionCount: 2 })),
        streamVersionJobImpl: () => new Subject<ExamVersionJob>().asObservable(),
      });

      expect(streamVersionJob).toHaveBeenCalledWith('exam-1', 'job-1');
      expect(compiled.querySelector('[data-testid="generate-progress"]')?.textContent).toContain(
        '1 de 2 formas',
      );
    });

    it('shows an error banner with a retry action when the enqueue itself is rejected, keeping the existing versions visible', () => {
      const { compiled, fixture, generateVersions, listVersions } = setup({
        generateVersionsImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });

      openGeneratePanel(compiled, fixture);
      (
        compiled.querySelector(
          '[data-testid="confirm-generate-versions"] button',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        compiled.querySelector('[data-testid="generate-confirm-yes"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="generate-error"]')).toBeTruthy();
      expect(compiled.querySelectorAll('[data-testid="version-row"]').length).toBe(3);
      expect(listVersions).toHaveBeenCalledTimes(1);

      (compiled.querySelector('[data-testid="retry-generate"]') as HTMLButtonElement).click();

      expect(generateVersions).toHaveBeenCalledTimes(2);
    });
  });

  describe('ver contenido (F8)', () => {
    it('is collapsed by default', () => {
      const { compiled } = setup({});

      expect(compiled.querySelector('[data-testid="exam-content-list"]')).toBeFalsy();
    });

    it('expands to show read-only questions (number + short summary) on toggle, and collapses again on a second click', () => {
      const { compiled, fixture } = setup({});

      const toggle = compiled.querySelector('[data-testid="toggle-content"]') as HTMLButtonElement;
      toggle.click();
      fixture.detectChanges();

      const items = compiled.querySelectorAll('[data-testid="exam-content-item"]');
      expect(items.length).toBe(2);
      expect(items[0].textContent).toContain('1');
      expect(items[0].textContent).toContain('¿Cuál es la unidad básica de la vida?');
      expect(items[1].textContent).toContain('2');
      expect(items[1].textContent).toContain('Pregunta con imagen');

      toggle.click();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="exam-content-list"]')).toBeFalsy();
    });
  });
});
