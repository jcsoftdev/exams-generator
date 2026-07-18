import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ExamsService } from '../exams.service';
import { CreateExamResult, ExamQuestionSummary, ExamStatus } from '../exams.models';

/**
 * Review + replace + confirm (design doc §5.3 steps 4-5). Given the exam
 * `POST /exams` just returned, fetches detail for every selected question
 * id, lets the teacher reroll (random alternative) or manually replace any
 * question, then confirms the selection (`draft` -> `ready`).
 *
 * GAP: there is no `GET /exams/:examId` endpoint — this component only
 * knows about the exam it received as `[exam]` from `ExamCreateComponent`;
 * it cannot be deep-linked or reloaded from a route param. `getQuestionById`
 * calls the bank module's `GET /bank/questions/:id` per selected id (see
 * ExamsService) since `POST /exams` only returns bare ids.
 */
@Component({
  selector: 'app-exam-review',
  imports: [FormsModule],
  templateUrl: './exam-review.component.html',
})
export class ExamReviewComponent implements OnInit {
  private readonly examsService = inject(ExamsService);

  readonly exam = input.required<CreateExamResult>();

  protected readonly questions = signal<ExamQuestionSummary[]>([]);
  protected readonly status = signal<ExamStatus>('draft');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly manualReplacementIds = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.status.set(this.exam().status);
    for (const questionId of this.exam().selectedQuestionIds) {
      this.examsService.getQuestionById(questionId).subscribe((question) => {
        this.questions.update((current) => [...current, question]);
      });
    }
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

    this.examsService.replaceQuestion(this.exam().id, questionId, payload).subscribe({
      next: (result) => {
        this.examsService.getQuestionById(result.newQuestionId).subscribe((question) => {
          this.questions.update((current) => current.map((q) => (q.id === questionId ? question : q)));
        });
      },
      error: (_error: HttpErrorResponse) => {
        this.errorMessage.set('Could not replace the question. Please try again.');
      },
    });
  }

  protected confirm(): void {
    this.errorMessage.set(null);

    this.examsService.confirmExam(this.exam().id).subscribe({
      next: (result) => {
        this.status.set(result.status);
      },
      error: (_error: HttpErrorResponse) => {
        this.errorMessage.set('Could not confirm the exam. Please try again.');
      },
    });
  }
}
