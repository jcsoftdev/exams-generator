import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { ExamVersionsService } from '../exam-versions.service';
import { ExamVersion } from '../exam-versions.models';

/**
 * Standalone versions screen (design doc §6, spec VS-R1..R3). Display-only:
 * generation happens on the exam-builder screen (`POST /exams/:id/versions`,
 * B3 auto-confirm), which navigates HERE afterward. This screen's only job
 * is to read the authoritative list via `GET /exams/:id/versions` (B4) and
 * build authenticated `blob:` download links (DECISION B4-A/G3 — `/assets/:id`
 * is Bearer-JWT protected, a plain `<a href>` can't send that header).
 *
 * 404 (exam not found / cross-tenant, B4-R2) renders a state DISTINCT from
 * "zero versions" (B4-R3, both are valid non-error outcomes) and from a
 * generic 4xx/5xx failure (SCR-G3).
 */
@Component({
  selector: 'app-exam-versions-panel',
  standalone: true,
  imports: [ButtonComponent, EmptyStateComponent],
  templateUrl: './exam-versions-panel.component.html',
})
export class ExamVersionsPanelComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly examVersionsService = inject(ExamVersionsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly examId = signal(this.route.snapshot.paramMap.get('examId') ?? '');

  protected readonly loading = signal(false);
  protected readonly notFound = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly versions = signal<ExamVersion[]>([]);

  /** relative asset path (`/assets/:id`) -> `blob:` object URL. */
  protected readonly downloadUrls = signal<Record<string, string>>({});
  private readonly objectUrls: string[] = [];

  constructor() {
    this.load();
    this.destroyRef.onDestroy(() => {
      for (const url of this.objectUrls) {
        URL.revokeObjectURL(url);
      }
    });
  }

  private load(): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.errorMessage.set(null);

    this.examVersionsService.listVersions(this.examId()).subscribe({
      next: (versions) => {
        this.loading.set(false);
        this.versions.set(versions);
        this.loadDownloads(versions);
      },
      error: (error: HttpErrorResponse) => {
        this.loading.set(false);
        if (error.status === 404) {
          this.notFound.set(true);
          return;
        }
        this.errorMessage.set('No se pudieron cargar las versiones. Inténtalo de nuevo.');
      },
    });
  }

  private loadDownloads(versions: readonly ExamVersion[]): void {
    for (const version of versions) {
      for (const assetUrl of [version.pdfUrl, version.answerSheetUrl]) {
        if (!assetUrl || this.downloadUrls()[assetUrl]) {
          continue;
        }
        this.examVersionsService.downloadAsset(assetUrl).subscribe((blob) => {
          const url = URL.createObjectURL(blob);
          this.objectUrls.push(url);
          this.downloadUrls.update((current) => ({ ...current, [assetUrl]: url }));
        });
      }
    }
  }

  protected downloadUrlFor(assetUrl: string): string | null {
    return this.downloadUrls()[assetUrl] ?? null;
  }
}
