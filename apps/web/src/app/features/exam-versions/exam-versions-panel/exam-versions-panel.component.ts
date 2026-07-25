import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, Folder, CopyPlus, ChevronDown, Plus, Check } from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { TagVariant } from '../../../ui/ui.types';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { ModalComponent } from '../../../ui/modal/modal.component';
import { ExamVersionsService } from '../exam-versions.service';
import { ExamVersion } from '../exam-versions.models';
import { ExamsService } from '../../exams/exams.service';
import { ExamDetail, ExamDetailQuestion, GRADE_LEVEL_LABELS, GradeLevel } from '../../exams/exams.models';

/** "¿Cuántas formas?" mockup step 3 (design doc §5.2) — only these counts are offered. */
const VERSION_COUNT_OPTIONS: readonly number[] = [2, 3, 4, 5];
const DEFAULT_VERSION_COUNT = 2;

/**
 * Standalone versions screen (design doc §6, spec VS-R1..R3). Reads the
 * authoritative list via `GET /exams/:id/versions` (B4) and builds
 * authenticated `blob:` download links (DECISION B4-A/G3 — `/assets/:id` is
 * Bearer-JWT protected, a plain `<a href>` can't send that header).
 *
 * "Generar más formas" (design doc §2.3/5.2) regenerates INLINE here via
 * `ExamVersionsService.generateVersions` — it used to navigate to
 * `ExamReviewComponent` (`/app/exams/:id`), but that screen disables
 * everything once the exam is `ready`, making it a dead end. The backend
 * regeneration is idempotent (B4 ⚠): confirming REPLACES the exam's
 * existing formas, hence the inline warning before firing the request.
 *
 * 404 (exam not found / cross-tenant, B4-R2) renders a state DISTINCT from
 * "zero versions" (B4-R3, both are valid non-error outcomes) and from a
 * generic 4xx/5xx failure (SCR-G3).
 */
