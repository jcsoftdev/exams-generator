import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { ExamsService } from '../exams.service';
import { ExamDetailQuestion, ExamStatus } from '../exams.models';

/**
 * Review + replace + confirm (design doc §5.3 steps 4-5). Reads the exam id
 * from the `:examId` route param (see app.routes.ts) and loads the full
 * exam detail via `GET /exams/:examId` (`ExamsService.getExam`) — this makes
 * the review screen deep-linkable and reload-safe (state used to live only
 * in an `[exam]` input signal held by `ExamCreateComponent`, which was lost
 * on refresh; see git history for that GAP note).
 */
@Component({
  selector: 'app-exam-review',
  imports: [FormsModule],
  templateUrl: './exam-review.component.html',
})
export class ExamReviewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly examsService = inject(ExamsService);

  protected readonly examId = signal(this.route.snapshot.paramMap.get('examId') ?? '');
  protected readonly title = signal('');
  protected readonly questions = signal<readonly ExamDetailQuestion[]>([]);
  protected readonly status = signal<ExamStatus>('draft');
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly manualReplacementIds = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.loadExam();
  }

  private loadExam(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.examsService.getExam(this.examId()).subscribe({
      next: (exam) => {
        this.title.set(exam.title);
        this.status.set(exam.status);
        this.questions.set(exam.questions);
        this.loading.set(false);
      },
      error: (_error: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMessage.set('Could not load the exam. Please try again.');
      },
    });
  }

  protected onManualReplacementInput(questionId: string, value: string): void {
    this.manualReplacementIds.update((current) => ({ ...current, [questionId]: value }));
  }

  protected reroll(questionId: string): void {
    this.replace(questionId, { mode: 'reroll' });
  }

  protected manualReplace(questionId: string): void {
    const replacementQuestionId = this.manualReplacementIds()[questionId];
    if (!replacementQuestionId) {
      return;
    }
    this.replace(questionId, { mode: 'manual', replacementQuestionId });
  }

  private replace(questionId: string, payload: { mode: 'reroll' } | { mode: 'manual'; replacementQuestionId: string }): void {
    if (this.status() === 'ready') {
      return;
    }

    this.errorMessage.set(null);

    this.examsService.replaceQuestion(this.examId(), questionId, payload).subscribe({
      next: () => {
        this.loadExam();
      },
      error: (_error: HttpErrorResponse) => {
        this.errorMessage.set('Could not replace the question. Please try again.');
      },
    });
  }

  protected confirm(): void {
    this.errorMessage.set(null);

    this.examsService.confirmExam(this.examId()).subscribe({
      next: (result) => {
        this.status.set(result.status);
      },
      error: (_error: HttpErrorResponse) => {
        this.errorMessage.set('Could not confirm the exam. Please try again.');
      },
    });
  }
}
