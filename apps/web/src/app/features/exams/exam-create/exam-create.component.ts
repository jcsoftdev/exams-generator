import { Component, signal } from '@angular/core';
import { ExamBlueprintComponent } from '../exam-blueprint/exam-blueprint.component';
import { ExamReviewComponent } from '../exam-review/exam-review.component';
import { CreateExamResult } from '../exams.models';

/**
 * Container for exam creation (design doc §5.3): shows the blueprint
 * builder first, then swaps to the review/replace/confirm screen once
 * `POST /exams` succeeds. Holds the created exam in a plain signal instead
 * of a route param because there is no `GET /exams/:examId` endpoint yet
 * (see ExamsService) — this is the single place that gap is worked around.
 */
@Component({
  selector: 'app-exam-create',
  imports: [ExamBlueprintComponent, ExamReviewComponent],
  templateUrl: './exam-create.component.html',
})
export class ExamCreateComponent {
  protected readonly exam = signal<CreateExamResult | null>(null);

  protected onExamCreated(result: CreateExamResult): void {
    this.exam.set(result);
  }
}