@Component({
  selector: 'app-exam-versions-panel',
  standalone: true,
  // `<lucide-icon>` is used both here (plantilla/generar/colapsable icons)
  // and inside the nested `ui-empty-state` primitive, so the module itself
  // goes in `imports` this time (not just `.pick()`'s providers).
  imports: [ButtonComponent, EmptyStateComponent, TagComponent, SelectComponent, ModalComponent, LucideAngularModule],
  // `ui-select` ("¿Cuántas formas?") needs Check too — this component-level
  // `.pick()` shadows the root `app.config.ts` registration for its subtree.
  providers: [LucideAngularModule.pick({ Folder, CopyPlus, ChevronDown, Plus, Check }).providers ?? []],
  templateUrl: './exam-versions-panel.component.html',
})
export class ExamVersionsPanelComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly examVersionsService = inject(ExamVersionsService);
  private readonly examsService = inject(ExamsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly examId = signal(this.route.snapshot.paramMap.get('examId') ?? '');

  protected readonly loading = signal(false);
  protected readonly notFound = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly versions = signal<ExamVersion[]>([]);

  /** relative asset path (`/assets/:id`) -> `blob:` object URL. */
  protected readonly downloadUrls = signal<Record<string, string>>({});
  private readonly objectUrls: string[] = [];

  // Header (design doc §2 "Detalle"): title/grado/tag estado + "Usar de
  // plantilla" — sourced from `GET /exams/:examId` (ExamsService.getExam),
  // fetched independently of `listVersions` above (own signal, own request)
  // so a failure here never breaks the versions list.
  protected readonly examDetail = signal<ExamDetail | null>(null);
  protected readonly actionError = signal<string | null>(null);

  // "Ver contenido" — collapsed by default (design doc §2.4).
  protected readonly contentOpen = signal(false);

  // "Generar más formas" inline regeneration (design doc §2.3/5.2).
  protected readonly versionCountOptions: readonly SelectOption<number>[] = VERSION_COUNT_OPTIONS.map((n) => ({
    value: n,
    label: String(n),
  }));
  protected readonly showGenerateForm = signal(false);
  protected readonly versionCount = signal(DEFAULT_VERSION_COUNT);
  protected readonly generating = signal(false);
  protected readonly generateError = signal<string | null>(null);
  protected readonly pendingGenerate = signal(false);
  protected readonly skeletonRows = [0, 1, 2];

  // "Descargar todo (ZIP)" (design doc §5.2, N1).
  protected readonly downloadingZip = signal(false);

  constructor() {
    this.load();
    this.loadExamDetail();
    this.destroyRef.onDestroy(() => {
      for (const url of this.objectUrls) {
        URL.revokeObjectURL(url);
      }
    });
  }

  private loadExamDetail(): void {
    this.examsService.getExam(this.examId()).subscribe({
      next: (exam) => this.examDetail.set(exam),
      // Header simply stays hidden on failure — the versions list below
      // already surfaces not-found/error states for this exam id.
      error: () => undefined,
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

  // Same status-tag/grade-label convention as ExamListComponent (kept as a
  // local duplicate per that file's own convention — see exams.models.ts).
  protected statusTag(status: string): TagVariant {
    return status === 'ready' ? 'easy' : 'medium';
  }
  protected statusLabel(status: string): string {
    return status === 'ready' ? 'Generado' : 'Borrador';
  }
  protected gradeLabel(g: string): string {
    return GRADE_LEVEL_LABELS[g as GradeLevel] ?? g;
  }

  /**
   * "Usar de plantilla" (design doc §2.1, S2) — duplicates this exam
   * (`POST /exams/:id/duplicate`) and navigates to the copy's builder route,
   * same target ExamListComponent.duplicate() uses for consistency.
   */
  protected useAsTemplate(): void {
    this.actionError.set(null);
    this.examsService.duplicateExam(this.examId()).subscribe({
      next: (copy) => this.router.navigate(['/app/exams', copy.id]),
      error: () => this.actionError.set('No se pudo duplicar el examen. Inténtalo de nuevo.'),
    });
  }

  /** "Generar más formas" (design doc §2.3) — toggles the inline count-picker panel. */
  protected toggleGenerateForm(): void {
    this.generateError.set(null);
    this.showGenerateForm.update((open) => !open);
  }

  /**
   * "Generar" inside the count-picker panel — the backend REPLACES the
   * exam's existing formas, so an existing non-empty list goes through the
   * same `ui-modal` confirm pattern as every other destructive action
   * (audit P1). First-time generation (nothing to replace) skips the modal.
   */
  protected requestGenerate(): void {
    if (this.versions().length > 0) {
      this.pendingGenerate.set(true);
      return;
    }
    this.confirmGenerate();
  }

  protected cancelGenerate(): void {
    this.pendingGenerate.set(false);
  }

  /**
   * Calls the SAME idempotent endpoint the exam-builder screen uses
   * (`ExamVersionsService.generateVersions`, B3). On success, reload
   * `listVersions` (B4, the single source of truth for download links) so
   * the list reflects the freshly-generated formas.
   */
  protected confirmGenerate(): void {
    this.pendingGenerate.set(false);
    this.generateError.set(null);
    this.generating.set(true);
    this.examVersionsService.generateVersions(this.examId(), this.versionCount()).subscribe({
      next: () => {
        this.generating.set(false);
        this.showGenerateForm.set(false);
        this.load();
      },
      error: () => {
        this.generating.set(false);
        this.generateError.set('No se pudieron generar las formas. Inténtalo de nuevo.');
      },
    });
  }

  /**
   * "Descargar todo (ZIP)" (design doc §5.2, N1) — fetches the ZIP through
   * `HttpClient` (Bearer-JWT protected, so no plain `<a href>`), turns it into
   * a `blob:` object URL, and triggers a browser save via a transient anchor.
   * The object URL is revoked right after to avoid leaking (unlike the
   * per-version links, which stay alive for the page's lifetime).
   */
  protected downloadZip(): void {
    if (this.downloadingZip() || this.versions().length === 0) {
      return;
    }
    this.actionError.set(null);
    this.downloadingZip.set(true);
    this.examVersionsService.downloadVersionsZip(this.examId()).subscribe({
      next: (blob) => {
        this.downloadingZip.set(false);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `examen-${this.examId()}-versiones.zip`;
        anchor.click();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.downloadingZip.set(false);
        this.actionError.set('No se pudo descargar el ZIP. Inténtalo de nuevo.');
      },
    });
  }

  protected toggleContent(): void {
    this.contentOpen.update((open) => !open);
  }

  /** Short read-only summary for the collapsed "Ver contenido" list — no new endpoint, only fields `getExam` already returns. */
  protected questionSummary(question: ExamDetailQuestion): string {
    if (question.type === 'image') {
      return 'Pregunta con imagen';
    }
    const raw = (question.bodyTypst ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) {
      return 'Pregunta estructurada';
    }
    return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
  }
}
