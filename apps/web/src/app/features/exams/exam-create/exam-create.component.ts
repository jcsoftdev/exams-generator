import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ExamBlueprintComponent } from '../exam-blueprint/exam-blueprint.component';
import { CreateExamResult } from '../exams.models';

/**
 * Container for exam creation (design doc §5.3): shows the blueprint
 * builder, then navigates to `/app/exams/:examId` (`ExamReviewComponent`)
 * once `POST /exams` succeeds. The review screen now loads its own state
 * via `GET /exams/:examId` (`ExamsService.getExam`), so it no longer needs
 * to be handed the created exam directly — reloading the review route no
 * longer loses state.
 */
@Component({
  selector: 'app-exam-create',
  imports: [ExamBlueprintComponent],
  templateUrl: './exam-create.component.html',
})
export class ExamCreateComponent {
  private readonly router = inject(Router);

  protected onExamCreated(result: CreateExamResult): void {
    this.router.navigate(['/app/exams', result.id]);
  }
}
