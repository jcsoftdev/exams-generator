import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ExamVersionsService } from '../exam-versions.service';
import { GeneratedVersionResult, GenerateVersionsErrorPayload } from '../exam-versions.models';

/**
 * KNOWN LIMITATION: the API has no GET endpoint for previously-generated
 * versions (only `POST /exams/:examId/versions`). This panel therefore
 * GENERATES versions on demand rather than fetching an existing list —
 * re-visiting the route re-generates instead of showing prior results.
 */
@Component({
  selector: 'app-exam-versions-panel',
  imports: [ReactiveFormsModule],
  templateUrl: './exam-versions-panel.component.html',
})
export class ExamVersionsPanelComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);
  private readonly examVersionsService = inject(ExamVersionsService);

  readonly examId = signal(this.route.snapshot.paramMap.get('examId') ?? '');

  readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly versions = signal<GeneratedVersionResult[]>([]);

  readonly form = this.formBuilder.nonNullable.group({
    versionCount: [1, [Validators.required, Validators.min(1)]],
  });

  protected generate(): void {
    if (this.form.invalid || this.loading()) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const versionCount = this.form.getRawValue().versionCount;

    this.examVersionsService.generateVersions(this.examId(), versionCount).subscribe({
      next: (versions) => {
        this.versions.set(versions);
        this.loading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.loading.set(false);
        const payload = error.error as GenerateVersionsErrorPayload | undefined;
        this.errorMessage.set(
          payload?.message
            ? `${payload.message}${payload.questionId ? ` (question: ${payload.questionId})` : ''}`
            : 'Could not generate exam versions. Please try again.',
        );
      },
    });
  }
}
